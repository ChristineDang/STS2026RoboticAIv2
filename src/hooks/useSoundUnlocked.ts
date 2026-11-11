import { useSyncExternalStore } from "react";
import { isSoundUnlocked, subscribeSoundUnlock } from "../services/sound";

/** True once the browser allows this page to play sound. */
export function useSoundUnlocked(): boolean {
  return useSyncExternalStore(subscribeSoundUnlock, isSoundUnlocked);
}
