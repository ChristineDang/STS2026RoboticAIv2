// Feature switches. Connection settings live in api/backend.ts.

const params = new URLSearchParams(window.location.search);

/**
 * Iris can be removed entirely with VITE_IRIS_ENABLED=false in .env, or for one
 * visit with ?iris=off in the address. Alerts work the same without Iris.
 */
export const IRIS_ALLOWED =
  import.meta.env.VITE_IRIS_ENABLED !== "false" && params.get("iris") !== "off";

/**
 * Set VITE_ARM_FEEDBACK=true once the hardware reports back (closing/closed/failed).
 * Then an alert with no arm report within ARM_TIMEOUT_MS becomes "arm didn't respond".
 */
export const ARM_FEEDBACK = import.meta.env.VITE_ARM_FEEDBACK === "true";
export const ARM_TIMEOUT_MS = Number(import.meta.env.VITE_ARM_TIMEOUT_MS) || 15_000;

// ---- System health thresholds ----
/** No webhook for this long = "Quiet" (amber). Only meaningful if the backend sends regularly. */
export const WEBHOOK_QUIET_MS = Number(import.meta.env.VITE_WEBHOOK_QUIET_MS) || 120_000;
/** A robot report older than this = "No recent report" (amber). */
export const ROBOT_STALE_MS = Number(import.meta.env.VITE_ROBOT_STALE_MS) || 30_000;
/** Robot latency above this = shown as slow (amber), even if the backend says "online". */
export const ROBOT_SLOW_MS = Number(import.meta.env.VITE_ROBOT_SLOW_MS) || 500;
/** Camera frame rate below this = "Low frame rate" (amber). Measured by the relay. */
export const CAMERA_MIN_FPS = Number(import.meta.env.VITE_CAMERA_MIN_FPS) || 5;
/** How much robot latency history the sparkline shows. */
export const LATENCY_HISTORY_MS = 10 * 60_000;
/** The relay reports every 5 s; nothing for this long = the stream has stalled. */
export const RELAY_STATUS_STALE_MS = 15_000;
/** Rejected webhooks within this window turn the webhook card amber. */
export const REJECTION_WINDOW_MS = 10 * 60_000;

/** Shows the "Simulate events" buttons in Settings: in development, or with ?demo=1. */
export const DEMO_ENABLED = import.meta.env.DEV || params.get("demo") === "1";
