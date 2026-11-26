// What `/gallery` reads, given a client signed in as the person. Row-level security decides
// every row; nothing here decides who may see a file. A file's place in storage is read to sign
// its thumbnail and stops here: `toFile` builds what the browser gets from named values only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDF_THUMB_MAX, THUMB_MAX } from "../../gallery/kind";
import type {
  Cursor,
  GalleryData,
  GalleryFile,
  GalleryFolder,
  GalleryPage,
  GallerySession,
  Kind,
  NoteRef,
  ServerFilter,
} from "../../gallery/types";
import { ownHive, sessionUserId } from "../own-hive";

export type GalleryLoad =
  | { state: "ok"; data: GalleryData }
  | { state: "no-hive" }
  | { state: "error" };

type Db = Pick<SupabaseClient, "from" | "auth" | "storage">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The file index. `storage_path`, `workspace_id` and `member_id` are used here and not returned. */
export const FILE_COLUMNS =
  "id,member_id,workspace_id,note_id,storage_path,name,mime,size_bytes,created_at,kind,session_id,vault_path";
export const NOTE_COLUMNS = "id,title,member_id,effective:note_visibility";
/** Never `client_key`: it is the agent's own handle on the session. */
const SESSION_COLUMNS =
  "id,title,agent_name,started_at,ended_at,note_id,member_id";

export const BUCKET = "files";
/** Signed links live ten minutes. */
export const LINK_SECONDS = 600;
const PAGE = 200;
const IDS_PER_REQUEST = 50;
/** The most folder memberships the first page reads; a person with more sees the newest files'. */
const MEMBERSHIPS = 5000;
const FOLDERS = 1000;
const OPEN_SESSION = "Open session";

/** No server filter: the newest files of the hive. */
export const NO_FILTER: ServerFilter = {
  kinds: [],
  session: null,
  owner: null,
  agent: null,
  folder: null,
  from: null,
  to: null,
};

const KINDS = new Set<Kind>([
  "image",
  "pdf",
  "slides",
  "sheet",
  "doc",
  "text",
  "csv",
  "other",
]);

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const rows = (res: Res): Row[] => (Array.isArray(res.data) ? res.data : []);
const chunks = <T>(all: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += IDS_PER_REQUEST)
    out.push(all.slice(i, i + IDS_PER_REQUEST));
  return out;
};

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

/** The stored kind; a value the gallery does not know is shown as "other". */
export function kindOf(r: Row): Kind {
  const k = r.kind;
  return typeof k === "string" && KINDS.has(k as Kind) ? (k as Kind) : "other";
}

type NoteInfo = { title: string; effective: string };

/** What a page of rows is read against: whose they are and what could be looked up for them. */
export type Context = {
  /** The caller's own member ids. */
  mine: ReadonlySet<string>;
  /** Member id to display name. */
  names: ReadonlyMap<string, string>;
  /** The attached notes the caller may read, by id. */
  notes: ReadonlyMap<string, NoteInfo>;
  /** Storage path to signed thumbnail link. */
  thumbs: ReadonlyMap<string, string>;
  /** File id to the notes referencing it that the caller may read. */
  refs?: ReadonlyMap<string, NoteRef[]>;
  /** File id to the caller's folders holding it. */
  folders?: ReadonlyMap<string, string[]>;
};

/** True when the row is an image up to 2 MB or a PDF up to 5 MB, shown as its own thumbnail. */
export function hasThumb(r: Row): boolean {
  const size = r.size_bytes;
  if (typeof size !== "number" || size < 0) return false;
  const kind = kindOf(r);
  return (
    (kind === "image" && size <= THUMB_MAX) ||
    (kind === "pdf" && size <= PDF_THUMB_MAX)
  );
}

/** A file row as the gallery shows it. */
export function toFile(r: Row, ctx: Context): GalleryFile {
  const id = text(r.id);
  const owner = text(r.member_id);
  const mine = ctx.mine.has(owner);
  const noteId = text(r.note_id);
  const found = noteId ? ctx.notes.get(noteId) : undefined;
  const shared = found?.effective === "group" || found?.effective === "members";
  const size = r.size_bytes;
  return {
    id,
    name: text(r.name),
    kind: kindOf(r),
    size:
      typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0,
    created_at: text(r.created_at),
    owner: ctx.names.get(owner) ?? "",
    owner_id: owner,
    mine,
    note: found ? { id: noteId, title: found.title } : null,
    sharing: !mine ? "shared-with-me" : shared ? "through-note" : "private",
    thumb: (hasThumb(r) && ctx.thumbs.get(text(r.storage_path))) || null,
    session_id: text(r.session_id) || null,
    // Only the caller's own files say so; a colleague's are sent as plain files.
    fromVault: mine && typeof r.vault_path === "string",
    refs: ctx.refs?.get(id) ?? [],
    folders: ctx.folders?.get(id) ?? [],
  };
}

/** The notes of these ids the caller may read; null when a query failed. */
export async function notesFor(
  db: Db,
  ids: string[],
): Promise<Map<string, NoteInfo> | null> {
  const notes = new Map<string, NoteInfo>();
  const distinct = [...new Set(ids.filter(Boolean))];
  if (distinct.length === 0) return notes;
  // In parallel requests of IDS_PER_REQUEST: 200 ids in one request line come within a few
  // hundred bytes of the 8 KB a gateway may refuse.
  const answers = await Promise.all(
    chunks(distinct).map(
      (chunk) =>
        db
          .from("notes")
          .select(NOTE_COLUMNS)
          .in("id", chunk) as unknown as Promise<Res>,
    ),
  );
  for (const res of answers) {
    if (failed("notes query", res)) return null;
    for (const n of rows(res))
      notes.set(text(n.id), {
        title: text(n.title),
        effective: text(n.effective),
      });
  }
  return notes;
}

/**
 * The notes referencing each file that the caller may read. A note the caller may not read comes
 * back as no note and is left out. A failure costs the references, not the page.
 */
async function refsFor(
  db: Db,
  fileIds: string[],
): Promise<Map<string, NoteRef[]>> {
  const refs = new Map<string, NoteRef[]>();
  if (fileIds.length === 0) return refs;
  const answers = await Promise.all(
    chunks(fileIds).map(
      (chunk) =>
        db
          .from("file_references")
          .select("file_id, notes(id,title)")
          .in("file_id", chunk) as unknown as Promise<Res>,
    ),
  );
  for (const res of answers) {
    if (failed("references query", res)) return new Map();
    for (const r of rows(res)) {
      const n = r.notes;
      if (typeof n !== "object" || n === null || Array.isArray(n)) continue;
      const note = n as Row;
      const id = text(note.id);
      if (!id) continue;
      const fileId = text(r.file_id);
      const list = refs.get(fileId) ?? [];
      list.push({ id, title: text(note.title) });
      refs.set(fileId, list);
    }
  }
  for (const list of refs.values())
    list.sort((a, b) => a.title.localeCompare(b.title));
  return refs;
}

/** The sessions of these ids the caller may read; a failure costs the sessions, not the page. */
async function sessionsFor(db: Db, ids: string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  const answers = await Promise.all(
    chunks(ids).map(
      (chunk) =>
        db
          .from("sessions")
          .select(SESSION_COLUMNS)
          .in("id", chunk) as unknown as Promise<Res>,
    ),
  );
  const out: Row[] = [];
  for (const res of answers) {
    if (failed("sessions query", res)) return [];
    out.push(...rows(res));
  }
  return out;
}

function toSession(
  r: Row,
  mine: ReadonlySet<string>,
  notes: ReadonlyMap<string, NoteInfo>,
): GallerySession {
  const noteId = text(r.note_id);
  const note = noteId ? notes.get(noteId) : undefined;
  return {
    id: text(r.id),
    title: text(r.title) || OPEN_SESSION,
    agent: text(r.agent_name),
    started_at: text(r.started_at),
    ended_at: text(r.ended_at) || null,
    note: note ? { id: noteId, title: note.title } : null,
    mine: mine.has(text(r.member_id)),
  };
}

/** One storage call signing every thumbnail. A failure costs the thumbnails, not the page. */
export async function thumbsFor(
  db: Db,
  files: Row[],
): Promise<Map<string, string>> {
  const thumbs = new Map<string, string>();
  const paths = files
    .filter(hasThumb)
    .map((f) => text(f.storage_path))
    .filter(Boolean);
  if (paths.length === 0) return thumbs;
  try {
    const { data, error } = await db.storage
      .from(BUCKET)
      .createSignedUrls(paths, LINK_SECONDS);
    if (error) {
      console.error(
        "thumbnail signing failed",
        (error as { statusCode?: unknown }).statusCode,
        error.message,
      );
      return thumbs;
    }
    for (const s of data ?? [])
      if (!s.error && s.path && s.signedUrl) thumbs.set(s.path, s.signedUrl);
  } catch (e) {
    console.error("thumbnail signing failed", e instanceof Error ? e.name : "");
  }
  return thumbs;
}

/**
 * A page of the caller's own hive, newest first, in at most four bounded waves:
 * 1. the hive (the person's own membership);
 * 2. in parallel: its members, the caller's user, up to 201 files (the 201st only says that more
 *    exist) and, for the first page, the caller's folders and folder memberships;
 * 3. in parallel over the 200 shown files: their home notes, references, sessions and one
 *    thumbnail signing call;
 * 4. the titles of the sessions' notes not already read, when there are any.
 */
async function page(
  db: Db,
  filter: ServerFilter,
  cursor: Cursor | null,
  first: boolean,
): Promise<GalleryLoad> {
  const hive = await ownHive(db);
  if (hive === "error") return { state: "error" };
  if (hive === null) return { state: "no-hive" };
  const hiveId = hive.id;

  // The agent and folder filters are embedded inner joins on the same one read: a file whose
  // session the caller may read with that agent name, or that the caller's own folder holds
  // (row-level security decides both). Neither bounds how many files match; the page is 200.
  let columns = FILE_COLUMNS;
  if (filter.agent) columns += ",sessions!inner(agent_name)";
  if (filter.folder) columns += ",gallery_folder_files!inner(folder_id)";
  let index = db.from("files").select(columns).eq("hive_id", hiveId);
  if (filter.kinds.length) index = index.in("kind", filter.kinds);
  if (filter.session) index = index.eq("session_id", filter.session);
  if (filter.owner) index = index.eq("member_id", filter.owner);
  if (filter.agent) index = index.eq("sessions.agent_name", filter.agent);
  if (filter.folder)
    index = index.eq("gallery_folder_files.folder_id", filter.folder);
  if (filter.from) index = index.gte("created_at", filter.from);
  if (filter.to) index = index.lt("created_at", filter.to);
  // Keyset: strictly after the last file shown, in the same (created_at, id) order.
  if (cursor)
    index = index.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  const filesRead = index
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE + 1) as unknown as Promise<Res>;

  const none: Promise<Res> = Promise.resolve({ data: [], error: null });
  const [members, user, files, folders, memberships] = await Promise.all([
    db
      .from("members")
      .select("id, display_name, user_id")
      .eq("hive_id", hiveId) as unknown as Promise<Res>,
    sessionUserId(db),
    filesRead,
    first
      ? (db
          .from("gallery_folders")
          .select("id,name,parent_id")
          .eq("member_id", hive.memberId)
          .order("created_at", { ascending: true })
          .limit(FOLDERS) as unknown as Promise<Res>)
      : none,
    // Owner only: these are the caller's own memberships. A file goes only into a folder of
    // its own hive, so one of another hive names no file here.
    db
      .from("gallery_folder_files")
      .select("folder_id,file_id")
      .order("added_at", { ascending: false })
      .limit(MEMBERSHIPS) as unknown as Promise<Res>,
  ]);
  if (failed("members query", members)) return { state: "error" };
  if (failed("files query", files)) return { state: "error" };
  if (failed("folders query", folders)) return { state: "error" };
  if (failed("folder memberships query", memberships))
    return { state: "error" };

  const userId = user;
  if (!userId) return { state: "error" };
  const memberRows = rows(members);
  const mine = new Set(
    memberRows.filter((m) => m.user_id === userId).map((m) => text(m.id)),
  );
  if (mine.size === 0) return { state: "error" };
  const names = new Map(
    memberRows.map((m) => [text(m.id), text(m.display_name)]),
  );

  const inFolders = new Map<string, string[]>();
  const pairs: { folder_id: string; file_id: string }[] = [];
  for (const m of rows(memberships)) {
    const fileId = text(m.file_id);
    const folderId = text(m.folder_id);
    if (!fileId || !folderId) continue;
    pairs.push({ folder_id: folderId, file_id: fileId });
    (inFolders.get(fileId) ?? inFolders.set(fileId, []).get(fileId)!).push(
      folderId,
    );
  }

  const all = rows(files);
  const shown = all.slice(0, PAGE);
  // A folder-filtered file is in that folder even when its membership is older than the
  // MEMBERSHIPS read.
  for (const f of shown) {
    const embedded = f.gallery_folder_files;
    if (!Array.isArray(embedded)) continue;
    const fileId = text(f.id);
    const list = inFolders.get(fileId) ?? [];
    for (const m of embedded as Row[]) {
      const folderId = text(m.folder_id);
      if (folderId && !list.includes(folderId)) list.push(folderId);
    }
    if (list.length) inFolders.set(fileId, list);
  }
  const sessionIds = [
    ...new Set(shown.map((f) => text(f.session_id)).filter(Boolean)),
  ];
  const [notes, refs, sessionRows, thumbs] = await Promise.all([
    notesFor(
      db,
      shown.map((f) => text(f.note_id)),
    ),
    refsFor(
      db,
      shown.map((f) => text(f.id)),
    ),
    sessionsFor(db, sessionIds),
    thumbsFor(db, shown),
  ]);
  if (!notes) return { state: "error" };

  // The sessions' notes not read with the files'. A failure here costs those notes' titles.
  const missing = sessionRows
    .map((s) => text(s.note_id))
    .filter((id) => id && !notes.has(id));
  if (missing.length) {
    const more = await notesFor(db, missing);
    for (const [id, n] of more ?? []) notes.set(id, n);
  }

  const last = shown[shown.length - 1];
  return {
    state: "ok",
    data: {
      files: shown.map((r) =>
        toFile(r, { mine, names, notes, thumbs, refs, folders: inFolders }),
      ),
      sessions: sessionRows.map((s) => toSession(s, mine, notes)),
      folders: rows(folders).map((f): GalleryFolder => ({
        id: text(f.id),
        name: text(f.name),
        parent_id: text(f.parent_id) || null,
      })),
      members: memberRows.map((m) => ({
        id: text(m.id),
        name: text(m.display_name),
      })),
      memberships: first ? pairs : [],
      next:
        all.length > PAGE && last
          ? { created_at: text(last.created_at), id: text(last.id) }
          : null,
    },
  };
}

/** Everything `/gallery` shows first: the newest 200 files the caller may read, and their context. */
export function loadGallery(db: Db): Promise<GalleryLoad> {
  return page(db, NO_FILTER, null, true);
}

/**
 * Up to 200 files matching `filter`, after `cursor` when given; both have already passed
 * through their `clean*` check. It is its own request, so the hive, its members and the user
 * are read again. Null on any failure.
 */
export async function loadPage(
  db: Db,
  filter: ServerFilter,
  cursor: Cursor | null,
): Promise<GalleryPage | null> {
  const out = await page(db, filter, cursor, false);
  if (out.state !== "ok") return null;
  const { files, sessions, next } = out.data;
  return { files, sessions, next };
}
