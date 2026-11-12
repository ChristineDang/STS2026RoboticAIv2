// Shared data shapes used by the dashboard UI.

export interface PersonLaptopUsage {
  person: string;
  count: number;
}

/** Who used the laptop most recently, and when. */
export interface LastUse {
  /** Null when the backend sent a time but no name. */
  person: string | null;
  at: number;
}

export interface DashboardStats {
  /** Number of frames where computer-vision confidence dropped. */
  confidenceDropFrames: number;
  /** Number of rejections. */
  rejections: number;
  /** Number of times each person used the laptop. */
  laptopUsage: PersonLaptopUsage[];
  lastUse: LastUse | null;
}

export interface LatencySample {
  at: number;
  ms: number;
}

export type ConnectionStatus = "connecting" | "live" | "disconnected";

/** Health of the backend → robot arm link, as reported by the backend. */
export type RobotStatus = "online" | "degraded" | "offline" | "unknown";

export interface RobotHealth {
  id: string;
  name: string;
  status: RobotStatus;
  /** When the backend last heard from this arm (if it says). */
  lastSeen?: number;
  latencyMs?: number;
  detail?: string;
  /** When the dashboard received this report. */
  receivedAt: number;
  /** Recent latency reports, oldest first (kept by the dashboard, see LATENCY_HISTORY_MS). */
  latencyHistory?: LatencySample[];
}

/** Camera health as measured by the relay (relay/camera-monitor.mjs). Times are the relay's clock. */
export type CameraStats =
  | {
      state: "up" | "down";
      /** "stream": MJPEG. "snapshot": a single-image URL, polled (no frame rate). Null until first connected. */
      kind: "stream" | "snapshot" | null;
      fps: number | null;
      /** Time up and down since the relay started. */
      upMs: number;
      downMs: number;
      /** When the current up/down state began. */
      since: number;
      /** Times the camera went from up to down. */
      drops: number;
      lastFrameAt: number | null;
      error: string | null;
    }
  | { state: "off"; offReason: "not_configured" | "monitor_off" };

/** Webhook statistics the relay reports every few seconds. Times are the relay's clock. */
export interface RelayStatus {
  now: number;
  startedAt: number;
  lastWebhookAt: number | null;
  accepted: number;
  rejected: number;
  lastRejectedAt: number | null;
  lastRejectReason: string | null;
  /** Null when the relay doesn't report it (an older relay). */
  camera: CameraStats | null;
}

export interface FeedHealth {
  connectedSince: number | null;
  /** Last time anything arrived (messages or relay status). */
  lastDataAt: number | null;
  reconnects: number;
  relay: (RelayStatus & { receivedAt: number }) | null;
}

export type HealthLevel = "ok" | "warn" | "bad" | "unknown";

/** Things that happen, as the dashboard understands them (see services/feedTranslator.ts). */
export type FeedEvent =
  | { kind: "unverifiedPerson"; at: number; confidence?: number }
  | { kind: "verifiedPerson"; at: number; person?: string }
  | { kind: "armClosing"; at: number }
  | { kind: "armClosed"; at: number }
  | { kind: "armFailed"; at: number; reason?: string };

/** normal → alert (auth: no) → secured (arm confirmed) or failed (arm problem) → normal. */
export type AlertPhase = "normal" | "alert" | "secured" | "failed";

/** "requested": alert started, no word from the arm yet. */
export type ArmStatus = "idle" | "requested" | "closing" | "closed" | "failed";

export type AlertResolution = "verifiedPerson" | "operator";

export interface AlertLogEntry {
  id: number;
  startedAt: number;
  confidence?: number;
  endedAt?: number;
  resolution?: AlertResolution;
  armResult?: "closed" | "failed";
}
