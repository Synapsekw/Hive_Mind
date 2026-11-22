import { describe, expect, it } from "vitest";
import { longDate, shortDate, stripFrontmatter } from "./format";

describe("longDate", () => {
  it("formats in UTC", () => {
    expect(longDate("2026-11-03T10:00:00Z")).toBe("3 Nov 2026");
    // Late evening west of UTC is already the next day in UTC.
    expect(longDate("2026-11-03T23:30:00-05:00")).toBe("4 Nov 2026");
    expect(longDate("2027-01-01T00:00:00Z")).toBe("1 Jan 2027");
  });
  it("returns nothing for a bad timestamp", () => {
    expect(longDate("not a date")).toBe("");
  });
});

describe("shortDate", () => {
  const now = Date.UTC(2026, 10, 22);
  it("drops the year of now", () => {
    expect(shortDate("2026-03-09T12:00:00Z", now)).toBe("9 Mar");
  });
  it("keeps another year", () => {
    expect(shortDate("2025-12-31T12:00:00Z", now)).toBe("31 Dec 2025");
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading block", () => {
    expect(stripFrontmatter("---\ntags: [a]\ntitle: x\n---\n# Hi\n")).toBe(
      "# Hi\n",
    );
    expect(stripFrontmatter("---\r\na: 1\r\n---\r\nBody")).toBe("Body");
  });
  it("leaves a body without one alone", () => {
    expect(stripFrontmatter("# Hi\n\n---\n\nmore")).toBe("# Hi\n\n---\n\nmore");
    expect(stripFrontmatter("text\n---\na\n---\n")).toBe("text\n---\na\n---\n");
  });
});
