import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, plist } from "../src/mac.ts";

test("the launchd agent runs every 15 minutes and at login", () => {
  const text = plist({
    node: "/opt/node",
    cli: "/repo/sync/src/cli.ts",
    log: "/l/hive-sync.log",
  });
  assert.match(
    text,
    /<key>Label<\/key>\s*<string>ai\.hive-mind\.sync<\/string>/,
  );
  assert.match(text, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(text, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(
    text,
    /<string>\/opt\/node<\/string>\s*<string>\/repo\/sync\/src\/cli\.ts<\/string>\s*<string>now<\/string>\s*<string>--scheduled<\/string>/,
  );
});

test("paths are escaped in the plist", () => {
  const text = plist({ node: "/a&b/node", cli: "/c<d>/cli.ts", log: "/l" });
  assert.match(text, /\/a&amp;b\/node/);
  assert.match(text, /\/c&lt;d&gt;\/cli\.ts/);
});

test("a second run waits for the lock; a stale lock is taken over", () => {
  const file = join(mkdtempSync(join(tmpdir(), "hive-lock-")), "lock");
  const release = acquireLock(file);
  assert.ok(release);
  assert.equal(acquireLock(file), null);
  release!();
  const again = acquireLock(file);
  assert.ok(again);
  again!();
});

test("a lock left by a process that is gone, or an unreadable one, is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-lock-"));
  const dead = join(dir, "dead");
  writeFileSync(dead, "2147483646");
  const a = acquireLock(dead);
  assert.ok(a);
  a!();
  const junk = join(dir, "junk");
  writeFileSync(junk, "");
  const b = acquireLock(junk);
  assert.ok(b);
  b!();
});
