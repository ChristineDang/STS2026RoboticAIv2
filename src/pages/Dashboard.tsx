import { RecentAlerts } from "../components/alert/RecentAlerts";
import { ConnectionBadge } from "../components/widgets/ConnectionBadge";
import { LaptopUsageCard } from "../components/widgets/LaptopUsageCard";
import { SecureCard } from "../components/widgets/SecureCard";
import { StatCard } from "../components/widgets/StatCard";
import { useLiveFeed } from "../context/LiveFeedContext";

export function Dashboard() {
  const { stats, status } = useLiveFeed();

  return (
    <section className="dashboard">
      <div className="dashboard__header">
        <h2>Overview</h2>
        <ConnectionBadge status={status} />
      </div>
      <div className="dashboard__grid">
        {/* Wrap every card that shows data in SecureCard so it hides during an alert. */}
        <SecureCard id="confidence-drops" label="Frames with confidence drop">
          <StatCard label="Frames with confidence drop" value={stats.confidenceDropFrames} unit="frames" />
        </SecureCard>
        <SecureCard id="rejections" label="Rejections">
          <StatCard label="Rejections" value={stats.rejections} />
        </SecureCard>
        <SecureCard id="laptop-usage" label="Laptop uses per person">
          <LaptopUsageCard usage={stats.laptopUsage} />
        </SecureCard>
        <RecentAlerts limit={3} />
      </div>
    </section>
  );
}
