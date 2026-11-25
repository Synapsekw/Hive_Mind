"use client";
// The opening lines of the selected note, asked once per id for the page's life. `null` while
// waiting. A request still running when the selection moves on still fills the cache, and the
// screen is redrawn when it lands only if that note is the one selected by then (which also
// covers coming back to a note whose answer is still on its way).
import { useEffect, useRef, useState } from "react";
import type { InboxActions, Opening } from "./types";

export function useOpening(
  id: string | null,
  load: InboxActions["noteOpening"],
): Opening | null {
  const cache = useRef(new Map<string, Opening>());
  const asked = useRef(new Set<string>());
  const loader = useRef(load);
  const wanted = useRef(id);
  const [, bump] = useState(0);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    wanted.current = id;
    if (!id || asked.current.has(id)) return;
    asked.current.add(id);
    loader
      .current(id)
      .catch((): Opening => ({ ok: false }))
      .then((a) => {
        cache.current.set(id, a);
        if (wanted.current === id) bump((n) => n + 1);
      });
  }, [id]);
  return id ? (cache.current.get(id) ?? null) : null;
}
