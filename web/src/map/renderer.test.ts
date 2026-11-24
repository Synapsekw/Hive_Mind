import { describe, expect, it } from "vitest";
import { dotDiameter, fitGroupLabel, HALO_STOPS, haloAlpha } from "./renderer";
import type { ModelNode } from "./types";

function node(kind: ModelNode["kind"], nb: number[] = []): ModelNode {
  return {
    i: 1,
    id: kind === "hub" || kind === "root" ? null : "x",
    kind,
    topic: kind === "agent" || kind === "root" ? -1 : 0,
    member: null,
    mine: true,
    locked: false,
    title: "x",
    path: null,
    updatedAt: 0,
    byAgent: false,
    nb,
  };
}

describe("dotDiameter", () => {
  it("gives a note with no neighbours its normal size at scale 1", () => {
    // size(): 5 + neighbours, at most 10.
    expect(dotDiameter(node("note"), 1)).toBe(5);
    expect(dotDiameter(node("note", [2, 3, 4]), 1)).toBe(8);
    expect(dotDiameter(node("file", [2, 3, 4, 5, 6, 7, 8]), 1)).toBe(10);
  });

  it("keeps notes and files at 2.5 or more when shrunk", () => {
    expect(dotDiameter(node("note"), 0.3)).toBe(2.5);
    expect(dotDiameter(node("file"), 0.3)).toBe(2.5);
    expect(dotDiameter(node("note", [2, 3, 4, 5, 6]), 0.3)).toBe(3);
  });

  it("scales hubs and agents without the floor", () => {
    expect(dotDiameter(node("hub"), 0.3)).toBeCloseTo(4.8, 12);
    expect(dotDiameter(node("agent"), 0.3)).toBeCloseTo(4.2, 12);
    expect(dotDiameter(node("hub"), 0.1)).toBeCloseTo(1.6, 12);
  });

  it("is scale 1 when the scale is left out", () => {
    for (const kind of ["note", "file", "hub", "agent", "root"] as const)
      expect(dotDiameter(node(kind, [2]))).toBe(
        dotDiameter(node(kind, [2]), 1),
      );
    expect(dotDiameter(node("root"))).toBe(28);
  });
});

describe("fitGroupLabel", () => {
  // Every character 6 px wide.
  const m = (s: string) => s.length * 6;
  const label = "Quadruped fleet · 384"; // 21 characters, 126 px

  it("keeps a label that fits", () => {
    expect(fitGroupLabel(label, 126, m)).toBe(label);
  });

  it("cuts the name with an ellipsis and keeps the count whole", () => {
    // 72 px = 12 characters: 5 of the name, "…", then " · 384".
    expect(fitGroupLabel(label, 72, m)).toBe("Quadr… · 384");
    expect(m(fitGroupLabel(label, 72, m))).toBeLessThanOrEqual(72);
  });

  it("shows only the count when fewer than 4 name characters fit", () => {
    // 60 px = 10 characters: 3 of the name would fit.
    expect(fitGroupLabel(label, 60, m)).toBe("384");
    expect(fitGroupLabel(label, 0, m)).toBe("384");
  });

  it("drops a trailing space before the ellipsis", () => {
    // 96 px = 16 characters: "Quadruped " (10) trimmed to "Quadruped" leaves room for "…".
    expect(fitGroupLabel(label, 96, m)).toBe("Quadruped… · 384");
  });
});

describe("haloAlpha", () => {
  it("is nothing below level 6", () => {
    for (let level = 0; level < 6; level++)
      expect(haloAlpha(level, 1234, false)).toBe(0);
  });

  it("is 0.3 at level 6, moving or still", () => {
    expect(haloAlpha(6, 0, false)).toBe(0.3);
    expect(haloAlpha(6, 999, true)).toBe(0.3);
  });

  it("is 0.5 at level 7 when still", () => {
    expect(haloAlpha(7, 777, true)).toBe(0.5);
  });

  it("breathes between 0.42 and 0.58 at level 7 on a four-second cycle", () => {
    expect(haloAlpha(7, 0, false)).toBeCloseTo(0.5, 10);
    expect(haloAlpha(7, 1000, false)).toBeCloseTo(0.58, 10);
    expect(haloAlpha(7, 3000, false)).toBeCloseTo(0.42, 10);
    expect(haloAlpha(7, 4000, false)).toBeCloseTo(0.5, 10);
  });
});

describe("HALO_STOPS", () => {
  it("is full at the centre, 35% at 0.4 of the radius and gone at the edge", () => {
    expect(HALO_STOPS).toEqual([
      [0, 1],
      [0.4, 0.35],
      [1, 0],
    ]);
  });
});
