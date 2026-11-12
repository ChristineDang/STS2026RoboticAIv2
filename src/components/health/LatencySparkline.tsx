import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { LATENCY_HISTORY_MS, ROBOT_SLOW_MS } from "../../config";
import { latencyStats } from "../../services/health";
import type { LatencySample } from "../../types";
import { formatDuration, formatTime } from "../../utils/format";

/** Shortest time axis, so a couple of reports don't stretch across the whole width. */
const MIN_SPAN_MS = 30_000;
const W = 240;
const H = 40;
/** Room so the line and dot aren't clipped at the top or bottom. */
const PAD = 3;

/**
 * One arm's latency over the last 10 minutes (or since the first report, if
 * that's more recent): a 2px line from a zero baseline,
 * a dashed line at the "slow" threshold when it's in range, and a hover/focus
 * readout. Min/avg/max are printed underneath, so nothing depends on hovering.
 */
export function LatencySparkline({ samples, now, name }: { samples: LatencySample[]; now: number; name: string }) {
  const [active, setActive] = useState<number | null>(null);
  const visible = samples.filter((s) => s.at >= now - LATENCY_HISTORY_MS);
  const stats = latencyStats(visible);

  if (!stats) return <div className="sparkline__empty">No latency reports in the last 10 min</div>;

  // The time axis starts at the oldest report (at most 10 min ago), so a short history still fills the width.
  const start = Math.min(visible[0].at, now - MIN_SPAN_MS);
  const span = now - start;
  const yMax = Math.max(stats.max * 1.15, 50);
  const x = (at: number) => ((at - start) / span) * W;
  const y = (ms: number) => H - PAD - (ms / yMax) * (H - 2 * PAD);
  const points = visible.map((s) => `${x(s.at).toFixed(1)},${y(s.ms).toFixed(1)}`).join(" ");
  const showThreshold = ROBOT_SLOW_MS <= yMax;
  const last = visible[visible.length - 1];
  const shown = active !== null ? visible[Math.min(active, visible.length - 1)] : null;

  const nearest = (clientX: number, rect: DOMRect) => {
    const at = start + ((clientX - rect.left) / rect.width) * span;
    let best = 0;
    visible.forEach((s, i) => {
      if (Math.abs(s.at - at) < Math.abs(visible[best].at - at)) best = i;
    });
    return best;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = active ?? visible.length - 1;
    setActive(Math.max(0, Math.min(visible.length - 1, current + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  const spanText = span >= LATENCY_HISTORY_MS - 1000 ? "10 min" : formatDuration(span);
  const summary = `${name} latency, last ${spanText}: min ${Math.round(stats.min)}, average ${Math.round(stats.avg)}, max ${Math.round(stats.max)} ms`;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="sparkline">
      <div
        className="sparkline__plot"
        tabIndex={0}
        role="img"
        aria-label={`${summary}. Use the arrow keys to read individual reports.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(visible.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="sparkline__baseline" x1="0" x2={W} y1={H - PAD} y2={H - PAD} />
          {showThreshold && (
            <line className="sparkline__threshold" x1="0" x2={W} y1={y(ROBOT_SLOW_MS)} y2={y(ROBOT_SLOW_MS)} />
          )}
          {visible.length > 1 && <polyline className="sparkline__line" points={points} />}
          {shown && <line className="sparkline__crosshair" x1={x(shown.at)} x2={x(shown.at)} y1="0" y2={H} />}
        </svg>
        {/* Dots are HTML so they stay round while the SVG stretches to the card width. */}
        <span className="sparkline__dot" style={{ left: pct(x((shown ?? last).at), W), top: pct(y((shown ?? last).ms), H) }} />
        {shown && (
          <div className={`sparkline__tooltip${x(shown.at) > W / 2 ? " sparkline__tooltip--left" : ""}`} style={{ left: pct(x(shown.at), W) }}>
            <strong>{Math.round(shown.ms)} ms</strong>
            <span>{formatTime(shown.at)}</span>
          </div>
        )}
      </div>
      <div className="sparkline__stats">
        <span>Last {spanText}</span>
        <span>
          min {Math.round(stats.min)} · avg {Math.round(stats.avg)} · max {Math.round(stats.max)} ms
        </span>
      </div>
    </div>
  );
}
