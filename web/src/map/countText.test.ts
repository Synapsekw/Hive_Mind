import { describe, expect, it } from "vitest";
import { countText } from "./countText";

const base = { shown: 301, total: 301, active: false, truncated: false };

describe("countText", () => {
  it("counts the items when nothing is filtered", () => {
    expect(countText(base)).toBe("301 items");
    expect(countText({ ...base, shown: 1, total: 1 })).toBe("1 item");
  });
  it("says how many of them show when filtered", () => {
    expect(countText({ ...base, shown: 96, active: true })).toBe(
      "96 of 301 shown",
    );
    expect(countText({ ...base, shown: 0, active: true })).toBe(
      "0 of 301 shown",
    );
  });
  it("says so when the map was cut to its newest items", () => {
    expect(
      countText({ shown: 5000, total: 5000, active: false, truncated: true }),
    ).toBe("5,000 most recent items");
    expect(
      countText({ shown: 96, total: 5000, active: true, truncated: true }),
    ).toBe("96 of 5,000 shown");
  });
});
