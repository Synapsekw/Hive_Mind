import { describe, expect, it } from "vitest";
import { buildHitGrid, hitTest } from "./hitGrid";

const pos: [number, number][] = [
  [100, 100],
  [110, 100],
  [500, 380],
  [990, 750],
];
const g = buildHitGrid(pos);

describe("hitTest", () => {
  it("finds the nearest node within the radius", () => {
    expect(hitTest(g, 104, 101, 8)).toBe(0);
    expect(hitTest(g, 107, 100, 8)).toBe(1);
  });
  it("finds nothing outside the radius", () => {
    expect(hitTest(g, 300, 300, 8)).toBeNull();
  });
  it("works across bucket edges", () => {
    expect(hitTest(g, 501, 381, 8)).toBe(2);
    expect(hitTest(g, 985, 746, 8)).toBe(3);
  });
  it("skips nodes that are not eligible", () => {
    expect(hitTest(g, 104, 101, 8, (i) => i !== 0)).toBe(1);
  });
});
