import { useAlert } from "../../context/AlertContext";
import type { AlertLogEntry } from "../../types";
import { formatTime } from "../../utils/format";

function status(entry: AlertLogEntry): { text: string; kind: "active" | "verified" | "operator" } {
  const armNote = entry.armResult === "failed" ? " (arm failed)" : "";
  switch (entry.resolution) {
    case "verifiedPerson":
      return { text: `Cleared: verified person${armNote}`, kind: "verified" };
    case "operator":
      return { text: `Cleared by operator${armNote}`, kind: "operator" };
    default:
      return { text: entry.armResult === "failed" ? "Needs attention" : "In progress", kind: "active" };
  }
}

interface RecentAlertsProps {
  limit?: number;
  title?: string;
  /** Adds a link to the full alert log at the bottom of the card. */
  showLogLink?: boolean;
}

/** Alert history for this session. Holds times and outcomes only, so it stays visible during an alert. */
export function RecentAlerts({ limit, title = "Recent alerts", showLogLink = false }: RecentAlertsProps) {
  const { state } = useAlert();
  const entries = limit ? state.log.slice(0, limit) : state.log;
  const hidden = state.log.length - entries.length;

  return (
    <div className="stat-card health-card">
      <div className="health-card__header">
        <div>
          <div className="health-card__title">{title}</div>
          <div className="health-card__subtitle">Since this page was opened</div>
        </div>
        <span className="health-card__count">{state.log.length === 1 ? "1 alert" : `${state.log.length} alerts`}</span>
      </div>
      {entries.length === 0 ? (
        <p className="stat-card__empty">No alerts since this page was opened</p>
      ) : (
        <ul className="alert-list">
          {entries.map((entry) => {
            const s = status(entry);
            return (
              <li key={entry.id} className="alert-list__row">
                <span>{formatTime(entry.startedAt)} · Unverified person</span>
                <span className={`alert-list__status alert-list__status--${s.kind}`}>{s.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {showLogLink && (
        <div className="health-card__footer">
          <a className="button button--link" href="#/alerts">
            {hidden > 0 ? `Open alert log (${hidden} more)` : "Open alert log"}
          </a>
        </div>
      )}
    </div>
  );
}
