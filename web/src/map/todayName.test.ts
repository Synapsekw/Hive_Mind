import { describe, expect, it } from "vitest";
import { todayName } from "./todayName";

describe("todayName", () => {
  it("names the count", () => {
    expect(todayName(82, 0)).toBe("Today, 82 notes written or changed");
  });
  it("uses the singular for one", () => {
    expect(todayName(1, 0)).toBe("Today, 1 note written or changed");
  });
  it("adds what needs the person", () => {
    expect(todayName(82, 5)).toBe(
      "Today, 82 notes written or changed, 5 need you",
    );
    expect(todayName(0, 1)).toBe(
      "Today, 0 notes written or changed, 1 needs you",
    );
  });
});
