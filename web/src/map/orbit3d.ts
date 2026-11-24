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

const CT = Math.cos(TILT);
const ST = Math.sin(TILT);

export function projectOrbit(
  pts: [number, number, number][],
  ry: number,
  zoom: number,
  w: number,
  h: number,
  /** The previous frame's projection: its buffers are reused and its order re-sorted. */
  prev?: OrbitProjection | null,
): OrbitProjection {
  const S = orbitScale(w, h, zoom);
  const cx = w / 2;
  const cy = h / 2;
  const cr = Math.cos(ry);
  const sr = Math.sin(ry);
  const n = pts.length;
  const reuse = !!prev && prev.p.length === n;
  const pos = reuse ? prev.pos : new Array<[number, number]>(n);
  const p = reuse ? prev.p : new Float32Array(n);
  const z = reuse ? prev.z : new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const q = pts[i]!;
    const x1 = q[0] * cr + q[2] * sr;
    const z1 = -q[0] * sr + q[2] * cr;
    const y2 = q[1] * CT + z1 * ST;
    const z2 = -q[1] * ST + z1 * CT;
    const k = 1 / (1 + z2 / DEPTH);
    const sx = cx + x1 * k * S;
    const sy = cy + y2 * k * S;
    const at = reuse ? pos[i]! : (pos[i] = [0, 0]);
    at[0] = sx;
    at[1] = sy;
    p[i] = k;
    z[i] = z2;
  }
  // Far to near. A turning orbit changes the order only a little each frame, so the previous
  // order is re-sorted by insertion (close to linear); a first frame sorts from scratch.
  const far = (a: number, b: number) => z[b]! - z[a]! || a - b;
  let order: Uint32Array;
  if (reuse) {
    order = prev.order;
    // A big jump (a fast drag) would make insertion quadratic: sort from scratch instead.
    let budget = n * 16;
    for (let j = 1; j < n && budget > 0; j++) {
      const v = order[j]!;
      let k = j - 1;
      while (k >= 0 && far(order[k]!, v) > 0) {
        order[k + 1] = order[k]!;
        k--;
        budget--;
      }
      order[k + 1] = v;
    }
    if (budget <= 0) order.sort(far);
  } else {
    order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort(far);
  }
  const equator = reuse ? prev.equator : [];
  for (let j = 0; j <= 72; j++) {
    const a = (j / 72) * Math.PI * 2;
    const x = 340 * Math.cos(a);
    const zz = 340 * Math.sin(a);
    const x1 = x * cr + zz * sr;
    const z1 = -x * sr + zz * cr;
    const y2 = z1 * ST;
    const z2 = z1 * CT;
    const k = 1 / (1 + z2 / DEPTH);
    const at = equator[j] ?? (equator[j] = [0, 0]);
    at[0] = cx + x1 * k * S;
    at[1] = cy + y2 * k * S;
  }
  // A new wrapper each frame (cheap): its identity tells the hit grid the projection moved.
  return { pos, p, z, order, equator };
}
