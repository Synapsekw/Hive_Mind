"use server";

// The vault's writes, and the one read that opens a note, as server actions. These are public
// HTTP endpoints: each one signs in as the person behind the session cookie (never a service
// key), checks its arguments (in `write.ts`, `validate.ts`) before any query, and lets the
// database decide. No session, no Supabase configuration or an unexpected failure answers
// `{ ok: false }` / `null`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImportNote } from "../../import/plan";
import type {
  BatchResult,
  ConnectResult,
  WorkspaceMade,
} from "../../import/types";
import { createServerSupabase } from "../../lib/supabase/server";
import type { AttachResult } from "../../topics/types";
import type {
  OpenAnswer,
  Result,
  SharePreview,
  TopicChange,
} from "../../vault/types";
import { attachBatchIn } from "./attach";
import { connectBatchIn } from "./connect";
import { createImportWorkspaceIn, importBatchIn } from "./import";
import { openNoteIn } from "./load-vault";
import {
  addTopicIn,
  deleteNoteIn,
  detachTopicIn,
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

/**
 * One note for the preview, read under the session like every other action: its row, body,
 * links and topics, never the hive's index. Not a write; the vault opens notes with it in place
 * of reloading the page.
 */
export async function openNote(id: string): Promise<OpenAnswer> {
  return withSession<OpenAnswer>({ ok: false }, (db) => openNoteIn(db, id));
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

export async function detachTopic(
  noteId: string,
  topicId: string,
): Promise<Result> {
  return withSession<Result>({ ok: false }, (db) =>
    detachTopicIn(db, noteId, topicId),
  );
}

export async function addTopic(
  noteId: string,
  topicId: string,
): Promise<TopicChange> {
  return withSession<TopicChange>({ ok: false, reason: "failed" }, (db) =>
    addTopicIn(db, noteId, topicId),
  );
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

/**
 * One step of turning a workspace's wiki links into links: the 40 notes after the cursor. The
 * arguments are checked in `connect.ts`; the hive and the member come from the workspace's row.
 */
export async function connectWikiLinks(
  workspaceId: string,
  after: string | null,
): Promise<ConnectResult> {
  return withSession<ConnectResult>({ ok: false }, (db) =>
    connectBatchIn(db, workspaceId, after),
  );
}

/**
 * One step of attaching a workspace's notes to the hive's topics: the 40 notes after the
 * cursor. The arguments are checked in `attach.ts`; the hive and the member come from the
 * workspace's row.
 */
export async function attachTopics(
  workspaceId: string,
  after: string | null,
): Promise<AttachResult> {
  return withSession<AttachResult>({ ok: false }, (db) =>
    attachBatchIn(db, workspaceId, after),
  );
}
