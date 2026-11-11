// Live feed: connects to the relay or the backend WebSocket(s) (see FEED_MODE in
// api/backend.ts), reconnects when the connection drops, and sends every message
// through the translator: metrics go to `stats`, events go to the alert system.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FEED_MODE, WS_PATHS, openRelayStream, openSocket } from "../api/backend";
import { translateMessage } from "../services/feedTranslator";
import { EMPTY_STATS } from "../services/statsService";
import type { ConnectionStatus, DashboardStats } from "../types";
import { useAlert } from "./AlertContext";

const RECONNECT_DELAY_MS = 3000;

type Deliver = (raw: unknown) => void;
type SetStatus = (status: ConnectionStatus) => void;

interface LiveFeedValue {
  stats: DashboardStats;
  status: ConnectionStatus;
  /** Feeds a message through the same path as the real feed (used by the Settings simulator). */
  injectMessage: (raw: unknown) => void;
}

const LiveFeedContext = createContext<LiveFeedValue | null>(null);

export function LiveFeedProvider({ children }: { children: ReactNode }) {
  const { handleEvent } = useAlert();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  const ingest = useCallback(
    (raw: unknown) => {
      const { stats: update, events } = translateMessage(raw);
      if (Object.keys(update).length > 0) setStats((prev) => ({ ...prev, ...update }));
      events.forEach(handleEvent);
    },
    [handleEvent]
  );
  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;

  useEffect(() => {
    const deliver: Deliver = (raw) => ingestRef.current(raw);
    return FEED_MODE === "websocket" ? connectSockets(deliver, setStatus) : connectRelay(deliver, setStatus);
  }, []);

  const value = useMemo(() => ({ stats, status, injectMessage: ingest }), [stats, status, ingest]);
  return <LiveFeedContext.Provider value={value}>{children}</LiveFeedContext.Provider>;
}

export function useLiveFeed(): LiveFeedValue {
  const value = useContext(LiveFeedContext);
  if (!value) throw new Error("useLiveFeed must be used inside <LiveFeedProvider>");
  return value;
}

/** Relay mode: one Server-Sent Events stream. Returns a cleanup function. */
function connectRelay(deliver: Deliver, setStatus: SetStatus): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    setStatus("connecting");
    const current = openRelayStream(deliver);
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
function connectSockets(deliver: Deliver, setStatus: SetStatus): () => void {
  const sockets = new Set<WebSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let openCount = 0;
  let stopped = false;

  const report = () => setStatus(openCount > 0 ? "live" : "disconnected");

  const connect = (path: string) => {
    const ws = openSocket(path, deliver);
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
