import { RecentAlerts } from "../components/alert/RecentAlerts";

export function AlertLogPage() {
  return (
    <section className="page">
      <div className="page__header">
        <h2>Alert log</h2>
        <p className="page__note">Alerts since this page was opened (up to 50). Reloading the page clears the list.</p>
      </div>
      <RecentAlerts title="All alerts" />
    </section>
  );
}
