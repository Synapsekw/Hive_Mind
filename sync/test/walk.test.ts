import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walk } from "../src/walk.ts";
import { parseIgnore } from "../src/skip.ts";

test("walk lists files by relative path, sorted, skipping and not following links", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  mkdirSync(join(root, "b"));
  mkdirSync(join(root, ".obsidian"));
  writeFileSync(join(root, "b", "z.md"), "z");
  writeFileSync(join(root, "a.pdf"), "pdf");
  writeFileSync(join(root, ".obsidian", "x.json"), "{}");
  writeFileSync(join(root, "clip.mov"), "v");
  symlinkSync(join(root, "a.pdf"), join(root, "link.pdf"));
  const { entries, skipped } = walk(root, parseIgnore(""));
  assert.deepEqual(
    entries.map((e) => e.path),
    ["a.pdf", "b/z.md"],
  );
  assert.equal(entries[0].size, 3);
  assert.equal(skipped, 3);
});

test("paths are NFC, whatever form the disk gives", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  writeFileSync(join(root, "Café.md"), "x");
  const { entries } = walk(root, parseIgnore(""));
  assert.equal(entries[0].path, "Café.md");
});
