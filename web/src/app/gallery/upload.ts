// The browser upload, as three server actions. The bytes go from the browser straight to
// storage through a signed upload link; this side decides the path, the declared type and the
// row. A person may only write under their own member and workspace (storage policy), attach to
// their own note (files_before_insert) and tag their own open upload session in the file's
// workspace (tag_session); this file checks shapes, not permissions. Paths are rebuilt here from
// ids, never taken from the browser, and never returned except inside a signed link.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mimeFor } from "../../gallery/mime";
import type { GalleryFile, Result, UploadStart } from "../../gallery/types";
import { ownHive } from "../own-hive";
import {
  BUCKET,
  FILE_COLUMNS,
  NOTE_COLUMNS,
  thumbsFor,
  toFile,
} from "./load-gallery";
import {
  cleanUploadRequest,
  isUuid,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
} from "./validate";

export { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES };

type Db = Pick<SupabaseClient, "from" | "auth" | "storage" | "rpc">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const UPLOADS_PATH = "Uploads.md";
const UPLOADS_TITLE = "Uploads";
const UPLOADS_BODY = "Files you uploaded in the gallery.";
const FILE_NAME_MAX = 255;
/** A type that says nothing about the content; the row's own type is what the gallery reads. */
const BYTES = "application/octet-stream";

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const first = (res: Res): Row | undefined =>
  Array.isArray(res.data) ? (res.data[0] as Row | undefined) : undefined;

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

/** A storage error has a status in place of a code. */
function storageFailed(what: string, error: unknown): boolean {
  if (!error) return false;
  const e = error as { statusCode?: unknown; message?: unknown };
  console.error(`${what} failed`, e.statusCode, e.message);
  return true;
}

/** One safe path segment, as hive_save_file makes them. */
export const segment = (s: string) =>
  s
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);

/** The name a file is stored under; the same for a name and for the name it was given. */
const storedName = (name: string) => segment(name) || "file";

/** "a.pdf" → "a-2.pdf"; "notes" → "notes-2". */
function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}-${n}${name.slice(dot)}`
    : `${name}-${n}`;
}

/** A batch's own folder, under the member and workspace the storage policy requires. */
const batchDir = (member: string, workspace: string, batch: string) =>
  `${member}/${workspace}/uploads/${batch}`;

/** The caller's user id, as the auth server answers it; null without a session. */
async function me(db: Db): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/** The private Uploads note of the workspace, created when it is not there yet. */
async function uploadsNote(
  db: Db,
  hiveId: string,
  member: string,
  workspace: string,
): Promise<string | null> {
  const find = async (): Promise<string | null | "error"> => {
    const res = (await db
      .from("notes")
      .select("id")
      .eq("workspace_id", workspace)
      .eq("path", UPLOADS_PATH)
      .limit(1)) as Res;
    if (failed("uploads note query", res)) return "error";
    const id = first(res)?.id;
    return isUuid(id) ? id : null;
  };
  const found = await find();
  if (found === "error") return null;
  if (found) return found;
  const made = (await db
    .from("notes")
    .insert({
      hive_id: hiveId,
      member_id: member,
      workspace_id: workspace,
      path: UPLOADS_PATH,
      title: UPLOADS_TITLE,
      visibility: "private",
      body: UPLOADS_BODY,
    })
    .select("id")) as Res;
  if (!failed("uploads note insert", made)) {
    const id = first(made)?.id;
    return isUuid(id) ? id : null;
  }
  // Another upload may have made it first (one path per workspace): read it once more.
  const again = await find();
  return again === "error" ? null : again;
}

/** The workspace the batch goes to and its home note: the one given, or the Uploads note. */
async function destination(
  db: Db,
  hiveId: string,
  member: string,
  noteId: string | null,
): Promise<{ workspace: string; noteId: string } | null> {
  if (noteId) {
    // The session lives in the note's workspace, so its files and the note it ends in agree.
    const res = (await db
      .from("notes")
      .select("id,workspace_id,member_id")
      .eq("id", noteId)
      .limit(1)) as Res;
    if (failed("home note query", res)) return null;
    const note = first(res);
    if (!note || note.member_id !== member || !isUuid(note.workspace_id))
      return null;
    return { workspace: note.workspace_id, noteId };
  }
  const ws = (await db
    .from("workspaces")
    .select("id, member_id")
    .eq("member_id", member)
    .order("created_at", { ascending: true })
    .limit(1)) as Res;
  if (failed("workspaces query", ws)) return null;
  const workspace = first(ws)?.id;
  if (!isUuid(workspace)) return null;
  const uploads = await uploadsNote(db, hiveId, member, workspace);
  return uploads ? { workspace, noteId: uploads } : null;
}

/**
 * Opens an upload batch (an upload session) and signs one upload link per file. Each slot's
 * `name` is the name the file is stored under, which `finishUpload` takes back; two files with
 * the same stored name get distinct ones. A slot is null when its link could not be signed.
 */
export async function startUploadIn(
  db: Db,
  raw: unknown,
): Promise<(UploadStart & { noteId: string }) | null> {
  const req = cleanUploadRequest(raw);
  if (!req) return null;
  const uid = await me(db);
  if (!uid) return null;
  const hive = await ownHive(db, uid);
  if (hive === "error" || hive === null) return null;
  const dest = await destination(db, hive.id, hive.memberId, req.noteId);
  if (!dest) return null;

  const opened = (await db.rpc("upload_session_open", {
    p_workspace: dest.workspace,
  })) as Res;
  if (failed("upload_session_open", opened)) return null;
  const batch = opened.data;
  if (!isUuid(batch)) return null;

  const taken = new Set<string>();
  const names = req.files.map((f) => {
    const base = storedName(f.name);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1)
      name = numbered(base, n);
    taken.add(name.toLowerCase());
    return name;
  });
  const dir = batchDir(hive.memberId, dest.workspace, batch);
  const slots = await Promise.all(
    names.map(async (name) => {
      try {
        const { data, error } = await db.storage
          .from(BUCKET)
          .createSignedUploadUrl(`${dir}/${name}`);
        if (storageFailed("upload signing", error)) return null;
        // Only the link: the token and the path stay here.
        return data?.signedUrl ? { name, url: data.signedUrl } : null;
      } catch (e) {
        console.error(
          "upload signing failed",
          e instanceof Error ? e.name : "",
        );
        return null;
      }
    }),
  );
  return { batch, noteId: dest.noteId, slots };
}

/** The declared type with no parameters, in lower case. */
const baseType = (v: unknown) => text(v).split(";")[0]!.trim().toLowerCase();

/**
 * Records one uploaded file: checks the object is in the batch's folder, at most 50 MB and not
 * stored under a type other than its name's, then inserts its row with the type its name gives.
 * An object whose row cannot be written is removed. A failure to join the folder keeps the file.
 */
export async function finishUploadIn(
  db: Db,
  batch: unknown,
  rawName: unknown,
  noteId: unknown,
  folderId: unknown,
): Promise<GalleryFile | null> {
  if (!isUuid(batch) || !isUuid(noteId)) return null;
  if (folderId !== null && !isUuid(folderId)) return null;
  if (typeof rawName !== "string") return null;
  const trimmed = rawName.trim();
  if (trimmed.length < 1 || trimmed.length > FILE_NAME_MAX) return null;
  const name = storedName(trimmed);

  const uid = await me(db);
  if (!uid) return null;
  const [hive, sessionRes, noteRes] = await Promise.all([
    ownHive(db, uid, { profile: true }),
    db
      .from("sessions")
      .select("id,hive_id,member_id,workspace_id,agent_id,ended_at")
      .eq("id", batch)
      .limit(1) as unknown as Promise<Res>,
    db
      .from("notes")
      .select(NOTE_COLUMNS)
      .eq("id", noteId)
      .limit(1) as unknown as Promise<Res>,
  ]);
  if (hive === "error" || hive === null) return null;
  if (failed("upload session query", sessionRes)) return null;
  const session = first(sessionRes);
  if (
    !session ||
    session.member_id !== hive.memberId ||
    session.agent_id != null ||
    session.ended_at != null ||
    !isUuid(session.workspace_id)
  )
    return null;

  const dir = batchDir(hive.memberId, session.workspace_id, batch);
  const path = `${dir}/${name}`;
  const bucket = db.storage.from(BUCKET);
  const listed = await bucket.list(dir, { search: name });
  if (storageFailed("upload check", listed.error)) return null;
  const object = (listed.data ?? []).find((o) => o.name === name);
  if (!object) return null;
  const meta = (object.metadata ?? {}) as Row;
  const size = typeof meta.size === "number" ? meta.size : -1;
  const mime = mimeFor(name);
  const stored = baseType(meta.mimetype);
  // The storage link serves the object under the type it was stored with, so one stored as
  // something its name does not say (a page named .png) is not kept.
  if (
    size < 0 ||
    size > MAX_UPLOAD_BYTES ||
    (stored !== "" && stored !== BYTES && stored !== mime)
  ) {
    const gone = await bucket.remove([path]);
    storageFailed("removing a refused upload", gone.error);
    return null;
  }

  const inserted = (await db
    .from("files")
    .insert({
      hive_id: session.hive_id,
      member_id: hive.memberId,
      workspace_id: session.workspace_id,
      note_id: noteId,
      storage_path: path,
      name,
      mime,
      size_bytes: size,
      session_id: batch,
    })
    .select(FILE_COLUMNS)) as Res;
  const row = failed("upload row insert", inserted)
    ? undefined
    : first(inserted);
  if (!row) {
    const gone = await bucket.remove([path]);
    storageFailed("removing an unrecorded upload", gone.error);
    return null;
  }

  const fileId = text(row.id);
  const [joined, thumbs] = await Promise.all([
    folderId
      ? (db.from("gallery_folder_files").insert({
          folder_id: folderId,
          file_id: fileId,
        }) as unknown as Promise<Res>)
      : Promise.resolve(null),
    thumbsFor(db, [row]),
  ]);
  const inFolder =
    !!folderId && !!joined && !failed("upload folder join", joined);

  const notes = new Map<string, { title: string; effective: string }>();
  const note = failed("upload note query", noteRes)
    ? undefined
    : first(noteRes);
  if (note && note.id === noteId)
    notes.set(noteId, {
      title: text(note.title),
      effective: text(note.effective),
    });
  return toFile(row, {
    mine: new Set([hive.memberId]),
    names: new Map([[hive.memberId, hive.displayName]]),
    notes,
    thumbs,
    refs: new Map(),
    folders: new Map(inFolder ? [[fileId, [folderId as string]]] : []),
  });
}

/** Ends the batch: its files' session gets its home note and a title, and is closed. */
export async function endUploadIn(
  db: Db,
  batch: unknown,
  noteId: unknown,
): Promise<Result> {
  if (!isUuid(batch) || !isUuid(noteId)) return { ok: false };
  const res = (await db.rpc("upload_session_end", {
    p_session: batch,
    p_note: noteId,
  })) as Res;
  if (failed("upload_session_end", res)) return { ok: false };
  return { ok: true };
}
