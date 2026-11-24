import { describe, expect, it } from "vitest";
import {
  clampK,
  fit,
  frame,
  keepView,
  K_MAX,
  K_MIN,
  pinchCam,
  toScreen,
  wheelFactor,
  zoomAt,
  type Cam,
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

describe("keepView", () => {
  // A stage sized the way useCamera measures it: the box fitted at k = 1.
  const stage = (sw: number, sh: number) => {
    const s0 = Math.min(sw / 1000, sh / 760);
    return { sw, sh, w: 1000 * s0, h: 760 * s0 };
  };
  // The map point (0..1000, 0..760) at the centre of the stage.
  const centre = (c: Cam, s: ReturnType<typeof stage>) => [
    ((s.sw / 2 - c.tx) / c.k / s.w) * 1000,
    ((s.sh / 2 - c.ty) / c.k / s.h) * 760,
  ];
  const a = stage(1200, 800);

  it("keeps a fitted camera fitted for the new size", () => {
    for (const b of [stage(960, 800), stage(1440, 800), stage(1200, 500)]) {
      const c = keepView(fit(a.w, a.h, a.sw, a.sh), a, b);
      expect(c.k).toBeCloseTo(1);
      expect(c.tx).toBeCloseTo(fit(b.w, b.h, b.sw, b.sh).tx);
      expect(c.ty).toBeCloseTo(fit(b.w, b.h, b.sw, b.sh).ty);
    }
  });
  it("treats a camera a hair off the fit as fitted", () => {
    const f = fit(a.w, a.h, a.sw, a.sh);
    const b = stage(960, 800);
    const c = keepView({ k: 1.0001, tx: f.tx + 0.2, ty: f.ty - 0.2 }, a, b);
    expect(c).toEqual(fit(b.w, b.h, b.sw, b.sh));
  });
  it("keeps a 2x zoom and the point at the centre when the stage narrows or widens", () => {
    // Zoom 2x on the map point (300, 200).
    const f = fit(a.w, a.h, a.sw, a.sh);
    const [px, py] = toScreen(f, 300, 200, a.w, a.h);
    const z = zoomAt(f, 2, px, py);
    // Pan so (300, 200) sits at the centre.
    const zc = {
      k: z.k,
      tx: z.tx + a.sw / 2 - px,
      ty: z.ty + a.sh / 2 - py,
    };
    expect(centre(zc, a)[0]).toBeCloseTo(300);
    for (const b of [stage(a.sw - 240, a.sh), stage(a.sw + 240, a.sh)]) {
      const c = keepView(zc, a, b);
      expect(c.k).toBeCloseTo(2);
      const [cx, cy] = centre(c, b);
      expect(cx).toBeCloseTo(300);
      expect(cy).toBeCloseTo(200);
    }
  });
  it("keeps an off-centre zoom's centre point too", () => {
    const zc = { k: 3, tx: -900, ty: -400 };
    const before = centre(zc, a);
    const b = stage(a.sw - 240, a.sh);
    const after = centre(keepView(zc, a, b), b);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });
  it("respects the zoom limits", () => {
    const b = stage(960, 800);
    expect(keepView({ k: 20, tx: 0, ty: 0 }, a, b).k).toBe(K_MAX);
    expect(keepView({ k: 0.1, tx: 0, ty: 0 }, a, b).k).toBe(K_MIN);
  });
  it("fits when there was no earlier size", () => {
    const b = stage(960, 800);
    expect(keepView({ k: 2, tx: 5, ty: 5 }, stage(0, 0), b)).toEqual(
      fit(b.w, b.h, b.sw, b.sh),
    );
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
