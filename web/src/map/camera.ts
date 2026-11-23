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

export function wheelFactor(deltaY: number, ctrlKey: boolean): number {
  return Math.exp(-deltaY * (ctrlKey ? 0.01 : 0.0025));
}

export function fit(w: number, h: number, sw: number, sh: number): Cam {
  return { k: 1, tx: (sw - w) / 2, ty: (sh - h) / 2 };
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
  const xs = points.map((p) => (p[0] / 1000) * w);
  const ys = points.map((p) => (p[1] / 760) * h);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const k = Math.max(
    1,
    Math.min(3, sw / (x1 - x0 + 120), sh / (y1 - y0 + 120)),
  );
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { k, tx: sw / 2 - cx * k, ty: sh / 2 - cy * k };
}
