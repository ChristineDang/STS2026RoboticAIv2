import { useEffect, useRef, useState } from "react";
import { useLockdown } from "../../context/LockdownContext";
import { usePreferences } from "../../context/PreferencesContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { IrisFigure, type IrisMood } from "./IrisFigure";
import { useIrisBrain, type LockdownProgress } from "./useIrisBrain";

const WIDTH = 76;
const HEIGHT = Math.round(WIDTH * 1.35);
const MARGIN = 20;
/** Pause before walking, so the alert pose and first line are seen. */
const LEAD_IN_MS = 900;
const BLINKABLE: IrisMood[] = ["idle", "curious", "happy", "proud"];

interface Point {
  x: number;
  y: number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function homePosition(): Point {
  return { x: window.innerWidth - WIDTH - MARGIN, y: window.innerHeight - HEIGHT - MARGIN };
}

/** Standing on the top-right corner of a card. */
function standNear(el: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  return {
    x: clamp(r.right - WIDTH - 12, MARGIN, window.innerWidth - WIDTH - MARGIN),
    y: clamp(r.top - HEIGHT + 28, 90, window.innerHeight - HEIGHT - MARGIN),
  };
}

function useHomePosition(): Point {
  const [home, setHome] = useState(homePosition);
  useEffect(() => {
    const onResize = () => setHome(homePosition());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return home;
}

function useBlink(mood: IrisMood, disabled: boolean): boolean {
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (disabled || !BLINKABLE.includes(mood)) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlinking(true);
        timer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 150);
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setBlinking(false);
    };
  }, [mood, disabled]);
  return blinking;
}

/** The dashboard mascot. Renders nothing when switched off. */
export function Iris() {
  const { showIris } = usePreferences();
  return showIris ? <IrisBot /> : null;
}

function IrisBot() {
  const reducedMotion = useReducedMotion();
  const { dataHidden, openCards, closeCard, claimConductor } = useLockdown();
  const { soundOn, setSoundOn, setIrisVisible } = usePreferences();

  const [progress, setProgress] = useState<LockdownProgress>("pending");
  const [target, setTarget] = useState<Point | null>(null);
  const [walkMs, setWalkMs] = useState(0);
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<"left" | "right">("left");
  const [reaching, setReaching] = useState(false);

  const home = useHomePosition();
  const position = target ?? home;
  const positionRef = useRef(position);
  positionRef.current = position;

  const { speech, mood, sayStatus } = useIrisBrain(progress);
  const blinking = useBlink(mood, reducedMotion);

  // Iris animates the card closing unless motion is reduced; then the cards fold by themselves.
  useEffect(() => (reducedMotion ? undefined : claimConductor()), [reducedMotion, claimConductor]);

  // The lockdown walk: visit each open card, push it shut, walk home.
  useEffect(() => {
    if (!dataHidden) {
      setProgress("pending");
      return;
    }
    let cancelled = false;

    const walkTo = async (point: Point | null) => {
      const from = positionRef.current;
      const to = point ?? homePosition();
      // At least one full step cycle (0.4 s), so even a short hop reads as walking.
      const ms = clamp(Math.hypot(to.x - from.x, to.y - from.y) * 0.9, 400, 900);
      if (Math.abs(to.x - from.x) > 4) setFacing(to.x < from.x ? "left" : "right");
      setWalkMs(ms);
      setWalking(true);
      setTarget(point);
      await wait(ms);
      setWalking(false);
    };

    (async () => {
      setProgress("pending");
      await wait(reducedMotion ? 1500 : LEAD_IN_MS);
      if (cancelled) return;
      if (reducedMotion) {
        setProgress("done");
        return;
      }
      setProgress("working");
      for (let next = openCards()[0]; next; next = openCards()[0]) {
        await walkTo(standNear(next.el));
        if (cancelled) return;
        setReaching(true);
        await wait(220);
        if (cancelled) return;
        closeCard(next.id);
        await wait(300);
        setReaching(false);
        if (cancelled) return;
      }
      await walkTo(null);
      if (!cancelled) setProgress("done");
    })();

    return () => {
      cancelled = true;
      setWalking(false);
      setReaching(false);
      setTarget(null);
    };
  }, [dataHidden, reducedMotion, openCards, closeCard]);

  const bubbleSide = position.x > 280 ? "left" : "right";

  return (
    <div
      className={`iris${walking ? " iris--walking" : ""}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)`, transitionDuration: `${walkMs}ms` }}
    >
      <div className="iris__speech" aria-live="polite">
        {speech && (
          <div key={speech.text} className={`iris__bubble iris__bubble--${bubbleSide}`}>
            {speech.text}
          </div>
        )}
      </div>

      <button
        type="button"
        className="iris__body"
        onClick={sayStatus}
        aria-label="Iris, the dashboard robot. Click for a status update."
      >
        <IrisFigure mood={mood} blinking={blinking} armUp={reaching || undefined} walking={walking} facing={facing} />
      </button>

      <div className="iris__controls">
        <button
          type="button"
          className="iris__control"
          onClick={() => setSoundOn(!soundOn)}
          aria-label={soundOn ? "Mute alert sounds" : "Turn alert sounds on"}
          title={soundOn ? "Mute alert sounds" : "Turn alert sounds on"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {soundOn ? (
              <>
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M19 5a10 10 0 0 1 0 14" />
              </>
            ) : (
              <>
                <line x1="16" y1="9" x2="22" y2="15" />
                <line x1="22" y1="9" x2="16" y2="15" />
              </>
            )}
          </svg>
        </button>
        <button
          type="button"
          className="iris__control"
          onClick={() => setIrisVisible(false)}
          aria-label="Hide Iris (turn back on in Settings)"
          title="Hide Iris (turn back on in Settings)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        </button>
      </div>
    </div>
  );
}
