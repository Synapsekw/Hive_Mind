import { expect, it } from "vitest";
import { staggerDelay } from "./stagger";

it("sweeps outward from the centre, capped at 450 ms plus a small jitter", () => {
  expect(staggerDelay(500, 380, 0)).toBe(0);
  expect(staggerDelay(600, 380, 0)).toBeCloseTo(110);
  expect(staggerDelay(1000, 760, 0)).toBe(450);
  expect(staggerDelay(500, 380, 3)).toBe(36);
});
