// Whether an element is narrower than `below` px. The first render says wide; a
// ResizeObserver corrects it at once in the browser.
import { useEffect, useState, type RefObject } from "react";

export function useNarrow(ref: RefObject<HTMLElement | null>, below = 1000) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setNarrow(e.contentRect.width < below),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}
