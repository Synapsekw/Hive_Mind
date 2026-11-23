// Dots gliding from one set of positions to another, each after its own delay. Pure.

/** `--ease` is cubic-bezier(0.16, 1, 0.3, 1); `1 - (1 - u)^4` is its close equivalent. */
export const ease = (u: number) => 1 - (1 - u) ** 4;

export function tweenPositions(
  from: [number, number][],
  to: [number, number][],
  delays: number[],
  t: number,
  dur = 900,
): { pos: [number, number][]; done: boolean } {
  let done = true;
  const pos = to.map((b, i) => {
    const a = from[i] ?? b;
    const u = Math.max(0, Math.min(1, (t - (delays[i] ?? 0)) / dur));
    if (u < 1) done = false;
    const e = ease(u);
    return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e] as [
      number,
      number,
    ];
  });
  return { pos, done };
}
