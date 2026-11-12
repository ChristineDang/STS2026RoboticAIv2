import { FEED_MODE } from "../../api/backend";
import { useAlert } from "../../context/AlertContext";
import { useLiveFeed } from "../../context/LiveFeedContext";
import { useNow } from "../../hooks/useNow";
import {
  armSuccess,
  cameraHealth,
  connectionHealth,
  robotHealth,
  webhookHealth,
  type HealthSummary,
} from "../../services/health";
import { formatPercent } from "../../utils/format";
import { SecureCard } from "../widgets/SecureCard";
import { LatencySparkline } from "./LatencySparkline";
import { StatusBadge } from "./StatusBadge";

function CardHeader({ title, subtitle, level, label }: { title: string; subtitle: string } & Pick<HealthSummary, "level" | "label">) {
  return (
    <div className="health-card__header">
      <div>
        <div className="health-card__title">{title}</div>
        <div className="health-card__subtitle">{subtitle}</div>
      </div>
      <StatusBadge level={level} label={label} />
    </div>
  );
}

function HealthCard({ title, subtitle, summary }: { title: string; subtitle: string; summary: HealthSummary }) {
  return (
    <div className="stat-card health-card">
      <CardHeader title={title} subtitle={subtitle} level={summary.level} label={summary.label} />
      {summary.rows.length > 0 && (
        <dl className="health-card__rows">
          {summary.rows.map((row) => (
            <div key={row.label} className="health-card__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {summary.note && <p className="health-card__note">{summary.note}</p>}
    </div>
  );
}

function RobotArmsCard({ now }: { now: number }) {
  const { robots } = useLiveFeed();
  const { state: alert } = useAlert();
  const summary = robotHealth(robots, now);
  const success = armSuccess(alert.log);
  const total = success.closed + success.failed;

  return (
    <div className="stat-card health-card">
      <CardHeader title="Robot arms" subtitle="Backend → robot" level={summary.level} label={summary.label} />
      {summary.robots.length > 0 && (
        <ul className="robot-list">
          {summary.robots.map((row) => {
            const robot = robots.find((r) => r.id === row.id);
            return (
              <li key={row.id} className="robot-list__row">
                <div className="robot-list__top">
                  <span className="robot-list__name">{row.name}</span>
                  <StatusBadge level={row.level} label={row.statusText} />
                </div>
                <div className="robot-list__details">{row.details.join(" · ")}</div>
                <LatencySparkline samples={robot?.latencyHistory ?? []} now={now} name={row.name} />
              </li>
            );
          })}
        </ul>
      )}
      {summary.note && <p className="health-card__note">{summary.note}</p>}
      <dl className="health-card__rows health-card__rows--footer">
        <div className="health-card__row">
          <dt>Arm close success</dt>
          <dd>{success.rate === null ? "No results yet" : `${formatPercent(success.rate)} (${success.closed} of ${total})`}</dd>
        </div>
      </dl>
      <p className="health-card__note">From alerts since this page was opened, where the arm reported back.</p>
    </div>
  );
}

/**
 * Four links: backend → relay (webhook), dashboard ↔ relay/backend, backend → robot arms, camera → relay.
 * Each card is a SecureCard, so it hides during an alert and Iris closes it like the activity cards.
 */
export function SystemHealth() {
  const { health, status } = useLiveFeed();
  const now = useNow(1000);
  const peer = FEED_MODE === "relay" ? "relay" : "backend";

  return (
    <div className="dashboard__grid">
      <SecureCard id="health-webhook" label="Webhook">
        <HealthCard title="Webhook" subtitle="Backend → relay" summary={webhookHealth(health, status, now)} />
      </SecureCard>
      <SecureCard id="health-connection" label="Dashboard connection">
        <HealthCard title="Dashboard connection" subtitle={`Dashboard ↔ ${peer}`} summary={connectionHealth(health, status, now)} />
      </SecureCard>
      <SecureCard id="health-robots" label="Robot arms">
        <RobotArmsCard now={now} />
      </SecureCard>
      <SecureCard id="health-camera" label="Camera stream">
        <HealthCard title="Camera stream" subtitle="Robot camera → relay" summary={cameraHealth(health, status, now)} />
      </SecureCard>
    </div>
  );
}
