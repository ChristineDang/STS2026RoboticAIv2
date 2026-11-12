// Live feed: connects to the relay or the backend WebSocket(s) (see FEED_MODE in
// api/backend.ts), reconnects when the connection drops, and sends every message
// through the translator: metrics go to `stats`, robot reports to `robots`,
// events go to the alert system. Also tracks the health of the connection itself.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FEED_MODE, WS_PATHS, openRelayStream, openSocket } from "../api/backend";
import { translateMessage } from "../services/feedTranslator";
import { appendLatency } from "../services/health";
import { INITIAL_STATS_STATE, applyStatsUpdate, type StatsState } from "../services/statsService";
import type {
  CameraStats,
  ConnectionStatus,
  DashboardStats,
  FeedHealth,
  LastUse,
  RelayStatus,
  RobotHealth,
} from "../types";
import { useAlert } from "./AlertContext";

const RECONNECT_DELAY_MS = 3000;

type Deliver = (raw: unknown, receivedAt?: number) => void;

interface Connection {
  deliver: Deliver;
  setStatus: (status: ConnectionStatus) => void;
  onRelayStatus: (raw: unknown) => void;
  onCapture: () => void;
}

interface LiveFeedValue {
  stats: DashboardStats;
  status: ConnectionStatus;
  health: FeedHealth;
  /** Latest report per robot arm, in the order first seen. */
  robots: RobotHealth[];
  /** Goes up by one whenever the relay saves or deletes a denied-person photo. */
  captureVersion: number;
  /** Feeds a message through the same path as the real feed (used by the Settings simulator). */
  injectMessage: (raw: unknown) => void;
}

const INITIAL_HEALTH: FeedHealth = { connectedSince: null, lastDataAt: null, reconnects: 0, relay: null };

const LiveFeedContext = createContext<LiveFeedValue | null>(null);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseCameraStats(raw: unknown): CameraStats | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c.state === "off") {
    return { state: "off", offReason: c.offReason === "monitor_off" ? "monitor_off" : "not_configured" };
  }
  if (c.state !== "up" && c.state !== "down") return null;
  return {
    state: c.state,
    kind: c.kind === "stream" || c.kind === "snapshot" ? c.kind : null,
    fps: num(c.fps),
    upMs: num(c.upMs) ?? 0,
    downMs: num(c.downMs) ?? 0,
    since: num(c.since) ?? 0,
    drops: num(c.drops) ?? 0,
    lastFrameAt: num(c.lastFrameAt),
    error: typeof c.error === "string" ? c.error : null,
  };
}

function parseRelayStatus(raw: unknown): RelayStatus | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const now = num(r.now);
  const startedAt = num(r.startedAt);
  if (now === null || startedAt === null) return null;
  return {
    now,
    startedAt,
    lastWebhookAt: num(r.lastWebhookAt),
    accepted: num(r.accepted) ?? 0,
    rejected: num(r.rejected) ?? 0,
    lastRejectedAt: num(r.lastRejectedAt),
    lastRejectReason: typeof r.lastRejectReason === "string" ? r.lastRejectReason : null,
    camera: parseCameraStats(r.camera),
  };
}

type StatsAction = { update: Partial<DashboardStats>; verifiedUses: LastUse[]; receivedAt: number };

function statsReducer(state: StatsState, action: StatsAction): StatsState {
  return applyStatsUpdate(state, action.update, action.verifiedUses, action.receivedAt);
}

export function LiveFeedProvider({ children }: { children: ReactNode }) {
  const { handleEvent } = useAlert();
  const [{ stats }, dispatchStats] = useReducer(statsReducer, INITIAL_STATS_STATE);
  const [status, setStatusState] = useState<ConnectionStatus>("connecting");
  const [health, setHealth] = useState<FeedHealth>(INITIAL_HEALTH);
  const [robots, setRobots] = useState<RobotHealth[]>([]);
  const [captureVersion, setCaptureVersion] = useState(0);

  const ingest = useCallback(
    (raw: unknown, receivedAt: number = Date.now()) => {
      const { stats: update, events, robots: reports } = translateMessage(raw, receivedAt);
      const verifiedUses: LastUse[] = events.flatMap((e) =>
        e.kind === "verifiedPerson" && e.person ? [{ person: e.person, at: e.at }] : []
      );
      if (Object.keys(update).length > 0 || verifiedUses.length > 0) {
        dispatchStats({ update, verifiedUses, receivedAt });
      }
      if (reports.length > 0) {
        setRobots((prev) => {
          const next = [...prev];
          for (const report of reports) {
            const i = next.findIndex((r) => r.id === report.id);
            const previous = i === -1 ? undefined : next[i];
            if (previous && previous.receivedAt > receivedAt) continue; // a replay older than what we have
            const entry: RobotHealth = {
              ...report,
              receivedAt,
              latencyHistory: appendLatency(previous?.latencyHistory, report.latencyMs, receivedAt),
            };
            if (i === -1) next.push(entry);
            else next[i] = entry;
          }
          return next;
        });
      }
      events.forEach(handleEvent);
    },
    [handleEvent]
  );
  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;

  useEffect(() => {
    const noteData = () => setHealth((h) => ({ ...h, lastDataAt: Date.now() }));
    const connection: Connection = {
      deliver: (raw, receivedAt) => {
        noteData();
        ingestRef.current(raw, receivedAt);
      },
      setStatus: (next) => {
        setStatusState(next);
        setHealth((h) => {
          if (next === "live") return { ...h, connectedSince: h.connectedSince ?? Date.now() };
          if (h.connectedSince === null) return h;
          return { ...h, connectedSince: null, reconnects: h.reconnects + 1 };
        });
      },
      onRelayStatus: (raw) => {
        const relay = parseRelayStatus(raw);
        if (relay) setHealth((h) => ({ ...h, lastDataAt: Date.now(), relay: { ...relay, receivedAt: Date.now() } }));
      },
      onCapture: () => setCaptureVersion((v) => v + 1),
    };
    return FEED_MODE === "websocket" ? connectSockets(connection) : connectRelay(connection);
  }, []);

  const injectMessage = useCallback((raw: unknown) => ingest(raw), [ingest]);
  const value = useMemo(
    () => ({ stats, status, health, robots, captureVersion, injectMessage }),
    [stats, status, health, robots, captureVersion, injectMessage]
  );
  return <LiveFeedContext.Provider value={value}>{children}</LiveFeedContext.Provider>;
}

export function useLiveFeed(): LiveFeedValue {
  const value = useContext(LiveFeedContext);
  if (!value) throw new Error("useLiveFeed must be used inside <LiveFeedProvider>");
  return value;
}

/** Relay mode: one Server-Sent Events stream. Returns a cleanup function. */
function connectRelay({ deliver, setStatus, onRelayStatus, onCapture }: Connection): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    setStatus("connecting");
    const current = openRelayStream({ onMessage: deliver, onStatus: onRelayStatus, onCapture });
    source = current;
    current.onopen = () => setStatus("live");
    current.onerror = () => {
      if (stopped) return;
      setStatus("disconnected");
      // EventSource retries a dropped connection by itself, but gives up for good
      // if the relay refuses it (relay down at startup, wrong key or origin): start over.
      if (current.readyState === EventSource.CLOSED) {
        current.close();
        retryTimer = setTimeout(open, RECONNECT_DELAY_MS);
      }
    };
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    source?.close();
  };
}

/** WebSocket mode: one socket per path in WS_PATHS. Returns a cleanup function. */
function connectSockets({ deliver, setStatus }: Connection): () => void {
  const sockets = new Set<WebSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let openCount = 0;
  let stopped = false;

  const report = () => setStatus(openCount > 0 ? "live" : "disconnected");

  const connect = (path: string) => {
    const ws = openSocket(path, (raw) => deliver(raw));
    let wasOpen = false;
    sockets.add(ws);
    ws.onopen = () => {
      wasOpen = true;
      openCount++;
      report();
    };
    ws.onclose = () => {
      sockets.delete(ws);
      if (wasOpen) openCount--;
      if (stopped) return;
      report();
      const timer = setTimeout(() => {
        timers.delete(timer);
        connect(path);
      }, RECONNECT_DELAY_MS);
      timers.add(timer);
    };
  };

  setStatus("connecting");
  WS_PATHS.forEach(connect);
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
    sockets.forEach((ws) => ws.close());
  };
}
