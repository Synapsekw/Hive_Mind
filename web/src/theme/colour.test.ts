import { describe, expect, it } from "vitest";
import data from "./themes.json";
import {
  contrast,
  css,
  fromHex,
  fromOklch,
  mix,
  over,
  parseColour,
  toHex,
  toOklch,
} from "./colour";

const black = fromHex("#000000");
const white = fromHex("#ffffff");

describe("hex", () => {
  it("round-trips", () => {
    for (const hex of ["#000000", "#ffffff", "#8ea2eb", "#0e0e10", "#c98a1b"]) {
      expect(toHex(fromHex(hex))).toBe(hex);
    }
    expect(toHex(fromHex("#8EA2EB"))).toBe("#8ea2eb");
    expect(toHex(fromHex("#fff"))).toBe("#ffffff");
  });

  it("clamps out-of-range channels", () => {
    expect(toHex({ r: 1.4, g: -0.2, b: 0.5 })).toBe("#ff0080");
  });
});

describe("mix and over", () => {
  it("mixes as color-mix in srgb", () => {
    expect(toHex(mix(black, white, 0.5))).toBe("#808080");
    expect(toHex(mix(black, white, 0))).toBe("#000000");
    expect(toHex(mix(black, white, 1))).toBe("#ffffff");
  });

  it("composites alpha", () => {
    expect(toHex(over({ ...white, a: 0.5 }, black))).toBe("#808080");
    expect(toHex(over({ ...white, a: 1 }, black))).toBe("#ffffff");
    expect(toHex(over({ ...white, a: 0 }, black))).toBe("#000000");
  });
});

describe("contrast", () => {
  it("is the WCAG ratio", () => {
    expect(contrast(black, white)).toBeCloseTo(21, 2);
    expect(contrast(white, black)).toBeCloseTo(21, 2);
    const x = fromHex("#8ea2eb");
    expect(contrast(x, x)).toBe(1);
  });
});

describe("oklch", () => {
  const brands = data.themes.flatMap((t) => [t.dark.brand, t.light.brand]);

  it("round-trips the 34 brand seeds within 1/255", () => {
    expect(brands).toHaveLength(34);
    for (const hex of brands) {
      const c = fromHex(hex);
      const o = toOklch(c);
      const back = fromOklch(o.l, o.c, o.h);
      expect(Math.abs(back.r - c.r)).toBeLessThan(1 / 255);
      expect(Math.abs(back.g - c.g)).toBeLessThan(1 / 255);
      expect(Math.abs(back.b - c.b)).toBeLessThan(1 / 255);
    }
  });

  it("reduces chroma into sRGB", () => {
    const c = fromOklch(0.82, 0.4, 150);
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(toOklch(c).l).toBeCloseTo(0.82, 2);
  });

  it("clamps lightness", () => {
    expect(toHex(fromOklch(1.2, 0.1, 30))).toBe("#ffffff");
    expect(toHex(fromOklch(-0.1, 0.1, 30))).toBe("#000000");
  });

  it("knows white and black", () => {
    expect(toOklch(white).l).toBeCloseTo(1, 4);
    expect(toOklch(black).l).toBeCloseTo(0, 4);
  });
});

describe("css and parseColour", () => {
  it("writes hex for opaque and rgba with three decimals otherwise", () => {
    expect(css(fromHex("#8ea2eb"))).toBe("#8ea2eb");
    expect(css({ ...fromHex("#8ea2eb"), a: 0.14 })).toBe(
      "rgba(142, 162, 235, 0.140)",
    );
    expect(css({ ...white, a: 1 })).toBe("#ffffff");
  });

  it("reads back what css writes", () => {
    expect(parseColour("#8ea2eb")).toEqual({ ...fromHex("#8ea2eb"), a: 1 });
    const p = parseColour("rgba(142, 162, 235, 0.140)");
    expect(toHex(p)).toBe("#8ea2eb");
    expect(p.a).toBe(0.14);
    expect(() => parseColour("var(--brand)")).toThrow();
  });
});
