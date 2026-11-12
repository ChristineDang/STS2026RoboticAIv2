import { RecentAlerts } from "../components/alert/RecentAlerts";
import { CameraFeed } from "../components/camera/CameraFeed";
import { SystemHealth } from "../components/health/SystemHealth";
import { ConnectionBadge } from "../components/widgets/ConnectionBadge";
import { LaptopUsageCard } from "../components/widgets/LaptopUsageCard";
import { LastUsedCard } from "../components/widgets/LastUsedCard";
import { SecureCard } from "../components/widgets/SecureCard";
import { StatCard } from "../components/widgets/StatCard";
import { useLiveFeed } from "../context/LiveFeedContext";

/**
 * Layout: a 4-column grid (2 on medium widths, 1 on phones) where every card in
 * a row is the same height.
 *   Row 1: camera | recent alerts (half each). Both stay visible during alerts.
 *   Row 2: activity tiles. Hidden during alerts.
 *   Row 3: system health. Hidden during alerts.
 */
export function Dashboard() {
  const { stats, status } = useLiveFeed();

  return (
    <section className="dashboard">
      <div className="dashboard__header">
        <h2>Overview</h2>
        <ConnectionBadge status={status} />
      </div>

      <div className="dashboard__grid">
        {/* Not a SecureCard on purpose: it stays visible during alerts so the operator can see who triggered it. */}
        <div className="dashboard__wide">
          <CameraFeed />
        </div>
        <div className="dashboard__wide">
          <RecentAlerts limit={6} showLogLink />
        </div>
      </div>

      <div className="dashboard__section">
        <h3 className="dashboard__subheading">Activity</h3>
        <span className="dashboard__section-note">Hidden during alerts</span>
      </div>
      <div className="dashboard__grid">
        {/* Wrap every card that shows data in SecureCard so it hides during an alert. */}
        <SecureCard id="rejections" label="Rejections">
          <StatCard label="Rejections" value={stats.rejections} />
        </SecureCard>
        <SecureCard id="confidence-drops" label="Frames with confidence drop">
          <StatCard label="Frames with confidence drop" value={stats.confidenceDropFrames} unit="frames" />
        </SecureCard>
        <SecureCard id="last-used" label="Last used by">
          <LastUsedCard lastUse={stats.lastUse} />
        </SecureCard>
        <SecureCard id="laptop-usage" label="Laptop uses per person">
          <LaptopUsageCard usage={stats.laptopUsage} />
        </SecureCard>
      </div>

      <div className="dashboard__section">
        <h3 className="dashboard__subheading">System health</h3>
        <span className="dashboard__section-note">Hidden during alerts</span>
      </div>
      <SystemHealth />
    </section>
  );
}
