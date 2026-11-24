"use server";

// The vault's writes, as server actions. These are public HTTP endpoints: each one signs in as
// the person behind the session cookie (never a service key), checks its arguments in `write.ts`
// before any query, and lets the database decide. No session, no Supabase configuration or an
// unexpected failure answers `{ ok: false }` / `null`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportNote } from "../../import/plan";
import type { BatchResult, WorkspaceMade } from "../../import/types";
import { createServerSupabase } from "../../lib/supabase/server";
import type { Result, SharePreview } from "../../vault/types";
import { createImportWorkspaceIn, importBatchIn } from "./import";
import {
  deleteNoteIn,
  previewIn,
  releaseIn,
  saveFolderIn,
  saveNoteIn,
  unlinkIn,
} from "./write";

async function withSession<T>(
  fallback: T,
  run: (db: SupabaseClient) => Promise<T>,
): Promise<T> {
  try {
    return await run(await createServerSupabase());
  } catch (e) {
    console.error("vault action failed", e instanceof Error ? e.name : "");
    return fallback;
  }
}

export async function saveNote(
  noteId: string,
  choice: unknown,
): Promise<Result> {
  return withSession<Result>({ ok: false }, (db) =>
    saveNoteIn(db, noteId, choice),
  );
}

export async function saveFolder(
  workspaceId: string,
  path: string,
  choice: unknown,
): Promise<Result> {
  return withSession<Result>({ ok: false }, (db) =>
    saveFolderIn(db, workspaceId, path, choice),
  );
}

export async function release(noteId: string): Promise<Result> {
  return withSession<Result>({ ok: false }, (db) => releaseIn(db, noteId));
}

export async function deleteNote(noteId: string): Promise<Result> {
  return withSession<Result>({ ok: false }, (db) => deleteNoteIn(db, noteId));
}

export async function unlink(linkId: string): Promise<Result> {
  return withSession<Result>({ ok: false }, (db) => unlinkIn(db, linkId));
}

export async function preview(
  workspaceId: string,
  path: string,
): Promise<SharePreview | null> {
  return withSession<SharePreview | null>(null, (db) =>
    previewIn(db, workspaceId, path),
  );
}

/**
 * A new workspace for a folder import. `hiveId` is the hive the vault was showing; the page
 * binds it, so the browser sends it back sealed. The workspace is made in that hive, under the
 * person's own member there, or not at all. The arguments are checked in `import.ts`.
 */
export async function createImportWorkspace(
  hiveId: string,
  name: string,
): Promise<WorkspaceMade> {
  return withSession<WorkspaceMade>({ ok: false, reason: "failed" }, (db) =>
    createImportWorkspaceIn(db, hiveId, name),
  );
}

/**
 * One batch of a folder import: at most 25 notes and 3 MB, checked again in `import.ts`
 * whatever the browser checked. The hive and the member come from the workspace's own row.
 */
export async function importBatch(
  workspaceId: string,
  notes: ImportNote[],
): Promise<BatchResult> {
  return withSession<BatchResult>({ ok: false }, (db) =>
    importBatchIn(db, workspaceId, notes),
  );
}
