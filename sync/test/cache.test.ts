import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  fingerprint,
  loadCache,
  noteTargets,
  saveCache,
  sha256Hex,
} from "../src/cache.ts";

const entryOf = (root: string, path: string) => {
  const abs = join(root, path);
  const st = statSync(abs);
  return { path, abs, size: st.size, mtimeMs: st.mtimeMs };
};

test("a file whose size and time match is not read again", async () => {
  const root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  writeFileSync(join(root, "a.pdf"), "one");
  const e = entryOf(root, "a.pdf");
  const first = await fingerprint(e, { version: 1, entries: {} });
  assert.equal(first.sha256, sha256Hex("one"));
  const cached = {
    version: 1 as const,
    entries: { "a.pdf": { ...first, sha256: "f".repeat(64) } },
  };
  assert.equal((await fingerprint(e, cached)).sha256, "f".repeat(64));
  assert.equal(
    (await fingerprint({ ...e, size: 4 }, cached)).sha256,
    sha256Hex("one"),
  );
});

test("a note's targets: wiki links, embeds and relative markdown links", () => {
  const t = noteTargets(
    '---\nrelated: "[[Other]]"\n---\nSee [[Plan#Goals|plan]], ![[deck.html]] and [pdf](../files/a%20b.pdf) and [w](https://x.y/a.pdf).',
    "notes/n.md",
  );
  assert.deepEqual(t.sort(), [
    "../files/a b.pdf",
    "Other",
    "Plan",
    "deck.html",
  ]);
});

test("the cache survives a round trip and a broken file reads as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-sync-"));
  const file = join(dir, "cache.json");
  saveCache(file, {
    version: 1,
    entries: { "a.md": { size: 1, mtimeMs: 2, sha256: "a".repeat(64) } },
  });
  assert.equal(loadCache(file).entries["a.md"].size, 1);
  writeFileSync(file, "{nope");
  assert.deepEqual(loadCache(file), { version: 1, entries: {} });
});
