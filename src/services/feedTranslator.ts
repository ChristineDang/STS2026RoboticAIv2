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
// When the backend team confirms their format, edit the tables below.
import type { DashboardStats, FeedEvent } from "../types";
import { parseStatsMessage } from "./statsService";

// ============================ FORMAT TABLES ================================

/** Fields that may hold the yes/no auth result. */
const AUTH_FIELDS = ["auth", "authorized", "authorised", "authenticated", "verified", "auth_status", "authStatus"];
const AUTH_YES = ["yes", "y", "true", "1", "verified", "authorized", "authorised", "approved", "allowed", "allow", "granted", "pass"];
const AUTH_NO = ["no", "n", "false", "0", "unverified", "unauthorized", "unauthorised", "denied", "deny", "rejected", "fail", "intruder", "unknown"];

/** Fields that may hold the arm/hardware result. */
const ARM_FIELDS = ["arm", "arm_status", "armStatus", "hardware", "laptop"];
const ARM_VALUES: Record<string, ArmKind> = {
  closing: "armClosing", moving: "armClosing", started: "armClosing", in_progress: "armClosing",
  closed: "armClosed", done: "armClosed", success: "armClosed", secured: "armClosed", complete: "armClosed",
  failed: "armFailed", fail: "armFailed", error: "armFailed", stuck: "armFailed", jammed: "armFailed", timeout: "armFailed",
};

/** Typed messages: { "type": "auth", "value": "no" } / { "type": "arm", "status": "closed" }. */
const TYPE_FIELDS = ["type", "event", "kind"];
const AUTH_TYPES = ["auth", "authentication", "authorization", "verification"];
const ARM_TYPES = ["arm", "hardware", "laptop"];
const TYPED_VALUE_FIELDS = ["value", "result", "status", "state"];

/** Named events: { "event": "unverified_person" }. Names are matched lower-case with _ for spaces/dashes. */
const EVENT_NAMES: Record<string, FeedEvent["kind"]> = {
  unverified_person: "unverifiedPerson", unknown_person: "unverifiedPerson", intruder: "unverifiedPerson", auth_failed: "unverifiedPerson",
  verified_person: "verifiedPerson", verified_person_returned: "verifiedPerson", auth_ok: "verifiedPerson",
  arm_closing: "armClosing", laptop_closing: "armClosing",
  arm_closed: "armClosed", laptop_closed: "armClosed",
  arm_failed: "armFailed", arm_error: "armFailed", laptop_close_failed: "armFailed",
};

const CONFIDENCE_FIELDS = ["confidence", "score", "similarity"];
const TIME_FIELDS = ["at", "timestamp", "time", "ts"];
const REASON_FIELDS = ["reason", "error", "message", "detail"];
/** Objects inside these fields are read too (one or two levels deep). */
const WRAPPER_FIELDS = ["data", "payload", "body", "metrics"];

// ==========================================================================

type ArmKind = "armClosing" | "armClosed" | "armFailed";
type Msg = Record<string, unknown>;

export interface TranslatedMessage {
  stats: Partial<DashboardStats>;
  events: FeedEvent[];
}

export function translateMessage(raw: unknown): TranslatedMessage {
  const out: TranslatedMessage = { stats: {}, events: [] };
  const items = Array.isArray(raw) ? raw : [raw];
  for (const item of items) visit(item, out, 0);
  return out;
}

function visit(raw: unknown, out: TranslatedMessage, depth: number) {
  if (!isObject(raw) || depth > 2) return;
  Object.assign(out.stats, parseStatsMessage(raw));
  const event = readEvent(raw);
  if (event) out.events.push(event);
  for (const field of WRAPPER_FIELDS) visit(raw[field], out, depth + 1);
}

function readEvent(msg: Msg): FeedEvent | null {
  const at = readTime(msg);
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

function readTime(msg: Msg): number {
  for (const field of TIME_FIELDS) {
    const v = msg[field];
    if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v; // seconds or ms
    if (typeof v === "string") {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return Date.now();
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
