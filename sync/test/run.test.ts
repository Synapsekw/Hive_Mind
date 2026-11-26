import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOnce } from "../src/run.ts";
import { FolderMissing } from "../src/store.ts";
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
      throw new Error("network");
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
  assert.equal(store.runs[0]!.finished!.error, "the run stopped: Error");
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
