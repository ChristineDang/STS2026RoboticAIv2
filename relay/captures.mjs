// Photos of denied people: detection, image handling and the database.
//
// When a webhook says someone was denied, the relay saves one photo:
//   1. the image the backend sent with the message (best: the exact frame it judged), or
//   2. a frame grabbed from the robot camera (RELAY_CAMERA_URL, an MJPEG or JPEG URL).
//
// Photos are stored in a SQLite file (relay/data/denied.db by default; ignored by git)
// and deleted automatically after the retention period.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const format = JSON.parse(fs.readFileSync(path.join(here, "../shared/feedFormat.json"), "utf8"));

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;

// ---- Reading denials from backend messages (same rules as the dashboard) --

function normalize(value) {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function yesNo(value) {
  if (typeof value === "boolean") return value;
  const v = normalize(value);
  if (format.authYes.includes(v)) return true;
  if (format.authNo.includes(v)) return false;
  return null;
}

function resultOf(msg) {
  const types = format.typeFields.map((f) => normalize(msg[f])).filter(Boolean);
  for (const t of types) {
    if (format.deniedEventNames.includes(t)) return "denied";
    if (format.verifiedEventNames.includes(t)) return "verified";
  }
  if (types.some((t) => format.authTypes.includes(t))) {
    for (const f of format.typedValueFields) {
      const yes = yesNo(msg[f]);
      if (yes !== null) return yes ? "verified" : "denied";
    }
  }
  for (const f of format.authFields) {
    const yes = yesNo(msg[f]);
    if (yes !== null) return yes ? "verified" : "denied";
  }
  return null;
}

function confidenceOf(msg) {
  for (const f of ["confidence", "score", "similarity"]) {
    const n = typeof msg[f] === "string" ? Number(msg[f]) : msg[f];
    if (typeof n === "number" && Number.isFinite(n)) return n > 1 && n <= 100 ? n / 100 : n;
  }
  return null;
}

function firstString(msg, fields) {
  for (const f of fields) if (typeof msg[f] === "string" && msg[f]) return msg[f];
  return null;
}

/**
 * Finds a verified/denied result in a message (looking inside wrappers like "data").
 * Returns { result: "denied" | "verified", confidence, imageBase64, imageUrl } or null.
 */
export function readAuth(message, depth = 0) {
  if (!isObject(message) || depth > 2) return null;
  const result = resultOf(message);
  if (result) {
    return {
      result,
      confidence: confidenceOf(message),
      imageBase64: firstString(message, format.imageFields),
      imageUrl: firstString(message, format.imageUrlFields),
    };
  }
  for (const f of format.wrapperFields) {
    const found = readAuth(message[f], depth + 1);
    if (found) return found;
  }
  return null;
}

/** A copy of the message without embedded images, so photos aren't broadcast or kept in memory. */
export function withoutImages(message) {
  return JSON.parse(
    JSON.stringify(message, (key, value) => (format.imageFields.includes(key) && typeof value === "string" ? undefined : value))
  );
}

// ---- Images -------------------------------------------------------------

/** Returns the image type from its first bytes, or null if it isn't a JPEG/PNG/WebP. */
export function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function decodeBase64Image(text) {
  const base64 = text.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
  const mime = imageType(buf);
  return mime ? { mime, image: buf } : null;
}

/** Finds the first complete JPEG (FFD8 … FFD9) in a buffer. */
function firstJpeg(buf) {
  const start = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (start === -1) return null;
  const end = buf.indexOf(Buffer.from([0xff, 0xd9]), start + 3);
  return end === -1 ? null : buf.subarray(start, end + 2);
}

/**
 * Downloads one image. Works for a plain image URL (a snapshot) and for an MJPEG
 * stream, where it takes the first full frame and disconnects.
 */
export async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const streaming = (res.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/");
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      chunks.push(Buffer.from(chunk));
      size += chunk.length;
      if (streaming) {
        const frame = firstJpeg(Buffer.concat(chunks));
        if (frame) return { mime: "image/jpeg", image: Buffer.from(frame) };
      }
      if (size > MAX_IMAGE_BYTES) throw new Error("image too large");
    }
    const buf = Buffer.concat(chunks);
    const mime = imageType(buf);
    if (!mime) throw new Error("not a JPEG, PNG or WebP image");
    return { mime, image: buf };
  } finally {
    clearTimeout(timer);
    controller.abort(); // stop an MJPEG stream once we have a frame
  }
}

// ---- Database -------------------------------------------------------------

export function openCaptureStore(dir, retentionDays) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "denied.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS captures (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at INTEGER NOT NULL,
      confidence  REAL,
      source      TEXT NOT NULL,
      mime        TEXT NOT NULL,
      image       BLOB NOT NULL
    )
  `);

  const insert = db.prepare("INSERT INTO captures (captured_at, confidence, source, mime, image) VALUES (?, ?, ?, ?, ?)");
  const listStmt = db.prepare("SELECT id, captured_at, confidence, source FROM captures ORDER BY captured_at DESC LIMIT ?");
  const imageStmt = db.prepare("SELECT mime, image FROM captures WHERE id = ?");
  const deleteStmt = db.prepare("DELETE FROM captures WHERE id = ?");
  const purgeStmt = db.prepare("DELETE FROM captures WHERE captured_at < ?");

  return {
    add({ capturedAt, confidence, source, mime, image }) {
      const info = insert.run(capturedAt, confidence ?? null, source, mime, image);
      return Number(info.lastInsertRowid);
    },
    list(limit = 200) {
      return listStmt.all(limit).map((row) => ({
        id: Number(row.id),
        capturedAt: Number(row.captured_at),
        confidence: row.confidence === null ? null : Number(row.confidence),
        source: String(row.source),
      }));
    },
    image(id) {
      const row = imageStmt.get(id);
      return row ? { mime: String(row.mime), image: Buffer.from(row.image) } : null;
    },
    remove(id) {
      return Number(deleteStmt.run(id).changes) > 0;
    },
    /** Deletes photos older than the retention period. Returns how many. */
    purge() {
      if (!(retentionDays > 0)) return 0;
      return Number(purgeStmt.run(Date.now() - retentionDays * 24 * 60 * 60 * 1000).changes);
    },
  };
}
