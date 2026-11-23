// The zoom control in the stage's bottom-right corner: zoom out, the zoom as a percentage, zoom
// in and Fit. Real buttons; `data-map-overlay` keeps the camera from treating a press as a drag.
import s from "./map.module.css";

export function ZoomControl({
  k,
  onZoom,
  onFit,
}: {
  k: number;
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
      <span className={s.zoomValue} aria-live="polite">
        {Math.round(k * 100)}%
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
