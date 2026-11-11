// Dashboard metrics: turns the metric fields of a backend message into DashboardStats.
// Called by services/feedTranslator.ts for every incoming message.
//
// BACKEND CONTRACT — a message may contain all metric fields (a full snapshot)
// or only the ones that changed (a partial update):
//
//   {
//     "confidence_drop_frames": 12,
//     "rejections": 3,
//     "laptop_usage": [ { "person": "Alex", "count": 5 }, ... ]
//   }
//
// If the backend uses different names, change them here only.
import type { DashboardStats } from "../types";

export const EMPTY_STATS: DashboardStats = {
  confidenceDropFrames: 0,
  rejections: 0,
  laptopUsage: [],
};

/** Converts one backend message into the fields of DashboardStats it contains. */
export function parseStatsMessage(raw: unknown): Partial<DashboardStats> {
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
  return update;
}
