// What a picked folder will import, and how its notes travel: pure, no I/O, and it runs in the
// browser (no `node:` import). The server checks every batch again with the same rules
// (`isNotePath`, `noteBytes` and the limits below), so what this lets through is what the
// server accepts.

/** The most notes one import takes; over that the screen asks for a subfolder. */
export const MAX_NOTES = 2000;
/** The largest file that is imported, in bytes, as in the importer script. */
export const MAX_NOTE_BYTES = 1_000_000;
/** The most notes in one request. */
export const BATCH_NOTES = 25;
/** The most bytes in one request, measured by `noteBytes`. */
export const BATCH_BYTES = 3_000_000;
/** The longest path of a note, in characters. */
export const MAX_PATH_CHARS = 500;

/** A picked file: its path relative to the picked folder, "/" separated, and its size in bytes. */
export type Picked = { path: string; size: number };

export type Plan = {
  /** The paths that will be imported, sorted. */
  notes: string[];
  /** Files that are not markdown notes, or whose path cannot be a note's. */
  skippedOther: number;
  /** Notes over 1 MB, by path. */
  tooLarge: string[];
  /** Files under a part that begins with a dot (`.obsidian`, `.git`, `.trash`). */
  hidden: number;
  /** More than `MAX_NOTES` notes: nothing should be sent. */
  tooMany: boolean;
};

export type ImportNote = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
};

/** The parts of a path that could be a file's inside a folder, or null: no backslash, no NUL, no
 * leading or trailing slash, no empty, "." or ".." part, 1 to 500 characters. */
function parts(path: unknown): string[] | null {
  if (typeof path !== "string") return null;
  if (path.length < 1 || path.length > MAX_PATH_CHARS) return null;
  if (path.includes("\\") || path.includes("\u0000")) return null;
  const all = path.split("/");
  if (all.some((p) => p === "" || p === "." || p === "..")) return null;
  return all;
}

const isMarkdown = (path: string) => /\.md$/i.test(path);

/**
 * True for a path a note may be stored at: "/" separated, relative, at most 500 characters,
 * no empty, "." or ".." part, no part that begins with a dot, no backslash, no NUL, and it ends
 * in `.md` (any case). The server refuses a batch that holds any other path.
 */
export function isNotePath(path: unknown): path is string {
  const all = parts(path);
  return (
    all !== null &&
    !all.some((p) => p.startsWith(".")) &&
    isMarkdown(path as string)
  );
}

/** The folder a note sits in, or null for a note at the top. */
export function dirOf(path: string): string | null {
  const at = path.lastIndexOf("/");
  return at < 0 ? null : path.slice(0, at);
}

export function planImport(files: Picked[]): Plan {
  const plan: Plan = {
    notes: [],
    skippedOther: 0,
    tooLarge: [],
    hidden: 0,
    tooMany: false,
  };
  const seen = new Set<string>();
  for (const file of files) {
    const all = parts(file?.path);
    if (all === null) {
      plan.skippedOther++;
      continue;
    }
    if (all.some((p) => p.startsWith("."))) {
      plan.hidden++;
      continue;
    }
    // A path given twice is one file: the second is not a note of its own.
    if (!isMarkdown(file.path) || seen.has(file.path)) {
      plan.skippedOther++;
      continue;
    }
    seen.add(file.path);
    // A size that is not a number is not let through as small.
    if (!(typeof file.size === "number" && file.size <= MAX_NOTE_BYTES)) {
      plan.tooLarge.push(file.path);
      continue;
    }
    plan.notes.push(file.path);
  }
  plan.notes.sort();
  plan.tooLarge.sort();
  plan.tooMany = plan.notes.length > MAX_NOTES;
  return plan;
}

const encoder = new TextEncoder();

/** The bytes of a text as UTF-8. */
export function textBytes(text: string): number {
  return encoder.encode(text).length;
}

/**
 * What a note weighs in a request: the bytes of its JSON text, so the quotes, newlines and
 * control characters that are escaped on the way count as what they become.
 */
export function noteBytes(note: ImportNote): number {
  return textBytes(
    JSON.stringify({
      path: note.path,
      title: note.title,
      body: note.body,
      frontmatter: note.frontmatter,
    }),
  );
}

/**
 * The notes in the order given, cut into requests of at most `BATCH_NOTES` notes and
 * `BATCH_BYTES` bytes. A single note over the byte limit travels alone.
 */
export function batches(notes: ImportNote[]): ImportNote[][] {
  const out: ImportNote[][] = [];
  let batch: ImportNote[] = [];
  let bytes = 0;
  for (const note of notes) {
    const size = noteBytes(note);
    if (
      batch.length > 0 &&
      (batch.length >= BATCH_NOTES || bytes + size > BATCH_BYTES)
    ) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(note);
    bytes += size;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}
