"use client";

// Renders nothing. Asks the server for a fresh map when the window regains focus, at most once
// a minute.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const MIN_GAP_MS = 60_000;

export function Refresher() {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      const t = Date.now();
      if (t - last < MIN_GAP_MS) return;
      last = t;
      router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
