// Sends a sample webhook to the relay, the same way the backend will.
//
//   npm run relay:test -- no          unverified person (auth: no)
//   npm run relay:test -- no-photo    unverified person, with a generated test photo
//   npm run relay:test -- yes         verified person (auth: yes)
//   npm run relay:test -- metrics     sample metrics
//   npm run relay:test -- arm-closing | arm-closed | arm-failed
//   npm run relay:test -- yes-named | last-used                 "Last used by" tile
//   npm run relay:test -- robots | robot-slow | robot-offline   robot arm health
//   npm run relay:test -- robots-live                            robot reports every 2 s for a minute (latency chart)
//   npm run relay:test -- heartbeat                              keep-alive
//   npm run relay:test -- '{"auth":"no"}'   any JSON you like
//
// Uses RELAY_SECRET and RELAY_PORT from .env. Set RELAY_TEST_URL to target another machine.

import zlib from "node:zlib";

const SECRET = process.env.RELAY_SECRET ?? "";
const URL_ = process.env.RELAY_TEST_URL ?? `http://localhost:${process.env.RELAY_PORT ?? 8787}/webhook`;

const randomInt = (max) => Math.floor(Math.random() * max);

/** A small generated test picture (PNG): a coloured background with a head-and-shoulders shape. */
function testImagePng(width = 160, height = 120) {
  const hue = randomInt(360);
  const [br, bg, bb] = hslToRgb(hue, 0.35, 0.55);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const head = (x - 80) ** 2 + (y - 45) ** 2 < 18 ** 2;
      const body = y > 68 && (x - 80) ** 2 / 45 ** 2 + (y - 120) ** 2 / 50 ** 2 < 1;
      const [r, g, b] = head || body ? [40, 46, 56] : [br, bg, bb];
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
}

const SAMPLES = {
  no: () => ({ auth: "no", confidence: 0.91, at: new Date().toISOString() }),
  "no-photo": () => ({ auth: "no", confidence: 0.88, at: new Date().toISOString(), image: testImagePng() }),
  yes: () => ({ auth: "yes", at: new Date().toISOString() }),
  "yes-named": () => ({ auth: "yes", person: "Test person A", at: new Date().toISOString() }),
  "last-used": () => ({ last_used: { person: "Test person B", at: new Date().toISOString() } }),
  metrics: () => ({
    confidence_drop_frames: randomInt(40),
    rejections: randomInt(8),
    laptop_usage: [
      { person: "Test person A", count: randomInt(10) },
      { person: "Test person B", count: randomInt(10) },
    ],
  }),
  "arm-closing": () => ({ arm: "closing" }),
  "arm-closed": () => ({ arm: "closed" }),
  "arm-failed": () => ({ arm: "failed", reason: "Test: the arm did not move" }),
  robots: () => ({
    robots: [
      { id: "arm-1", name: "Arm 1", status: "online", latency_ms: 20 + randomInt(30), last_seen: new Date().toISOString() },
      { id: "arm-2", name: "Arm 2", status: "online", latency_ms: 20 + randomInt(30), last_seen: new Date().toISOString() },
    ],
  }),
  "robot-slow": () => ({ robots: [{ id: "arm-2", name: "Arm 2", status: "degraded", latency_ms: 850, detail: "Test: high latency" }] }),
  "robot-offline": () => ({ robots: [{ id: "arm-2", name: "Arm 2", status: "offline", detail: "Test: no response" }] }),
  heartbeat: () => ({ type: "heartbeat", at: new Date().toISOString() }),
};

/** Repeating samples: [sample name, how many times, interval ms]. */
const REPEATED = { "robots-live": ["robots", 30, 2000] };

const arg = process.argv[2];
let makeBody;
let times = 1;
let intervalMs = 0;
if (arg && REPEATED[arg]) {
  const [name, count, every] = REPEATED[arg];
  [makeBody, times, intervalMs] = [SAMPLES[name], count, every];
} else if (arg && SAMPLES[arg]) {
  makeBody = SAMPLES[arg];
} else if (arg && /^[[{]/.test(arg.trim())) {
  const parsed = JSON.parse(arg);
  makeBody = () => parsed;
} else {
  console.log(`Usage: npm run relay:test -- <${[...Object.keys(SAMPLES), ...Object.keys(REPEATED)].join(" | ")} | JSON>`);
  process.exit(arg ? 1 : 0);
}

if (!SECRET) {
  console.error("RELAY_SECRET is not set (add it to .env).");
  process.exit(1);
}

async function sendOnce(body) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  const shown = JSON.stringify(body, (k, v) => (k === "image" ? `<${v.length} characters of image data>` : v));
  console.log(`${res.status} ${await res.text()}  ←  ${shown}`);
  return res.ok;
}

try {
  let ok = true;
  for (let i = 0; i < times; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    ok = (await sendOnce(makeBody())) && ok;
  }
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(`Could not reach the relay at ${URL_}. Is it running (npm run relay)?`, err.message);
  process.exit(1);
}
