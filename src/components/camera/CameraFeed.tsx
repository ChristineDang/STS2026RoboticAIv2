import { useEffect, useMemo, useRef, useState } from "react";
import { CAMERA_URL } from "../../api/backend";
import { useAlert } from "../../context/AlertContext";
import { usePageVisible } from "../../hooks/usePageVisible";
import type { HealthLevel } from "../../types";
import { StatusBadge } from "../health/StatusBadge";

const RETRY_MS = 5000;

type StreamState = "connecting" | "live" | "error";

function cameraSrc(attempt: number): string | null {
  if (!CAMERA_URL) return null;
  try {
    const url = new URL(CAMERA_URL, window.location.href);
    // A new address forces a fresh connection on retry.
    if (attempt > 0) url.searchParams.set("_retry", String(attempt));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Live MJPEG stream from the robot camera. Stays visible during alerts (with a
 * red outline) so the operator can see who triggered it. The stream is only
 * connected while someone can see it: not when paused, on another page, or
 * when the tab is in the background.
 */
export function CameraFeed() {
  const { state: alert } = useAlert();
  const alerting = alert.phase !== "normal";
  const pageVisible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const [stream, setStream] = useState<StreamState>("connecting");
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);

  const src = useMemo(() => cameraSrc(attempt), [attempt]);
  const configured = CAMERA_URL !== "";
  const active = src !== null && !paused && pageVisible;

  // Coming back from paused or a background tab: start a fresh connection.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      setStream("connecting");
      setAttempt((a) => a + 1);
    }
    wasActive.current = active;
  }, [active]);

  // Stream failed: retry every few seconds.
  useEffect(() => {
    if (!active || stream !== "error") return;
    const timer = setTimeout(() => {
      setStream("connecting");
      setAttempt((a) => a + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [active, stream]);

  let level: HealthLevel;
  let label: string;
  let message: string | null;
  if (!configured) [level, label, message] = ["unknown", "Not set up", "No camera set up. Add VITE_CAMERA_URL to .env."];
  else if (src === null) [level, label, message] = ["bad", "Bad address", "VITE_CAMERA_URL isn't a valid web address."];
  else if (paused || !pageVisible) [level, label, message] = ["unknown", "Paused", "Paused"];
  else if (stream === "error") [level, label, message] = ["bad", "Unavailable", "Can't reach the camera. Retrying every 5 seconds."];
  else if (stream === "connecting") [level, label, message] = ["unknown", "Connecting…", "Connecting to the camera…"];
  else [level, label, message] = ["ok", "Live", null];

  const fullScreen = () => {
    void frameRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <section className={`stat-card camera${alerting ? " camera--alert" : ""}`} aria-label="Robot camera">
      <div className="health-card__header">
        <div>
          <div className="health-card__title">Robot camera</div>
          <div className={`health-card__subtitle${alerting ? " camera__alert-text" : ""}`}>
            {alerting ? "Unverified person in view" : "Live feed"}
          </div>
        </div>
        <StatusBadge level={level} label={label} />
      </div>

      <div className="camera__frame" ref={frameRef}>
        {active && (
          <img
            key={attempt}
            src={src}
            alt="Live feed from the robot camera"
            className={`camera__img${stream === "live" ? "" : " camera__img--waiting"}`}
            onLoad={() => setStream("live")}
            onError={() => setStream("error")}
          />
        )}
        {message && <div className="camera__message">{message}</div>}
      </div>

      {configured && src !== null && (
        <div className="camera__controls">
          <button type="button" className="button" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="button" onClick={fullScreen} disabled={!active || stream !== "live"}>
            Full screen
          </button>
        </div>
      )}
    </section>
  );
}
