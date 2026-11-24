import { describe, expect, it } from "vitest";
import {
  addBatch,
  asPicked,
  emptyTally,
  handled,
  inFolder,
  nextChunk,
} from "./importFiles";

const f = (relativePath: string, size = 10) => ({ relativePath, size });

describe("the picked folder", () => {
  it("takes the folder's own name off each path and keeps the name", () => {
    const folder = inFolder([
      f("Notes/b.md", 2),
      f("Notes/a/deep/c.md", 3),
      f("Notes/a.md", 1),
    ]);
    expect(folder.supported).toBe(true);
    expect(folder.name).toBe("Notes");
    expect(asPicked(folder.files)).toEqual([
      { path: "a.md", size: 1 },
      { path: "a/deep/c.md", size: 3 },
      { path: "b.md", size: 2 },
    ]);
  });

  it("keeps each file beside its path", () => {
    const picked = [f("Notes/b.md"), f("Notes/a.md")];
    const folder = inFolder(picked);
    expect(folder.files.map((x) => x.file)).toEqual([picked[1], picked[0]]);
  });

  it("removes only the first part, even when a subfolder has the same name", () => {
    expect(inFolder([f("Notes/Notes/a.md")]).files[0]!.path).toBe("Notes/a.md");
  });

  it("is unsupported when the browser gave no relative paths", () => {
    const folder = inFolder([f(""), f("")]);
    expect(folder.supported).toBe(false);
    expect(folder.files).toEqual([]);
    expect(folder.name).toBe("");
  });

  it("leaves out a file that is not inside a folder", () => {
    const folder = inFolder([f("loose.md"), f("Notes/a.md")]);
    expect(folder.files.map((x) => x.path)).toEqual(["a.md"]);
  });

  it("nothing picked is not a browser problem", () => {
    expect(inFolder([])).toEqual({ supported: true, name: "", files: [] });
  });
});

describe("the tally", () => {
  it("counts each outcome and lists the failed paths", () => {
    const t = addBatch(emptyTally(), ["a.md", "b.md", "c.md", "d.md"], {
      ok: true,
      outcomes: [
        { path: "a.md", outcome: "created" },
        { path: "b.md", outcome: "updated" },
        { path: "c.md", outcome: "unchanged" },
        { path: "d.md", outcome: "failed" },
      ],
    });
    expect(t).toEqual({
      created: 1,
      updated: 1,
      unchanged: 1,
      failed: ["d.md"],
    });
    expect(handled(t)).toBe(4);
  });

  it("fails every note of a refused batch, and of one that never answered", () => {
    let t = addBatch(emptyTally(), ["a.md", "b.md"], { ok: false });
    t = addBatch(t, ["c.md"], null);
    expect(t.failed).toEqual(["a.md", "b.md", "c.md"]);
    expect(handled(t)).toBe(3);
  });

  it("fails a path the answer says nothing about and ignores a path that was not sent", () => {
    const t = addBatch(emptyTally(), ["a.md", "b.md"], {
      ok: true,
      outcomes: [
        { path: "a.md", outcome: "created" },
        { path: "elsewhere.md", outcome: "created" },
      ],
    });
    expect(t).toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
      failed: ["b.md"],
    });
  });

  it("adds up over batches without changing the tally it was given", () => {
    const first = addBatch(emptyTally(), ["a.md"], { ok: false });
    const second = addBatch(first, ["b.md"], {
      ok: true,
      outcomes: [{ path: "b.md", outcome: "created" }],
    });
    expect(first).toEqual({
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: ["a.md"],
    });
    expect(second.created).toBe(1);
    expect(second.failed).toEqual(["a.md"]);
  });
});

describe("the files read together", () => {
  const paths = ["a", "b", "c", "d", "e"];
  const sizes: Record<string, number> = { a: 4, b: 4, c: 4, d: 20, e: 1 };
  const size = (p: string) => sizes[p]!;

  it("stops at the number of notes", () => {
    expect(nextChunk(paths, 0, size, 2, 100)).toEqual(["a", "b"]);
    expect(nextChunk(paths, 2, size, 2, 100)).toEqual(["c", "d"]);
    expect(nextChunk(paths, 4, size, 2, 100)).toEqual(["e"]);
    expect(nextChunk(paths, 5, size, 2, 100)).toEqual([]);
  });

  it("stops before the bytes run over", () => {
    expect(nextChunk(paths, 0, size, 25, 10)).toEqual(["a", "b"]);
  });

  it("takes a file larger than the limit alone", () => {
    expect(nextChunk(paths, 3, size, 25, 10)).toEqual(["d"]);
  });
});
