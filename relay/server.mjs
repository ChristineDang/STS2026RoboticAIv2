// Webhook relay: receives the backend's webhook and streams every message to
// the dashboard. A browser page cannot receive a webhook itself, so this small
// server sits in between.
//
//   backend ── POST /webhook ──▶ relay ── GET /events (Server-Sent Events) ──▶ dashboard
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
//   RELAY_VIEW_KEY         Optional. When set, /events requires ?key=<value>
//                          (set the same value as VITE_RELAY_VIEW_KEY for the dashboard).

import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const HOST = process.env.RELAY_HOST ?? "0.0.0.0";
const SECRET = process.env.RELAY_SECRET ?? "";
const VIEW_KEY = process.env.RELAY_VIEW_KEY ?? "";
const ALLOWED_ORIGINS = list(process.env.RELAY_ALLOWED_ORIGINS ?? "http://localhost:5173");
const ALLOWED_IPS = list(process.env.RELAY_ALLOWED_IPS ?? "");
const LOOPBACK = ["127.0.0.1", "::1"];
const MAX_BODY_BYTES = 64 * 1024;
const HEARTBEAT_MS = 15_000;

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

/** Open dashboard connections. */
const clients = new Set();

/**
 * Latest message of each kind, oldest first, replayed to a dashboard when it
 * (re)connects so it shows the current auth state and metrics straight away.
 * A message's kind is its "type"/"event"/"kind" value, or else the set of
 * field names it has, so { auth } and { arm } and metrics are kept apart and
 * replay in the order they arrived.
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

function isAuthorized(req, rawBody) {
  const auth = req.headers["authorization"];
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const header = req.headers["x-webhook-secret"];
  const token = bearer ?? (typeof header === "string" ? header : undefined);
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
  snapshot.set(key, message);
  if (snapshot.size > MAX_SNAPSHOT) snapshot.delete(snapshot.keys().next().value);
}

function send(res, message) {
  res.write(`data: ${JSON.stringify(message)}\n\n`);
}

function broadcast(message) {
  for (const res of clients) send(res, message);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
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

async function handleWebhook(req, res) {
  const ip = clientIp(req);
  if (ALLOWED_IPS.length > 0 && !ALLOWED_IPS.includes(ip) && !LOOPBACK.includes(ip)) {
    console.warn(`[relay] rejected webhook from ${ip}: not in RELAY_ALLOWED_IPS`);
    return json(res, 403, { ok: false, error: "forbidden" });
  }

  const raw = await readBody(req);
  if (raw === null) {
    console.warn(`[relay] rejected webhook from ${ip}: body over ${MAX_BODY_BYTES} bytes`);
    return; // stream was destroyed while reading
  }
  if (!isAuthorized(req, raw)) {
    console.warn(`[relay] rejected webhook from ${ip}: missing or wrong secret`);
    return json(res, 401, { ok: false, error: "unauthorized" });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return json(res, 400, { ok: false, error: "body must be JSON" });
  }

  const messages = (Array.isArray(body) ? body : [body]).filter(isObject);
  if (messages.length === 0) return json(res, 400, { ok: false, error: "expected a JSON object or array of objects" });

  for (const message of messages) {
    remember(message);
    broadcast(message);
  }
  console.log(`[relay] ${messages.length} message(s) from ${ip} → ${clients.size} dashboard(s)`);
  json(res, 202, { ok: true, delivered: clients.size });
}

function handleEvents(req, res, url) {
  const origin = req.headers.origin;
  const originAllowed = !origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
  if (!originAllowed) {
    console.warn(`[relay] refused dashboard connection from origin ${origin}`);
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
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  res.write("retry: 3000\n\n");
  for (const message of snapshot.values()) send(res, message);

  clients.add(res);
  console.log(`[relay] dashboard connected (${clients.size} open)`);
  req.on("close", () => {
    clients.delete(res);
    console.log(`[relay] dashboard disconnected (${clients.size} open)`);
  });
}

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
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, dashboards: clients.size });
  }
  json(res, 404, { ok: false, error: "not found" });
});

setInterval(() => {
  for (const res of clients) res.write(": ping\n\n");
}, HEARTBEAT_MS).unref();

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
});
