import { describe, expect, it } from "vitest";
import { zoomLabels, type LabelInput } from "./zoomLabels";

const stage = { w: 1000, h: 760 };
const id = (x: number, y: number): [number, number] => [x, y];
const dot = (
  i: number,
  links: number,
  x = 500,
  y = 380,
  on = true,
  width = 80,
): LabelInput => ({ i, on, links, x, y, width });

describe("zoomLabels", () => {
  it("adds nothing below 1.8x", () => {
    expect(zoomLabels([dot(1, 9)], 1.7, stage, id).size).toBe(0);
  });
  it("labels well-linked lit dots from 1.8x", () => {
    const got = zoomLabels(
      [dot(1, 3), dot(2, 2), dot(3, 5, 500, 380, false)],
      1.8,
      stage,
      id,
    );
    expect([...got]).toEqual([1]);
  });
  it("labels every lit dot from 3x", () => {
    expect(
      zoomLabels([dot(1, 0), dot(2, 1, 500, 420)], 3, stage, id).size,
    ).toBe(2);
  });
  it("skips dots outside the stage", () => {
    expect(
      zoomLabels([dot(1, 5, -10, 10), dot(2, 5, 10, 900)], 3, stage, id).size,
    ).toBe(0);
  });
  it("skips a label that would overlap one already placed", () => {
    const got = zoomLabels(
      [dot(1, 5, 500, 380), dot(2, 5, 540, 385), dot(3, 5, 500, 420)],
      3,
      stage,
      id,
    );
    expect([...got].sort()).toEqual([1, 3]);
  });
  it("caps at 60, nearest the centre first", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      dot(i, 5, 500 + (i % 10) * 90, 100 + Math.floor(i / 10) * 30, true, 60),
    );
    const got = zoomLabels(many, 3, stage, id);
    expect(got.size).toBe(60);
    expect(got.has(0)).toBe(true);
    expect(got.has(99)).toBe(false);
  });
});
