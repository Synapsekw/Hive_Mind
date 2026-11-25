import { describe, expect, it } from "vitest";
import { withoutTitle } from "./withoutTitle";

describe("withoutTitle", () => {
  it("drops a first heading equal to the title", () => {
    expect(
      withoutTitle("# Kickoff notes\n\nSample note.", "Kickoff notes"),
    ).toBe("\nSample note.");
  });
  it("ignores case, outer spaces and runs of spaces", () => {
    expect(
      withoutTitle("\n\n#   kickoff  NOTES  \nText", "Kickoff notes"),
    ).toBe("Text");
  });
  it("keeps a heading that differs", () => {
    const b = "# Something else\nText";
    expect(withoutTitle(b, "Kickoff notes")).toBe(b);
  });
  it("keeps a matching heading that is not the first line with text", () => {
    const b = "Intro\n# Kickoff notes";
    expect(withoutTitle(b, "Kickoff notes")).toBe(b);
  });
  it("keeps a level-two heading", () => {
    const b = "## Kickoff notes\nText";
    expect(withoutTitle(b, "Kickoff notes")).toBe(b);
  });
});
