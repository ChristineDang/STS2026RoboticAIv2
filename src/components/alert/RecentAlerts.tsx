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

/** Alert history for this session. Holds times and outcomes only, so it stays visible during an alert. */
export function RecentAlerts({ limit, title = "Recent alerts" }: { limit?: number; title?: string }) {
  const { state } = useAlert();
  const entries = limit ? state.log.slice(0, limit) : state.log;

  return (
    <div className="stat-card">
      <div className="stat-card__label">{title}</div>
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
    </div>
  );
}
