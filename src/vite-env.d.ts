/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_HOST?: string;
  readonly VITE_BACKEND_PORT?: string;
  readonly VITE_BACKEND_PROTOCOL?: "http" | "https";
  readonly VITE_FEED_MODE?: "relay" | "websocket";
  readonly VITE_RELAY_URL?: string;
  readonly VITE_RELAY_VIEW_KEY?: string;
  readonly VITE_WS_PATHS?: string;
  readonly VITE_IRIS_ENABLED?: string;
  readonly VITE_ARM_FEEDBACK?: string;
  readonly VITE_ARM_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
