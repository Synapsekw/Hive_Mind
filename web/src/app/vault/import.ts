// What the folder import's two server actions do, given a client signed in as the person. The
// actions are public endpoints, so every argument is taken as hostile: its shape and size are
// checked before any query, and the hive and member a row is written under are read from the
// database, never taken from the browser. Who may write where is the database's answer
// (row-level security and its triggers); nothing here decides it. The rules are those of
// `scripts/import-vault.mjs`: one note per path, private, never deleted, sharing never set,
// and a note that is already there is updated only when its title, text, fields or folder
// changed. Only an error's code and message are logged, never a path or a note's text, and
// what the database said is never returned.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BATCH_BYTES,
  BATCH_NOTES,
  MAX_NOTE_BYTES,
  dirOf,
  isNotePath,
  noteBytes,
  textBytes,
  type ImportNote,
} from "../../import/plan";
import type { BatchResult, Outcome, WorkspaceMade } from "../../import/types";
import { isUuid } from "./validate";

export type Db = Pick<SupabaseClient, "from" | "auth">;
export type Res = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

/** The longest title a note is stored with, in characters. */
export const MAX_TITLE_CHARS = 1000;
/** The most a note's fields may weigh as JSON text, in bytes. */
export const MAX_FRONTMATTER_BYTES = 100_000;
/** How deep a note's fields may nest. */
const MAX_DEPTH = 32;
/** A workspace's name, as the database trims and measures it. */
const SPACE = " \t\n\r\f\u000B";
const MAX_NAME_CHARS = 60;

const REFUSED: BatchResult = { ok: false };
const FAILED: WorkspaceMade = { ok: false, reason: "failed" };

/**
 * Logs a failure and says whether there was one. `quiet` is for the two reads whose request
 * names paths: what the API says about such a request may quote it, so only the code is kept.
 */
export function failed(what: string, res: Res, quiet = false): boolean {
  if (!res.error) return false;
  if (quiet) console.error(`${what} failed`, res.error.code);
  else console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

export async function userId(db: Db): Promise<string | null> {
  const { data } = await db.auth.getUser();
  const id = data.user?.id;
  return isUuid(id) ? id : null;
}

export const rows = (res: Res): Record<string, unknown>[] =>
  Array.isArray(res.data)
    ? res.data.filter(
        (r): r is Record<string, unknown> =>
          typeof r === "object" && r !== null && !Array.isArray(r),
      )
    : [];

// ------------------------------------------------------------- the workspace

function trimName(name: string): string {
  let start = 0;
  let end = name.length;
  while (start < end && SPACE.includes(name[start]!)) start++;
  while (end > start && SPACE.includes(name[end - 1]!)) end--;
  return name.slice(start, end);
}

/** The name as the database will store it, or null when it is not 1 to 60 characters. */
export function cleanWorkspaceName(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 1000 || v.includes("\u0000"))
    return null;
  const name = trimName(v);
  // Counted as the database counts: in characters, not in UTF-16 units.
  const length = [...name].length;
  return length >= 1 && length <= MAX_NAME_CHARS ? name : null;
}

/** The database's refusals (20261124110155_workspace_cap.sql), told apart by their words. */
const SAYS_LIMIT = "you already have 20 workspaces";
const SAYS_NAME = [
  "a workspace needs a name",
  "that workspace name is too long",
];
const UNIQUE_VIOLATION = "23505";

/**
 * A new workspace of the person's in the hive the page was showing. The member it belongs to is
 * the person's own in that hive, read now; a person who is not in the hive has none.
 */
export async function createImportWorkspaceIn(
  db: Db,
  hiveId: unknown,
  rawName: unknown,
): Promise<WorkspaceMade> {
  if (!isUuid(hiveId)) return FAILED;
  const name = cleanWorkspaceName(rawName);
  if (name === null) return { ok: false, reason: "name" };
  const uid = await userId(db);
  if (!uid) return FAILED;

  const mine = (await db
    .from("members")
    .select("id")
    .eq("hive_id", hiveId.toLowerCase())
    .eq("user_id", uid)
    .limit(1)) as Res;
  if (failed("import member query", mine)) return FAILED;
  const memberId = rows(mine)[0]?.id;
  if (!isUuid(memberId)) return FAILED;

  const made = (await db
    .from("workspaces")
    .insert({ hive_id: hiveId.toLowerCase(), member_id: memberId, name })
    .select("id")) as Res;
  if (made.error) {
    failed("import workspace insert", made);
    const said = String(made.error.message ?? "");
    if (made.error.code === UNIQUE_VIOLATION)
      return { ok: false, reason: "taken" };
    if (said.includes(SAYS_LIMIT)) return { ok: false, reason: "limit" };
    if (SAYS_NAME.some((s) => said.includes(s)))
      return { ok: false, reason: "name" };
    return FAILED;
  }
  const id = rows(made)[0]?.id;
  if (!isUuid(id)) {
    console.error("import workspace answer has an unexpected shape");
    return FAILED;
  }
  return { ok: true, id };
}

// ----------------------------------------------------------------- the notes

/** A value JSON can hold and the database can store, no deeper than `MAX_DEPTH`. */
function isJson(v: unknown, depth: number): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean")
    return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "object" || depth >= MAX_DEPTH) return false;
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  return (
    isPlainObject(v) && Object.values(v).every((x) => isJson(x, depth + 1))
  );
}

/** An object written as `{…}`: not an array, a Date, a Map or anything with a class. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

type Checked = {
  note: ImportNote;
  dir: string | null;
  /** False for a note that is well formed but too big to store: it fails by itself. */
  storable: boolean;
};

/**
 * The batch rebuilt from known keys only, or null when anything about it is malformed: then
 * nothing is read or written.
 */
export function cleanBatch(raw: unknown): Checked[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > BATCH_NOTES)
    return null;
  const out: Checked[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const item of raw as unknown[]) {
    if (!isPlainObject(item)) return null;
    const { path, title, body, frontmatter } = item;
    if (!isNotePath(path) || seen.has(path)) return null;
    seen.add(path);
    if (typeof title !== "string" || title.length < 1) return null;
    if (typeof body !== "string") return null;
    // Cheap before exact: a text is never more bytes than three times its length.
    if (body.length > MAX_NOTE_BYTES || textBytes(body) > MAX_NOTE_BYTES)
      return null;
    if (!isPlainObject(frontmatter) || !isJson(frontmatter, 0)) return null;
    const note: ImportNote = { path, title, body, frontmatter };
    total += noteBytes(note);
    if (total > BATCH_BYTES) return null;
    out.push({
      note,
      dir: dirOf(path),
      storable:
        title.length <= MAX_TITLE_CHARS &&
        textBytes(JSON.stringify(frontmatter)) <= MAX_FRONTMATTER_BYTES,
    });
  }
  return out;
}

/** JSON text with every object's keys in order, so two sets of fields compare by content. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : 1,
          ),
        )
      : x,
  );
}

/** A list of texts as the API's `in` filter takes it: each one quoted, quotes and backslashes escaped. */
function inList(values: string[]): string {
  return `(${values
    .map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")})`;
}

/** The workspace's folder rows at these paths, by path; null when they cannot be read. */
async function foldersAt(
  db: Db,
  workspaceId: string,
  dirs: string[],
): Promise<Map<string, string> | null> {
  const res = (await db
    .from("folders")
    .select("id, path")
    .eq("workspace_id", workspaceId)
    .filter("path", "in", inList(dirs))) as Res;
  if (failed("import folders query", res, true) || !Array.isArray(res.data))
    return null;
  const known = new Set(dirs);
  const out = new Map<string, string>();
  for (const r of rows(res))
    if (typeof r.path === "string" && known.has(r.path) && isUuid(r.id))
      out.set(r.path, r.id);
  return out;
}

/**
 * The workspace's hive and member when the workspace is the signed-in person's own, else null.
 * `wsId` is a uuid in lower case. The hive and the member come from the workspace's own row,
 * which row-level security answers only to its owner, and that member is then read as one of
 * the person's own. The import and the connecting of wiki links both start here.
 */
export async function ownWorkspace(
  db: Db,
  wsId: string,
  uid: string,
): Promise<{ hiveId: string; memberId: string } | null> {
  const ws = (await db
    .from("workspaces")
    .select("id, hive_id, member_id")
    .eq("id", wsId)
    .limit(1)) as Res;
  if (failed("import workspace query", ws)) return null;
  const space = rows(ws)[0];
  if (!space || !isUuid(space.hive_id) || !isUuid(space.member_id)) return null;
  if (typeof space.id !== "string" || space.id.toLowerCase() !== wsId)
    return null;
  const hiveId = space.hive_id;
  const memberId = space.member_id;
  const member = (await db
    .from("members")
    .select("id, hive_id")
    .eq("id", memberId)
    .eq("user_id", uid)
    .limit(1)) as Res;
  if (failed("import member query", member)) return null;
  const own = rows(member)[0];
  if (
    !own ||
    own.id !== memberId ||
    typeof own.hive_id !== "string" ||
    own.hive_id.toLowerCase() !== hiveId.toLowerCase()
  ) {
    console.error("import refused: the workspace is not the person's own");
    return null;
  }
  return { hiveId, memberId };
}

/**
 * One batch of an import into one of the person's workspaces: at most 25 notes and 3 MB. It
 * answers one outcome per path, in the order sent, or `{ ok: false }` when the batch is
 * malformed, there is no session, or the workspace or its notes cannot be read; then nothing
 * was written.
 */
export async function importBatchIn(
  db: Db,
  workspaceId: unknown,
  raw: unknown,
): Promise<BatchResult> {
  if (!isUuid(workspaceId)) return REFUSED;
  let batch: Checked[] | null;
  try {
    batch = cleanBatch(raw);
  } catch {
    // Something that cannot even be measured.
    batch = null;
  }
  if (batch === null) return REFUSED;
  const uid = await userId(db);
  if (!uid) return REFUSED;
  const wsId = workspaceId.toLowerCase();
  const own = await ownWorkspace(db, wsId, uid);
  if (own === null) return REFUSED;
  const { hiveId, memberId } = own;

  const outcome = new Map<string, Outcome>();
  const live = batch.filter((c) => {
    if (!c.storable) outcome.set(c.note.path, "failed");
    return c.storable;
  });
  const answer = (): BatchResult => ({
    ok: true,
    outcomes: batch.map((c) => ({
      path: c.note.path,
      outcome: outcome.get(c.note.path) ?? "failed",
    })),
  });
  if (live.length === 0) return answer();

  // The notes already at these paths.
  const found = (await db
    .from("notes")
    .select("id, path, title, body, frontmatter, folder_id")
    .eq("workspace_id", wsId)
    .filter("path", "in", inList(live.map((c) => c.note.path)))) as Res;
  if (failed("import notes query", found, true) || !Array.isArray(found.data))
    return REFUSED;
  const existing = new Map<string, Record<string, unknown>>();
  for (const r of rows(found))
    if (typeof r.path === "string" && isUuid(r.id)) existing.set(r.path, r);

  // Folder rows, as the script makes them: one for the folder each note sits in, not for the
  // folders above it.
  const dirs = [...new Set(live.flatMap((c) => (c.dir ? [c.dir] : [])))];
  let folders = new Map<string, string>();
  if (dirs.length > 0) {
    const read = await foldersAt(db, wsId, dirs);
    if (read === null) return REFUSED;
    folders = read;
    const missing = dirs.filter((d) => !folders.has(d));
    if (missing.length > 0) {
      const made = (await db
        .from("folders")
        .insert(
          missing.map((path) => ({
            workspace_id: wsId,
            member_id: memberId,
            path,
          })),
        )
        .select("id, path")) as Res;
      if (failed("import folders insert", made)) {
        // Another import may have made one of them meanwhile: read once more, and the notes
        // whose folder is still not there fail below.
        folders = (await foldersAt(db, wsId, dirs)) ?? folders;
      } else {
        const asked = new Set(missing);
        for (const r of rows(made))
          if (typeof r.path === "string" && asked.has(r.path) && isUuid(r.id))
            folders.set(r.path, r.id);
      }
    }
  }

  const toCreate: Record<string, unknown>[] = [];
  for (const { note, dir } of live) {
    const folderId = dir ? folders.get(dir) : null;
    if (folderId === undefined) {
      outcome.set(note.path, "failed");
      continue;
    }
    const old = existing.get(note.path);
    if (!old) {
      toCreate.push({
        hive_id: hiveId,
        member_id: memberId,
        workspace_id: wsId,
        path: note.path,
        title: note.title,
        body: note.body,
        frontmatter: note.frontmatter,
        folder_id: folderId,
      });
      continue;
    }
    const same =
      old.title === note.title &&
      old.body === note.body &&
      stable(old.frontmatter) === stable(note.frontmatter) &&
      (old.folder_id ?? null) === folderId;
    if (same) {
      outcome.set(note.path, "unchanged");
      continue;
    }
    const id = old.id as string;
    const res = (await db
      .from("notes")
      .update({
        title: note.title,
        body: note.body,
        frontmatter: note.frontmatter,
        folder_id: folderId,
      })
      .eq("id", id)
      .select("id")) as Res;
    const changed =
      !failed("import note update", res) &&
      rows(res).length === 1 &&
      rows(res)[0]!.id === id;
    outcome.set(note.path, changed ? "updated" : "failed");
  }

  if (toCreate.length > 0) {
    const all = (await db.from("notes").insert(toCreate)) as Res;
    if (!failed("import notes insert", all)) {
      for (const n of toCreate) outcome.set(n.path as string, "created");
    } else {
      // Find the note the database refused; the others still go in.
      for (const n of toCreate) {
        const one = (await db.from("notes").insert([n])) as Res;
        outcome.set(
          n.path as string,
          failed("import note insert", one) ? "failed" : "created",
        );
      }
    }
  }
  return answer();
}
