"use client";

// Holds which sides are folded. The server renders data-rail and data-panel on <html> from the
// cookie, so the first paint has the right widths; a change here sets them in place and
// rewrites the cookie, with no request. It also owns the `[` key, which folds the left rail on
// every page. The `]` key is the map's, through togglePanel.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { foldCookie } from "./cookie";
import { DEFAULT_FOLD, foldKeyIgnored, formatFold, type Fold } from "./fold";

type FoldApi = {
  fold: Fold;
  toggleRail(): void;
  togglePanel(): void;
  /** Opens the panel; nothing happens when it is already open. */
  openPanel(): void;
  /** Opens the rail; nothing happens when it is already open. */
  openRail(): void;
};

const FoldContext = createContext<FoldApi | null>(null);

function paint(fold: Fold) {
  const d = document.documentElement.dataset;
  d.rail = fold.rail;
  d.panel = fold.panel;
}

function apply(fold: Fold) {
  paint(fold);
  // A blocked cookie (privacy settings, sandboxed frame) must never break the fold.
  try {
    document.cookie = foldCookie(fold, location.protocol === "https:");
  } catch {
    // The fold still applies for this page; it just is not remembered.
  }
}

export { foldKeyIgnored, quietTarget, QUIET } from "./fold";

/** Below this width the page stacks and nothing folds; the CSS uses the same figure. */
export const FOLD_MEDIA = "(min-width: 700px)";

/** True when the window is wide enough to fold. Read in handlers only, never during render. */
export function foldWide(): boolean {
  return typeof window !== "undefined" && window.matchMedia(FOLD_MEDIA).matches;
}

export function FoldProvider({
  initial,
  children,
}: {
  initial: Fold;
  children: React.ReactNode;
}) {
  const [fold, set] = useState(initial);
  // The latest fold, so two changes in one tick both land and the side effects stay out of
  // the state updater.
  const latest = useRef(initial);
  const change = useCallback((patch: Partial<Fold>) => {
    const next = { ...latest.current, ...patch };
    if (formatFold(next) === formatFold(latest.current)) return;
    latest.current = next;
    apply(next);
    set(next);
  }, []);

  const toggleRail = useCallback(
    () => change({ rail: latest.current.rail === "open" ? "shut" : "open" }),
    [change],
  );
  const togglePanel = useCallback(
    () => change({ panel: latest.current.panel === "open" ? "shut" : "open" }),
    [change],
  );
  const openRail = useCallback(() => change({ rail: "open" }), [change]);
  const openPanel = useCallback(() => change({ panel: "open" }), [change]);

  // A server refresh renders the layout again with the cookie as it is now, which another tab
  // may have changed: follow it, and set the attributes in place, as LookProvider does.
  const key = formatFold(initial);
  useEffect(() => {
    latest.current = initial;
    paint(initial);
    set(initial);
    // `key` stands for `initial`'s two values; a new object with the same fold is no change.
  }, [key]);

  // How many of each side are on the page now. A key only folds a side that is there: on a page
  // without a rail (sign-in, consent) `[` does nothing and leaves the cookie alone.
  const present = useRef<Record<keyof Fold, number>>({ rail: 0, panel: 0 });
  const mount = useCallback((side: keyof Fold) => {
    present.current[side] += 1;
    return () => {
      present.current[side] -= 1;
    };
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "[" || foldKeyIgnored(e)) return;
      if (present.current.rail === 0 || !foldWide()) return;
      e.preventDefault();
      toggleRail();
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggleRail]);

  const api = useMemo(
    () => ({ fold, toggleRail, togglePanel, openPanel, openRail }),
    [fold, toggleRail, togglePanel, openPanel, openRail],
  );
  const presence = useMemo(() => ({ mount, present }), [mount]);
  return (
    <PresenceContext.Provider value={presence}>
      <FoldContext.Provider value={api}>{children}</FoldContext.Provider>
    </PresenceContext.Provider>
  );
}

type Presence = {
  mount(side: keyof Fold): () => void;
  present: { readonly current: Record<keyof Fold, number> };
};

const PresenceContext = createContext<Presence | null>(null);

/**
 * Marks a side as on the page while the calling component is mounted. The rail (Shell) calls
 * it with "rail"; the map's panel calls it with "panel", so its key acts only there.
 */
export function useFoldSide(side: keyof Fold): void {
  const mount = useContext(PresenceContext)?.mount;
  useEffect(() => mount?.(side), [mount, side]);
}

/** True while at least one component has marked this side as on the page. For key handlers. */
export function useFoldSidePresent(): (side: keyof Fold) => boolean {
  const present = useContext(PresenceContext)?.present;
  return useCallback(
    (side: keyof Fold) => (present ? present.current[side] > 0 : false),
    [present],
  );
}

const NOOP = () => {};
const STILL: FoldApi = {
  fold: DEFAULT_FOLD,
  toggleRail: NOOP,
  togglePanel: NOOP,
  openPanel: NOOP,
  openRail: NOOP,
};

/** The fold and its switches. Outside a FoldProvider everything is open and stays so. */
export function useFold(): FoldApi {
  return useContext(FoldContext) ?? STILL;
}
