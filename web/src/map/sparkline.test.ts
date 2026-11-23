import { expect, it } from "vitest";
import { daySeries, sparkPath } from "./sparkline";

it("sums agent writes per day across members", () => {
  const s = daySeries({
    today: 3,
    perMember: [],
    days: [
      { day: 0, member: "a", count: 2 },
      { day: 0, member: "b", count: 1 },
      { day: 13, member: "a", count: 4 },
    ],
  });
  expect(s).toHaveLength(14);
  expect(s[0]).toBe(3);
  expect(s[13]).toBe(4);
  expect(s[5]).toBe(0);
});

it("draws a line and a closed area in the box", () => {
  const { line, area } = sparkPath([0, 2, 4], 260, 54);
  expect(line.startsWith("M0.0 54.0")).toBe(true);
  expect(line).toContain("L260.0 10.0");
  expect(area.endsWith("L260 54L0 54Z")).toBe(true);
});
