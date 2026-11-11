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

/** Shows the "Simulate events" buttons in Settings: in development, or with ?demo=1. */
export const DEMO_ENABLED = import.meta.env.DEV || params.get("demo") === "1";
