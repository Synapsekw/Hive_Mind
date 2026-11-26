// What the gallery's server actions do, given a client signed in as the person. Each checks its
// argument before any query and answers only a link, `{ ok }` or nothing. The database decides
// which rows can be read and deleted: a file the caller cannot read and one that does not exist
// both come back as no row, and are answered the same way. A file's place in storage is used to
// sign or remove it and is never returned. Only an error's code and message are logged. Moving a
// file's home note is the database's `file_set_home`, which decides whose file and note it is.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kind, NoteChoice, Result } from "../../gallery/types";
import { ownHive } from "../own-hive";
import { BUCKET, kindOf, LINK_SECONDS } from "./load-gallery";
import { cleanQuery, isUuid } from "./validate";

type Db = Pick<SupabaseClient, "from" | "auth" | "storage" | "rpc">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const NO: Result = { ok: false };
const YES: Result = { ok: true };

const text = (v: unknown): string => (typeof v === "string" ? v : "");

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

type FileRow = { member_id: string; path: string; name: string; kind: Kind };

/** The row as the caller's session may read it, or null: missing and unreadable look the same. */
async function readable(db: Db, id: string): Promise<FileRow | null> {
  const res = (await db
    .from("files")
    .select("id,member_id,storage_path,name,kind")
    .eq("id", id)
    .limit(1)) as Res;
  if (failed("file query", res)) return null;
  const r = Array.isArray(res.data) ? (res.data[0] as Row | undefined) : null;
  if (!r) return null;
  const path = text(r.storage_path);
  if (!path) return null;
  const name = text(r.name);
  return {
    member_id: text(r.member_id),
    path,
    name,
    // Stored on insert from the name and the declared type (public.file_kind).
    kind: kindOf(r),
  };
}

const INLINE = new Set<Kind>(["image", "pdf", "text", "csv"]);
const NOTE_CHOICES = 20;

/** A ten-minute link to the object. */
async function sign(db: Db, path: string): Promise<string | null> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, LINK_SECONDS);
  if (storageFailed("signing", error)) return null;
  return data?.signedUrl || null;
}

/** A link to show the file, and what it is. */
export async function openIn(
  db: Db,
  id: unknown,
): Promise<{ url: string; kind: Kind } | null> {
  if (!isUuid(id)) return null;
  const file = await readable(db, id);
  if (!file) return null;
  // Only what the viewer shows gets a link without the download disposition: anything else
  // (a page, a drawing, a mislabelled file) could be rendered by the browser if opened inline.
  // Text and CSV are kinds only when declared as text/plain, text/markdown or text/csv, which a
  // browser shows as text; the viewer fetches them and never renders them as HTML.
  if (!INLINE.has(file.kind)) return null;
  const url = await sign(db, file.path);
  return url ? { url, kind: file.kind } : null;
}

/** A link that saves the file under its own name. */
export async function downloadIn(
  db: Db,
  id: unknown,
): Promise<{ url: string } | null> {
  if (!isUuid(id)) return null;
  const file = await readable(db, id);
  if (!file) return null;
  // The download parameter is added here, not through the client library's option, which
  // encodes the name a second time ("R&D.pdf" would be saved as "R%26D.pdf"). The parameter is
  // not part of what is signed. An empty value saves the file under the object's own name.
  const url = await sign(db, file.path);
  return url
    ? { url: `${url}&download=${encodeURIComponent(file.name)}` }
    : null;
}

/** The caller's member id in their own hive, read now; null when it cannot be told. */
export async function myMember(
  db: Pick<SupabaseClient, "from" | "auth">,
): Promise<string | null> {
  const { data } = await db.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return null;
  const hive = await ownHive(db, uid);
  return hive === "error" || hive === null ? null : hive.memberId;
}

/**
 * Deletes the caller's own file. A file shared with the caller is readable but not theirs, so it
 * is refused here, before storage is touched. The stored object goes first, so the content is
 * certainly gone if the second step fails; the row that is then left can be deleted again, which
 * is why an object that is already gone does not stop the row delete.
 */
export async function deleteIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  const mine = await myMember(db);
  if (!mine) return NO;
  const file = await readable(db, id);
  if (!file || file.member_id !== mine) return NO;

  const removed = await db.storage.from(BUCKET).remove([file.path]);
  if (storageFailed("removing the object", removed.error)) return NO;

  // By id alone: the database refuses a row that is not the caller's.
  const res = (await db
    .from("files")
    .delete()
    .eq("id", id)
    .select("id")) as Res;
  if (failed("deleteFile", res)) return NO;
  return Array.isArray(res.data) && res.data.length > 0 ? YES : NO;
}

/**
 * Moves the caller's file to another of their own notes, or to none (`noteId` null): who may
 * read a file follows its home note. The database checks both are the caller's and logs it.
 */
export async function setHomeIn(
  db: Db,
  fileId: unknown,
  noteId: unknown,
): Promise<Result> {
  if (!isUuid(fileId)) return NO;
  if (noteId !== null && !isUuid(noteId)) return NO;
  const res = (await db.rpc("file_set_home", {
    p_file: fileId,
    p_note: noteId,
  })) as Res;
  if (failed("setHome", res)) return NO;
  return YES;
}

/** The query as a case-blind "contains" pattern; `*` is PostgREST's own wildcard, so it goes. */
const pattern = (q: string) =>
  `%${q.replace(/\*/g, "").replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Up to 20 of the caller's own notes in their hive whose title contains `query`, newest first:
 * the choices for a file's home note and an upload's. An empty query lists the newest.
 */
export async function findNotesIn(
  db: Db,
  query: unknown,
): Promise<NoteChoice[]> {
  const q = cleanQuery(query);
  if (q === null) return [];
  const mine = await myMember(db);
  if (!mine) return [];
  let search = db.from("notes").select("id,title,path").in("member_id", [mine]);
  if (q) search = search.ilike("title", pattern(q));
  const res = (await search
    .order("updated_at", { ascending: false })
    .limit(NOTE_CHOICES)) as Res;
  if (failed("note search", res)) return [];
  return (Array.isArray(res.data) ? (res.data as Row[]) : []).map((n) => ({
    id: text(n.id),
    title: text(n.title),
    path: text(n.path),
  }));
}
