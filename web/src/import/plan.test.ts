import { describe, expect, it } from "vitest";
import {
  BATCH_BYTES,
  BATCH_NOTES,
  MAX_NOTE_BYTES,
  MAX_NOTES,
  batches,
  dirOf,
  isNotePath,
  noteBytes,
  planImport,
  textBytes,
  type ImportNote,
} from "./plan";

const file = (path: string, size = 10) => ({ path, size });
const note = (path: string, body = "x"): ImportNote => ({
  path,
  title: path,
  body,
  frontmatter: {},
});

describe("the limits", () => {
  it("are the ones the spec names", () => {
    expect(MAX_NOTES).toBe(2000);
    expect(MAX_NOTE_BYTES).toBe(1_000_000);
    expect(BATCH_NOTES).toBe(25);
    expect(BATCH_BYTES).toBe(3_000_000);
  });
});

describe("isNotePath", () => {
  it("takes a relative markdown path, in any case of the extension", () => {
    for (const p of [
      "Home.md",
      "Decisions/deep/two.md",
      "LOUD.MD",
      "mixed.Md",
      "a b/c d.md",
      "v1.2/release.notes.md",
      'Notes "draft", (v2).md',
      "Ünïcode/naïve café.md",
      "x".repeat(497) + ".md",
    ])
      expect(isNotePath(p), p).toBe(true);
  });

  it("refuses everything else", () => {
    for (const p of [
      "",
      "notes.txt",
      "md",
      "note.md.bak",
      "/Home.md",
      "a//b.md",
      "a/b.md/",
      "./a.md",
      "a/./b.md",
      "../a.md",
      "a/../b.md",
      "a\\b.md",
      "..\\a.md",
      ".obsidian/config.md",
      "a/.trash/b.md",
      "a/.hidden.md",
      ".md",
      "a\u0000.md",
      "x".repeat(498) + ".md",
      null,
      undefined,
      42,
      ["a.md"],
      { path: "a.md" },
    ])
      expect(isNotePath(p), String(p)).toBe(false);
  });
});

describe("dirOf", () => {
  it("is the folder a note sits in, or null at the top", () => {
    expect(dirOf("Home.md")).toBeNull();
    expect(dirOf("Decisions/one.md")).toBe("Decisions");
    expect(dirOf("Decisions/deep/two.md")).toBe("Decisions/deep");
  });
});

describe("planImport", () => {
  it("takes markdown only, in any case, sorted as the script sorts", () => {
    const plan = planImport([
      file("Home.md"),
      file("assets/picture.png"),
      file("notes.txt"),
      file("Decisions/one.md"),
      file("Decisions/deep/two.MD"),
      file("README"),
      file("archive.md.zip"),
    ]);
    expect(plan).toEqual({
      notes: ["Decisions/deep/two.MD", "Decisions/one.md", "Home.md"],
      skippedOther: 4,
      tooLarge: [],
      hidden: 0,
      tooMany: false,
    });
  });

  it("leaves out anything under a part that begins with a dot", () => {
    const plan = planImport([
      file(".obsidian/config.md"),
      file(".obsidian/app.json"),
      file("a/.trash/old.md"),
      file("a/.hidden.md"),
      file(".DS_Store"),
      file("a/kept.md"),
    ]);
    expect(plan.notes).toEqual(["a/kept.md"]);
    expect(plan.hidden).toBe(5);
    expect(plan.skippedOther).toBe(0);
  });

  it("lists a note over 1 MB as too large, and takes one of exactly 1 MB", () => {
    const plan = planImport([
      file("big.md", MAX_NOTE_BYTES + 1),
      file("edge.md", MAX_NOTE_BYTES),
      file("empty.md", 0),
      file("odd.md", Number.NaN),
      file("huge.png", 50_000_000),
    ]);
    expect(plan.notes).toEqual(["edge.md", "empty.md"]);
    expect(plan.tooLarge).toEqual(["big.md", "odd.md"]);
    expect(plan.skippedOther).toBe(1);
  });

  it("drops a path that could not be a file inside the folder, as other", () => {
    const plan = planImport([
      file("../outside.md"),
      file("a/../../outside.md"),
      file("/etc/passwd.md"),
      file("a\\b.md"),
      file("a//b.md"),
      file("a/b.md/"),
      file("./a.md"),
      file(""),
      file("nul\u0000.md"),
      file("x".repeat(600) + ".md"),
      { path: 42, size: 1 } as never,
      null as never,
      file("fine.md"),
    ]);
    expect(plan.notes).toEqual(["fine.md"]);
    expect(plan.skippedOther).toBe(12);
    expect(plan.hidden).toBe(0);
  });

  it("takes a path given twice once", () => {
    const plan = planImport([file("a.md"), file("a.md"), file("A.md")]);
    expect(plan.notes).toEqual(["A.md", "a.md"]);
    expect(plan.skippedOther).toBe(1);
  });

  it("says when there are more than 2,000 notes, and not at 2,000", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => file(`n/${i}.md`));
    const at = planImport(many(MAX_NOTES));
    expect(at.tooMany).toBe(false);
    expect(at.notes).toHaveLength(MAX_NOTES);
    const over = planImport([...many(MAX_NOTES + 1), file("x.png")]);
    expect(over.tooMany).toBe(true);
    expect(over.notes).toHaveLength(MAX_NOTES + 1);
    // What is not a note does not count towards the limit.
    const padded = planImport([
      ...many(MAX_NOTES),
      file("x.png"),
      file(".git/HEAD"),
      file("big.md", MAX_NOTE_BYTES + 1),
    ]);
    expect(padded.tooMany).toBe(false);
  });

  it("lets through only what the server takes", () => {
    const plan = planImport([
      file("a.md"),
      file("b/c.MD"),
      file(".x/y.md"),
      file("../z.md"),
      file("q.txt"),
    ]);
    expect(plan.notes.every(isNotePath)).toBe(true);
  });
});

describe("noteBytes", () => {
  it("counts the bytes of the note as JSON text", () => {
    expect(textBytes("é")).toBe(2);
    expect(textBytes("😀")).toBe(4);
    const plain = noteBytes(note("a.md", "abc"));
    // A newline and a quote travel as two bytes each.
    expect(noteBytes(note("a.md", 'a\n"'))).toBe(plain + 2);
    expect(noteBytes(note("a.md", "aéc"))).toBe(plain + 1);
    expect(
      noteBytes({ ...note("a.md", "abc"), frontmatter: { tags: ["a"] } }),
    ).toBe(plain + textBytes('"tags":["a"]'));
  });
});

describe("batches", () => {
  it("is empty for no notes", () => {
    expect(batches([])).toEqual([]);
  });

  it("holds at most 25 notes each and keeps the order", () => {
    const notes = Array.from({ length: 60 }, (_, i) => note(`n/${i}.md`));
    const out = batches(notes);
    expect(out.map((b) => b.length)).toEqual([25, 25, 10]);
    expect(out.flat()).toEqual(notes);
  });

  it("holds at most 3 MB each and keeps the order", () => {
    const big = "x".repeat(900_000);
    const notes = Array.from({ length: 8 }, (_, i) => note(`n/${i}.md`, big));
    const out = batches(notes);
    expect(out.map((b) => b.length)).toEqual([3, 3, 2]);
    expect(out.flat()).toEqual(notes);
    for (const b of out)
      expect(b.reduce((n, x) => n + noteBytes(x), 0)).toBeLessThanOrEqual(
        BATCH_BYTES,
      );
  });

  it("fills a batch exactly to the limit and no further", () => {
    const a = note("a.md", "");
    const pad = BATCH_BYTES - 2 * noteBytes(a);
    const full = note("b.md", "x".repeat(pad));
    expect(noteBytes(a) + noteBytes(full)).toBe(BATCH_BYTES);
    expect(batches([a, full]).map((b) => b.length)).toEqual([2]);
    const over = note("b.md", "x".repeat(pad + 1));
    expect(batches([a, over]).map((b) => b.length)).toEqual([1, 1]);
  });

  it("sends a single note over the byte limit alone", () => {
    // Under 1 MB as a file, over 3 MB once every character is escaped.
    const heavy = note("heavy.md", "\u0001".repeat(600_000));
    expect(noteBytes(heavy)).toBeGreaterThan(BATCH_BYTES);
    const out = batches([note("a.md"), heavy, note("b.md"), note("c.md")]);
    expect(out.map((b) => b.map((n) => n.path))).toEqual([
      ["a.md"],
      ["heavy.md"],
      ["b.md", "c.md"],
    ]);
  });

  it("counts what the text weighs, not how long it is", () => {
    const wide = "é".repeat(700_000); // 1.4 MB
    const notes = [note("a.md", wide), note("b.md", wide), note("c.md", wide)];
    expect(batches(notes).map((b) => b.length)).toEqual([2, 1]);
  });
});
