// The zoom control in the stage's bottom-right corner: zoom out, the zoom as a percentage, zoom
// in and Fit. Real buttons; `data-map-overlay` keeps the camera from treating a press as a drag.
import { useId, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "./useDismiss";
import s from "./map.module.css";

export function ZoomControl({
  k,
  settledK,
  onZoom,
  onFit,
  names,
  onNames,
  legend,
}: {
  k: number;
  settledK: number;
  onZoom: (f: number) => void;
  onFit: () => void;
  /** Whether names are drawn, and the switch for them. */
  names: boolean;
  onNames: () => void;
  /** The legend's content, shown in the popover the "?" button opens. */
  legend: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // Outside press, Escape, focus leaving, or another popover opening closes the legend.
  useDismiss({
    open,
    root,
    button,
    onClose: (refocus) => {
      setOpen(false);
      if (refocus) button.current?.focus();
    },
  });

  return (
    <div
      ref={root}
      role="group"
      aria-label="Zoom"
      className={s.zoom}
      data-map-overlay=""
    >
      <button
        type="button"
        className={s.zoomButton}
        aria-label="Zoom out"
        onClick={() => onZoom(1 / 1.25)}
      >
        −
      </button>
      {/* The live number follows every frame; screen readers hear it once the camera settles. */}
      <span className={s.zoomValue} aria-hidden="true">
        {Math.round(k * 100)}%
      </span>
      <span className={s.srOnly} aria-live="polite">
        {Math.round(settledK * 100)}%
      </span>
      <button
        type="button"
        className={s.zoomButton}
        aria-label="Zoom in"
        onClick={() => onZoom(1.25)}
      >
        +
      </button>
      <button type="button" className={s.zoomFit} onClick={onFit}>
        Fit
      </button>
      <span aria-hidden="true" className={s.zoomRule} data-zoom-rule="" />
      <button
        type="button"
        className={s.zoomFit}
        aria-label="Labels"
        aria-pressed={names}
        onClick={onNames}
      >
        Aa
      </button>
      <button
        ref={button}
        type="button"
        className={s.zoomFit}
        aria-label="Legend"
        aria-expanded={open}
        aria-controls={open ? `${id}-legend` : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <div
          id={`${id}-legend`}
          role="group"
          aria-label="Legend"
          data-popover=""
          className={s.zoomLegend}
        >
          {legend}
        </div>
      )}
    </div>
  );
}
