import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error The importer script is plain JavaScript with no types of its own.
import { parseNote as scriptParseNote } from "../../../scripts/import-vault.mjs";
import { parseNote, type Parsed } from "./parse";

const script = scriptParseNote as (raw: string, relPath: string) => Parsed;

/** [what it is, the file's text, its path inside the folder] */
const CASES: [string, string, string][] = [
  ["no frontmatter", "# Heading\n\ntext\n", "Decisions/my note.md"],
  ["an empty file", "", "empty.md"],
  ["only white space", "\n\n  \n", "blank.md"],
  ["a title", "---\ntitle: Home page\n---\n\nWelcome.\n", "Home.md"],
  [
    "a title with white space around it",
    '---\ntitle: "  Spaced  "\n---\nx\n',
    "s.md",
  ],
  ["an empty title", '---\ntitle: ""\n---\nx\n', "Folder/untitled.md"],
  ["a title that is not text", "---\ntitle: 42\n---\nx\n", "n.md"],
  ["a title that is a list", "---\ntitle: [a, b]\n---\nx\n", "l.md"],
  ["broken frontmatter", "---\ntitle: [unclosed\n---\nStill a note.\n", "b.md"],
  ["a tab where YAML allows none", "---\na:\n\t- b\n---\nx\n", "tab.md"],
  ["a list as frontmatter", "---\n- a\n- b\n---\nbody\n", "list.md"],
  ["a word as frontmatter", "---\njust text\n---\nbody\n", "word.md"],
  ["a number as frontmatter", "---\n42\n---\nbody\n", "number.md"],
  ["empty frontmatter", "---\n---\nbody\n", "e.md"],
  ["frontmatter that is only a comment", "---\n# nothing\n---\nbody\n", "c.md"],
  ["frontmatter that says null", "---\nnull\n---\nbody\n", "null.md"],
  [
    "Windows line endings",
    "---\r\ntitle: Two\r\nrelated:\r\n  - one\r\n---\r\nLine one\r\nLine two\r\n",
    "Decisions/deep/two.md",
  ],
  ["old Mac line endings", "---\rtitle: Mac\r---\rLine\r", "mac.md"],
  ["a byte order mark", "﻿---\ntitle: Marked\n---\nbody\n", "bom.md"],
  ["a byte order mark and no frontmatter", "﻿plain\n", "bom2.md"],
  [
    "a byte order mark with Windows line endings",
    "﻿---\r\ntitle: Two\r\ndate: 2026-05-23\r\n---\r\n\r\nLine one\r\n",
    "Decisions/deep/two.md",
  ],
  ["a NUL in the text", "be\u0000fore\n", "nul.md"],
  [
    "a NUL in the frontmatter",
    "---\ntitle: a\u0000b\n---\nbo\u0000dy\n",
    "nul2.md",
  ],
  [
    "dates",
    "---\ndate: 2026-05-23\nat: 2026-05-23T10:00:00Z\nquoted: '2026-05-23'\n---\nx\n",
    "dates.md",
  ],
  [
    "numbers, booleans and nothing",
    "---\nn: 1.5\nbig: 12345678901234567890\nyes: true\nnone: null\nempty:\nnan: .nan\ninf: .inf\n---\nx\n",
    "values.md",
  ],
  [
    "nested fields and lists",
    '---\ntags: [a, b]\nrelated:\n  - "[[one]]"\nmeta:\n  deep:\n    deeper: [1, {k: v}]\n---\nx\n',
    "nested.md",
  ],
  [
    "anchors and a merge",
    "---\nbase: &b\n  k: v\ncopy: *b\n---\nx\n",
    "anchors.md",
  ],
  ["a field named like a prototype", "---\n__proto__: 1\n---\nx\n", "p.md"],
  ["a field given twice", "---\na: 1\na: 2\n---\nx\n", "twice.md"],
  ["frontmatter that never closes", "---\ntitle: Open\nbody\n", "open.md"],
  ["a closing line with no newline", "---\ntitle: End\n---", "end.md"],
  ["spaces after the fences", "---  \ntitle: Fenced\n--- \t\nbody\n", "f.md"],
  ["a rule that is not at the top", "text\n---\ntitle: No\n---\n", "late.md"],
  [
    "blank lines after the frontmatter",
    "---\ntitle: T\n---\n\n\n\nbody\n\n",
    "blank-lines.md",
  ],
  ["a rule in the body", "---\ntitle: T\n---\nabove\n---\nbelow\n", "rule.md"],
  ["four dashes", "----\ntitle: T\n----\nx\n", "four.md"],
  ["a nested path", "x\n", "a/b/c/d/Deep note.md"],
  ["an upper-case extension", "x\n", "Folder/LOUD.MD"],
  ["two extensions", "x\n", "notes.md.md"],
  ["a name with dots", "x\n", "v1.2/release.notes.md"],
  ["a name that is not markdown", "x\n", "readme.txt"],
  ["a path that ends in a slash", "x\n", "Folder/note.md/"],
  ["a name beyond ASCII", "x\n", "Ünïcode/naïve café.md"],
  ["no folder at all", "x\n", "note.md"],
  ["an empty path", "x\n", ""],
];

describe("parseNote answers what the importer script answers", () => {
  it.each(CASES)("%s", (_what, raw, path) => {
    const ours = parseNote(raw, path);
    const theirs = script(raw, path);
    expect(ours).toEqual(theirs);
    // toEqual passes over a key whose value is undefined: the keys must be the same too.
    expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());
    // And what goes to the database is the same text.
    expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs));
  });

  it("covers a warning, plain text and real fields", () => {
    const seen = CASES.map(([, raw, path]) => parseNote(raw, path));
    expect(seen.some((n) => n.warning?.startsWith("unreadable"))).toBe(true);
    expect(seen.some((n) => n.warning?.startsWith("frontmatter is not"))).toBe(
      true,
    );
    expect(seen.some((n) => Object.keys(n.frontmatter).length > 2)).toBe(true);
  });
});

describe("parseNote", () => {
  it("reads frontmatter, strips the byte order mark and Windows line endings", () => {
    expect(
      parseNote(
        "﻿---\r\ntitle: Two\r\ndate: 2026-05-23\r\n---\r\n\r\nLine one\r\nLine two\r\n",
        "Decisions/deep/two.md",
      ),
    ).toEqual({
      title: "Two",
      frontmatter: { title: "Two", date: "2026-05-23" },
      body: "Line one\nLine two\n",
    });
  });

  it("falls back to the file's name and keeps broken frontmatter as text", () => {
    expect(parseNote("# Heading\n\ntext\n", "Decisions/my note.md")).toEqual({
      title: "my note",
      frontmatter: {},
      body: "# Heading\n\ntext\n",
    });
    const broken = parseNote(
      "---\ntitle: [unclosed\n---\nStill a note.\n",
      "b.md",
    );
    expect(broken.title).toBe("b");
    expect(broken.frontmatter).toEqual({});
    expect(broken.body).toBe("---\ntitle: [unclosed\n---\nStill a note.\n");
    expect(broken.warning).toMatch(/^unreadable frontmatter, kept as text: /);
    expect(broken.warning).not.toContain("\n");
  });

  it("keeps a list as text, with a warning", () => {
    expect(parseNote("---\n- a\n- b\n---\nbody\n", "list.md")).toEqual({
      title: "list",
      frontmatter: {},
      body: "---\n- a\n- b\n---\nbody\n",
      warning: "frontmatter is not a set of fields, kept as text",
    });
  });

  it("holds only what JSON can hold", () => {
    const n = parseNote("---\nnan: .nan\nwhen: 2026-05-23\n---\nx\n", "v.md");
    expect(n.frontmatter).toEqual({ nan: null, when: "2026-05-23" });
  });
});

describe("the modules the browser loads", () => {
  it("import nothing from node", () => {
    for (const file of ["parse.ts", "plan.ts", "types.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from\s+["']node:/);
      expect(source, file).not.toMatch(/\b(require|Buffer|process)\b/);
    }
  });
});
