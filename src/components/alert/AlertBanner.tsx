import { ARM_FEEDBACK } from "../../config";
import { useAlert, type AlertState } from "../../context/AlertContext";
import { formatPercent, formatTime } from "../../utils/format";

const TITLES = {
  alert: "Unverified person detected",
  secured: "Unverified person detected: laptop closed",
  failed: "Unverified person detected: laptop may still be open",
} as const;

function armText(state: AlertState): string | null {
  switch (state.armStatus) {
    case "requested":
      return ARM_FEEDBACK ? "Waiting for the arm to confirm…" : "Data hidden; the arm is closing the laptop";
    case "closing":
      return "Arm is closing the laptop…";
    case "closed":
      return "Arm confirmed the laptop is closed";
    case "failed":
      return state.failReason;
    default:
      return null;
  }
}

/** Shown at the top of every page during an alert, with the operator's "Clear alert" button. */
export function AlertBanner() {
  const { state, clearAlert } = useAlert();
  if (state.phase === "normal" || !state.current) return null;

  const { current, phase } = state;
  const details = [
    formatTime(current.startedAt),
    current.confidence !== undefined ? `Camera confidence ${formatPercent(current.confidence)}` : null,
    armText(state),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`alert-banner alert-banner--${phase}`} role="alert">
      <svg className="alert-banner__icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div className="alert-banner__text">
        <strong className="alert-banner__title">{TITLES[phase]}</strong>
        <span className="alert-banner__details">{details}</span>
      </div>
      <button type="button" className="alert-banner__clear" onClick={clearAlert}>
        {phase === "failed" ? "Acknowledge and clear" : "Clear alert"}
      </button>
    </div>
  );
}
