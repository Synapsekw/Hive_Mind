import { describe, expect, it } from "vitest";
import {
  clampK,
  fit,
  frame,
  K_MAX,
  K_MIN,
  toScreen,
  wheelFactor,
  zoomAt,
} from "./camera";

describe("camera", () => {
  it("keeps the point under the cursor fixed when zooming", () => {
    const c = { k: 1, tx: 40, ty: 20 };
    const before = (300 - c.tx) / c.k;
    const z = zoomAt(c, 2, 300, 200);
    expect((300 - z.tx) / z.k).toBeCloseTo(before);
    expect((200 - z.ty) / z.k).toBeCloseTo((200 - c.ty) / c.k);
  });
  it("clamps the zoom", () => {
    expect(clampK(100)).toBe(K_MAX);
    expect(clampK(0.01)).toBe(K_MIN);
    expect(zoomAt({ k: 7, tx: 0, ty: 0 }, 4, 0, 0).k).toBe(K_MAX);
  });
  it("zooms in on a negative wheel delta, faster for a pinch", () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
    expect(wheelFactor(-10, true)).toBeCloseTo(Math.exp(0.1));
  });
  it("fits the world centred at 100%", () => {
    expect(fit(800, 608, 1000, 700)).toEqual({ k: 1, tx: 100, ty: 46 });
  });
  it("frames no points as a plain fit", () => {
    expect(frame([], 800, 608, 1000, 700)).toEqual(fit(800, 608, 1000, 700));
  });
  it("frames points inside the stage, never closer than 3x", () => {
    const c = frame(
      [
        [500, 380],
        [510, 390],
      ],
      1000,
      760,
      1000,
      760,
    );
    expect(c.k).toBe(3);
    const [x, y] = toScreen(c, 505, 385, 1000, 760);
    expect(x).toBeCloseTo(500);
    expect(y).toBeCloseTo(380);
  });
});
