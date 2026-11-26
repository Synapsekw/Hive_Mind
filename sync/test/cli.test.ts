import { test } from "node:test";
import assert from "node:assert/strict";
import {
  now,
  parseArgs,
  replaceKey,
  type KeyDeps,
  type NowDeps,
} from "../src/cli.ts";
import { KeyRefused, Unreachable } from "../src/store.ts";
import type { Report } from "../src/run.ts";
import type { State } from "../src/config.ts";

test("subcommands and flags", () => {
  assert.deepEqual(parseArgs(["now"]), {
    cmd: "now",
    confirmDeletes: false,
    scheduled: false,
  });
  assert.deepEqual(parseArgs(["--confirm-deletes"]), {
    cmd: "now",
    confirmDeletes: true,
    scheduled: false,
  });
  assert.deepEqual(parseArgs(["now", "--scheduled"]), {
    cmd: "now",
    confirmDeletes: false,
    scheduled: true,
  });
  assert.deepEqual(
    parseArgs([
      "setup",
      "--url",
      "https://p",
      "--publishable-key",
      "pk",
      "--folder",
      "/v",
    ]),
    {
      cmd: "setup",
      url: "https://p",
      anonKey: "pk",
      folder: "/v",
    },
  );
  assert.deepEqual(parseArgs(["status"]), { cmd: "status" });
  assert.deepEqual(parseArgs(["uninstall"]), { cmd: "uninstall" });
  assert.deepEqual(parseArgs(["nope"]), { cmd: "help" });
  assert.deepEqual(parseArgs([]), { cmd: "help" });
});

const KEY = "hsync_" + "d".repeat(64);
const counts = (added: number) => ({
  added,
  changed: 0,
  moved: 0,
  deleted: 0,
  skipped: 0,
  too_big: 0,
});
const report = (over: Partial<Report>): Report => ({
  counts: counts(0),
  tooBig: [],
  refusedDeletes: 0,
  failed: [],
  deferred: 0,
  ...over,
});

function nowDeps(run: () => Promise<Report>) {
  const state: State = { failuresInRow: 0, notified: [] };
  const notes: string[] = [];
  const logs: string[] = [];
  const deps: NowDeps = {
    loadConfig: () => ({ url: "https://p", anonKey: "pk", folder: "/v" }),
    loadState: () => state,
    saveState: () => {},
    keychainRead: () => KEY,
    acquireLock: () => () => {},
    run,
    notify: (p) => void notes.push(p),
    log: (l) => void logs.push(l),
  };
  return { deps, state, notes, logs };
}

test("three runs where every upload failed notify once and are not successes", async () => {
  const t = nowDeps(async () => report({ failed: ["a.md", "b.md"] }));
  for (let i = 0; i < 3; i++) assert.equal(await now(false, t.deps), 1);
  assert.deepEqual(t.notes, [
    "Hive sync has failed 3 times in a row. See the log.",
  ]);
  assert.equal(t.state.failuresInRow, 3);
  assert.equal(t.state.last?.ok, false);
  assert.equal(await now(false, t.deps), 1);
  assert.equal(t.notes.length, 1);
  assert.match(t.logs[0]!, /^failed /);
});

test("a run that stored something resets the count", async () => {
  const t = nowDeps(async () => report({ failed: ["x"], counts: counts(1) }));
  t.state.failuresInRow = 2;
  assert.equal(await now(false, t.deps), 0);
  assert.equal(t.state.failuresInRow, 0);
  assert.equal(t.state.last?.ok, true);
});

test("a refused key is told once", async () => {
  const t = nowDeps(() => Promise.reject(new KeyRefused("x")));
  await now(false, t.deps);
  await now(false, t.deps);
  assert.deepEqual(t.notes, [
    "Your sync key was refused. Run hive-sync setup.",
  ]);
});

function keyDeps(opts: { signIn?: () => Promise<void>; format?: boolean }) {
  const store = new Map<string, string>([["default", "old"]]);
  const deps: KeyDeps = {
    prompt: (a) => (store.set(a, KEY), true),
    read: (a) => (opts.format === false ? null : (store.get(a) ?? null)),
    write: (k, a) => (store.set(a, k), true),
    remove: (a) => void store.delete(a),
    signIn: opts.signIn ?? (async () => {}),
  };
  return { deps, store };
}

test("a good new key replaces the old one only after sign-in, and pending is gone", async () => {
  const k = keyDeps({});
  assert.equal(await replaceKey(k.deps), "ok");
  assert.equal(k.store.get("default"), KEY);
  assert.equal(k.store.has("pending"), false);
});

test("a refused, unreachable or malformed key leaves the old key in place", async () => {
  const cases: [Parameters<typeof keyDeps>[0], string][] = [
    [{ signIn: () => Promise.reject(new KeyRefused("x")) }, "refused"],
    [{ signIn: () => Promise.reject(new Unreachable("x")) }, "unreachable"],
    [{ format: false }, "bad-format"],
  ];
  for (const [opts, want] of cases) {
    const k = keyDeps(opts);
    assert.equal(await replaceKey(k.deps), want);
    assert.equal(k.store.get("default"), "old");
    assert.equal(k.store.has("pending"), false);
  }
});
