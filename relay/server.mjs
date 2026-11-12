// Webhook relay: receives the backend's webhook and streams every message to
// the dashboard. A browser page cannot receive a webhook itself, so this small
// server sits in between. It also saves a photo of each denied person.
//
//   backend ── POST /webhook ──▶ relay ── GET /events (Server-Sent Events) ──▶ dashboard
//                                  └── denied? save a photo ── GET /captures ──▶ dashboard
//
// No dependencies: run with `npm run relay` (reads settings from .env).
//
// Settings (environment variables):
//   RELAY_SECRET           REQUIRED. Shared with the backend. Each webhook must send it as
//                          "Authorization: Bearer <secret>" or "X-Webhook-Secret: <secret>",
//                          or sign the raw body: "X-Signature: sha256=<hex HMAC-SHA256>".
//   RELAY_PORT             Port to listen on (default 8787).
//   RELAY_HOST             Interface to listen on (default 0.0.0.0, so the backend can reach it).
//   RELAY_ALLOWED_ORIGINS  Comma-separated dashboard origins allowed to read /events
//                          (default http://localhost:5173). "*" allows any.
//   RELAY_ALLOWED_IPS      Optional comma-separated IPs allowed to POST /webhook
//                          (this machine is always allowed, for the test script).
//   RELAY_VIEW_KEY         Optional. When set, /events and /captures require ?key=<value>
//                          (set the same value as VITE_RELAY_VIEW_KEY for the dashboard).
//                          Without it, photos can only be viewed from this machine.
//
// Photos of denied people:
//   RELAY_CAPTURES                  "off" to stop saving photos (default on).
//   RELAY_CAMERA_URL                Where to grab a frame when the backend doesn't send an
//                                   image (MJPEG stream or JPEG snapshot URL). Defaults to
//                                   VITE_CAMERA_URL.
//   RELAY_CAPTURE_DIR               Folder for the database (default relay/data, ignored by git).
//   RELAY_CAPTURE_RETENTION_DAYS    Delete photos older than this (default 30; 0 = keep forever).
//   RELAY_CAPTURE_COOLDOWN_MS       Minimum time between photos (default 30000).
//
// Camera health (frame rate, uptime, drops):
//   RELAY_CAMERA_MONITOR            "off" to stop watching the camera (default on when a camera
//                                   URL is set). The relay keeps one connection open to the
//                                   camera; turn it off if the camera only allows one viewer.

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startCameraMonitor } from "./camera-monitor.mjs";
import { decodeBase64Image, fetchImage, openCaptureStore, readAuth, withoutImages } from "./captures.mjs";

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const HOST = process.env.RELAY_HOST ?? "0.0.0.0";
const SECRET = process.env.RELAY_SECRET ?? "";
const VIEW_KEY = process.env.RELAY_VIEW_KEY ?? "";
const ALLOWED_ORIGINS = list(process.env.RELAY_ALLOWED_ORIGINS ?? "http://localhost:5173");
const ALLOWED_IPS = list(process.env.RELAY_ALLOWED_IPS ?? "");
const LOOPBACK = ["127.0.0.1", "::1"];
/** Large enough for a webhook carrying a photo (base64). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** How often the relay sends its webhook statistics (also keeps the stream alive). */
const STATUS_INTERVAL_MS = 5_000;

const CAPTURES_ON = (process.env.RELAY_CAPTURES ?? "on").toLowerCase() !== "off";
const CAMERA_URL = process.env.RELAY_CAMERA_URL || process.env.VITE_CAMERA_URL || "";
const CAPTURE_DIR = process.env.RELAY_CAPTURE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const RETENTION_DAYS = Number(process.env.RELAY_CAPTURE_RETENTION_DAYS ?? 30);
const CAPTURE_COOLDOWN_MS = Number(process.env.RELAY_CAPTURE_COOLDOWN_MS ?? 30_000);
const CAMERA_MONITOR_ON = (process.env.RELAY_CAMERA_MONITOR ?? "on").toLowerCase() !== "off";

if (!SECRET) {
  console.error(
    "[relay] RELAY_SECRET is not set. Add RELAY_SECRET=<long random string> to .env " +
      "and give the same value to the backend team."
  );
  process.exit(1);
}
if (SECRET.length < 16) {
  console.warn("[relay] RELAY_SECRET is shorter than 16 characters. Use a longer random value.");
}

const captures = CAPTURES_ON ? openCaptureStore(CAPTURE_DIR, RETENTION_DAYS) : null;
const camera = CAMERA_URL && CAMERA_MONITOR_ON ? startCameraMonitor(CAMERA_URL) : null;

/** Open dashboard connections. */
const clients = new Set();

/** Webhook health, sent to dashboards as a separate "relay" event (a webhook can't fake it). */
const stats = {
  startedAt: Date.now(),
  lastWebhookAt: null,
  accepted: 0,
  rejected: 0,
  lastRejectedAt: null,
  lastRejectReason: null,
};

function noteRejected(reason) {
  stats.rejected++;
  stats.lastRejectedAt = Date.now();
  stats.lastRejectReason = reason;
  broadcastStatus();
}

function cameraStatus() {
  if (camera) return camera.stats();
  return { state: "off", offReason: CAMERA_URL ? "monitor_off" : "not_configured" };
}

function statusPayload() {
  return { now: Date.now(), ...stats, camera: cameraStatus() };
}

function broadcastStatus() {
  const payload = statusPayload();
  for (const res of clients) send(res, payload, "relay");
}

/**
 * Latest message of each kind, oldest first, replayed to a dashboard when it
 * (re)connects so it shows the current auth state and metrics straight away.
 * A message's kind is its "type"/"event"/"kind" value, or else the set of
 * field names it has, so { auth } and { arm } and metrics are kept apart and
 * replay in the order they arrived. Replays carry the time the relay received
 * them, so old robot status or alerts don't look new.
 */
const snapshot = new Map();
const MAX_SNAPSHOT = 50;

function list(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function clientIp(req) {
  return (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

/** The secret from the headers, if the sender used a header (not a signature). */
function headerToken(req) {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  const header = req.headers["x-webhook-secret"];
  return typeof header === "string" ? header : undefined;
}

function isAuthorized(req, rawBody) {
  const token = headerToken(req);
  if (token !== undefined) return safeEqual(token, SECRET);

  const signature = req.headers["x-signature"] ?? req.headers["x-hub-signature-256"];
  if (typeof signature === "string") {
    const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
    const given = signature.startsWith("sha256=") ? signature : `sha256=${signature}`;
    return safeEqual(given.toLowerCase(), expected);
  }
  return false;
}

function remember(message) {
  if (!isObject(message)) return;
  const kind = [message.type, message.event, message.kind].find((v) => typeof v === "string");
  const key = kind ? `kind:${kind}` : `fields:${Object.keys(message).sort().join(",")}`;
  snapshot.delete(key); // re-insert so the snapshot stays ordered by recency
  snapshot.set(key, { receivedAt: Date.now(), message });
  if (snapshot.size > MAX_SNAPSHOT) snapshot.delete(snapshot.keys().next().value);
}

/** Writes one Server-Sent Event. No event name = a backend message. */
function send(res, data, event) {
  res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(message, event) {
  for (const res of clients) send(res, message, event);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---- Photos of denied people --------------------------------------------------

/** "denied" while the backend is reporting a denied person; one photo per denial. */
let authState = "unknown";
let lastCaptureAt = 0;

/** Saves one photo for a denied person. Runs in the background; never blocks the webhook. */
async function capture(auth) {
  try {
    let photo = null;
    let source = "backend";
    if (auth.imageBase64) photo = decodeBase64Image(auth.imageBase64);
    if (!photo && auth.imageUrl) photo = await fetchImage(auth.imageUrl).catch((err) => {
      console.warn(`[relay] couldn't download the backend's image: ${err.message}`);
      return null;
    });
    if (!photo && CAMERA_URL) {
      source = "camera";
      // The monitor's latest frame if it's fresh; otherwise connect and grab one.
      photo = camera?.latestFrame() ?? await fetchImage(CAMERA_URL).catch((err) => {
        console.warn(`[relay] couldn't grab a camera frame: ${err.message}`);
        return null;
      });
    }
    if (!photo) {
      console.warn("[relay] denied person, but no photo saved: the message had no image and no camera URL is set.");
      return;
    }
    const capturedAt = Date.now();
    const id = captures.add({ capturedAt, confidence: auth.confidence, source, mime: photo.mime, image: photo.image });
    console.log(`[relay] saved photo #${id} of a denied person (from ${source})`);
    broadcast({ id, capturedAt }, "capture");
  } catch (err) {
    console.error("[relay] failed to save photo:", err);
  }
}

function considerCapture(message) {
  const auth = readAuth(message);
  if (!auth) return;
  if (auth.result === "verified") {
    authState = "verified";
    return;
  }
  // Only the first "denied" of a run (the camera may report it every frame), and not too often.
  const isNewDenial = authState !== "denied";
  authState = "denied";
  if (!captures || !isNewDenial || Date.now() - lastCaptureAt < CAPTURE_COOLDOWN_MS) return;
  lastCaptureAt = Date.now();
  void capture(auth);
}

// ---- Webhook ------------------------------------------------------------------

async function handleWebhook(req, res) {
  const ip = clientIp(req);
  if (ALLOWED_IPS.length > 0 && !ALLOWED_IPS.includes(ip) && !LOOPBACK.includes(ip)) {
    console.warn(`[relay] rejected webhook from ${ip}: not in RELAY_ALLOWED_IPS`);
    noteRejected("Sender IP not allowed");
    return json(res, 403, { ok: false, error: "forbidden" });
  }
  // Wrong header secret: refuse before reading a (possibly large) body.
  const token = headerToken(req);
  if (token !== undefined && !safeEqual(token, SECRET)) {
    console.warn(`[relay] rejected webhook from ${ip}: missing or wrong secret`);
    noteRejected("Missing or wrong secret");
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  const raw = await readBody(req);
  if (raw === null) {
    console.warn(`[relay] rejected webhook from ${ip}: body over ${MAX_BODY_BYTES} bytes`);
    noteRejected("Message too large");
    return; // stream was destroyed while reading
  }
  if (!isAuthorized(req, raw)) {
    console.warn(`[relay] rejected webhook from ${ip}: missing or wrong secret`);
    noteRejected("Missing or wrong secret");
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    noteRejected("Not valid JSON");
    return json(res, 400, { ok: false, error: "body must be JSON" });
  }

  const messages = (Array.isArray(body) ? body : [body]).filter(isObject);
  if (messages.length === 0) {
    noteRejected("No JSON objects in message");
    return json(res, 400, { ok: false, error: "expected a JSON object or array of objects" });
  }

  for (const message of messages) {
    considerCapture(message);
    const clean = withoutImages(message); // photos are stored, not broadcast or replayed
    remember(clean);
    broadcast(clean);
  }
  stats.lastWebhookAt = Date.now();
  stats.accepted += messages.length;
  broadcastStatus();
  console.log(`[relay] ${messages.length} message(s) from ${ip} → ${clients.size} dashboard(s)`);
  json(res, 202, { ok: true, delivered: clients.size });
}

// ---- Dashboard access ------------------------------------------------------

function originHeaders(req) {
  const origin = req.headers.origin;
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
}

function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
}

/**
 * Photos are more sensitive than the live feed: with no RELAY_VIEW_KEY they can
 * only be viewed from this machine; with one, the key is required.
 */
function canViewCaptures(req, url) {
  if (VIEW_KEY) return safeEqual(url.searchParams.get("key") ?? "", VIEW_KEY);
  return LOOPBACK.includes(clientIp(req));
}

function handleEvents(req, res, url) {
  if (!originAllowed(req)) {
    console.warn(`[relay] refused dashboard connection from origin ${req.headers.origin}`);
    return json(res, 403, { ok: false, error: "origin not allowed" });
  }
  if (VIEW_KEY && !safeEqual(url.searchParams.get("key") ?? "", VIEW_KEY)) {
    return json(res, 401, { ok: false, error: "wrong or missing view key" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    ...originHeaders(req),
  });
  res.write("retry: 3000\n\n");
  send(res, statusPayload(), "relay");
  for (const entry of snapshot.values()) send(res, { now: Date.now(), ...entry }, "replay");

  clients.add(res);
  console.log(`[relay] dashboard connected (${clients.size} open)`);
  req.on("close", () => {
    clients.delete(res);
    console.log(`[relay] dashboard disconnected (${clients.size} open)`);
  });
}

function handleCaptures(req, res, url) {
  const cors = originHeaders(req);
  if (req.method === "OPTIONS") {
    if (!originAllowed(req)) return json(res, 403, { ok: false, error: "origin not allowed" });
    res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, DELETE", "Access-Control-Max-Age": "600" });
    return res.end();
  }
  if (!captures) return json(res, 404, { ok: false, error: "photo capture is turned off (RELAY_CAPTURES=off)" }, cors);
  if (!originAllowed(req)) {
    console.warn(`[relay] refused photo request from origin ${req.headers.origin}`);
    return json(res, 403, { ok: false, error: "origin not allowed" });
  }
  if (!canViewCaptures(req, url)) {
    return json(res, 403, { ok: false, error: VIEW_KEY ? "wrong or missing view key" : "photos can only be viewed from this computer (or set RELAY_VIEW_KEY)" }, cors);
  }

  const match = url.pathname.match(/^\/captures(?:\/(\d+)(\/image)?)?$/);
  if (!match) return json(res, 404, { ok: false, error: "not found" }, cors);
  const id = match[1] ? Number(match[1]) : null;

  if (req.method === "GET" && id === null) {
    return json(res, 200, { retentionDays: RETENTION_DAYS, cameraConfigured: CAMERA_URL !== "", captures: captures.list() }, { ...cors, "Cache-Control": "no-store" });
  }
  if (req.method === "GET" && id !== null && match[2]) {
    const photo = captures.image(id);
    if (!photo) return json(res, 404, { ok: false, error: "no such photo" }, cors);
    res.writeHead(200, { ...cors, "Content-Type": photo.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return res.end(photo.image);
  }
  if (req.method === "DELETE" && id !== null && !match[2]) {
    const removed = captures.remove(id);
    if (removed) {
      console.log(`[relay] photo #${id} deleted from the dashboard`);
      broadcast({ id, deleted: true }, "capture");
    }
    return json(res, removed ? 200 : 404, { ok: removed }, cors);
  }
  json(res, 405, { ok: false, error: "method not allowed" }, cors);
}

// ---- Server -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://relay");
  if (req.method === "POST" && url.pathname === "/webhook") {
    handleWebhook(req, res).catch((err) => {
      console.error("[relay] webhook error:", err);
      if (!res.headersSent) json(res, 500, { ok: false, error: "relay error" });
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/events") return handleEvents(req, res, url);
  if (url.pathname === "/captures" || url.pathname.startsWith("/captures/")) return handleCaptures(req, res, url);
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, dashboards: clients.size, ...statusPayload() });
  }
  json(res, 404, { ok: false, error: "not found" });
});

setInterval(broadcastStatus, STATUS_INTERVAL_MS).unref();

if (captures) {
  const purge = () => {
    const removed = captures.purge();
    if (removed > 0) console.log(`[relay] deleted ${removed} photo(s) older than ${RETENTION_DAYS} days`);
  };
  purge();
  setInterval(purge, 60 * 60 * 1000).unref();
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[relay] port ${PORT} is already in use. Set RELAY_PORT to another port.`);
  } else {
    console.error("[relay] server error:", err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[relay] listening on http://${HOST}:${PORT}`);
  console.log(`[relay]   backend sends webhooks to  POST /webhook`);
  console.log(`[relay]   dashboard listens on       GET  /events  (allowed origins: ${ALLOWED_ORIGINS.join(", ")})`);
  if (captures) {
    const keep = RETENTION_DAYS > 0 ? `kept ${RETENTION_DAYS} days` : "kept until deleted";
    const from = CAMERA_URL ? "backend image, else camera frame" : "backend image only (no camera URL set)";
    console.log(`[relay]   denied-person photos:      ${from}; ${keep}; ${CAPTURE_DIR}`);
  } else {
    console.log("[relay]   denied-person photos:      off");
  }
  if (camera) console.log(`[relay]   camera health:             watching ${CAMERA_URL}`);
  else console.log(`[relay]   camera health:             off (${CAMERA_URL ? "RELAY_CAMERA_MONITOR=off" : "no camera URL set"})`);
});
