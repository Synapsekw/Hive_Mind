import { expect, it } from "vitest";
import { tweenPositions } from "./tween";

const from: [number, number][] = [
  [0, 0],
  [100, 100],
];
const to: [number, number][] = [
  [100, 0],
  [200, 100],
];

it("starts at the old positions and ends at the new ones", () => {
  expect(tweenPositions(from, to, [0, 0], 0).pos).toEqual(from);
  const end = tweenPositions(from, to, [0, 0], 900);
  expect(end.pos).toEqual(to);
  expect(end.done).toBe(true);
});
it("holds a dot until its delay has passed", () => {
  const mid = tweenPositions(from, to, [0, 500], 400);
  expect(mid.pos[1]).toEqual([100, 100]);
  expect(mid.pos[0]![0]).toBeGreaterThan(0);
  expect(mid.done).toBe(false);
});
