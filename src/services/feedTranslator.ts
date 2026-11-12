// Event translator: the ONE place that knows what backend messages look like.
//
// Every message — from the webhook relay or a backend WebSocket — comes through
// translateMessage(), which splits it into metrics (for the cards) and events
// (for the alert system). Nothing else in the dashboard reads raw messages.
//
// The backend format isn't final, so several shapes are accepted. All of these work:
//
//   { "auth": "no", "confidence": 0.91 }               yes/no field
//   { "authorized": false }                            boolean
//   { "type": "auth", "value": "no" }                  typed message
//   { "event": "unverified_person" }                   named event
//   { "arm": "closed" }  { "type": "arm", "status": "failed", "reason": "..." }
//   { "type": "metrics", "data": { "rejections": 3 } } wrapped metrics
//   [ {...}, {...} ]                                   several at once
//
// Robot arm health (backend → robot link), any of:
//
//   { "robots": [ { "id": "arm-1", "name": "Left arm", "status": "online", "latency_ms": 42, "last_seen": "..." } ] }
//   { "robot_status": "offline" }                      one arm, status only
//   { "type": "robot", "id": "arm-1", "status": "degraded", "detail": "high latency" }
//
// When the backend team confirms their format, edit the tables below. The
// verified/denied rules live in shared/feedFormat.json, because the relay uses
// them too (to save photos of denied people).
import feedFormat from "../../shared/feedFormat.json";
import type { DashboardStats, FeedEvent, RobotHealth, RobotStatus } from "../types";
import { parseStatsMessage } from "./statsService";

// ============================ FORMAT TABLES ================================

/** Fields that may hold the yes/no auth result. */
const AUTH_FIELDS = feedFormat.authFields;
const AUTH_YES = feedFormat.authYes;
const AUTH_NO = feedFormat.authNo;

/** Fields that may hold the arm/hardware result. */
const ARM_FIELDS = ["arm", "arm_status", "armStatus", "hardware", "laptop"];
const ARM_VALUES: Record<string, ArmKind> = {
  closing: "armClosing", moving: "armClosing", started: "armClosing", in_progress: "armClosing",
  closed: "armClosed", done: "armClosed", success: "armClosed", secured: "armClosed", complete: "armClosed",
  failed: "armFailed", fail: "armFailed", error: "armFailed", stuck: "armFailed", jammed: "armFailed", timeout: "armFailed",
};

/** Typed messages: { "type": "auth", "value": "no" } / { "type": "arm", "status": "closed" }. */
const TYPE_FIELDS = feedFormat.typeFields;
const AUTH_TYPES = feedFormat.authTypes;
const ARM_TYPES = ["arm", "hardware", "laptop"];
const TYPED_VALUE_FIELDS = feedFormat.typedValueFields;

/** Named events: { "event": "unverified_person" }. Names are matched lower-case with _ for spaces/dashes. */
const EVENT_NAMES: Record<string, FeedEvent["kind"]> = {
  ...Object.fromEntries(feedFormat.deniedEventNames.map((n) => [n, "unverifiedPerson" as const])),
  ...Object.fromEntries(feedFormat.verifiedEventNames.map((n) => [n, "verifiedPerson" as const])),
  arm_closing: "armClosing", laptop_closing: "armClosing",
  arm_closed: "armClosed", laptop_closed: "armClosed",
  arm_failed: "armFailed", arm_error: "armFailed", laptop_close_failed: "armFailed",
};

const CONFIDENCE_FIELDS = ["confidence", "score", "similarity"];
/** Who was verified: { "auth": "yes", "person": "Alex" }. Used for "Last used by". */
const PERSON_FIELDS = ["person", "person_name", "user", "user_name", "name"];
const TIME_FIELDS = ["at", "timestamp", "time", "ts"];
const REASON_FIELDS = ["reason", "error", "message", "detail"];
/** Objects inside these fields are read too (one or two levels deep). */
const WRAPPER_FIELDS = feedFormat.wrapperFields;

/** Robot arm health. */
const ROBOT_LIST_FIELDS = ["robots", "arms", "robot_arms"];
const ROBOT_SINGLE_FIELDS = ["robot", "robot_status", "robot_health", "robotStatus"];
const ROBOT_TYPES = ["robot", "robot_health", "robot_status"];
const ROBOT_ID_FIELDS = ["id", "robot_id", "arm_id", "name"];
const ROBOT_NAME_FIELDS = ["name", "label", "id"];
const ROBOT_STATUS_FIELDS = ["status", "state", "health", "connection"];
const ROBOT_LAST_SEEN_FIELDS = ["last_seen", "lastSeen", "last_heartbeat", "lastHeartbeat"];
const ROBOT_LATENCY_FIELDS = ["latency_ms", "latencyMs", "ping_ms", "latency"];
const ROBOT_DETAIL_FIELDS = ["detail", "message", "error", "reason"];
const ROBOT_STATUS_VALUES: Record<string, RobotStatus> = {
  online: "online", ok: "online", connected: "online", healthy: "online", up: "online", ready: "online", idle: "online", busy: "online",
  degraded: "degraded", slow: "degraded", warning: "degraded", warn: "degraded", unstable: "degraded",
  offline: "offline", disconnected: "offline", down: "offline", error: "offline", unreachable: "offline", fault: "offline",
};

// ==========================================================================

type ArmKind = "armClosing" | "armClosed" | "armFailed";
type Msg = Record<string, unknown>;

/** A robot report before the dashboard stamps it with when it arrived. */
export type RobotReport = Omit<RobotHealth, "receivedAt">;

export interface TranslatedMessage {
  stats: Partial<DashboardStats>;
  events: FeedEvent[];
  robots: RobotReport[];
}

/**
 * @param receivedAt when the message reached the dashboard (or the relay, for
 *   replayed messages). Used as the event time when the message has none.
 */
export function translateMessage(raw: unknown, receivedAt: number = Date.now()): TranslatedMessage {
  const out: TranslatedMessage = { stats: {}, events: [], robots: [] };
  const items = Array.isArray(raw) ? raw : [raw];
  for (const item of items) visit(item, out, 0, receivedAt);
  return out;
}

function visit(raw: unknown, out: TranslatedMessage, depth: number, receivedAt: number) {
  if (!isObject(raw) || depth > 2) return;
  Object.assign(out.stats, parseStatsMessage(raw, receivedAt));
  const event = readEvent(raw, receivedAt);
  if (event) out.events.push(event);
  out.robots.push(...readRobots(raw));
  for (const field of WRAPPER_FIELDS) visit(raw[field], out, depth + 1, receivedAt);
}

function readRobots(msg: Msg): RobotReport[] {
  const reports: RobotReport[] = [];
  if (TYPE_FIELDS.some((f) => ROBOT_TYPES.includes(normalize(msg[f])))) {
    const report = readRobot(msg, "arm");
    if (report) reports.push(report);
  }
  for (const field of ROBOT_LIST_FIELDS) {
    const list = msg[field];
    if (!Array.isArray(list)) continue;
    list.forEach((item, i) => {
      const report = readRobot(item, `arm-${i + 1}`);
      if (report) reports.push(report);
    });
  }
  for (const field of ROBOT_SINGLE_FIELDS) {
    const report = readRobot(msg[field], "arm");
    if (report) reports.push(report);
  }
  return reports;
}

/** One robot entry: a status string ("online") or an object with status, name, latency… */
function readRobot(value: unknown, fallbackId: string): RobotReport | null {
  if (typeof value === "string") {
    const status = ROBOT_STATUS_VALUES[normalize(value)];
    return status ? { id: fallbackId, name: "Robot arm", status } : null;
  }
  if (!isObject(value)) return null;
  const statusRaw = firstString(value, ROBOT_STATUS_FIELDS);
  if (statusRaw === undefined) return null;
  const id = firstString(value, ROBOT_ID_FIELDS) ?? fallbackId;
  const lastSeen = readTimeFrom(value, ROBOT_LAST_SEEN_FIELDS);
  const latency = firstNumber(value, ROBOT_LATENCY_FIELDS);
  return {
    id,
    name: firstString(value, ROBOT_NAME_FIELDS) ?? "Robot arm",
    status: ROBOT_STATUS_VALUES[normalize(statusRaw)] ?? "unknown",
    ...(lastSeen !== undefined ? { lastSeen } : {}),
    ...(latency !== undefined ? { latencyMs: latency } : {}),
    ...(firstString(value, ROBOT_DETAIL_FIELDS) ? { detail: firstString(value, ROBOT_DETAIL_FIELDS) } : {}),
  };
}

function firstString(msg: Msg, fields: string[]): string | undefined {
  for (const field of fields) {
    const v = msg[field];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function firstNumber(msg: Msg, fields: string[]): number | undefined {
  for (const field of fields) {
    const v = typeof msg[field] === "string" ? Number(msg[field]) : msg[field];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function readEvent(msg: Msg, receivedAt: number): FeedEvent | null {
  const at = readTimeFrom(msg, TIME_FIELDS) ?? receivedAt;
  const types = TYPE_FIELDS.map((f) => normalize(msg[f])).filter(Boolean);

  // 1. Named event: { "event": "unverified_person" }
  for (const type of types) {
    const kind = EVENT_NAMES[type];
    if (kind) return build(kind, msg, at);
  }

  // 2. Typed message: { "type": "auth", "value": "no" }
  if (types.some((t) => AUTH_TYPES.includes(t))) {
    for (const field of TYPED_VALUE_FIELDS) {
      const yes = readYesNo(msg[field]);
      if (yes !== null) return build(yes ? "verifiedPerson" : "unverifiedPerson", msg, at);
    }
  }
  if (types.some((t) => ARM_TYPES.includes(t))) {
    for (const field of TYPED_VALUE_FIELDS) {
      const kind = ARM_VALUES[normalize(msg[field])];
      if (kind) return build(kind, msg, at);
    }
  }

  // 3. Plain fields: { "auth": "no" }, { "arm": "closed" }
  for (const field of AUTH_FIELDS) {
    const yes = readYesNo(msg[field]);
    if (yes !== null) return build(yes ? "verifiedPerson" : "unverifiedPerson", msg, at);
  }
  for (const field of ARM_FIELDS) {
    const kind = ARM_VALUES[normalize(msg[field])];
    if (kind) return build(kind, msg, at);
  }
  return null;
}

function build(kind: FeedEvent["kind"], msg: Msg, at: number): FeedEvent {
  switch (kind) {
    case "unverifiedPerson":
      return { kind, at, confidence: readConfidence(msg) };
    case "armFailed":
      return { kind, at, reason: readReason(msg) };
    case "verifiedPerson": {
      const person = firstString(msg, PERSON_FIELDS);
      return person ? { kind, at, person } : { kind, at };
    }
    default:
      return { kind, at };
  }
}

function readYesNo(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const v = normalize(value);
  if (AUTH_YES.includes(v)) return true;
  if (AUTH_NO.includes(v)) return false;
  return null;
}

function readConfidence(msg: Msg): number | undefined {
  for (const field of CONFIDENCE_FIELDS) {
    const n = typeof msg[field] === "string" ? Number(msg[field]) : msg[field];
    if (typeof n === "number" && Number.isFinite(n)) {
      return n > 1 && n <= 100 ? n / 100 : n; // accept 91 as well as 0.91
    }
  }
  return undefined;
}

function readTimeFrom(msg: Msg, fields: string[]): number | undefined {
  for (const field of fields) {
    const v = msg[field];
    if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v; // seconds or ms
    if (typeof v === "string") {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

function readReason(msg: Msg): string | undefined {
  for (const field of REASON_FIELDS) {
    if (typeof msg[field] === "string" && msg[field]) return msg[field] as string;
  }
  return undefined;
}

function normalize(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isObject(value: unknown): value is Msg {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
