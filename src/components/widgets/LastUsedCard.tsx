import { useNow } from "../../hooks/useNow";
import type { LastUse } from "../../types";
import { formatAgo, formatWhen } from "../../utils/format";

/** Who used the laptop last, and when. */
export function LastUsedCard({ lastUse }: { lastUse: LastUse | null }) {
  const now = useNow(5000);
  const person = lastUse ? (lastUse.person ?? "Unknown person") : "—";

  return (
    <div className="stat-card">
      <div className="stat-card__label">Last used by</div>
      <div className="stat-card__value stat-card__value--text" title={lastUse?.person ?? undefined}>
        {person}
      </div>
      <p className="stat-card__meta">
        {lastUse ? `${formatWhen(lastUse.at)} · ${formatAgo(Math.max(0, now - lastUse.at))}` : "No use recorded yet"}
      </p>
    </div>
  );
}
