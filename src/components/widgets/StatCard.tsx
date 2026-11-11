import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: number | string;
  unit?: string;
  /** Optional extra content shown under the value (e.g. a breakdown list). */
  children?: ReactNode;
}

export function StatCard({ label, value, unit, children }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">
        {value}
        {unit && <span className="stat-card__unit"> {unit}</span>}
      </div>
      {children}
    </div>
  );
}
