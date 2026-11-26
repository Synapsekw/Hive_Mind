import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  jsonbBytes,
  noteBatches,
  noteBytes,
  pathOk,
  runOnce,
} from "../src/run.ts";
import type { NoteUp } from "../src/store.ts";
import { FolderMissing, Unreachable } from "../src/store.ts";
import { FakeStore } from "./fake-store.ts";

const vault = () => {
  const root = mkdtempSync(join(tmpdir(), "hive-vault-"));
  const cachePath = join(
    mkdtempSync(join(tmpdir(), "hive-cache-")),
    "cache.json",
  );
  return {
    root,
    cachePath,
    write: (p: string, text: string) => {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), text);
    },
  };
};

test("first run: notes before files, files in their linking note, report counts", async () => {
  const v = vault();
  v.write(
    "decks/Pitch.md",
    "---\ncreated: 2025-02-03\n---\nSee ![[pitch.html]] and [[Plan]]",
  );
  v.write("Plan.md", "plan");
  v.write("decks/pitch.html", "<html></html>");
  v.write("loose.pdf", "%PDF");
  v.write("big.mov", "video");
  const store = new FakeStore();
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(r.counts, {
    added: 4,
    changed: 0,
    moved: 0,
    deleted: 0,
    skipped: 1,
    too_big: 0,
  });
  const order = store.calls.filter((c) => c !== "upload");
  assert.deepEqual(order, [
    "plan",
    "putNotes",
    "linkNotes",
    "putFiles",
    "finish",
  ]);
  assert.equal(store.kept.get("decks/pitch.html")!.home, "decks/Pitch.md");
  assert.equal(store.kept.get("loose.pdf")!.home, "Vault files.md");
  assert.equal(
    store.notes.get("decks/Pitch.md")!.created_at,
    "2025-02-03T12:00:00.000Z",
  );
  // The object's place is fixed by path and content; HTML is stored as bytes.
  const [key] = [...store.objects.keys()].filter((k) =>
    k.endsWith("/pitch.html"),
  );
  assert.match(key!, /^m\/w\/vault\/[0-9a-f]{32}\/pitch\.html$/);
});

test("second run with no change sends only the plan and the finish", async () => {
  const v = vault();
  v.write("A.md", "a");
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  store.calls = [];
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(store.calls, ["plan", "finish"]);
});

test("a rename is a move, an edit is a change, a removal a delete", async () => {
  const v = vault();
  v.write("A.md", "a");
  v.write("B.md", "b");
  v.write("C.md", "c");
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  renameSync(join(v.root, "A.md"), join(v.root, "A2.md"));
  v.write("B.md", "b changed");
  unlinkSync(join(v.root, "C.md"));
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.equal(r.counts.moved, 1);
  assert.equal(r.counts.changed, 1);
  // One delete of three kept items is 33%, but a single item never trips the guard.
  assert.equal(r.counts.deleted, 1);
  assert.equal(store.notes.get("A2.md")!.from, "A.md");
});

test("a mass delete is held back until the next run is told to let it through", async () => {
  const v = vault();
  for (let i = 0; i < 30; i++) v.write(`n/${i}.md`, `note ${i}`);
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  rmSync(join(v.root, "n"), { recursive: true });
  v.write("keep.md", "k");
  let r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.equal(r.refusedDeletes, 30);
  assert.equal(store.kept.has("n/0.md"), true);
  r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: true,
  });
  assert.equal(r.counts.deleted, 30);
});

test("a missing folder stops before anything is compared", async () => {
  const store = new FakeStore();
  await assert.rejects(
    runOnce({
      root: "/nonexistent/vault",
      cachePath: "/tmp/x.json",
      store,
      confirmDeletes: false,
    }),
    FolderMissing,
  );
  assert.deepEqual(store.calls, []);
});

test("files over 50 MB and notes over 1 MB are listed, never uploaded or deleted", async () => {
  const v = vault();
  v.write("huge.md", "x".repeat(1_000_001));
  v.write("ok.md", "ok");
  const store = new FakeStore();
  store.kept.set("huge.md", { sha: "0".repeat(64), note: true });
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(r.tooBig, ["huge.md"]);
  assert.equal(store.kept.has("huge.md"), true);
  assert.equal(r.counts.too_big, 1);
});

test("an interrupted run is finished by the next, with nothing duplicated", async () => {
  const v = vault();
  v.write("a.pdf", "1");
  v.write("b.pdf", "2");
  const store = new FakeStore();
  // The first upload of b.pdf fails, whatever its object's key is.
  const real = store.upload.bind(store);
  let failedOnce = false;
  store.upload = async (p, bytes, type) => {
    if (!failedOnce && p.endsWith("/b.pdf")) {
      failedOnce = true;
      throw new Unreachable("network");
    }
    return real(p, bytes, type);
  };
  await assert.rejects(
    runOnce({
      root: v.root,
      cachePath: v.cachePath,
      store,
      confirmDeletes: false,
    }),
  );
  assert.equal(store.runs[0]!.finished!.error, "the run stopped: Unreachable");
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.equal(store.objects.size, 2);
  assert.equal(store.kept.size, 2);
});

test("uploads stop at the run's budget; the rest goes up next run", async () => {
  const v = vault();
  v.write("a.pdf", "11111");
  v.write("b.pdf", "22222");
  const store = new FakeStore();
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
    uploadBudget: 6,
  });
  assert.equal(r.deferred, 1);
  assert.equal(store.objects.size, 1);
  const again = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
    uploadBudget: 6,
  });
  assert.equal(again.deferred, 0);
  assert.equal(store.objects.size, 2);
});

const rootCanReadAnyway = process.getuid?.() === 0;

test("files in an unreadable subfolder are not deleted", async (t) => {
  if (rootCanReadAnyway) return t.skip("root reads everything");
  const v = vault();
  v.write("sub/Keep.md", "keep");
  v.write("top.md", "top");
  const store = new FakeStore();
  const opts = {
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  };
  await runOnce(opts);
  chmodSync(join(v.root, "sub"), 0o000);
  try {
    const r = await runOnce(opts);
    assert.equal(r.counts.deleted, 0);
    assert.equal(store.kept.has("sub/Keep.md"), true);
  } finally {
    chmodSync(join(v.root, "sub"), 0o755);
  }
});

test("a file whose fingerprint fails is not deleted", async (t) => {
  if (rootCanReadAnyway) return t.skip("root reads everything");
  const v = vault();
  v.write("a.pdf", "1");
  v.write("b.pdf", "2");
  v.write("c.pdf", "3");
  const store = new FakeStore();
  const opts = {
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  };
  await runOnce(opts);
  // A changed time forces a fresh read, which then fails.
  writeFileSync(join(v.root, "b.pdf"), "22");
  chmodSync(join(v.root, "b.pdf"), 0o000);
  try {
    const r = await runOnce(opts);
    assert.equal(r.counts.deleted, 0);
    assert.equal(store.kept.has("b.pdf"), true);
  } finally {
    chmodSync(join(v.root, "b.pdf"), 0o644);
  }
});

test("pathOk mirrors the database's _sync_path_ok", () => {
  assert.equal(pathOk("a/b.md"), true);
  assert.equal(pathOk("a/.b.md"), true);
  assert.equal(pathOk("a..b/c"), true);
  assert.equal(pathOk("x".repeat(4000)), true);
  assert.equal(pathOk("x".repeat(4001)), false);
  assert.equal(pathOk(""), false);
  assert.equal(pathOk("a\\b.pdf"), false);
  assert.equal(pathOk("a//b"), false);
  assert.equal(pathOk("/a"), false);
  assert.equal(pathOk("a/"), false);
  assert.equal(pathOk("."), false);
  assert.equal(pathOk("a/./b"), false);
  assert.equal(pathOk("../b"), false);
  assert.equal(pathOk("a/.."), false);
});

test("a path the database refuses is skipped, never sent, never deleted", async () => {
  const v = vault();
  v.write("ok.pdf", "1");
  v.write("a\\b.pdf", "2");
  const store = new FakeStore();
  const sent: string[] = [];
  const plan = store.plan.bind(store);
  store.plan = async (run, page, last) => {
    sent.push(...page.map((e) => e.path));
    return plan(run, page, last);
  };
  const opts = {
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  };
  const r = await runOnce(opts);
  assert.deepEqual(sent, ["ok.pdf"]);
  assert.equal(r.counts.skipped, 1);
  assert.equal(r.counts.added, 1);
  const again = await runOnce(opts);
  assert.equal(again.counts.deleted, 0);
});

test("one file that always fails to upload does not block the others or the run", async () => {
  const v = vault();
  v.write("bad.pdf", "1");
  v.write("good.pdf", "2");
  v.write("gone.md", "x");
  const store = new FakeStore();
  const opts = {
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  };
  await runOnce({ ...opts, store });
  unlinkSync(join(v.root, "gone.md"));
  v.write("bad2.pdf", "3");
  v.write("good2.pdf", "4");
  store.failUploadAlways.add("bad2.pdf");
  const r = await runOnce(opts);
  assert.deepEqual(r.failed, ["bad2.pdf"]);
  assert.equal(store.kept.has("good2.pdf"), true);
  assert.equal(store.kept.has("bad2.pdf"), false);
  assert.equal(r.counts.deleted, 1);
  assert.equal(
    store.runs[store.runs.length - 1]!.finished!.error,
    "1 items failed",
  );
  const again = await runOnce(opts);
  assert.deepEqual(again.failed, ["bad2.pdf"]);
  assert.equal(store.kept.has("good2.pdf"), true);
});

test("a move whose source is still on disk goes up as a new item", async (t) => {
  if (rootCanReadAnyway) return t.skip("root reads everything");
  const v = vault();
  v.write("sub/A.md", "same text");
  v.write("other.md", "o");
  const store = new FakeStore();
  const opts = {
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  };
  await runOnce(opts);
  chmodSync(join(v.root, "sub"), 0o000);
  try {
    v.write("B.md", "same text");
    const r = await runOnce(opts);
    assert.equal(r.counts.moved, 0);
    assert.equal(r.counts.added, 1);
    assert.equal(store.notes.get("B.md")!.from, undefined);
    assert.equal(store.kept.has("sub/A.md"), true);
  } finally {
    chmodSync(join(v.root, "sub"), 0o755);
  }
});

test("finish is called once even when it throws", async () => {
  const v = vault();
  v.write("A.md", "a");
  const store = new FakeStore();
  const real = store.finish.bind(store);
  let n = 0;
  store.finish = async (...a) => {
    n++;
    await real(...a);
    throw new Unreachable("down");
  };
  await assert.rejects(
    runOnce({
      root: v.root,
      cachePath: v.cachePath,
      store,
      confirmDeletes: false,
    }),
    Unreachable,
  );
  assert.equal(n, 1);
});

test("a note whose text is over 1 MB once read is listed as too big; the run completes", async () => {
  const v = vault();
  // Under 1 MB on disk, over it with the title its long name gives.
  const name = `${"n".repeat(200)}.md`;
  v.write(name, "x".repeat(999_900));
  v.write("ok.md", "ok");
  const store = new FakeStore();
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(r.tooBig, [name]);
  assert.equal(r.counts.too_big, 1);
  assert.equal(store.notes.has(name), false);
  assert.equal(store.notes.has("ok.md"), true);
  assert.equal(store.runs[0]!.finished?.error, null);
  assert.equal(store.runs[0]!.finished?.counts.too_big, 1);
});

test("a note is measured as the database prints its frontmatter, or more", () => {
  // jsonb puts a space after every ":" and ",", and prints a number in full.
  assert.equal(jsonbBytes({}), 2);
  assert.equal(
    jsonbBytes({ a: 1, b: [1, "x", null, true] }),
    '{"a": 1, "b": [1, "x", null, true]}'.length,
  );
  assert.equal(jsonbBytes({ é: "ü" }), Buffer.byteLength('{"é": "ü"}'));
  assert.ok(jsonbBytes({ n: 1e300 }) >= '{"n": }'.length + 301);
  assert.ok(jsonbBytes({ n: 1.5e-7 }) >= '{"n": 0.00000015}'.length);
});

const up = (path: string, over: Partial<NoteUp>): NoteUp => ({
  path,
  title: "t",
  body: "",
  frontmatter: {},
  sha256: "0".repeat(64),
  ...over,
});

test("two notes under 1 MB by their JSON but over it as the database counts go apart", () => {
  const fm = Object.fromEntries(
    Array.from({ length: 2000 }, (_, i) => [`k${i}`, i]),
  );
  const old = (n: NoteUp) =>
    Buffer.byteLength(n.title) +
    Buffer.byteLength(n.body) +
    Buffer.byteLength(JSON.stringify(n.frontmatter));
  const a = up("a.md", { frontmatter: fm });
  const b = up("b.md", {
    frontmatter: fm,
    body: "x".repeat(999_990 - 2 * old(a)),
  });
  assert.ok(old(a) + old(b) < 1_000_000);
  assert.ok(noteBytes(a) + noteBytes(b) > 1_000_000);
  assert.deepEqual(
    noteBatches([a, b]).map((x) => x.map((n) => n.path)),
    [["a.md"], ["b.md"]],
  );
});

test("a title is cut by characters, never inside one", async () => {
  const v = vault();
  const title = "a".repeat(999) + "\u{1F600}" + "bbb";
  v.write("T.md", `---\ntitle: ${title}\n---\nbody`);
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  const got = store.notes.get("T.md")!.title;
  // No lone half of a character: the text survives UTF-8 unchanged.
  assert.equal(/\p{Surrogate}/u.test(got), false);
  assert.equal(Buffer.from(got, "utf8").toString("utf8"), got);
  assert.equal(Array.from(got).length, 1000);
  assert.equal(got, "a".repeat(999) + "\u{1F600}");
});
