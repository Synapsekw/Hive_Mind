// What the gallery's server actions do, given a client signed in as the person. Each checks its
// argument before any query and answers only a link, `{ ok }` or nothing. The database decides
// which rows can be read and deleted: a file the caller cannot read and one that does not exist
// both come back as no row, and are answered the same way. A file's place in storage is used to
// sign or remove it and is never returned. Only an error's code and message are logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileKind } from "../../gallery/kind";
import type { Kind, Result } from "../../gallery/types";
import { ownHive } from "../own-hive";
import { BUCKET, LINK_SECONDS } from "./load-gallery";
import { isUuid } from "./validate";

type Db = Pick<SupabaseClient, "from" | "auth" | "storage">;
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
    .select("id,member_id,storage_path,name,mime")
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
    kind: fileKind(name, typeof r.mime === "string" ? r.mime : null),
  };
}

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
  if (file.kind !== "image" && file.kind !== "pdf") return null;
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
async function myMember(db: Db): Promise<string | null> {
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
