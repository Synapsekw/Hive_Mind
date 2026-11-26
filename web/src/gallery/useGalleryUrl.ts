"use client";

// The filters live in the address, so a view can be reloaded or sent to someone. They are read
// once, from the request's query (the server renders the same view), and written back with
// `history.replaceState`: no navigation, no request, no history entry per keystroke. Query keys
// that are not filters (a dev page's switches) are kept as they are.
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { fromQuery, toQuery } from "./filters";
import type { Filters } from "./types";

const KEYS = [
  "view",
  "scope",
  "folder",
  "kinds",
  "date",
  "from",
  "to",
  "session",
  "agent",
  "owner",
  "q",
];

export function useGalleryUrl(): [Filters, (next: Filters) => void] {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() =>
    fromQuery(new URLSearchParams(params?.toString() ?? "")),
  );
  const update = useCallback((next: Filters) => {
    setFilters(next);
    const p = new URLSearchParams(window.location.search);
    for (const key of KEYS) p.delete(key);
    for (const [key, value] of new URLSearchParams(toQuery(next)))
      p.set(key, value);
    const query = p.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);
  return [filters, update];
}
