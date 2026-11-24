import { describe, expect, it } from "vitest";
import {
  andMore,
  found,
  hiddenSkipped,
  notSent,
  num,
  openWorkspace,
  otherSkipped,
  progress,
  resultCounts,
  SHOWN,
  shownPaths,
  tooLargeSkipped,
  unreadFrontmatter,
  workspaceName,
} from "./importText";

describe("the import's sentences", () => {
  it("writes thousands with a comma", () => {
    expect(num(0)).toBe("0");
    expect(num(999)).toBe("999");
    expect(num(2000)).toBe("2,000");
    expect(num(1234567)).toBe("1,234,567");
  });

  it("counts notes in the singular and the plural", () => {
    expect(found(0)).toBe("0 notes found");
    expect(found(1)).toBe("1 note found");
    expect(found(1480)).toBe("1,480 notes found");
  });

  it("says what was left out and why", () => {
    expect(otherSkipped(1)).toBe("1 other file left out (not markdown)");
    expect(otherSkipped(12)).toBe("12 other files left out (not markdown)");
    expect(hiddenSkipped(1)).toBe(
      "1 hidden file left out (a name that begins with a dot)",
    );
    expect(hiddenSkipped(3)).toBe(
      "3 hidden files left out (a name that begins with a dot)",
    );
    expect(tooLargeSkipped(1)).toBe("1 note skipped: over 1 MB");
    expect(tooLargeSkipped(2)).toBe("2 notes skipped: over 1 MB");
  });

  it("says the progress as N of M notes", () => {
    expect(progress(120, 480)).toBe("120 of 480 notes");
    expect(progress(0, 1)).toBe("0 of 1 note");
    expect(progress(1000, 2000)).toBe("1,000 of 2,000 notes");
  });

  it("says what a stop left unsent and what was kept as text", () => {
    expect(notSent(1)).toBe("1 note was not sent.");
    expect(notSent(35)).toBe("35 notes were not sent.");
    expect(unreadFrontmatter(1)).toBe(
      "1 note had frontmatter that could not be read. It was kept as text.",
    );
    expect(unreadFrontmatter(4)).toBe(
      "4 notes had frontmatter that could not be read. It was kept as text.",
    );
  });

  it("names the workspace it opens", () => {
    expect(openWorkspace("Field notes")).toBe("Open Field notes");
  });

  it("gives the five counts in order", () => {
    expect(
      resultCounts({
        created: 1200,
        updated: 3,
        unchanged: 0,
        skipped: 2,
        failed: 25,
      }),
    ).toEqual([
      { label: "Created", value: "1,200" },
      { label: "Updated", value: "3" },
      { label: "Unchanged", value: "0" },
      { label: "Skipped", value: "2" },
      { label: "Failed", value: "25" },
    ]);
  });
});

describe("a new workspace's name", () => {
  it("is trimmed", () => {
    expect(workspaceName("  Field notes \n")).toBe("Field notes");
  });

  it("needs 1 to 60 characters after trimming", () => {
    expect(workspaceName("")).toBeNull();
    expect(workspaceName("   \t")).toBeNull();
    expect(workspaceName("a")).toBe("a");
    expect(workspaceName("a".repeat(60))).toBe("a".repeat(60));
    expect(workspaceName(` ${"a".repeat(60)} `)).toBe("a".repeat(60));
    expect(workspaceName("a".repeat(61))).toBeNull();
  });
});

describe("a list of paths", () => {
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `n${i}.md`);

  it("is shown whole up to 50", () => {
    expect(shownPaths([])).toEqual({ shown: [], more: 0 });
    expect(shownPaths(paths(50))).toEqual({ shown: paths(50), more: 0 });
  });

  it("shows the first 50 and counts the rest", () => {
    const { shown, more } = shownPaths(paths(1275));
    expect(shown).toEqual(paths(SHOWN));
    expect(more).toBe(1225);
    expect(andMore(more)).toBe("and 1,225 more");
  });
});
