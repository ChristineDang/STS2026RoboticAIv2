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
relay/                  # webhook relay + test sender (Node, no dependencies)
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
