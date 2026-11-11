import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { IRIS_ALLOWED } from "../config";

// Per-viewer settings, remembered in this browser only.
const STORAGE_KEY = "sts2026.preferences";

interface StoredPreferences {
  irisVisible: boolean;
  soundOn: boolean;
}

const DEFAULTS: StoredPreferences = { irisVisible: true, soundOn: true };

function load(): StoredPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      irisVisible: typeof parsed.irisVisible === "boolean" ? parsed.irisVisible : DEFAULTS.irisVisible,
      soundOn: typeof parsed.soundOn === "boolean" ? parsed.soundOn : DEFAULTS.soundOn,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(prefs: StoredPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked: the setting lasts until the page reloads
  }
}

interface PreferencesValue {
  /** False when Iris is switched off by .env or ?iris=off; the Settings toggle can't override that. */
  irisAllowed: boolean;
  irisVisible: boolean;
  /** irisAllowed && irisVisible */
  showIris: boolean;
  soundOn: boolean;
  setIrisVisible: (visible: boolean) => void;
  setSoundOn: (on: boolean) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(load);

  const update = useCallback((patch: Partial<StoredPreferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      irisAllowed: IRIS_ALLOWED,
      irisVisible: prefs.irisVisible,
      showIris: IRIS_ALLOWED && prefs.irisVisible,
      soundOn: prefs.soundOn,
      setIrisVisible: (irisVisible) => update({ irisVisible }),
      setSoundOn: (soundOn) => update({ soundOn }),
    }),
    [prefs, update]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return value;
}
