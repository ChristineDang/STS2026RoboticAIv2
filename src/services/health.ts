// Turns raw health data into what the System health cards show.
// Pure functions (no React) so the rules are easy to read and test.
import { FEED_MODE, RELAY_URL, WS_URL } from "../api/backend";
import {
  CAMERA_MIN_FPS,
  LATENCY_HISTORY_MS,
  REJECTION_WINDOW_MS,
  RELAY_STATUS_STALE_MS,
  ROBOT_SLOW_MS,
  ROBOT_STALE_MS,
  WEBHOOK_QUIET_MS,
} from "../config";
import type { AlertLogEntry, ConnectionStatus, FeedHealth, HealthLevel, LatencySample, RobotHealth } from "../types";
import { formatAgo, formatDuration, formatUptime } from "../utils/format";

export interface HealthRow {
  label: string;
  value: string;
}

export interface HealthSummary {
  level: HealthLevel;
  label: string;
  rows: HealthRow[];
  note?: string;
}

const SEVERITY: Record<HealthLevel, number> = { ok: 0, unknown: 1, warn: 2, bad: 3 };

export function worstLevel(levels: HealthLevel[]): HealthLevel {
  return levels.reduce<HealthLevel>((worst, l) => (SEVERITY[l] > SEVERITY[worst] ? l : worst), "ok");
}

// ---- Webhook: backend → relay ----------------------------------------------

export function webhookHealth(health: FeedHealth, status: ConnectionStatus, now: number): HealthSummary {
  if (FEED_MODE === "websocket") {
    return {
      level: "unknown",
      label: "Not used",
      rows: [],
      note: "The dashboard connects to the backend's WebSocket directly, so there is no webhook.",
    };
  }

  const relay = health.relay;
  if (!relay) {
    return { level: "unknown", label: "Unknown", rows: [], note: "Waiting to hear from the relay." };
  }

  // Relay times are on the relay's clock; shift them by how long ago the report arrived.
  const relayNow = relay.now + (now - relay.receivedAt);
  const rows: HealthRow[] = [
    { label: "Last webhook", value: relay.lastWebhookAt === null ? "Never" : formatAgo(relayNow - relay.lastWebhookAt) },
    { label: "Accepted", value: String(relay.accepted) },
    { label: "Rejected", value: String(relay.rejected) },
    { label: "Relay running for", value: formatDuration(relayNow - relay.startedAt) },
  ];

  const reportAge = now - relay.receivedAt;
  if (status !== "live" || reportAge > RELAY_STATUS_STALE_MS) {
    return {
      level: "unknown",
      label: "Unknown",
      rows,
      note: `Can't reach the relay, so these numbers are from ${formatAgo(reportAge)}.`,
    };
  }

  if (relay.lastRejectedAt !== null && relayNow - relay.lastRejectedAt < REJECTION_WINDOW_MS) {
    const secretHint = relay.lastRejectReason?.includes("secret")
      ? " Check that the backend uses the same RELAY_SECRET."
      : "";
    return {
      level: "warn",
      label: "Rejecting requests",
      rows,
      note: `Last rejected ${formatAgo(relayNow - relay.lastRejectedAt)}: ${relay.lastRejectReason ?? "unknown reason"}.${secretHint}`,
    };
  }

  if (relay.lastWebhookAt === null) {
    return {
      level: "warn",
      label: "No webhooks yet",
      rows,
      note: "The relay is running but hasn't received anything from the backend.",
    };
  }

  const age = relayNow - relay.lastWebhookAt;
  if (age > WEBHOOK_QUIET_MS) {
    return {
      level: "warn",
      label: "Quiet",
      rows,
      note: `Nothing from the backend for ${formatDuration(age)}. That's fine if it only sends on changes; a regular heartbeat makes this check reliable.`,
    };
  }

  return { level: "ok", label: "Receiving", rows };
}

// ---- Dashboard connection: dashboard ↔ relay (or backend) -------------------

export function connectionHealth(health: FeedHealth, status: ConnectionStatus, now: number): HealthSummary {
  const peer = FEED_MODE === "relay" ? "relay" : "backend";
  const rows: HealthRow[] = [
    { label: "Connected for", value: health.connectedSince === null ? "—" : formatDuration(now - health.connectedSince) },
    { label: "Last data", value: health.lastDataAt === null ? "Never" : formatAgo(now - health.lastDataAt) },
    { label: "Reconnects", value: String(health.reconnects) },
    { label: "Address", value: FEED_MODE === "relay" ? RELAY_URL : WS_URL },
  ];

  if (status === "connecting") return { level: "unknown", label: "Connecting…", rows };
  if (status === "disconnected") {
    return {
      level: "bad",
      label: "Disconnected",
      rows,
      note:
        FEED_MODE === "relay"
          ? "Retrying every few seconds. Is the relay running (npm run relay)?"
          : "Retrying every few seconds. Is the backend running?",
    };
  }

  // The relay reports every 5 s, so silence while "connected" means the stream has stalled.
  if (FEED_MODE === "relay" && health.relay && now - health.relay.receivedAt > RELAY_STATUS_STALE_MS) {
    return {
      level: "warn",
      label: "Stalled",
      rows,
      note: `Connected, but nothing from the ${peer} for ${formatDuration(now - health.relay.receivedAt)}.`,
    };
  }

  return { level: "ok", label: "Connected", rows };
}

// ---- Robot arms: backend → robot -------------------------------------------

export interface RobotRow {
  id: string;
  name: string;
  level: HealthLevel;
  statusText: string;
  details: string[];
}

export interface RobotSummary {
  level: HealthLevel;
  label: string;
  robots: RobotRow[];
  note?: string;
}

function robotRow(robot: RobotHealth, now: number): RobotRow {
  const reportAge = now - robot.receivedAt;
  const stale = reportAge > ROBOT_STALE_MS;
  const slow = robot.latencyMs !== undefined && robot.latencyMs > ROBOT_SLOW_MS;

  let level: HealthLevel;
  let statusText: string;
  if (robot.status === "offline") [level, statusText] = ["bad", "Offline"];
  else if (stale) [level, statusText] = ["warn", "No recent report"];
  else if (robot.status === "degraded") [level, statusText] = ["warn", "Degraded"];
  else if (robot.status === "online" && slow) [level, statusText] = ["warn", "Slow"];
  else if (robot.status === "online") [level, statusText] = ["ok", "Online"];
  else [level, statusText] = ["unknown", "Unknown status"];

  const details: string[] = [];
  if (robot.latencyMs !== undefined) details.push(`${Math.round(robot.latencyMs)} ms`);
  if (robot.lastSeen !== undefined) details.push(`seen ${formatAgo(Math.max(0, now - robot.lastSeen))}`);
  details.push(`reported ${formatAgo(reportAge)}`);
  if (robot.detail) details.push(robot.detail);

  return { id: robot.id, name: robot.name, level, statusText, details };
}

export function robotHealth(robots: RobotHealth[], now: number): RobotSummary {
  if (robots.length === 0) {
    return {
      level: "unknown",
      label: "No reports yet",
      robots: [],
      note: "The backend needs to include robot arm status in its messages (see README).",
    };
  }

  const rows = robots.map((r) => robotRow(r, now));
  const online = rows.filter((r) => r.level === "ok").length;
  const offline = rows.filter((r) => r.level === "bad").length;
  const label =
    offline > 0
      ? `${offline} offline`
      : online === rows.length
        ? rows.length === 1
          ? "Online"
          : "All online"
        : `${online} of ${rows.length} OK`;

  return { level: worstLevel(rows.map((r) => r.level)), label, robots: rows };
}

/** Most samples kept per arm (a report every second for 10 minutes is 600; plenty for a sparkline). */
const MAX_LATENCY_SAMPLES = 300;

/** Adds a latency report to an arm's history. Replays (not newer than the last sample) are ignored. */
export function appendLatency(history: LatencySample[] = [], ms: number | undefined, at: number): LatencySample[] {
  if (ms === undefined) return history;
  const last = history[history.length - 1];
  if (last && at <= last.at) return history;
  const next = [...history, { at, ms }].filter((s) => s.at >= at - LATENCY_HISTORY_MS);
  return next.length > MAX_LATENCY_SAMPLES ? next.slice(-MAX_LATENCY_SAMPLES) : next;
}

export interface LatencyStats {
  min: number;
  avg: number;
  max: number;
  count: number;
}

export function latencyStats(samples: LatencySample[]): LatencyStats | null {
  if (samples.length === 0) return null;
  const values = samples.map((s) => s.ms);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    count: values.length,
  };
}

// ---- Arm close success (from the alert log) ---------------------------------

export interface ArmSuccess {
  closed: number;
  failed: number;
  /** Closed ÷ (closed + failed); null when no alert has an arm result yet. */
  rate: number | null;
}

/** How often the arm closed when asked. Only alerts where the arm reported back count. */
export function armSuccess(log: AlertLogEntry[]): ArmSuccess {
  const closed = log.filter((e) => e.armResult === "closed").length;
  const failed = log.filter((e) => e.armResult === "failed").length;
  return { closed, failed, rate: closed + failed > 0 ? closed / (closed + failed) : null };
}

// ---- Camera stream: robot camera → relay -------------------------------------

export function cameraHealth(health: FeedHealth, status: ConnectionStatus, now: number): HealthSummary {
  if (FEED_MODE === "websocket") {
    return {
      level: "unknown",
      label: "Not measured",
      rows: [],
      note: "The relay measures the camera, and this dashboard doesn't use the relay (VITE_FEED_MODE=websocket).",
    };
  }
  const relay = health.relay;
  if (!relay) return { level: "unknown", label: "Unknown", rows: [], note: "Waiting to hear from the relay." };

  const camera = relay.camera;
  if (!camera) {
    return { level: "unknown", label: "Not measured", rows: [], note: "This relay doesn't report the camera. Restart it (npm run relay)." };
  }
  if (camera.state === "off") {
    return camera.offReason === "monitor_off"
      ? { level: "unknown", label: "Not measured", rows: [], note: "Camera monitoring is off (RELAY_CAMERA_MONITOR=off)." }
      : { level: "unknown", label: "Not set up", rows: [], note: "No camera set up. Add VITE_CAMERA_URL to .env and restart the relay." };
  }

  const relayNow = relay.now + (now - relay.receivedAt);
  const total = camera.upMs + camera.downMs;
  const stream = camera.kind !== "snapshot";
  const rows: HealthRow[] = [
    {
      label: "Frame rate",
      value: !stream ? "— (snapshot URL)" : camera.fps === null ? "—" : `${camera.fps.toFixed(1)} fps`,
    },
    { label: "Uptime", value: total > 0 ? `${formatUptime(camera.upMs / total)} of ${formatDuration(total)}` : "—" },
    { label: camera.state === "up" ? "Up for" : "Down for", value: formatDuration(relayNow - camera.since) },
    { label: "Drops", value: String(camera.drops) },
  ];

  if (status !== "live" || now - relay.receivedAt > RELAY_STATUS_STALE_MS) {
    return { level: "unknown", label: "Unknown", rows, note: `Can't reach the relay, so these numbers are from ${formatAgo(now - relay.receivedAt)}.` };
  }
  if (camera.state === "down") {
    const last = camera.lastFrameAt === null ? "No frames received yet." : `Last frame ${formatAgo(relayNow - camera.lastFrameAt)}.`;
    return { level: "bad", label: "Down", rows, note: `${camera.error ?? "No frames"}. ${last} Retrying every 5 seconds.` };
  }
  if (stream && camera.fps !== null && camera.fps < CAMERA_MIN_FPS) {
    return { level: "warn", label: "Low frame rate", rows, note: `Below ${CAMERA_MIN_FPS} fps. Check the camera's network or load.` };
  }
  return { level: "ok", label: "Live", rows };
}
