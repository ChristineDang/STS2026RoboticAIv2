import type { ConnectionStatus } from "../../types";

const LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  disconnected: "Disconnected — retrying",
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`connection-badge connection-badge--${status}`}>
      <span className="connection-badge__dot" />
      {LABELS[status]}
    </span>
  );
}
