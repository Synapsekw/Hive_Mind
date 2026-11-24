// The zoom control in the stage's bottom-right corner: zoom out, the zoom as a percentage, zoom
// in and Fit. Real buttons; `data-map-overlay` keeps the camera from treating a press as a drag.
import s from "./map.module.css";

export function ZoomControl({
  k,
  settledK,
  onZoom,
  onFit,
}: {
  k: number;
  settledK: number;
  onZoom: (f: number) => void;
  onFit: () => void;
}) {
  return (
    <div role="group" aria-label="Zoom" className={s.zoom} data-map-overlay="">
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
    </div>
  );
}
