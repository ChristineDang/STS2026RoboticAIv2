// Short alert sounds, generated in the browser (no audio files).
// Browsers only allow sound after the person has clicked or typed on the page,
// so initSoundUnlock() waits for that first interaction.

export type SoundCue = "alert" | "worried" | "secured" | "clear";

interface Note {
  freq: number;
  start: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

const CUES: Record<SoundCue, Note[]> = {
  // soft two-tone "boop-beep"
  alert: [
    { freq: 523.25, start: 0, dur: 0.16 },
    { freq: 783.99, start: 0.2, dur: 0.24 },
  ],
  // falling two-tone
  worried: [
    { freq: 440, start: 0, dur: 0.18 },
    { freq: 349.23, start: 0.22, dur: 0.28 },
  ],
  // small mechanical click
  secured: [
    { freq: 1567.98, start: 0, dur: 0.05, type: "triangle", gain: 0.05 },
    { freq: 1046.5, start: 0.06, dur: 0.08, type: "triangle", gain: 0.05 },
  ],
  // gentle rising chime
  clear: [
    { freq: 523.25, start: 0, dur: 0.12 },
    { freq: 659.25, start: 0.12, dur: 0.12 },
    { freq: 783.99, start: 0.24, dur: 0.22 },
  ],
};

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

export function isSoundUnlocked(): boolean {
  return ctx?.state === "running";
}

export function subscribeSoundUnlock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call once at startup: unlocks audio on the first click or key press. */
export function initSoundUnlock(): void {
  const remove = () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  const unlock = () => {
    try {
      ctx ??= new AudioContext();
      void ctx.resume().then(() => {
        if (ctx?.state === "running") {
          remove();
          listeners.forEach((l) => l());
        }
      });
    } catch {
      remove(); // no Web Audio support: stay silent
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function playCue(cue: SoundCue): void {
  if (!ctx) return;
  if (ctx.state === "running") schedule(ctx, cue);
  else void ctx.resume().then(() => ctx && ctx.state === "running" && schedule(ctx, cue));
}

function schedule(audio: AudioContext, cue: SoundCue) {
  const t0 = audio.currentTime + 0.01;
  for (const note of CUES[cue]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = t0 + note.start;
    osc.type = note.type ?? "sine";
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.gain ?? 0.07, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + note.dur + 0.02);
  }
}
