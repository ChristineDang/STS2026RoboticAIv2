import { useCallback, useEffect, useState } from "react";
import { FEED_MODE, capturesApi, type CaptureList, type DeniedCapture } from "../api/backend";
import { useLiveFeed } from "../context/LiveFeedContext";
import { formatPercent } from "../utils/format";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: CaptureList };

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
}

const SOURCE_LABEL: Record<string, string> = {
  backend: "Image from the backend",
  camera: "Frame from the robot camera",
};

/** Photos the relay saved when someone was denied. Updates live when a new one is saved. */
export function DeniedPeoplePage() {
  const { captureVersion, status } = useLiveFeed();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [deleting, setDeleting] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: "ready", data: await capturesApi.list() });
    } catch (err) {
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Reload on open, whenever the relay saves or deletes a photo, and after reconnecting.
  useEffect(() => {
    if (FEED_MODE === "relay") void refresh();
  }, [refresh, captureVersion, status]);

  const remove = async (capture: DeniedCapture) => {
    if (!window.confirm(`Delete the photo from ${formatDateTime(capture.capturedAt)}? This can't be undone.`)) return;
    setDeleting(capture.id);
    try {
      await capturesApi.remove(capture.id);
      await refresh();
    } catch (err) {
      window.alert(`Couldn't delete the photo: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(null);
    }
  };

  let body: JSX.Element;
  if (FEED_MODE !== "relay") {
    body = <p className="page__note">Photos are saved by the webhook relay, which isn't used in WebSocket mode.</p>;
  } else if (load.state === "loading") {
    body = <p className="page__note">Loading photos…</p>;
  } else if (load.state === "error") {
    body = (
      <div className="stat-card">
        <p className="stat-card__empty">Couldn't load photos: {load.message}</p>
        <div className="settings__buttons">
          <button type="button" className="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    );
  } else if (load.data.captures.length === 0) {
    body = (
      <div className="stat-card">
        <p className="stat-card__empty">No photos yet. One is saved each time someone is denied.</p>
        {!load.data.cameraConfigured && (
          <p className="settings__note">
            No camera URL is set, so photos only appear if the backend includes an image with its "denied" message.
          </p>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="denied-grid">
        {load.data.captures.map((capture) => (
          <li key={capture.id} className="stat-card denied-card">
            <a href={capturesApi.imageUrl(capture.id)} target="_blank" rel="noreferrer" className="denied-card__photo">
              <img
                src={capturesApi.imageUrl(capture.id)}
                alt={`Person denied at ${formatDateTime(capture.capturedAt)}`}
                loading="lazy"
              />
            </a>
            <div className="denied-card__info">
              <div className="denied-card__time">{formatDateTime(capture.capturedAt)}</div>
              <div className="denied-card__meta">
                {capture.confidence !== null && <>Camera confidence {formatPercent(capture.confidence)} · </>}
                {SOURCE_LABEL[capture.source] ?? capture.source}
              </div>
            </div>
            <button
              type="button"
              className="button denied-card__delete"
              onClick={() => void remove(capture)}
              disabled={deleting === capture.id}
              aria-label={`Delete photo from ${formatDateTime(capture.capturedAt)}`}
            >
              {deleting === capture.id ? "Deleting…" : "Delete"}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const retention = load.state === "ready" ? load.data.retentionDays : null;

  return (
    <section className="page">
      <div className="page__header">
        <h2>Denied people</h2>
        <p className="page__note">
          A photo is saved each time someone is denied. Photos stay on the dashboard laptop
          {retention ? ` and are deleted automatically after ${retention} days` : ""}.
        </p>
      </div>
      {body}
    </section>
  );
}
