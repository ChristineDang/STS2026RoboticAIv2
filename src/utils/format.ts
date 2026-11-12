export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "just now", "12s", "4m", "2h" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatAgo(ms: number): string {
  return ms < 5000 ? "just now" : `${formatDuration(ms)} ago`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Rounded down to one decimal, so a short outage never reads as "100%". */
export function formatUptime(fraction: number): string {
  if (fraction >= 1) return "100%";
  return `${(Math.floor(fraction * 1000) / 10).toFixed(1)}%`;
}

/** Time only for today, otherwise date and time. */
export function formatWhen(ms: number): string {
  const date = new Date(ms);
  if (date.toDateString() === new Date().toDateString()) return formatTime(ms);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
