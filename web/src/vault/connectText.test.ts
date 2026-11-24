import { describe, expect, it } from "vitest";
import {
  AFTER_IMPORT_UNFINISHED,
  CONNECT,
  CONNECT_HALTED,
  connectCounts,
  connectProgress,
} from "./connectText";

describe("the sentences of connecting wiki links", () => {
  it("says how many notes were read, in the singular and the plural", () => {
    expect(connectProgress(0, 0)).toBe("0 of 0 notes read");
    expect(connectProgress(1, 1)).toBe("1 of 1 note read");
    expect(connectProgress(120, 480)).toBe("120 of 480 notes read");
  });

  it("writes thousands with a comma", () => {
    expect(connectProgress(1000, 1643)).toBe("1,000 of 1,643 notes read");
    expect(
      connectCounts({ linked: 5712, already: 1000, missing: 12345, failed: 0 }),
    ).toEqual([
      { label: "Links made", value: "5,712" },
      { label: "Already linked", value: "1,000" },
      { label: "Pointing at no note", value: "12,345" },
    ]);
  });

  it("shows three counts when every link was saved", () => {
    expect(
      connectCounts({ linked: 0, already: 0, missing: 0, failed: 0 }),
    ).toEqual([
      { label: "Links made", value: "0" },
      { label: "Already linked", value: "0" },
      { label: "Pointing at no note", value: "0" },
    ]);
  });

  it("adds a fourth count only when some could not be saved", () => {
    expect(
      connectCounts({ linked: 21, already: 6, missing: 3, failed: 2 }),
    ).toEqual([
      { label: "Links made", value: "21" },
      { label: "Already linked", value: "6" },
      { label: "Pointing at no note", value: "3" },
      { label: "Could not be saved", value: "2" },
    ]);
  });

  it("names the button in the sentence that sends people to it", () => {
    expect(AFTER_IMPORT_UNFINISHED).toContain(CONNECT);
    expect(CONNECT_HALTED).toContain("Three steps in a row");
  });
});
