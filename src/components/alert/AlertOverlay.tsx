import { useAlert } from "../../context/AlertContext";

/**
 * Red glow around the screen edges during an alert. Pulses slowly (well under
 * the 3-flashes-per-second limit) while the alert is active, then holds steady
 * once the laptop is secured or the arm needs attention. Never blocks clicks.
 */
export function AlertOverlay() {
  const { state } = useAlert();
  if (state.phase === "normal") return null;
  const pulsing = state.phase === "alert";
  return <div className={`alert-overlay alert-overlay--${pulsing ? "pulsing" : "steady"}`} aria-hidden="true" />;
}
