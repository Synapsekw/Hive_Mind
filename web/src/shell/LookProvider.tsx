"use client";

// Holds the chosen look. The server renders the four attributes on <html> from the cookie;
// a change here sets them in place and rewrites the cookie. No request, no navigation: the
// generated stylesheet already carries every theme.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatLook, type Look } from "../theme/look";
import { lookCookie } from "./cookie";

type LookApi = { look: Look; setLook(patch: Partial<Look>): void };

const LookContext = createContext<LookApi | null>(null);

function apply(look: Look) {
  const d = document.documentElement.dataset;
  d.theme = look.theme;
  d.mode = look.mode;
  d.reach = look.reach;
  d.dots = look.dots;
  // A blocked cookie (privacy settings, sandboxed frame) must never break the switch.
  try {
    document.cookie = lookCookie(look, location.protocol === "https:");
  } catch {
    // The look still applies for this page; it just is not remembered.
  }
}

export function LookProvider({
  initial,
  children,
}: {
  initial: Look;
  children: React.ReactNode;
}) {
  const [look, set] = useState(initial);
  // The latest look, so two changes in one tick both land and the side effects stay out of
  // the state updater.
  const latest = useRef(initial);
  const setLook = useCallback((patch: Partial<Look>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    apply(next);
    set(next);
  }, []);
  // A server refresh (router.refresh(), e.g. the map's Refresher on focus) renders the layout
  // again with the cookie as it is now, which another tab may have changed: follow it, so the
  // panel shows that choice and the next change keeps its other fields.
  const key = formatLook(initial);
  useEffect(() => {
    latest.current = initial;
    set(initial);
    // `key` stands for `initial`'s four values; a new object with the same look is no change.
  }, [key]);
  const api = useMemo(() => ({ look, setLook }), [look, setLook]);
  return <LookContext.Provider value={api}>{children}</LookContext.Provider>;
}

export function useLook(): LookApi {
  const api = useContext(LookContext);
  if (!api) throw new Error("useLook needs a LookProvider above it");
  return api;
}
