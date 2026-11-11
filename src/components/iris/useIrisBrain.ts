// Decides what Iris shows and says. Iris never reads the feed directly: it
// watches the alert system, the connection status and the metrics.
//
// Priority: anything about an active alert > a short-lived line (resolution,
// "back online", a click, a tip) > "connection lost" > idle.
import { useCallback, useEffect, useRef, useState } from "react";
import { ARM_FEEDBACK } from "../../config";
import { ARM_TIMEOUT_REASON, useAlert, type AlertState } from "../../context/AlertContext";
import { useLiveFeed } from "../../context/LiveFeedContext";
import { usePreferences } from "../../context/PreferencesContext";
import { useSoundUnlocked } from "../../hooks/useSoundUnlocked";
import type { IrisMood } from "./IrisFigure";

export interface IrisSpeech {
  text: string;
  mood: IrisMood;
}

/** Where Iris is in closing the cards during an alert. */
export type LockdownProgress = "pending" | "working" | "done";

/** Minimum gap between optional remarks (tips, camera comments). */
const CHATTER_COOLDOWN_MS = 15_000;
/** "Camera's having a hard time": this many new confidence-drop frames within the window. */
const SPIKE_FRAMES = 10;
const SPIKE_WINDOW_MS = 10_000;
const SPIKE_COOLDOWN_MS = 60_000;

function alertSpeech(state: AlertState, progress: LockdownProgress): IrisSpeech | null {
  switch (state.phase) {
    case "alert":
      if (progress === "pending") return { text: "Hold on. I don't have you on file.", mood: "alert" };
      if (progress === "working") return { text: "Hiding everything. Nothing to see here!", mood: "working" };
      if (state.armStatus === "closing") return { text: "Closing the laptop…", mood: "alert" };
      return ARM_FEEDBACK
        ? { text: "Everything's hidden. Waiting on the arm…", mood: "alert" }
        : { text: "Everything's hidden. The arm's on it.", mood: "alert" };
    case "secured":
      return { text: "Laptop secured 🔒", mood: "proud" };
    case "failed":
      return state.failReason === ARM_TIMEOUT_REASON
        ? { text: "The arm didn't respond. Can a human check?", mood: "worried" }
        : { text: "The arm reported a problem. Can a human check?", mood: "worried" };
    default:
      return null;
  }
}

export function useIrisBrain(progress: LockdownProgress) {
  const { state } = useAlert();
  const { status, stats } = useLiveFeed();
  const { soundOn } = usePreferences();
  const soundUnlocked = useSoundUnlocked();

  const [brief, setBrief] = useState<IrisSpeech | null>(null);
  const briefTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastChatter = useRef(0);

  const sayBriefly = useCallback((speech: IrisSpeech, ms: number, optional = false) => {
    if (optional) {
      const now = Date.now();
      if (now - lastChatter.current < CHATTER_COOLDOWN_MS) return;
      lastChatter.current = now;
    }
    clearTimeout(briefTimer.current);
    setBrief(speech);
    briefTimer.current = setTimeout(() => setBrief(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(briefTimer.current), []);

  // Alert starts: drop any small talk. Alert ends: celebrate.
  const previousPhase = useRef(state.phase);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = state.phase;
    if (previous === "normal" && state.phase !== "normal") {
      clearTimeout(briefTimer.current);
      setBrief(null);
    } else if (previous !== "normal" && state.phase === "normal") {
      sayBriefly(
        state.lastResolution === "verifiedPerson"
          ? { text: "There you are! Opening back up.", mood: "happy" }
          : { text: "All clear.", mood: "happy" },
        4000
      );
    }
  }, [state.phase, state.lastResolution, sayBriefly]);

  // Connection comes back.
  const previousStatus = useRef(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous === "disconnected" && status === "live") sayBriefly({ text: "Back online.", mood: "happy" }, 2500);
  }, [status, sayBriefly]);

  // Sudden jump in confidence drops.
  const drops = useRef<{ t: number; v: number }[]>([]);
  const lastSpike = useRef(0);
  const sawData = useRef(false);
  useEffect(() => {
    const now = Date.now();
    const value = stats.confidenceDropFrames;
    const recent = drops.current.filter((p) => now - p.t <= SPIKE_WINDOW_MS);
    recent.push({ t: now, v: value });
    drops.current = recent;
    const firstData = !sawData.current && value > 0;
    if (value > 0) sawData.current = true;
    if (firstData) return; // the first snapshot after connecting isn't a spike
    if (value - recent[0].v >= SPIKE_FRAMES && now - lastSpike.current > SPIKE_COOLDOWN_MS && state.phase === "normal") {
      lastSpike.current = now;
      drops.current = [{ t: now, v: value }];
      sayBriefly({ text: "The camera's having a hard time seeing.", mood: "curious" }, 5000, true);
    }
  }, [stats.confidenceDropFrames, state.phase, sayBriefly]);

  // One-time hint that sound needs a click first.
  const hinted = useRef(false);
  useEffect(() => {
    if (hinted.current || !soundOn || soundUnlocked) return;
    const timer = setTimeout(() => {
      hinted.current = true;
      sayBriefly({ text: "Click anywhere to turn on my sound.", mood: "curious" }, 6000, true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [soundOn, soundUnlocked, sayBriefly]);

  const sayStatus = useCallback(() => {
    let text: string;
    if (state.phase !== "normal") text = "Busy with an alert!";
    else if (status !== "live") text = "I can't reach the feed right now.";
    else text = "All quiet. Watching the camera.";
    sayBriefly({ text, mood: "curious" }, 3500);
  }, [state.phase, status, sayBriefly]);

  const speech =
    alertSpeech(state, progress) ??
    brief ??
    (status === "disconnected" ? { text: "I've lost the connection. Retrying…", mood: "worried" as const } : null);

  return { speech, mood: speech?.mood ?? ("idle" as IrisMood), sayStatus };
}
