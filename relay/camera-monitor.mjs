// Camera monitor: keeps one connection to the robot camera and measures it.
//
// Reports frame rate, uptime, drops and the last error with the relay status
// (every 5 s), so the dashboard can show camera health. A browser can't count
// the frames of an MJPEG <img> from another address, but the relay can.
//
// It also keeps the latest frame, so a photo of a denied person is taken from
// it instead of opening a second connection to the camera.
//
// Works with an MJPEG stream (multipart/x-mixed-replace) and with a plain JPEG
// snapshot URL (polled every few seconds; no frame rate then).

import { imageType } from "./captures.mjs";

const SOI = Buffer.from([0xff, 0xd8, 0xff]);
const EOI = Buffer.from([0xff, 0xd9]);

/** Stream: no frame for this long counts as down. */
const STREAM_STALE_MS = 3_000;
/** Stream: connected but no frame for this long = reconnect. */
const STREAM_STALL_MS = 10_000;
const SNAPSHOT_POLL_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
const RETRY_MS = 5_000;
const FPS_WINDOW_MS = 5_000;
const MAX_FRAME_BYTES = 5 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

function describeError(err) {
  const code = err?.cause?.code;
  if (code === "ECONNREFUSED") return "Connection refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Address not found";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "Camera unreachable";
  if (code) return `Can't connect (${code})`;
  return err?.message || "Unknown error";
}

export function startCameraMonitor(url) {
  const startedAt = Date.now();
  /** "stream" (MJPEG) or "snapshot" (single image), once known. */
  let kind = null;
  let up = false;
  let since = startedAt;
  let upMs = 0;
  let downMs = 0;
  let lastTick = startedAt;
  let drops = 0;
  let lastFrameAt = null;
  let lastError = null;
  let frameTimes = [];
  /** Latest complete JPEG (a view into the read buffer; copied when handed out). */
  let latest = null;
  let controller = null;
  let stallAbort = false;
  /** When the current stream connection started sending (null when not streaming). */
  let streamOpenedAt = null;

  const staleLimit = () => (kind === "snapshot" ? SNAPSHOT_POLL_MS * 2 + CONNECT_TIMEOUT_MS : STREAM_STALE_MS);

  /** Adds the time since the last tick to up or down, then updates the state. */
  function tick(now = Date.now()) {
    const elapsed = Math.max(0, now - lastTick);
    lastTick = now;
    if (up) upMs += elapsed;
    else downMs += elapsed;
    const fresh = lastFrameAt !== null && now - lastFrameAt <= staleLimit();
    if (fresh !== up) {
      up = fresh;
      since = now;
      if (!fresh) drops++;
    }
  }

  function onFrame(image) {
    const now = Date.now();
    lastFrameAt = now;
    latest = { image, at: now };
    lastError = null;
    frameTimes.push(now);
    if (frameTimes.length > 1 && now - frameTimes[0] > FPS_WINDOW_MS) {
      frameTimes = frameTimes.filter((t) => now - t <= FPS_WINDOW_MS);
    }
    if (!up) tick(now);
  }

  async function readStream(body) {
    let pending = Buffer.alloc(0);
    for await (const chunk of body) {
      pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
      let start = pending.indexOf(SOI);
      while (start !== -1) {
        const end = pending.indexOf(EOI, start + SOI.length);
        if (end === -1) break;
        onFrame(pending.subarray(start, end + EOI.length));
        pending = pending.subarray(end + EOI.length);
        start = pending.indexOf(SOI);
      }
      // Keep only what may still become a frame (2 bytes could be a split marker).
      if (start === -1) pending = pending.subarray(Math.max(0, pending.length - 2));
      else if (start > 0) pending = pending.subarray(start);
      if (pending.length > MAX_FRAME_BYTES) pending = Buffer.alloc(0);
    }
  }

  async function readAll(body) {
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
      size += chunk.length;
      if (size > MAX_FRAME_BYTES) throw new Error("Image too large");
    }
    return Buffer.concat(chunks);
  }

  async function run() {
    for (;;) {
      controller = new AbortController();
      stallAbort = false;
      const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
      let wait = RETRY_MS;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`Camera answered HTTP ${res.status}`);
        const streaming = (res.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/");
        if (streaming) {
          kind = "stream";
          clearTimeout(timeout);
          streamOpenedAt = Date.now();
          await readStream(res.body);
          lastError = "The camera ended the stream";
        } else {
          kind = "snapshot";
          const buf = await readAll(res.body);
          clearTimeout(timeout);
          if (imageType(buf)) onFrame(buf);
          else lastError = "The camera address didn't return an image";
          wait = SNAPSHOT_POLL_MS;
        }
      } catch (err) {
        if (stallAbort) lastError = `No frames for ${STREAM_STALL_MS / 1000}s`;
        else if (controller.signal.aborted) lastError = "Timed out connecting";
        else lastError = describeError(err);
      } finally {
        clearTimeout(timeout);
        streamOpenedAt = null;
        controller.abort();
      }
      await sleep(wait);
    }
  }

  // Once a second: account uptime, and reconnect a stream that stopped sending frames.
  setInterval(() => {
    const now = Date.now();
    tick(now);
    if (streamOpenedAt === null || !controller || controller.signal.aborted) return;
    const quietFor = now - Math.max(lastFrameAt ?? 0, streamOpenedAt);
    if (quietFor > STREAM_STALL_MS) {
      stallAbort = true;
      controller.abort();
    }
  }, 1000).unref();

  void run();

  return {
    /** What the dashboard shows. Times are this machine's clock. */
    stats() {
      const now = Date.now();
      tick(now);
      const recent = frameTimes.filter((t) => now - t <= FPS_WINDOW_MS);
      let fps = null;
      if (kind === "stream") {
        if (!up) fps = 0;
        else if (recent.length >= 2) fps = (recent.length - 1) / ((recent[recent.length - 1] - recent[0]) / 1000);
      }
      return {
        state: up ? "up" : "down",
        kind,
        fps: fps === null ? null : Math.round(fps * 10) / 10,
        upMs,
        downMs,
        since,
        drops,
        lastFrameAt,
        error: up ? null : lastError,
      };
    },
    /** A copy of the latest frame if it is at most `maxAgeMs` old, else null. */
    latestFrame(maxAgeMs = 2000) {
      if (!latest || Date.now() - latest.at > maxAgeMs) return null;
      return { mime: "image/jpeg", image: Buffer.from(latest.image) };
    },
  };
}
