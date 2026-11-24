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
import { DEFAULT_FOLD, formatFold, type Fold } from "./fold";

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

const QUIET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-popover], [role="dialog"], [role="radiogroup"]';

/**
 * True when a fold key must do nothing: a modifier is held, or the key lands while typing in a
 * field, inside a popover, a dialog or a radio group (where keys already mean something).
 */
export function foldKeyIgnored(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    return true;
  const target = e.target;
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest(QUIET) !== null;
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

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "[" || foldKeyIgnored(e)) return;
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
  return <FoldContext.Provider value={api}>{children}</FoldContext.Provider>;
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
