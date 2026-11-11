import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLockdown } from "../../context/LockdownContext";

interface SecureCardProps {
  /** Unique, stable id for this card. */
  id: string;
  /** Shown while the data is hidden; must not contain sensitive data. */
  label: string;
  children: ReactNode;
}

/**
 * Wraps a dashboard card so it hides its data during an alert.
 * Data disappears immediately (children are not rendered at all, so nothing is
 * left in the page); then the card closes like a laptop lid, and reopens when
 * the alert ends.
 */
export function SecureCard({ id, label, children }: SecureCardProps) {
  const { dataHidden, closedIds, registerCard } = useLockdown();
  const closed = closedIds.has(id);
  const hidden = closed || dataHidden;

  const ref = useCallback((el: HTMLDivElement | null) => registerCard(id, el), [id, registerCard]);

  // Play the reopen animation only when coming back from hidden, not on first load.
  const [reopening, setReopening] = useState(false);
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current && !hidden) setReopening(true);
    wasHidden.current = hidden;
  }, [hidden]);

  let content: ReactNode;
  if (closed) {
    content = (
      <div className="secure-card__lid">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <div className="secure-card__lid-title">Hidden during alert</div>
        <div className="secure-card__lid-label">{label}</div>
      </div>
    );
  } else if (dataHidden) {
    content = (
      <div className="stat-card">
        <div className="stat-card__label">{label}</div>
        <div className="skeleton skeleton--value" />
        <div className="skeleton skeleton--line" />
        <div className="skeleton skeleton--line skeleton--short" />
        <span className="visually-hidden">Hidden during alert</span>
      </div>
    );
  } else {
    content = (
      <div
        className={reopening ? "secure-card__content--reopening" : undefined}
        onAnimationEnd={() => setReopening(false)}
      >
        {children}
      </div>
    );
  }

  return (
    <div ref={ref} className="secure-card">
      {content}
    </div>
  );
}
