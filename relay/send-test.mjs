// Sends a sample webhook to the relay, the same way the backend will.
//
//   npm run relay:test -- no          unverified person (auth: no)
//   npm run relay:test -- yes         verified person (auth: yes)
//   npm run relay:test -- metrics     sample metrics
//   npm run relay:test -- arm-closing | arm-closed | arm-failed
//   npm run relay:test -- '{"auth":"no"}'   any JSON you like
//
// Uses RELAY_SECRET and RELAY_PORT from .env. Set RELAY_TEST_URL to target another machine.

const SECRET = process.env.RELAY_SECRET ?? "";
const URL_ = process.env.RELAY_TEST_URL ?? `http://localhost:${process.env.RELAY_PORT ?? 8787}/webhook`;

const randomInt = (max) => Math.floor(Math.random() * max);

const SAMPLES = {
  no: () => ({ auth: "no", confidence: 0.91, at: new Date().toISOString() }),
  yes: () => ({ auth: "yes", at: new Date().toISOString() }),
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
};

const arg = process.argv[2];
let body;
if (arg && SAMPLES[arg]) {
  body = SAMPLES[arg]();
} else if (arg && /^[[{]/.test(arg.trim())) {
  body = JSON.parse(arg);
} else {
  console.log(`Usage: npm run relay:test -- <${Object.keys(SAMPLES).join(" | ")} | JSON>`);
  process.exit(arg ? 1 : 0);
}

if (!SECRET) {
  console.error("RELAY_SECRET is not set (add it to .env).");
  process.exit(1);
}

try {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  console.log(`${res.status} ${await res.text()}  ←  ${JSON.stringify(body)}`);
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error(`Could not reach the relay at ${URL_}. Is it running (npm run relay)?`, err.message);
  process.exit(1);
}
