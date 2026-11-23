// Hit testing for the canvas map: box-space buckets, so a pointer move checks a 3 x 3 block of
// buckets instead of every node.
export type HitGrid = {
  cell: number;
  buckets: Map<string, number[]>;
  pos: [number, number][];
};

const k = (gx: number, gy: number) => `${gx},${gy}`;

export function buildHitGrid(pos: [number, number][], cell = 20): HitGrid {
  const buckets = new Map<string, number[]>();
  pos.forEach(([x, y], i) => {
    const key = k(Math.floor(x / cell), Math.floor(y / cell));
    const b = buckets.get(key);
    if (b) b.push(i);
    else buckets.set(key, [i]);
  });
  return { cell, buckets, pos };
}

/** Nearest index within `radius` box units of (x, y), or null. Only `eligible(i)` nodes count. */
export function hitTest(
  g: HitGrid,
  x: number,
  y: number,
  radius: number,
  eligible: (i: number) => boolean = () => true,
): number | null {
  const span = Math.max(1, Math.ceil(radius / g.cell));
  const gx = Math.floor(x / g.cell);
  const gy = Math.floor(y / g.cell);
  let best: number | null = null;
  let bd = radius * radius;
  for (let a = -span; a <= span; a++)
    for (let b = -span; b <= span; b++)
      for (const i of g.buckets.get(k(gx + a, gy + b)) ?? []) {
        if (!eligible(i)) continue;
        const [px, py] = g.pos[i]!;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d <= bd) {
          bd = d;
          best = i;
        }
      }
  return best;
}
