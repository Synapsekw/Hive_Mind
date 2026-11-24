// The map's camera: one transform (translate tx, ty, then scale k) over a world of w x h
// pixels that shows the 1000 x 760 box. Pure maths; the hook in useCamera.ts drives it.
export type Cam = { k: number; tx: number; ty: number };
export const K_MIN = 0.6;
export const K_MAX = 8;

export const clampK = (k: number): number =>
  Math.max(K_MIN, Math.min(K_MAX, k));

export function zoomAt(c: Cam, factor: number, px: number, py: number): Cam {
  const k = clampK(c.k * factor);
  return {
    k,
    tx: px - ((px - c.tx) * k) / c.k,
    ty: py - ((py - c.ty) * k) / c.k,
  };
}

/**
 * A two-finger pinch step: fingers moved from (a0, b0) to (a1, b1), in stage pixels. Zooms about
 * the old midpoint by the change in distance, then pans by the midpoint's movement.
 */
export function pinchCam(
  c: Cam,
  a0: [number, number],
  b0: [number, number],
  a1: [number, number],
  b1: [number, number],
): Cam {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const m0x = (a0[0] + b0[0]) / 2;
  const m0y = (a0[1] + b0[1]) / 2;
  const m1x = (a1[0] + b1[0]) / 2;
  const m1y = (a1[1] + b1[1]) / 2;
  const z = zoomAt(c, d0 > 0 && d1 > 0 ? d1 / d0 : 1, m0x, m0y);
  return { k: z.k, tx: z.tx + m1x - m0x, ty: z.ty + m1y - m0y };
}

export function wheelFactor(deltaY: number, ctrlKey: boolean): number {
  return Math.exp(-deltaY * (ctrlKey ? 0.01 : 0.0025));
}

export function fit(w: number, h: number, sw: number, sh: number): Cam {
  return { k: 1, tx: (sw - w) / 2, ty: (sh - h) / 2 };
}

/** A stage in css px, and the 1000 x 760 box fitted to it at k = 1 (`w` x `h`). */
export type StageSize = { sw: number; sh: number; w: number; h: number };

/** How far (px, and in k) a camera may sit from the fit and still count as fitted. */
const FIT_PX = 1;
const FIT_K = 0.001;

/**
 * The camera after the stage resizes from `a` to `b`. A fitted camera stays fitted. Any other
 * view keeps its zoom relative to the fit (k: the box is refitted, so k = 1 is always the fit)
 * and keeps the same map point under the centre of the stage.
 */
export function keepView(c: Cam, a: StageSize, b: StageSize): Cam {
  const fb = fit(b.w, b.h, b.sw, b.sh);
  if (a.w <= 0 || a.h <= 0) return fb;
  const fa = fit(a.w, a.h, a.sw, a.sh);
  if (
    Math.abs(c.k - fa.k) < FIT_K &&
    Math.abs(c.tx - fa.tx) < FIT_PX &&
    Math.abs(c.ty - fa.ty) < FIT_PX
  )
    return fb;
  // The centre as a share of the box (0..1 across, 0..1 down), then back out at the new size.
  const u = (a.sw / 2 - c.tx) / c.k / a.w;
  const v = (a.sh / 2 - c.ty) / c.k / a.h;
  const k = clampK(c.k);
  return { k, tx: b.sw / 2 - u * b.w * k, ty: b.sh / 2 - v * b.h * k };
}

export function toScreen(
  c: Cam,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number] {
  return [(x / 1000) * w * c.k + c.tx, (y / 760) * h * c.k + c.ty];
}

export function frame(
  points: [number, number][],
  w: number,
  h: number,
  sw: number,
  sh: number,
): Cam {
  if (points.length === 0) return fit(w, h, sw, sh);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [px, py] of points) {
    const x = (px / 1000) * w;
    const y = (py / 760) * h;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const k = Math.max(
    1,
    Math.min(3, sw / (x1 - x0 + 120), sh / (y1 - y0 + 120)),
  );
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { k, tx: sw / 2 - cx * k, ty: sh / 2 - cy * k };
}
