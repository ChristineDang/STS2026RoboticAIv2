// Dashboard metrics: turns the metric fields of a backend message into DashboardStats.
// Called by services/feedTranslator.ts for every incoming message.
//
// BACKEND CONTRACT — a message may contain all metric fields (a full snapshot)
// or only the ones that changed (a partial update):
//
//   {
//     "confidence_drop_frames": 12,
//     "rejections": 3,
//     "laptop_usage": [ { "person": "Alex", "count": 5 }, ... ],
//     "last_used": { "person": "Alex", "at": "2026-11-11T17:00:00Z" }
//   }
//
// "Last used" also accepts flat fields ("last_used_by", "last_used_at"). Without
// them, the dashboard works it out (see applyStatsUpdate): a verified-person
// message that names the person, or one person's laptop_usage count going up.
//
// If the backend uses different names, change them here only.
import type { DashboardStats, LastUse } from "../types";

export const EMPTY_STATS: DashboardStats = {
  confidenceDropFrames: 0,
  rejections: 0,
  laptopUsage: [],
  lastUse: null,
};

const PERSON_FIELDS = ["person", "name", "user"];
const TIME_FIELDS = ["at", "time", "timestamp"];

/** A time as epoch ms: a number (seconds or ms) or a date string. */
export function parseTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readLastUse(msg: Record<string, unknown>, receivedAt: number): LastUse | undefined {
  const nested = msg.last_used;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    const person = PERSON_FIELDS.map((f) => text(n[f])).find((v) => v !== null) ?? null;
    const at = TIME_FIELDS.map((f) => parseTime(n[f])).find((v) => v !== undefined);
    if (person !== null || at !== undefined) return { person, at: at ?? receivedAt };
  }
  const person = text(msg.last_used_by);
  const at = parseTime(msg.last_used_at);
  if (person !== null || at !== undefined) return { person, at: at ?? receivedAt };
  return undefined;
}

/** Converts one backend message into the fields of DashboardStats it contains. */
export function parseStatsMessage(raw: unknown, receivedAt: number = Date.now()): Partial<DashboardStats> {
  if (typeof raw !== "object" || raw === null) return {};
  const msg = raw as Record<string, unknown>;
  const update: Partial<DashboardStats> = {};

  if (typeof msg.confidence_drop_frames === "number") {
    update.confidenceDropFrames = msg.confidence_drop_frames;
  }
  if (typeof msg.rejections === "number") {
    update.rejections = msg.rejections;
  }
  if (Array.isArray(msg.laptop_usage)) {
    update.laptopUsage = msg.laptop_usage
      .filter(
        (u): u is { person: string; count: number } =>
          typeof u?.person === "string" && typeof u?.count === "number"
      )
      .map((u) => ({ person: u.person, count: u.count }));
  }
  const lastUse = readLastUse(msg, receivedAt);
  if (lastUse) update.lastUse = lastUse;
  return update;
}

// ---- Applying updates ---------------------------------------------------------

export interface StatsState {
  stats: DashboardStats;
  /** True once a laptop_usage list has arrived, so count changes after it mean real use. */
  usageSeen: boolean;
}

export const INITIAL_STATS_STATE: StatsState = { stats: EMPTY_STATS, usageSeen: false };

/** If exactly one person's count went up, they used the laptop. */
function inferLastUse(prev: DashboardStats["laptopUsage"], next: DashboardStats["laptopUsage"], at: number): LastUse | null {
  const before = new Map(prev.map((u) => [u.person, u.count]));
  const risen = next.filter((u) => u.count > (before.get(u.person) ?? 0));
  return risen.length === 1 ? { person: risen[0].person, at } : null;
}

/**
 * Merges a metrics update into the current stats (pure, so it is safe as a reducer).
 * `verifiedUses` are verified-person messages that named the person.
 */
export function applyStatsUpdate(
  state: StatsState,
  update: Partial<DashboardStats>,
  verifiedUses: LastUse[],
  receivedAt: number
): StatsState {
  const candidates: LastUse[] = [...verifiedUses];
  if (update.lastUse) candidates.push(update.lastUse);
  else if (update.laptopUsage && state.usageSeen) {
    const inferred = inferLastUse(state.stats.laptopUsage, update.laptopUsage, receivedAt);
    if (inferred) candidates.push(inferred);
  }

  // The newest wins; an older report (e.g. a replay) never replaces a newer one.
  let lastUse = state.stats.lastUse;
  for (const c of candidates) if (!lastUse || c.at >= lastUse.at) lastUse = c;

  return {
    stats: { ...state.stats, ...update, lastUse },
    usageSeen: state.usageSeen || update.laptopUsage !== undefined,
  };
}
