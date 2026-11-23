import { expect, it } from "vitest";
import { orbitAlpha, orbitScale, projectOrbit } from "./orbit3d";

const W = 1000;
const H = 760;

it("puts the centre of the sphere at the centre of the stage", () => {
  const o = projectOrbit([[0, 0, 0]], 0, 1, W, H);
  expect(o.pos[0]).toEqual([500, 380]);
  expect(o.p[0]).toBe(1);
});

it("scales by min(w, h * 1.3) / 1000 and the zoom", () => {
  expect(orbitScale(W, H, 1)).toBeCloseTo(0.988);
  expect(orbitScale(2000, H, 1)).toBeCloseTo(0.988);
  expect(orbitScale(W, 2000, 2)).toBeCloseTo(2);
});

it("turns about the vertical axis: a quarter turn brings +x to the far or near side", () => {
  const a = projectOrbit([[300, 0, 0]], 0, 1, W, H);
  expect(a.pos[0]![0]).toBeGreaterThan(500);
  const b = projectOrbit([[300, 0, 0]], Math.PI / 2, 1, W, H);
  expect(b.pos[0]![0]).toBeCloseTo(500, 0);
  expect(Math.abs(b.z[0]!)).toBeGreaterThan(250);
});

it("draws the near side larger and lower than the far side (seen from slightly above)", () => {
  const o = projectOrbit(
    [
      [0, 0, -300],
      [0, 0, 300],
    ],
    0,
    1,
    W,
    H,
  );
  expect(o.z[0]).toBeLessThan(o.z[1]!);
  expect(o.p[0]).toBeGreaterThan(1);
  expect(o.p[1]).toBeLessThan(1);
  expect(o.pos[0]![1]).toBeGreaterThan(o.pos[1]![1]);
  // Far to near: the far point first.
  expect(o.order[0]).toBe(1);
});

it("fades the far side, never below 0.35 and never above 1", () => {
  expect(orbitAlpha(0.2)).toBe(0.35);
  expect(orbitAlpha(0.8)).toBeCloseTo(0.84);
  expect(orbitAlpha(1.5)).toBe(1);
});
