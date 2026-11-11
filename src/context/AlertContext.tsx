// The alert system: decides whether the dashboard is in an alert, and owns
// everything security-related (hidden data, red edges, banner, sounds).
// Iris only watches this state; nothing here depends on Iris.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ARM_FEEDBACK, ARM_TIMEOUT_MS } from "../config";
import { playCue, type SoundCue } from "../services/sound";
import type { AlertLogEntry, AlertPhase, AlertResolution, ArmStatus, FeedEvent } from "../types";
import { usePreferences } from "./PreferencesContext";

const MAX_LOG = 50;
export const ARM_TIMEOUT_REASON = "No confirmation from the arm";

export interface AlertState {
  phase: AlertPhase;
  armStatus: ArmStatus;
  current: AlertLogEntry | null;
  /** Newest first. Kept until the page reloads. */
  log: AlertLogEntry[];
  lastResolution: AlertResolution | null;
  failReason: string | null;
  nextId: number;
}

const INITIAL_STATE: AlertState = {
  phase: "normal",
  armStatus: "idle",
  current: null,
  log: [],
  lastResolution: null,
  failReason: null,
  nextId: 1,
};

type AlertAction =
  | { type: "event"; event: FeedEvent }
  | { type: "operatorClear"; at: number }
  | { type: "armTimeout"; alertId: number };

function updateCurrent(state: AlertState, patch: Partial<AlertLogEntry>): AlertState {
  if (!state.current) return state;
  const current = { ...state.current, ...patch };
  return { ...state, current, log: state.log.map((e) => (e.id === current.id ? current : e)) };
}

function endAlert(state: AlertState, resolution: AlertResolution, at: number): AlertState {
  return {
    ...updateCurrent(state, { endedAt: at, resolution }),
    phase: "normal",
    armStatus: "idle",
    current: null,
    lastResolution: resolution,
    failReason: null,
  };
}

function armFailed(state: AlertState, reason: string): AlertState {
  return { ...updateCurrent(state, { armResult: "failed" }), phase: "failed", armStatus: "failed", failReason: reason };
}

export function alertReducer(state: AlertState, action: AlertAction): AlertState {
  switch (action.type) {
    case "operatorClear":
      return state.phase === "normal" ? state : endAlert(state, "operator", action.at);

    case "armTimeout":
      return state.phase === "alert" && state.current?.id === action.alertId
        ? armFailed(state, ARM_TIMEOUT_REASON)
        : state;

    case "event": {
      const event = action.event;
      switch (event.kind) {
        case "unverifiedPerson": {
          // Already handling an alert: the camera repeating "no" changes nothing.
          if (state.phase !== "normal") return state;
          const entry: AlertLogEntry = { id: state.nextId, startedAt: event.at, confidence: event.confidence };
          return {
            ...state,
            phase: "alert",
            armStatus: "requested",
            current: entry,
            log: [entry, ...state.log].slice(0, MAX_LOG),
            nextId: state.nextId + 1,
            lastResolution: null,
            failReason: null,
          };
        }
        case "verifiedPerson":
          // A failed close never clears by itself: someone has to acknowledge it.
          return state.phase === "alert" || state.phase === "secured"
            ? endAlert(state, "verifiedPerson", event.at)
            : state;
        case "armClosing":
          return state.phase === "alert" ? { ...state, armStatus: "closing" } : state;
        case "armClosed":
          return state.phase === "alert"
            ? { ...updateCurrent(state, { armResult: "closed" }), phase: "secured", armStatus: "closed" }
            : state;
        case "armFailed":
          return state.phase === "alert" || state.phase === "secured"
            ? armFailed(state, event.reason ?? "The arm reported a problem")
            : state;
      }
      return state;
    }
  }
}

const CUE_FOR_PHASE: Record<AlertPhase, SoundCue> = {
  alert: "alert",
  secured: "secured",
  failed: "worried",
  normal: "clear",
};

interface AlertValue {
  state: AlertState;
  /** True during any alert phase: cards must not show their data. */
  dataHidden: boolean;
  handleEvent: (event: FeedEvent) => void;
  clearAlert: () => void;
}

const AlertContext = createContext<AlertValue | null>(null);

export function AlertProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(alertReducer, INITIAL_STATE);
  const { soundOn } = usePreferences();
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  const handleEvent = useCallback((event: FeedEvent) => dispatch({ type: "event", event }), []);
  const clearAlert = useCallback(() => dispatch({ type: "operatorClear", at: Date.now() }), []);

  // With arm feedback on, an alert the arm never answers becomes "failed".
  const currentId = state.current?.id;
  useEffect(() => {
    if (!ARM_FEEDBACK || state.phase !== "alert" || currentId === undefined) return;
    const timer = setTimeout(() => dispatch({ type: "armTimeout", alertId: currentId }), ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.phase, currentId]);

  // One sound per phase change; repeats of the same event don't change the phase, so they stay silent.
  const previousPhase = useRef(state.phase);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = state.phase;
    if (previous !== state.phase && soundOnRef.current) playCue(CUE_FOR_PHASE[state.phase]);
  }, [state.phase]);

  const value = useMemo<AlertValue>(
    () => ({ state, dataHidden: state.phase !== "normal", handleEvent, clearAlert }),
    [state, handleEvent, clearAlert]
  );

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlert(): AlertValue {
  const value = useContext(AlertContext);
  if (!value) throw new Error("useAlert must be used inside <AlertProvider>");
  return value;
}
