// Closes the dashboard cards during an alert.
//
// Card data is hidden the moment an alert starts (that comes straight from the
// alert system). Closing the cards is the visible part: Iris walks over and
// closes them one by one. If nobody claims that job (Iris off, hidden, crashed,
// or reduced motion), the cards fold shut by themselves, one after another.
// Either way, a fallback timer closes anything still open.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAlert } from "./AlertContext";

const STAGGER_MS = 220;
/**
 * Long enough for Iris to walk to all eight cards (about 1 s each). Card data is
 * already hidden the moment the alert starts; this only closes the lids.
 */
const FALLBACK_MS = 12_000;

export interface RegisteredCard {
  id: string;
  el: HTMLElement;
}

interface LockdownValue {
  dataHidden: boolean;
  closedIds: ReadonlySet<string>;
  registerCard: (id: string, el: HTMLElement | null) => void;
  /** Cards still open, in page order. */
  openCards: () => RegisteredCard[];
  closeCard: (id: string) => void;
  /** Called by whoever animates the closing (Iris). Returns a release function. */
  claimConductor: () => () => void;
}

const LockdownContext = createContext<LockdownValue | null>(null);

export function LockdownProvider({ children }: { children: ReactNode }) {
  const { dataHidden } = useAlert();
  const cards = useRef(new Map<string, HTMLElement>());
  const closedRef = useRef(new Set<string>());
  const [closedIds, setClosedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [conductorCount, setConductorCount] = useState(0);
  const conductors = useRef(0);
  const dataHiddenRef = useRef(dataHidden);
  dataHiddenRef.current = dataHidden;

  const commit = useCallback(() => setClosedIds(new Set(closedRef.current)), []);

  const closeCard = useCallback(
    (id: string) => {
      if (closedRef.current.has(id)) return;
      closedRef.current.add(id);
      commit();
    },
    [commit]
  );

  const closeAll = useCallback(() => {
    let changed = false;
    cards.current.forEach((_, id) => {
      if (!closedRef.current.has(id)) {
        closedRef.current.add(id);
        changed = true;
      }
    });
    if (changed) commit();
  }, [commit]);

  const registerCard = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (!el) {
        cards.current.delete(id);
        return;
      }
      cards.current.set(id, el);
      // A card that appears during an alert starts closed.
      if (dataHiddenRef.current) closeCard(id);
    },
    [closeCard]
  );

  const openCards = useCallback(
    () =>
      [...cards.current]
        .filter(([id]) => !closedRef.current.has(id))
        .map(([id, el]) => ({ id, el }))
        .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)),
    []
  );

  const claimConductor = useCallback(() => {
    conductors.current++;
    setConductorCount(conductors.current);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      conductors.current--;
      setConductorCount(conductors.current);
    };
  }, []);

  // Alert over: reopen everything. Alert on: make sure everything is closed eventually.
  useEffect(() => {
    if (!dataHidden) {
      if (closedRef.current.size > 0) {
        closedRef.current = new Set();
        commit();
      }
      return;
    }
    const fallback = setTimeout(closeAll, FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [dataHidden, closeAll, commit]);

  // Nobody animating the cards: fold them shut one after another.
  useEffect(() => {
    if (!dataHidden || conductorCount > 0) return;
    const timer = setInterval(() => {
      const next = openCards()[0];
      if (next) closeCard(next.id);
      else clearInterval(timer);
    }, STAGGER_MS);
    return () => clearInterval(timer);
  }, [dataHidden, conductorCount, openCards, closeCard]);

  const value = useMemo<LockdownValue>(
    () => ({ dataHidden, closedIds, registerCard, openCards, closeCard, claimConductor }),
    [dataHidden, closedIds, registerCard, openCards, closeCard, claimConductor]
  );

  return <LockdownContext.Provider value={value}>{children}</LockdownContext.Provider>;
}

export function useLockdown(): LockdownValue {
  const value = useContext(LockdownContext);
  if (!value) throw new Error("useLockdown must be used inside <LockdownProvider>");
  return value;
}
