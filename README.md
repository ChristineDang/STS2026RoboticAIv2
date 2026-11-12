# STS2026 Robotic AI Dashboard

React + TypeScript + Vite frontend. The backend is a separate codebase.

## Getting started

```bash
npm install
cp .env.example .env   # then set RELAY_SECRET (a long random string)
npm run relay          # terminal 1: webhook relay on http://localhost:8787
npm run dev            # terminal 2: dashboard on http://localhost:5173
```

Try an alert without the backend:

```bash
npm run relay:test -- no        # unverified person → red edges, cards close
npm run relay:test -- yes       # verified person → cards reopen
npm run relay:test -- metrics   # sample metrics
npm run relay:test -- arm-closed | arm-failed
```

In development, Settings also has "Simulate events" buttons (or add `?demo=1` to the address).

## How live data arrives

```
backend ── webhook (POST /webhook) ──▶ relay ── event stream ──▶ dashboard
```

A browser page can't receive a webhook, so `relay/server.mjs` (no dependencies)
receives it and streams each message to the dashboard. On (re)connect it replays
the latest message of each kind, so a reloaded dashboard shows the current state.

**Give the backend team:** `POST http://<dashboard-laptop-ip>:8787/webhook` with a
JSON body, and the secret as `Authorization: Bearer <RELAY_SECRET>` (or
`X-Webhook-Secret`, or an HMAC-SHA256 signature of the body in `X-Signature: sha256=<hex>`).
Allow port 8787 through Windows Firewall on the dashboard laptop.

If the backend hosts a WebSocket instead, set `VITE_FEED_MODE=websocket` and
`VITE_WS_PATHS` (e.g. `/ws/stats,/ws/events`); no relay needed.

### Message format

Not final yet, so `src/services/feedTranslator.ts` accepts several shapes —
`{"auth":"no"}`, `{"authorized":false}`, `{"type":"auth","value":"no"}`,
`{"event":"unverified_person"}`, `{"arm":"closed"}`, wrapped `{"data":{...}}`,
arrays — plus the metric fields documented in `src/services/statsService.ts`.
When the format is confirmed, edit the tables at the top of the translator.

## Robot camera

Set `VITE_CAMERA_URL` in `.env` to the robot's MJPEG stream (e.g.
`http://192.168.1.50:8080/video_feed`) and restart `npm run dev`. The browser
loads it straight from the robot, so the dashboard laptop must be able to reach
that address. The card stays visible during alerts (red outline) so the operator
can see who triggered it, retries every 5 s if the stream drops, and disconnects
while paused, on another page, or in a background tab.

Don't put a password in the URL: `VITE_` values can be read by anyone who opens
the dashboard. If the stream needs a login, ask the backend team to put it behind
something that doesn't (e.g. only reachable on the local network).

## Denied people (photos)

Each time someone is denied, the relay saves **one** photo (repeats of the same
denial are skipped until someone is verified again) to a SQLite database in
`relay/data/` — on the dashboard laptop only, never in git. The **Denied people**
page shows them, newest first, updates live, and lets you delete them.

Where the photo comes from:
1. **The backend's image**, if the "denied" message includes one — best, since it's
   the exact frame that was judged. Base64 (`"image": "<base64 or data: URL>"`) or a URL
   (`"image_url": "http://..."`); field names are in `shared/feedFormat.json`.
2. Otherwise **a frame from the robot camera** (`RELAY_CAMERA_URL`, default `VITE_CAMERA_URL`).

Privacy defaults: photos are only viewable from the dashboard laptop (unless you set
`RELAY_VIEW_KEY`), are never sent over the live stream, and are deleted after 30 days
(`RELAY_CAPTURE_RETENTION_DAYS`). Turn the feature off with `RELAY_CAPTURES=off`.

Test: `npm run relay:test -- no-photo` (sends a generated test picture).

The "who counts as verified/denied" rules are in `shared/feedFormat.json`, read by
both the dashboard and the relay so they always agree.

## System health

The Overview page shows four health cards (hidden during alerts, like the activity cards;
only the robot camera and recent alerts stay visible):

| Card | Measures | Source |
|---|---|---|
| **Webhook** (backend → relay) | Last webhook, accepted/rejected counts, why the last one was rejected | The relay, every 5 s, on a channel webhooks can't imitate |
| **Dashboard connection** (dashboard ↔ relay/backend) | Connected or not, for how long, reconnects, last data | Measured by the dashboard |
| **Robot arms** (backend → robot) | Online / degraded / offline per arm, latency, last seen, a latency chart (last 10 min), and **arm close success** | Status and latency **reported by the backend**; close success from this session's alerts |
| **Camera stream** (camera → relay) | Frame rate, uptime since the relay started, drops, last error | **Measured by the relay** (`relay/camera-monitor.mjs`) |

**Camera stream:** a browser can't count the frames of a camera stream from another
address, so the relay keeps one connection to the camera and measures it (it also uses
that connection's latest frame for denied-person photos). If the camera allows only one
viewer, set `RELAY_CAMERA_MONITOR=off`, or the dashboard's live feed can't connect.
Not available in WebSocket mode.

**Arm close success** counts alerts where the arm reported `closed` or `failed`. Like
the alert log, it starts over when the page is reloaded.

**Latency chart:** the dashboard keeps the last 10 minutes of each arm's `latency_ms`
reports, so it fills up as reports arrive (and starts over on reload). Hover, or focus
it and use the arrow keys, to read single reports.

**Ask the backend team** to include robot arm status, ideally every 10–30 s as a
heartbeat (that also makes the Webhook card's "Quiet" warning meaningful):

```json
{ "robots": [
  { "id": "arm-1", "name": "Arm 1", "status": "online", "latency_ms": 42, "last_seen": "2026-11-11T17:00:00Z" },
  { "id": "arm-2", "name": "Arm 2", "status": "offline", "detail": "no response" }
] }
```

`status` can be online/ok/connected, degraded/slow, or offline/down/error. Other
accepted shapes are listed at the top of `src/services/feedTranslator.ts`.
Thresholds (quiet webhook, stale or slow robot) are in `.env.example`.

Test: `npm run relay:test -- robots | robots-live | robot-slow | robot-offline | heartbeat`
(`robots-live` sends a report every 2 s for a minute, to fill the latency chart).

## Last used by

The **Last used by** card (hidden during alerts) shows who used the laptop most
recently. Best: the backend says so, in any of these forms:

```json
{ "last_used": { "person": "Alex", "at": "2026-11-11T17:00:00Z" } }
{ "last_used_by": "Alex", "last_used_at": "2026-11-11T17:00:00Z" }
{ "auth": "yes", "person": "Alex" }
```

Without those, the dashboard works it out from `laptop_usage`: when exactly one
person's count goes up, they used it then. (The first list it receives only sets the
starting counts.)

Test: `npm run relay:test -- yes-named | last-used`.

## Alerts and Iris

- **Alert system** (`src/context/AlertContext.tsx`): `auth: no` starts an alert;
  card data is hidden immediately, the screen edges glow red, a banner appears and
  a chime plays. `auth: yes` clears it. A failed arm only clears when someone clicks
  "Acknowledge and clear". Set `VITE_ARM_FEEDBACK=true` once the hardware reports back.
- **Cards**: wrap any card that shows data in `<SecureCard>` so it hides during alerts.
- **Iris** (`src/components/iris/`): the mascot. It watches the alert system and
  walks over to close each card. Iris is optional — alerts work the same without it:
  - `VITE_IRIS_ENABLED=false` in `.env` removes it entirely,
  - `?iris=off` in the address hides it for one visit,
  - Settings → "Show Iris", or the hide button next to Iris,
  - if Iris crashes, it disappears and the dashboard keeps running.

## Structure

```
relay/                  # webhook relay, denied-person photos, test sender (Node, no dependencies)
  data/                 # photo database (created at runtime, ignored by git)
shared/feedFormat.json  # verified/denied message rules, used by dashboard AND relay
src/
  api/backend.ts        # ALL connection settings (backend, relay, feed mode)
  config.ts             # feature switches (Iris, arm feedback, demo mode)
  services/             # feedTranslator (message formats), statsService (metrics), sound
  context/              # Preferences, Alert system, LiveFeed (connection), Lockdown (card closing)
  hooks/                # small reusable hooks
  components/
    alert/              # AlertOverlay, AlertBanner, RecentAlerts
    iris/               # Iris mascot
    layout/             # Header, Sidebar
    widgets/            # StatCard, SecureCard and other dashboard tiles
  pages/                # Overview, Alert log, Settings
  styles/               # global CSS
```

Never hard-code a URL outside `api/backend.ts`.
