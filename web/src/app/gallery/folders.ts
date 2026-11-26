// A person's own gallery folders, given a client signed in as the person. Organisation only: a
// folder never changes who may read a file (that is the file's home note). The database keeps
// folders to their owner, two levels deep, and a file in a folder of its own hive; this file only
// checks shapes. A folder the caller cannot see and one that does not exist answer the same.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GalleryFolder, Result } from "../../gallery/types";
import { cleanIds, cleanName, isUuid } from "./validate";
import { myMember } from "./write";

type Db = Pick<SupabaseClient, "from" | "auth">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const NO: Result = { ok: false };
const YES: Result = { ok: true };

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const first = (res: Res): Row | undefined =>
  Array.isArray(res.data) ? (res.data[0] as Row | undefined) : undefined;

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

/** A new folder of the caller's in their hive, at the top or under `parentId`. */
export async function createFolderIn(
  db: Db,
  rawName: unknown,
  parentId: unknown,
): Promise<GalleryFolder | null> {
  const name = cleanName(rawName);
  if (!name) return null;
  if (parentId !== null && !isUuid(parentId)) return null;
  const member = await myMember(db);
  if (!member) return null;
  const res = (await db
    .from("gallery_folders")
    .insert({ member_id: member, parent_id: parentId, name })
    .select("id,name,parent_id")) as Res;
  if (failed("createFolder", res)) return null;
  const row = first(res);
  if (!row || !isUuid(row.id)) return null;
  return {
    id: row.id,
    name: text(row.name),
    parent_id: text(row.parent_id) || null,
  };
}

export async function renameFolderIn(
  db: Db,
  id: unknown,
  rawName: unknown,
): Promise<Result> {
  if (!isUuid(id)) return NO;
  const name = cleanName(rawName);
  if (!name) return NO;
  const res = (await db
    .from("gallery_folders")
    .update({ name })
    .eq("id", id)
    .select("id")) as Res;
  if (failed("renameFolder", res)) return NO;
  return first(res) ? YES : NO;
}

/** Deletes the folder, its sub-folders and their memberships; never a file. */
export async function deleteFolderIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  const res = (await db
    .from("gallery_folders")
    .delete()
    .eq("id", id)
    .select("id")) as Res;
  if (failed("deleteFolder", res)) return NO;
  return first(res) ? YES : NO;
}

/** Puts up to 200 files in the folder; one already there is left as it is. */
export async function addToFolderIn(
  db: Db,
  folderId: unknown,
  fileIds: unknown,
): Promise<Result> {
  if (!isUuid(folderId)) return NO;
  const ids = cleanIds(fileIds);
  if (!ids) return NO;
  const res = (await db.from("gallery_folder_files").upsert(
    ids.map((file_id) => ({ folder_id: folderId, file_id })),
    { onConflict: "folder_id,file_id", ignoreDuplicates: true },
  )) as Res;
  if (failed("addToFolder", res)) return NO;
  return YES;
}

/** Takes one file out of the folder; the file itself stays. */
export async function removeFromFolderIn(
  db: Db,
  folderId: unknown,
  fileId: unknown,
): Promise<Result> {
  if (!isUuid(folderId) || !isUuid(fileId)) return NO;
  const res = (await db
    .from("gallery_folder_files")
    .delete()
    .eq("folder_id", folderId)
    .eq("file_id", fileId)
    .select("folder_id")) as Res;
  if (failed("removeFromFolder", res)) return NO;
  return first(res) ? YES : NO;
}
