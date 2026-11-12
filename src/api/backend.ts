/**
 * backend.ts — THE single place the dashboard connects to the backend.
 *
 * The backend lives in a separate codebase. Change connection settings here
 * (or override via .env) and every request in the app follows.
 */

// ---- Connection settings -------------------------------------------------
export const BACKEND_HOST = import.meta.env.VITE_BACKEND_HOST ?? "localhost";
export const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT ?? "8000";
export const BACKEND_PROTOCOL = import.meta.env.VITE_BACKEND_PROTOCOL ?? "http";

export const BASE_URL = `${BACKEND_PROTOCOL}://${BACKEND_HOST}:${BACKEND_PORT}`;
export const WS_URL = `${BACKEND_PROTOCOL === "https" ? "wss" : "ws"}://${BACKEND_HOST}:${BACKEND_PORT}`;

// ---- Live feed settings --------------------------------------------------
// "relay":     the backend sends webhooks to the local relay (relay/server.mjs),
//              and the dashboard listens to the relay's event stream. Default.
// "websocket": the dashboard connects to WebSocket(s) hosted by the backend.
// Either way, every message goes through services/feedTranslator.ts.
export const FEED_MODE: "relay" | "websocket" =
  import.meta.env.VITE_FEED_MODE === "websocket" ? "websocket" : "relay";
export const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "http://localhost:8787";
export const RELAY_VIEW_KEY = import.meta.env.VITE_RELAY_VIEW_KEY ?? "";
export const WS_PATHS = (import.meta.env.VITE_WS_PATHS ?? "/ws/stats")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * Robot camera: an MJPEG stream URL, e.g. http://robot.local:8080/video_feed.
 * The browser loads it directly from the robot (not through the relay).
 * Leave empty to show "No camera set up".
 */
export const CAMERA_URL = import.meta.env.VITE_CAMERA_URL ?? "";

export const FEED_DESCRIPTION =
  FEED_MODE === "relay" ? `Relay: ${RELAY_URL}` : `Backend: ${WS_URL}${WS_PATHS.join(", ")}`;

// ---- HTTP helper ---------------------------------------------------------
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    throw new Error(`Backend ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const backend = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ---- WebSocket helper (backend-hosted live data) -------------------------
export function openSocket(path: string, onMessage: (data: unknown) => void): WebSocket {
  const ws = new WebSocket(`${WS_URL}${path}`);
  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      onMessage(event.data);
    }
  };
  return ws;
}

// ---- Relay event stream (webhook messages forwarded by relay/server.mjs) --
export interface RelayStreamHandlers {
  /** A backend message. `receivedAt` is when the relay got it (dashboard clock). */
  onMessage: (data: unknown, receivedAt: number) => void;
  /** The relay's own webhook statistics (a separate channel backend messages can't imitate). */
  onStatus: (data: unknown) => void;
  /** A photo of a denied person was saved or deleted. */
  onCapture: () => void;
}

export function openRelayStream(handlers: RelayStreamHandlers): EventSource {
  const url = new URL("/events", RELAY_URL);
  if (RELAY_VIEW_KEY) url.searchParams.set("key", RELAY_VIEW_KEY);
  const source = new EventSource(url);
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  source.onmessage = (event) => {
    const data = parse(event.data);
    if (data !== undefined) handlers.onMessage(data, Date.now());
  };
  // Messages from before this connection, replayed so the dashboard starts up to date.
  source.addEventListener("replay", (event) => {
    const data = parse((event as MessageEvent).data) as { now?: unknown; receivedAt?: unknown; message?: unknown };
    if (!data || data.message === undefined) return;
    const age = typeof data.now === "number" && typeof data.receivedAt === "number" ? data.now - data.receivedAt : 0;
    handlers.onMessage(data.message, Date.now() - Math.max(0, age));
  });
  source.addEventListener("relay", (event) => {
    const data = parse((event as MessageEvent).data);
    if (data !== undefined) handlers.onStatus(data);
  });
  source.addEventListener("capture", () => handlers.onCapture());
  return source;
}

// ---- Photos of denied people (stored by the relay) -----------------------
export interface DeniedCapture {
  id: number;
  capturedAt: number;
  confidence: number | null;
  /** "backend": the image sent with the webhook; "camera": a frame grabbed from the robot camera. */
  source: string;
}

export interface CaptureList {
  retentionDays: number;
  cameraConfigured: boolean;
  captures: DeniedCapture[];
}

function relayUrl(path: string): string {
  const url = new URL(path, RELAY_URL);
  if (RELAY_VIEW_KEY) url.searchParams.set("key", RELAY_VIEW_KEY);
  return url.toString();
}

async function relayRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(relayUrl(path), init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Relay ${res.status}`);
  return body as T;
}

export const capturesApi = {
  list: () => relayRequest<CaptureList>("/captures"),
  imageUrl: (id: number) => relayUrl(`/captures/${id}/image`),
  remove: (id: number) => relayRequest<{ ok: boolean }>(`/captures/${id}`, { method: "DELETE" }),
};
