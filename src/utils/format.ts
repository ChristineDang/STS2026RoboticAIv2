export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
