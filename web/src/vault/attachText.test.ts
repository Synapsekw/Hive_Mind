import { describe, expect, it } from "vitest";
import * as a from "./attachText";

describe("the sentences of attaching topics", () => {
  it("counts in the order shown, with the fourth line only when something failed", () => {
    expect(
      a.attachCounts({
        attached: 1234,
        already: 5,
        none: 7,
        failed: 0,
        topics: 3,
      }),
    ).toEqual([
      { label: "Attached to a topic", value: "1,234" },
      { label: "Already attached", value: "5" },
      { label: "Notes with no topic", value: "7" },
    ]);
    expect(
      a.attachCounts({
        attached: 0,
        already: 0,
        none: 0,
        failed: 2,
        topics: 3,
      })[3],
    ).toEqual({ label: "Could not be saved", value: "2" });
  });

  it("says progress in notes read", () => {
    expect(a.attachProgress(40, 90)).toBe("40 of 90 notes read");
    expect(a.attachProgress(1, 1)).toBe("1 of 1 note read");
  });

  it("says where topics come from when the hive has none", () => {
    expect(a.NO_TOPICS).toContain("Settings");
  });
});
