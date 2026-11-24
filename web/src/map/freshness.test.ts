import { describe, expect, it } from "vitest";
import { FRESH_ALPHA, FRESH_LEVELS, freshLevel } from "./freshness";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);

describe("freshLevel", () => {
  it("is 7 for anything changed in the last two days", () => {
    expect(freshLevel(NOW, NOW)).toBe(7);
    expect(freshLevel(NOW - 2 * DAY, NOW)).toBe(7);
  });
  it("is 7 for a time in the future", () => {
    expect(freshLevel(NOW + DAY, NOW)).toBe(7);
  });
  it("drops just past two days and never returns 7 again", () => {
    expect(freshLevel(NOW - 2 * DAY - 1, NOW)).toBe(6);
    expect(freshLevel(NOW - 3 * DAY, NOW)).toBe(6);
  });
  it("follows floor(7.4 * e^(-days/26)) clamped to 0..6", () => {
    expect(freshLevel(NOW - 10 * DAY, NOW)).toBe(5);
    expect(freshLevel(NOW - 26 * DAY, NOW)).toBe(2);
    expect(freshLevel(NOW - 60 * DAY, NOW)).toBe(0);
    expect(freshLevel(NOW - 400 * DAY, NOW)).toBe(0);
  });
  it("is 0 for a missing time", () => {
    expect(freshLevel(0, NOW)).toBe(0);
    expect(freshLevel(Number.NaN, NOW)).toBe(0);
  });
  it("has eight rising opacities", () => {
    expect(FRESH_LEVELS).toBe(8);
    expect([...FRESH_ALPHA]).toEqual([
      0.11, 0.15, 0.23, 0.33, 0.45, 0.6, 0.76, 0.94,
    ]);
  });
});
