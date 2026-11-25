import { describe, expect, it } from "vitest";
import { backingScale, MAX_CANVAS_PIXELS } from "./pdf";

// An A4 page in PDF points; the viewer draws 1.25 CSS px per point at 100%.
const A4 = { width: 595, height: 842 };
const pixels = (s: number) =>
  Math.floor(A4.width * s) * Math.floor(A4.height * s);

describe("backingScale", () => {
  it("caps a page that would pass 16 Mpx at 300% on a 2x screen", () => {
    const wanted = 1.25 * 3 * 2;
    expect(pixels(wanted)).toBeGreaterThan(MAX_CANVAS_PIXELS);
    const s = backingScale(A4, 1.25 * 3, 2);
    expect(s).toBeLessThan(wanted);
    expect(pixels(s)).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(pixels(s)).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
  });
  it("leaves a page under the cap at full sharpness", () => {
    expect(backingScale(A4, 1.25, 2)).toBe(2.5);
    expect(pixels(2.5)).toBeLessThan(MAX_CANVAS_PIXELS);
  });
  it("takes a lower cap", () => {
    expect(pixels(backingScale(A4, 1.25, 2, 1_000_000))).toBeLessThanOrEqual(
      1_000_000,
    );
  });
});
