// What `/gallery` reads, given a client signed in as the person. Row-level security decides
// every row; nothing here decides who may see a file. A file's place in storage is read to sign
// its thumbnail and stops here: `toFile` builds what the browser gets from named values only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileKind, THUMB_MAX } from "../../gallery/kind";
import type {
  Cursor,
  GalleryData,
  GalleryFile,
  GalleryPage,
} from "../../gallery/types";

export type GalleryLoad =
  | { state: "ok"; data: GalleryData }
  | { state: "no-hive" }
  | { state: "error" };

type Db = Pick<SupabaseClient, "from" | "auth" | "storage">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The file index. `storage_path`, `workspace_id` and `member_id` are used here and not returned. */
export const FILE_COLUMNS =
  "id,member_id,workspace_id,note_id,storage_path,name,mime,size_bytes,created_at";
const NOTE_COLUMNS = "id,title,member_id,effective:note_visibility";

export const BUCKET = "files";
/** Signed links live ten minutes. */
export const LINK_SECONDS = 600;
const PAGE = 200;
const NOTE_IDS_PER_REQUEST = 50;

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const rows = (res: Res): Row[] => (Array.isArray(res.data) ? res.data : []);

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

/** What a page of rows is read against: whose they are and what could be looked up for them. */
export type Context = {
  /** The caller's own member ids. */
  mine: ReadonlySet<string>;
  /** Member id to display name. */
  names: ReadonlyMap<string, string>;
  /** The attached notes the caller may read, by id. */
  notes: ReadonlyMap<string, { title: string; effective: string }>;
  /** Storage path to signed thumbnail link. */
  thumbs: ReadonlyMap<string, string>;
};

/** True when the row is an image small enough to be shown as its own thumbnail. */
function hasThumb(r: Row): boolean {
  return (
    typeof r.size_bytes === "number" &&
    r.size_bytes >= 0 &&
    r.size_bytes <= THUMB_MAX &&
    fileKind(text(r.name), typeof r.mime === "string" ? r.mime : null) ===
      "image"
  );
}

/** A file row as the gallery shows it. */
export function toFile(r: Row, ctx: Context): GalleryFile {
  const name = text(r.name);
  const owner = text(r.member_id);
  const mine = ctx.mine.has(owner);
  const noteId = text(r.note_id);
  const found = noteId ? ctx.notes.get(noteId) : undefined;
  const shared = found?.effective === "group" || found?.effective === "members";
  const size = r.size_bytes;
  return {
    id: text(r.id),
    name,
    kind: fileKind(name, typeof r.mime === "string" ? r.mime : null),
    size:
      typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0,
    created_at: text(r.created_at),
    owner: ctx.names.get(owner) ?? "",
    mine,
    note: found ? { id: noteId, title: found.title } : null,
    sharing: !mine ? "shared-with-me" : shared ? "through-note" : "private",
    thumb: (hasThumb(r) && ctx.thumbs.get(text(r.storage_path))) || null,
  };
}

/** The attached notes the caller may read; null when the query failed. */
async function notesFor(
  db: Db,
  files: Row[],
): Promise<Context["notes"] | null> {
  const ids = [...new Set(files.map((f) => text(f.note_id)).filter(Boolean))];
  const notes = new Map<string, { title: string; effective: string }>();
  if (ids.length === 0) return notes;
  // In parallel requests of NOTE_IDS_PER_REQUEST: 200 ids in one request line come within a
  // few hundred bytes of the 8 KB a gateway may refuse.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += NOTE_IDS_PER_REQUEST)
    chunks.push(ids.slice(i, i + NOTE_IDS_PER_REQUEST));
  const answers = await Promise.all(
    chunks.map(
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

/** One storage call signing every thumbnail. A failure costs the thumbnails, not the page. */
async function thumbsFor(db: Db, files: Row[]): Promise<Context["thumbs"]> {
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
 * A page of the caller's first hive, newest first, in three waves: the hive; then its members,
 * the caller's user and up to 201 files in parallel (the 201st only says that more exist); then
 * the attached notes and the thumbnail links in parallel.
 */
async function page(db: Db, cursor: Cursor | null): Promise<GalleryLoad> {
  const hives = (await db
    .from("hives")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)) as Res;
  if (failed("hives query", hives)) return { state: "error" };
  const hive = rows(hives)[0];
  if (!hive) return { state: "no-hive" };
  const hiveId = text(hive.id);

  let index = db.from("files").select(FILE_COLUMNS).eq("hive_id", hiveId);
  // Keyset: strictly after the last file shown, in the same (created_at, id) order.
  if (cursor)
    index = index.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );

  const [members, user, files] = await Promise.all([
    db
      .from("members")
      .select("id, display_name, user_id")
      .eq("hive_id", hiveId) as unknown as Promise<Res>,
    db.auth.getUser(),
    index
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE + 1) as unknown as Promise<Res>,
  ]);
  if (failed("members query", members)) return { state: "error" };
  if (failed("files query", files)) return { state: "error" };

  const userId = user.data.user?.id;
  if (!userId) return { state: "error" };
  const memberRows = rows(members);
  const mine = new Set(
    memberRows.filter((m) => m.user_id === userId).map((m) => text(m.id)),
  );
  if (mine.size === 0) return { state: "error" };
  const names = new Map(
    memberRows.map((m) => [text(m.id), text(m.display_name)]),
  );

  const all = rows(files);
  const shown = all.slice(0, PAGE);
  const [notes, thumbs] = await Promise.all([
    notesFor(db, shown),
    thumbsFor(db, shown),
  ]);
  if (!notes) return { state: "error" };

  const last = shown[shown.length - 1];
  return {
    state: "ok",
    data: {
      files: shown.map((r) => toFile(r, { mine, names, notes, thumbs })),
      next:
        all.length > PAGE && last
          ? { created_at: text(last.created_at), id: text(last.id) }
          : null,
    },
  };
}

/** Everything `/gallery` shows first: the newest 200 files the caller may read. */
export function loadGallery(db: Db): Promise<GalleryLoad> {
  return page(db, null);
}

/**
 * The next 200 after `cursor`, which the caller has already passed through `cleanCursor`. It is
 * its own request, so the hive, its members and the user are read again. Null on any failure.
 */
export async function loadPage(
  db: Db,
  cursor: Cursor,
): Promise<GalleryPage | null> {
  const out = await page(db, cursor);
  return out.state === "ok" ? out.data : null;
}
