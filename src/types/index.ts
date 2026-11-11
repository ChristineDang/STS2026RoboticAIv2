// Shared data shapes used by the dashboard UI.

export interface PersonLaptopUsage {
  person: string;
  count: number;
}

export interface DashboardStats {
  /** Number of frames where computer-vision confidence dropped. */
  confidenceDropFrames: number;
  /** Number of rejections. */
  rejections: number;
  /** Number of times each person used the laptop. */
  laptopUsage: PersonLaptopUsage[];
}

export type ConnectionStatus = "connecting" | "live" | "disconnected";

/** Things that happen, as the dashboard understands them (see services/feedTranslator.ts). */
export type FeedEvent =
  | { kind: "unverifiedPerson"; at: number; confidence?: number }
  | { kind: "verifiedPerson"; at: number }
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
