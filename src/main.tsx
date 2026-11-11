import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AlertProvider } from "./context/AlertContext";
import { LiveFeedProvider } from "./context/LiveFeedContext";
import { LockdownProvider } from "./context/LockdownContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { initSoundUnlock } from "./services/sound";
import "./styles/global.css";

initSoundUnlock();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreferencesProvider>
      <AlertProvider>
        <LiveFeedProvider>
          <LockdownProvider>
            <App />
          </LockdownProvider>
        </LiveFeedProvider>
      </AlertProvider>
    </PreferencesProvider>
  </React.StrictMode>
);
