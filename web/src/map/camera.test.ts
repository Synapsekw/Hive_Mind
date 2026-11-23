import { describe, expect, it } from "vitest";
import {
  clampK,
  fit,
  frame,
  K_MAX,
  K_MIN,
  pinchCam,
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

describe("pinchCam", () => {
  it("zooms about the midpoint by the change in finger distance", () => {
    const c = { k: 1, tx: 0, ty: 0 };
    const z = pinchCam(c, [100, 100], [200, 100], [50, 100], [250, 100]);
    expect(z.k).toBeCloseTo(2);
    // The world point under the midpoint (150, 100) stays under it.
    expect((150 - z.tx) / z.k).toBeCloseTo(150);
    expect((100 - z.ty) / z.k).toBeCloseTo(100);
  });
  it("pans by the midpoint's movement when the distance is unchanged", () => {
    const z = pinchCam(
      { k: 2, tx: 10, ty: 20 },
      [100, 100],
      [200, 100],
      [130, 140],
      [230, 140],
    );
    expect(z).toEqual({ k: 2, tx: 40, ty: 60 });
  });
  it("clamps the zoom and ignores a zero start distance", () => {
    expect(
      pinchCam({ k: 7, tx: 0, ty: 0 }, [0, 0], [10, 0], [0, 0], [100, 0]).k,
    ).toBe(K_MAX);
    expect(
      pinchCam({ k: 1, tx: 0, ty: 0 }, [5, 5], [5, 5], [5, 5], [50, 5]).k,
    ).toBe(1);
  });
});
