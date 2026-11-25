"use server";

// The gallery's server actions. These are public HTTP endpoints: each one signs in as the person
// behind the session cookie (never a service key), checks its arguments before any query, and
// lets the database decide. No session, no Supabase configuration or an unexpected failure
// answers `null` / `{ ok: false }` / `[]`, the same as a file that is not there.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Cursor,
  GalleryFile,
  GalleryFolder,
  GalleryPage,
  Kind,
  NoteChoice,
  Result,
  ServerFilter,
  UploadStart,
} from "../../gallery/types";
import { createServerSupabase } from "../../lib/supabase/server";
import {
  addToFolderIn,
  createFolderIn,
  deleteFolderIn,
  removeFromFolderIn,
  renameFolderIn,
} from "./folders";
import { loadPage as loadPageIn } from "./load-gallery";
import { endUploadIn, finishUploadIn, startUploadIn } from "./upload";
import { cleanCursor, cleanServerFilter } from "./validate";
import { deleteIn, downloadIn, findNotesIn, openIn, setHomeIn } from "./write";

const NO: Result = { ok: false };

async function withSession<T>(
  fallback: T,
  run: (db: SupabaseClient) => Promise<T>,
): Promise<T> {
  try {
    return await run(await createServerSupabase());
  } catch (e) {
    console.error("gallery action failed", e instanceof Error ? e.name : "");
    return fallback;
  }
}

export async function openFile(
  id: string,
): Promise<{ url: string; kind: Kind } | null> {
  return withSession<{ url: string; kind: Kind } | null>(null, (db) =>
    openIn(db, id),
  );
}

export async function downloadFile(
  id: string,
): Promise<{ url: string } | null> {
  return withSession<{ url: string } | null>(null, (db) => downloadIn(db, id));
}

export async function deleteFile(id: string): Promise<Result> {
  return withSession<Result>(NO, (db) => deleteIn(db, id));
}

/** Up to 200 files matching the server filter, after `cursor` when given. */
export async function loadPage(
  filter: ServerFilter,
  cursor: Cursor | null,
): Promise<GalleryPage | null> {
  const clean = cleanServerFilter(filter);
  if (!clean) return null;
  let after: Cursor | null = null;
  if (cursor !== null) {
    after = cleanCursor(cursor);
    if (!after) return null;
  }
  return withSession<GalleryPage | null>(null, (db) =>
    loadPageIn(db, clean, after),
  );
}

export async function setHome(
  fileId: string,
  noteId: string | null,
): Promise<Result> {
  return withSession<Result>(NO, (db) => setHomeIn(db, fileId, noteId));
}

export async function findMyNotes(query: string): Promise<NoteChoice[]> {
  return withSession<NoteChoice[]>([], (db) => findNotesIn(db, query));
}

export async function createFolder(
  name: string,
  parentId: string | null,
): Promise<GalleryFolder | null> {
  return withSession<GalleryFolder | null>(null, (db) =>
    createFolderIn(db, name, parentId),
  );
}

export async function renameFolder(id: string, name: string): Promise<Result> {
  return withSession<Result>(NO, (db) => renameFolderIn(db, id, name));
}

export async function deleteFolder(id: string): Promise<Result> {
  return withSession<Result>(NO, (db) => deleteFolderIn(db, id));
}

export async function addToFolder(
  folderId: string,
  fileIds: string[],
): Promise<Result> {
  return withSession<Result>(NO, (db) => addToFolderIn(db, folderId, fileIds));
}

export async function removeFromFolder(
  folderId: string,
  fileId: string,
): Promise<Result> {
  return withSession<Result>(NO, (db) =>
    removeFromFolderIn(db, folderId, fileId),
  );
}

export async function startUpload(req: {
  files: { name: string; size: number }[];
  noteId: string | null;
  folderId: string | null;
}): Promise<(UploadStart & { noteId: string }) | null> {
  return withSession<(UploadStart & { noteId: string }) | null>(null, (db) =>
    startUploadIn(db, req),
  );
}

export async function finishUpload(
  batch: string,
  name: string,
  noteId: string,
  folderId: string | null,
): Promise<GalleryFile | null> {
  return withSession<GalleryFile | null>(null, (db) =>
    finishUploadIn(db, batch, name, noteId, folderId),
  );
}

export async function endUpload(
  batch: string,
  noteId: string,
): Promise<Result> {
  return withSession<Result>(NO, (db) => endUploadIn(db, batch, noteId));
}
