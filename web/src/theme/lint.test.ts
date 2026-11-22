import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { colourLiterals } from "./lint";

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hive-lint-"));
  mkdirSync(join(dir, "nested"));
  writeFileSync(
    join(dir, "a.tsx"),
    [
      'const ok = "var(--fg)";',
      'const bad = "#8ea2eb";',
      "// a comment with #ffffff and rgb(0, 0, 0) is ignored",
      "/* so is a block",
      "   with oklch(0.5 0.1 30) inside */",
      'const ids = "#root #main #fade5";',
      'const short = "#fff"; const four = "#ffff";',
      'const five = "#fffff"; const seven = "#abcdef1";',
      'const url = "https://example.com/#abc";',
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "nested", "b.css"),
    [
      ".x { color: var(--fg); }",
      "/* #000 */",
      ".y { background: rgba(0, 0, 0, 0.5); }",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "nested", "c.ts"),
    'export const c = hsl(10, 20%, 30%) + "oklch(1 0 0)";',
  );
  writeFileSync(join(dir, "a.test.ts"), 'const ignored = "#123456";');
  writeFileSync(join(dir, "notes.md"), "#123456");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("colourLiterals", () => {
  it("finds colour literals outside comments and tests", () => {
    const found = colourLiterals(dir).map((f) => `${f.file}:${f.line}`);
    expect(found).toEqual([
      "a.tsx:2",
      "a.tsx:7",
      "a.tsx:9",
      "nested/b.css:3",
      "nested/c.ts:1",
    ]);
  });

  it("reports the line's text", () => {
    const first = colourLiterals(dir)[0]!;
    expect(first.text).toBe('const bad = "#8ea2eb";');
  });

  it("is empty for a clean folder", () => {
    const clean = mkdtempSync(join(tmpdir(), "hive-lint-clean-"));
    writeFileSync(join(clean, "x.ts"), 'export const x = "var(--brand)";');
    expect(colourLiterals(clean)).toEqual([]);
    rmSync(clean, { recursive: true, force: true });
  });
});
