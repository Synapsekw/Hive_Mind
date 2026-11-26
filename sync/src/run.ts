// One run of the sync: walk the vault, fingerprint, compare with the hive, then notes, their
// wiki links, files, deletes, and the record. Every step can be repeated: an interrupted run's
// next run compares again and carries on, with nothing duplicated (an object's place is fixed by
// its path and content). Nothing here logs a path or a note's text.
import { readFileSync, statSync } from "node:fs";
import { noteDates } from "../../web/src/import/dates.ts";
import { parseNote } from "../../web/src/import/parse.ts";
import { mimeFor } from "../../web/src/gallery/mime.ts";
import {
  fingerprint,
  isNote,
  loadCache,
  saveCache,
  sha256Hex,
  type Cache,
  type Cached,
} from "./cache.ts";
import { chooseHomes } from "./homes.ts";
import { notePairs } from "./links.ts";
import { loadIgnore } from "./skip.ts";
import {
  FolderMissing,
  KeyRefused,
  Unreachable,
  type Counts,
  type FileUp,
  type ManifestEntry,
  type NoteUp,
  type PlanResult,
  type Store,
} from "./store.ts";
import { walk, type Entry } from "./walk.ts";

export const PAGE = 2000;
export const BATCH_NOTES = 50;
export const BATCH_BYTES = 1_000_000;
export const MAX_NOTE_BYTES = 1_000_000;
export const MAX_FILE_BYTES = 52_428_800;
export const BATCH_FILES = 200;
export const BATCH_LINKS = 2000;
export const UPLOAD_BUDGET = 2_000_000_000;

export type RunOptions = {
  root: string;
  cachePath: string;
  store: Store;
  confirmDeletes: boolean;
  now?: () => number;
  uploadBudget?: number;
  log?: (line: string) => void;
};

export type Report = {
  counts: Counts;
  tooBig: string[];
  refusedDeletes: number;
  failed: string[];
  deferred: number;
};

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

/** An object's last part: the name in characters Storage takes in a key. */
export function storageName(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .slice(-200);
  return safe.replace(/^[ .]+/, "") || "file";
}

/** An object's folder, fixed by the file's path and content. */
export function objectKey(path: string, sha256: string): string {
  return sha256Hex(`${path}\n${sha256}`).slice(0, 32);
}

/** The database's `_sync_path_ok`, on the client: a path it refuses would fail every run. */
export function pathOk(path: string): boolean {
  const n = [...path].length;
  return (
    n >= 1 &&
    n <= 4000 &&
    !/(^|\/)\.{1,2}(\/|$)/.test(path) &&
    !path.includes("//") &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("\\")
  );
}

function isReadableDir(root: string): boolean {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function readNote(e: Entry, sha256: string, now: number): NoteUp {
  const parsed = parseNote(readFileSync(e.abs, "utf8"), e.path);
  const dates = noteDates(parsed.frontmatter, e.path, e.mtimeMs, now);
  return {
    path: e.path,
    title: (
      parsed.title ||
      nameOf(e.path).replace(/\.md$/i, "") ||
      "Untitled"
    ).slice(0, 1000),
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    sha256,
    ...(dates.written_at ? { created_at: dates.written_at } : {}),
    ...(dates.modified_at ? { updated_at: dates.modified_at } : {}),
  };
}

const noteBytes = (n: NoteUp): number =>
  utf8(n.title) + utf8(n.body) + utf8(JSON.stringify(n.frontmatter));

/** Batches of at most 50 notes and 1 MB of text; a note that alone is over goes by itself. */
export function noteBatches(notes: NoteUp[]): NoteUp[][] {
  const out: NoteUp[][] = [];
  let cur: NoteUp[] = [];
  let bytes = 0;
  for (const n of notes) {
    const b = noteBytes(n);
    if (cur.length && (cur.length === BATCH_NOTES || bytes + b > BATCH_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(n);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function runOnce(o: RunOptions): Promise<Report> {
  const now = o.now ?? Date.now;
  const budget = o.uploadBudget ?? UPLOAD_BUDGET;
  // A missing folder must never read as "everything was deleted".
  if (!isReadableDir(o.root)) throw new FolderMissing();

  const walked = walk(o.root, loadIgnore(o.root));
  if (walked.unreadable.includes("")) throw new FolderMissing();
  const old = loadCache(o.cachePath);
  const cache: Cache = { version: 1, entries: {} };
  const byPath = new Map<string, Entry>();
  const prints = new Map<string, Cached>();
  const tooBig: string[] = [];
  // Paths still in the vault that this run does not record: an unreadable folder or file,
  // one too big, one the database would refuse, one that failed to upload. An entry also
  // covers everything below it. None of them is ever deleted.
  const unreadable = new Set(walked.unreadable);
  const isKept = (p: string): boolean => {
    if (unreadable.has(p)) return true;
    for (let i = p.indexOf("/"); i !== -1; i = p.indexOf("/", i + 1))
      if (unreadable.has(p.slice(0, i))) return true;
    return false;
  };
  let refused = 0;
  for (const e of walked.entries) {
    if (!pathOk(e.path)) {
      refused++;
      unreadable.add(e.path);
      continue;
    }
    if (e.size > (isNote(e.path) ? MAX_NOTE_BYTES : MAX_FILE_BYTES)) {
      tooBig.push(e.path);
      unreadable.add(e.path);
      continue;
    }
    try {
      const c = await fingerprint(e, old);
      prints.set(e.path, c);
      cache.entries[e.path] = c;
      byPath.set(e.path, e);
    } catch {
      unreadable.add(e.path);
    }
  }
  saveCache(o.cachePath, cache);

  const notes = [...prints]
    .filter(([p]) => isNote(p))
    .map(([path, c]) => ({ path, targets: c.targets ?? [] }));
  const files = [...prints.keys()].filter((p) => !isNote(p));
  const homes = chooseHomes(notes, files);
  const manifest: ManifestEntry[] = [...prints].map(([path, c]) => ({
    path,
    sha256: c.sha256,
    size: c.size,
    ...(isNote(path) ? {} : { home: homes.get(path)! }),
  }));

  const counts: Counts = {
    added: 0,
    changed: 0,
    moved: 0,
    deleted: 0,
    skipped: walked.skipped + refused,
    too_big: tooBig.length,
  };
  const failed: string[] = [];
  let refusedDeletes = 0;
  let deferred = 0;

  const { runId, storagePrefix } = await o.store.openRun(o.confirmDeletes);
  let finishing = false; // finish is called once, whichever way the run ends
  try {
    let plan: PlanResult | null = null;
    const pages = manifest.length ? chunks(manifest, PAGE) : [[]];
    for (let i = 0; i < pages.length; i++) {
      plan = await o.store.plan(runId, pages[i]!, i === pages.length - 1);
    }
    if (!plan) throw new Error("no plan");
    // A move whose source is still on disk (too big, unreadable, refused) is no move: the
    // destination goes up as a new item and the source's row stays.
    const moves = plan.moved.filter((m) => !isKept(m.from));
    const asNew = plan.moved.filter((m) => isKept(m.from)).map((m) => m.to);
    const newPaths = [...plan.new, ...asNew];
    const added = new Set(newPaths);
    const changed = new Set(plan.changed);
    const tally = (path: string, from?: string) => {
      if (from) counts.moved++;
      else if (added.has(path)) counts.added++;
      else if (changed.has(path)) counts.changed++;
    };

    // Notes first, so a file's home note exists when the file is recorded.
    const noteUps: NoteUp[] = [];
    for (const path of [...newPaths, ...plan.changed].filter(isNote)) {
      try {
        noteUps.push(
          readNote(byPath.get(path)!, prints.get(path)!.sha256, now()),
        );
      } catch {
        unreadable.add(path);
      }
    }
    for (const m of moves.filter((x) => isNote(x.to))) {
      try {
        noteUps.push({
          ...readNote(byPath.get(m.to)!, prints.get(m.to)!.sha256, now()),
          from: m.from,
        });
      } catch {
        unreadable.add(m.to);
      }
    }
    for (const batch of noteBatches(noteUps)) {
      const r = await o.store.putNotes(runId, batch);
      const sent = new Map(batch.map((n) => [n.path, n]));
      for (const w of r.written) tally(w.path, sent.get(w.path)?.from);
      failed.push(...r.failed.map((f) => f.path));
    }

    const pairs = notePairs(
      noteUps.map((n) => ({
        path: n.path,
        targets: prints.get(n.path)?.targets ?? [],
      })),
      notes.map((n) => n.path),
    );
    for (const chunk of chunks(pairs, BATCH_LINKS))
      await o.store.linkNotes(runId, chunk);

    // Then files: upload, then record, at most the run's budget of bytes.
    const fileUps: FileUp[] = [];
    let spent = 0;
    for (const path of [...newPaths, ...plan.changed].filter(
      (p) => !isNote(p),
    )) {
      const e = byPath.get(path)!;
      const sha = prints.get(path)!.sha256;
      if (spent + e.size > budget) {
        deferred++;
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(e.abs);
      } catch {
        unreadable.add(path);
        continue;
      }
      if (sha256Hex(bytes) !== sha) {
        unreadable.add(path); // changed while the run read it: the next run takes it
        continue;
      }
      const name = nameOf(path);
      const storage_path = `${storagePrefix}${objectKey(path, sha)}/${storageName(name)}`;
      try {
        await o.store.upload(storage_path, bytes, mimeFor(name));
      } catch (err) {
        if (err instanceof KeyRefused || err instanceof Unreachable) throw err;
        // This file alone failed: leave it for the next run, and go on with the rest.
        failed.push(path);
        unreadable.add(path);
        continue;
      }
      spent += e.size;
      fileUps.push({
        path,
        name,
        size: e.size,
        sha256: sha,
        mime: mimeFor(name),
        home: homes.get(path)!,
        storage_path,
      });
    }
    for (const m of moves.filter((x) => !isNote(x.to))) {
      const name = nameOf(m.to);
      fileUps.push({
        path: m.to,
        name,
        size: byPath.get(m.to)!.size,
        sha256: prints.get(m.to)!.sha256,
        mime: mimeFor(name),
        home: homes.get(m.to)!,
        from: m.from,
      });
    }
    for (const r of plan.rehome) {
      const name = nameOf(r.path);
      fileUps.push({
        path: r.path,
        name,
        size: byPath.get(r.path)!.size,
        sha256: prints.get(r.path)!.sha256,
        mime: mimeFor(name),
        home: r.home,
      });
    }
    for (const batch of chunks(fileUps, BATCH_FILES)) {
      const r = await o.store.putFiles(runId, batch);
      const sent = new Map(batch.map((f) => [f.path, f]));
      for (const w of r.written)
        if (sent.get(w.path)?.storage_path || sent.get(w.path)?.from)
          tally(w.path, sent.get(w.path)?.from);
      failed.push(...r.failed.map((f) => f.path));
    }

    // Deletes last. A too-big or unreadable path is still in the vault: never deleted.
    const gone = plan.gone.filter((p) => !isKept(p));
    if (gone.length) {
      const d = await o.store.deletePaths(runId, gone);
      counts.deleted = d.deleted;
      refusedDeletes = d.refused;
    }
    finishing = true;
    await o.store.finish(
      runId,
      counts,
      tooBig,
      failed.length ? `${failed.length} items failed` : null,
    );
  } catch (e) {
    if (!finishing) {
      const what = e instanceof Error ? e.constructor.name : "unknown";
      await o.store
        .finish(runId, counts, tooBig, `the run stopped: ${what}`)
        .catch(() => {});
    }
    throw e;
  }
  return { counts, tooBig, refusedDeletes, failed, deferred };
}
