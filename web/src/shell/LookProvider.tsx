"use client";

// Holds the chosen look. The server renders the four attributes on <html> from the cookie;
// a change here sets them in place and rewrites the cookie. No request, no navigation: the
// generated stylesheet already carries every theme.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatLook, LOOK_COOKIE, type Look } from "../theme/look";

const YEAR = 60 * 60 * 24 * 365;

type LookApi = { look: Look; setLook(patch: Partial<Look>): void };

const LookContext = createContext<LookApi | null>(null);

function apply(look: Look) {
  const d = document.documentElement.dataset;
  d.theme = look.theme;
  d.mode = look.mode;
  d.reach = look.reach;
  d.dots = look.dots;
  document.cookie = `${LOOK_COOKIE}=${formatLook(look)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
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
  const api = useMemo(() => ({ look, setLook }), [look, setLook]);
  return <LookContext.Provider value={api}>{children}</LookContext.Provider>;
}

export function useLook(): LookApi {
  const api = useContext(LookContext);
  if (!api) throw new Error("useLook needs a LookProvider above it");
  return api;
}
