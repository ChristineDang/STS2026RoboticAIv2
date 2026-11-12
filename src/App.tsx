import { AlertBanner } from "./components/alert/AlertBanner";
import { AlertOverlay } from "./components/alert/AlertOverlay";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Iris } from "./components/iris/Iris";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { useHashPage } from "./hooks/useHashPage";
import { AlertLogPage } from "./pages/AlertLogPage";
import { Dashboard } from "./pages/Dashboard";
import { DeniedPeoplePage } from "./pages/DeniedPeoplePage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const page = useHashPage();

  return (
    <div className="app">
      <Header />
      <div className="app__body">
        <Sidebar current={page} />
        <main className="app__main">
          <AlertBanner />
          {page === "overview" && <Dashboard />}
          {page === "alerts" && <AlertLogPage />}
          {page === "denied" && <DeniedPeoplePage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
      <AlertOverlay />
      {/* If Iris ever crashes, it disappears and the dashboard keeps running. */}
      <ErrorBoundary name="Iris">
        <Iris />
      </ErrorBoundary>
    </div>
  );
}
