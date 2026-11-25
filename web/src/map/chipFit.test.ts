import { describe, expect, it } from "vitest";
import { chipFit } from "./chipFit";

// Chips 50 px wide, 4 px apart, a "+N" chip of 30 px, and 64 px the least a cut chip shows in.
const base = { gap: 4, plus: 30, min: 64 };

describe("chipFit", () => {
  it("shows every chip when they all fit", () => {
    expect(chipFit({ ...base, widths: [50, 60], room: 400 })).toBe(2);
  });
  it("shows every chip when they fit exactly, with no room for a +N chip", () => {
    expect(chipFit({ ...base, widths: [50, 60], room: 114 })).toBe(2);
  });
  it("shows none when nothing fits, so +N counts them all", () => {
    expect(chipFit({ ...base, widths: [100, 100], room: 30 })).toBe(0);
  });
  it("shows no chips for an empty list", () => {
    expect(chipFit({ ...base, widths: [], room: 0 })).toBe(0);
  });
  it("fits chips and the +N chip exactly", () => {
    // 50 + 4 + 50 + 4 + 30 = 138.
    expect(chipFit({ ...base, widths: [50, 50, 50], room: 138 })).toBe(2);
    expect(chipFit({ ...base, widths: [50, 50, 50], room: 137 })).toBe(1);
  });
  it("shows the next chip cut short when at least the least width is left", () => {
    // After one chip and the +N chip, 200 - 50 - 4 - 30 - 4 = 112 is left for the second.
    expect(chipFit({ ...base, widths: [50, 300, 300], room: 200 })).toBe(2);
    // 50 + 4 + 64 + 4 + 30 = 152: exactly the least width left.
    expect(chipFit({ ...base, widths: [50, 300, 300], room: 152 })).toBe(2);
    expect(chipFit({ ...base, widths: [50, 300, 300], room: 151 })).toBe(1);
  });
  it("needs no +N chip for the last chip cut short", () => {
    // 50 + 4 + 64 = 118: the last chip shows cut short and nothing is left to count.
    expect(chipFit({ ...base, widths: [50, 200], room: 118 })).toBe(2);
    expect(chipFit({ ...base, widths: [50, 200], room: 117 })).toBe(1);
  });
  it("never shows one chip as +1 when it fits alone, even cut short", () => {
    expect(chipFit({ ...base, widths: [200], room: 100 })).toBe(1);
    expect(chipFit({ ...base, widths: [200], room: 64 })).toBe(1);
    expect(chipFit({ ...base, widths: [80], room: 80 })).toBe(1);
    expect(chipFit({ ...base, widths: [200], room: 50 })).toBe(0);
  });
});
