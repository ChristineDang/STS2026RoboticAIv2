import type { HealthLevel } from "../../types";

/** Coloured dot + text. The dot's shape also differs by level, so it doesn't rely on colour alone. */
export function StatusBadge({ level, label }: { level: HealthLevel; label: string }) {
  return (
    <span className={`health-badge health-badge--${level}`}>
      <span className="health-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
