// The import's pure steps: what the folder picker gave, as paths inside the picked folder, and
// the running count of what the server answered. No reading of files and no requests here.
import type { Picked } from "../import/plan";
import type { BatchResult } from "../import/types";

/** What the browser reports for one picked file. */
export type FromPicker = { relativePath: string; size: number };

export type Folder<T> = {
  /** False when the browser gave no relative paths: a folder cannot be imported there. */
  supported: boolean;
  /** The picked folder's own name; "" when unknown. */
  name: string;
  /** The files by their path inside the picked folder, in path order. */
  files: { path: string; size: number; file: T }[];
};

/**
 * The picked files with the picked folder's own name taken off the front of each path
 * ("Notes/a/b.md" is "a/b.md" in the folder "Notes"). A file without a relative path, or one
 * that is not inside a folder, is left out.
 */
export function inFolder<T extends FromPicker>(
  picked: readonly T[],
): Folder<T> {
  let name = "";
  const files: Folder<T>["files"] = [];
  for (const file of picked) {
    const parts = file.relativePath.split("/");
    if (parts.length < 2 || parts[0] === "") continue;
    name ||= parts[0]!;
    files.push({ path: parts.slice(1).join("/"), size: file.size, file });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { supported: picked.length === 0 || files.length > 0, name, files };
}

export const asPicked = (files: Folder<unknown>["files"]): Picked[] =>
  files.map((f) => ({ path: f.path, size: f.size }));

/** What has been answered so far. `failed` holds the paths, in the order they failed. */
export type Tally = {
  created: number;
  updated: number;
  unchanged: number;
  failed: string[];
};

export const emptyTally = (): Tally => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  failed: [],
});

/** How many notes have an answer, whatever it was. */
export const handled = (t: Tally) =>
  t.created + t.updated + t.unchanged + t.failed.length;

/**
 * The tally with one batch added. A batch that was refused (`{ ok: false }`) or never answered
 * (`null`) fails every note in it; so does a path the answer says nothing about. An answer
 * about a path that was not sent is ignored.
 */
export function addBatch(
  t: Tally,
  paths: readonly string[],
  result: BatchResult | null,
): Tally {
  const next: Tally = { ...t, failed: [...t.failed] };
  const answers = new Map(
    result?.ok ? result.outcomes.map((o) => [o.path, o.outcome]) : [],
  );
  for (const path of paths) {
    const outcome = answers.get(path);
    if (outcome === "created") next.created += 1;
    else if (outcome === "updated") next.updated += 1;
    else if (outcome === "unchanged") next.unchanged += 1;
    else next.failed.push(path);
  }
  return next;
}

/** The next paths to read together: at most `maxNotes`, and `maxBytes` unless one alone is larger. */
export function nextChunk(
  paths: readonly string[],
  from: number,
  sizeOf: (path: string) => number,
  maxNotes: number,
  maxBytes: number,
): string[] {
  const chunk: string[] = [];
  let bytes = 0;
  for (let i = from; i < paths.length && chunk.length < maxNotes; i++) {
    const size = sizeOf(paths[i]!);
    if (chunk.length > 0 && bytes + size > maxBytes) break;
    chunk.push(paths[i]!);
    bytes += size;
  }
  return chunk;
}
