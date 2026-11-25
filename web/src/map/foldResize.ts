// A rail fold animates the rail's width for a moment, which resizes the map's stage on every
// frame of it. Resizing the canvas reallocates its bitmap and redraws everything, so while the
// shell folds (FOLDING_ATTR on <html>, set by FoldProvider) the sizes are ignored and the
// canvas keeps its bitmap, stretched by CSS; the stage is measured once when the fold ends.

/** Set on <html> while the rail folds or unfolds. */
export const FOLDING_ATTR = "data-folding";
/** The property whose transition is the fold (shell.module.css `.rail`). */
const FOLD_PROPERTY = "flex-basis";
/** If the fold's transition never reports its end (no transition ran), measure after this. */
export const FOLD_FALLBACK_MS = 1000;

export type FoldRoot = {
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  addEventListener(
    type: "transitionend",
    f: (e: { propertyName: string }) => void,
  ): void;
  removeEventListener(
    type: "transitionend",
    f: (e: { propertyName: string }) => void,
  ): void;
};

/** Wraps a resize handler so a fold costs one measure, at its end. */
export function foldAware(
  measure: () => void,
  root: FoldRoot,
): { onResize(): void; dispose(): void } {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    pending = false;
    measure();
  };
  const onEnd = (e: { propertyName: string }) => {
    if (e.propertyName !== FOLD_PROPERTY || !root.hasAttribute(FOLDING_ATTR))
      return;
    root.removeAttribute(FOLDING_ATTR);
    flush();
  };
  root.addEventListener("transitionend", onEnd);
  return {
    onResize() {
      if (!root.hasAttribute(FOLDING_ATTR)) return measure();
      pending = true;
      if (timer === null)
        timer = setTimeout(() => {
          root.removeAttribute(FOLDING_ATTR);
          flush();
        }, FOLD_FALLBACK_MS);
    },
    dispose() {
      root.removeEventListener("transitionend", onEnd);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
