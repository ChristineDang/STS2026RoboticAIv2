import type { PersonLaptopUsage } from "../../types";
import { StatCard } from "./StatCard";

interface LaptopUsageCardProps {
  usage: PersonLaptopUsage[];
}

/** Total laptop uses, with a per-person breakdown (most uses first). */
export function LaptopUsageCard({ usage }: LaptopUsageCardProps) {
  const sorted = [...usage].sort((a, b) => b.count - a.count);
  const total = usage.reduce((sum, u) => sum + u.count, 0);

  return (
    <StatCard label="Laptop uses per person" value={total} unit="total">
      {sorted.length === 0 ? (
        <p className="stat-card__empty">No laptop use recorded yet</p>
      ) : (
        <ul className="usage-list">
          {sorted.map((u) => (
            <li key={u.person} className="usage-list__row">
              <span>{u.person}</span>
              <span className="usage-list__count">{u.count}</span>
            </li>
          ))}
        </ul>
      )}
    </StatCard>
  );
}
