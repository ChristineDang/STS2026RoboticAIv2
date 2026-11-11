import { FEED_DESCRIPTION, FEED_MODE } from "../api/backend";
import { ARM_FEEDBACK, ARM_TIMEOUT_MS, DEMO_ENABLED } from "../config";
import { useLiveFeed } from "../context/LiveFeedContext";
import { usePreferences } from "../context/PreferencesContext";
import { useSoundUnlocked } from "../hooks/useSoundUnlocked";
import { playCue } from "../services/sound";
import type { DashboardStats } from "../types";

/** Sample messages for testing without the backend. They go through the real translator. */
const SIMULATIONS: { label: string; message: (stats: DashboardStats) => unknown }[] = [
  { label: "Unverified person (auth: no)", message: () => ({ auth: "no", confidence: 0.91, at: new Date().toISOString() }) },
  { label: "Verified person (auth: yes)", message: () => ({ auth: "yes" }) },
  { label: "Arm closing", message: () => ({ arm: "closing" }) },
  { label: "Arm closed", message: () => ({ arm: "closed" }) },
  { label: "Arm failed", message: () => ({ arm: "failed", reason: "Simulated: the arm did not move" }) },
  { label: "Confidence drops +12", message: (s) => ({ confidence_drop_frames: s.confidenceDropFrames + 12 }) },
];

export function SettingsPage() {
  const prefs = usePreferences();
  const { injectMessage, stats, status } = useLiveFeed();
  const soundUnlocked = useSoundUnlocked();

  return (
    <section className="page">
      <div className="page__header">
        <h2>Settings</h2>
      </div>
      <div className="settings">
        <div className="stat-card">
          <h3 className="settings__title">Iris</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={prefs.showIris}
              disabled={!prefs.irisAllowed}
              onChange={(e) => prefs.setIrisVisible(e.target.checked)}
            />
            Show Iris on the dashboard
          </label>
          {!prefs.irisAllowed && (
            <p className="settings__note">Iris is switched off for this dashboard (VITE_IRIS_ENABLED=false or ?iris=off in the address).</p>
          )}
          <p className="settings__note">
            With Iris off, alerts work the same: red edges, the banner, hidden data and closing cards.
          </p>
        </div>

        <div className="stat-card">
          <h3 className="settings__title">Sound</h3>
          <label className="toggle">
            <input type="checkbox" checked={prefs.soundOn} onChange={(e) => prefs.setSoundOn(e.target.checked)} />
            Play alert sounds
          </label>
          <div className="settings__buttons">
            <button type="button" className="button" onClick={() => playCue("alert")}>
              Play test sound
            </button>
          </div>
          {!soundUnlocked && (
            <p className="settings__note">Browsers only allow sound after you click or type somewhere on the page.</p>
          )}
        </div>

        <div className="stat-card">
          <h3 className="settings__title">Live feed</h3>
          <dl className="settings__facts">
            <dt>Mode</dt>
            <dd>{FEED_MODE === "relay" ? "Webhook relay" : "Backend WebSocket"}</dd>
            <dt>Source</dt>
            <dd>{FEED_DESCRIPTION}</dd>
            <dt>Status</dt>
            <dd>{status}</dd>
            <dt>Arm feedback</dt>
            <dd>{ARM_FEEDBACK ? `On (no report within ${ARM_TIMEOUT_MS / 1000}s = arm didn't respond)` : "Off"}</dd>
          </dl>
        </div>

        {DEMO_ENABLED && (
          <div className="stat-card">
            <h3 className="settings__title">Simulate events</h3>
            <p className="settings__note">
              Sends sample messages through the same translator as the real feed. Shown in development or with ?demo=1.
            </p>
            <div className="settings__buttons">
              {SIMULATIONS.map((s) => (
                <button key={s.label} type="button" className="button" onClick={() => injectMessage(s.message(stats))}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
