// The Orbit view's projection: the cached 3D positions (layouts.ts `orbit`) turned about the
// vertical axis by `ry`, tilted so the sphere is seen from slightly above, and projected with a
// soft perspective into stage pixels. Pure; the renderer draws what this returns and MapCanvas
// hit-tests against `pos`. Spec 1.4.

/** The tilt about the horizontal axis (rad): the near side sits lower, as seen from above. */
export const TILT = -0.28;
/** Perspective: p = 1 / (1 + z / DEPTH). */
const DEPTH = 900;

export type OrbitProjection = {
  /** Screen position per node, stage css px. */
  pos: [number, number][];
  /** Perspective factor per node (> 1 near, < 1 far). */
  p: Float32Array;
  /** Depth after the turn and tilt (larger is farther). */
  z: Float32Array;
  /** Node indices far to near, the draw order. */
  order: Uint32Array;
  /** The agents' ring (radius 340) as a closed polyline. */
  equator: [number, number][];
};

/** Box units to stage px: `min(w, h · 1.3) / 1000 · zoom`. */
export function orbitScale(w: number, h: number, zoom: number): number {
  return (Math.min(w, h * 1.3) / 1000) * zoom;
}

/** Far dots fade with depth, `clamp(0.35, p · 1.05, 1)`. */
export function orbitAlpha(p: number): number {
  return Math.max(0.35, Math.min(1, p * 1.05));
}

function project(
  x: number,
  y: number,
  z: number,
  cr: number,
  sr: number,
): [number, number, number] {
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  const x1 = x * cr + z * sr;
  const z1 = -x * sr + z * cr;
  const y2 = y * ct + z1 * st;
  const z2 = -y * st + z1 * ct;
  return [x1, y2, z2];
}

export function projectOrbit(
  pts: [number, number, number][],
  ry: number,
  zoom: number,
  w: number,
  h: number,
): OrbitProjection {
  const S = orbitScale(w, h, zoom);
  const cx = w / 2;
  const cy = h / 2;
  const cr = Math.cos(ry);
  const sr = Math.sin(ry);
  const n = pts.length;
  const pos = new Array<[number, number]>(n);
  const p = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y, zz] = pts[i]!;
    const [x1, y2, z2] = project(x, y, zz, cr, sr);
    const k = 1 / (1 + z2 / DEPTH);
    pos[i] = [cx + x1 * k * S, cy + y2 * k * S];
    p[i] = k;
    z[i] = z2;
  }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => z[b]! - z[a]! || a - b);
  const equator: [number, number][] = [];
  for (let j = 0; j <= 72; j++) {
    const a = (j / 72) * Math.PI * 2;
    const [x1, y2, z2] = project(
      340 * Math.cos(a),
      0,
      340 * Math.sin(a),
      cr,
      sr,
    );
    const k = 1 / (1 + z2 / DEPTH);
    equator.push([cx + x1 * k * S, cy + y2 * k * S]);
  }
  return { pos, p, z, order, equator };
}
