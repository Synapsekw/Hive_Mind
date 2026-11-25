// Whether an element is narrower than `below` px. The first render says wide; a
// ResizeObserver corrects it at once in the browser.
import { useEffect, useState, type RefObject } from "react";

export function useNarrow(ref: RefObject<HTMLElement | null>, below = 1000) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The border box: the card's whole width, padding included.
    const ro = new ResizeObserver(([e]) => {
      const box = e.borderBoxSize?.[0];
      const width = box ? box.inlineSize : el.getBoundingClientRect().width;
      setNarrow(width < below);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}
