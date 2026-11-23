import { describe, expect, it } from "vitest";
import { pillRect } from "./useSlidingPill";

const r = (left: number, width: number) =>
  ({
    left,
    width,
    top: 0,
    height: 30,
    right: left + width,
    bottom: 30,
    x: left,
    y: 0,
  }) as DOMRect;

describe("pillRect", () => {
  it("places the pill under the active control, relative to the group", () => {
    expect(pillRect(r(100, 400), r(160, 70))).toEqual({ left: 60, width: 70 });
  });
  it("never returns a negative width", () => {
    expect(pillRect(r(0, 100), r(10, -5))).toEqual({ left: 10, width: 0 });
  });
});
