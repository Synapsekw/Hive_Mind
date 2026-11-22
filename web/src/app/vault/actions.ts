"use server";

// The vault's writes, as server actions. These are public HTTP endpoints: each one signs in as
// the person behind the session cookie (never a service key), checks its arguments in `write.ts`
// before any query, and lets the database decide. No session, no Supabase configuration or an
// unexpected failure answers `{ ok: false }` / `null`.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "../../lib/supabase/server";
import type { Result, SharePreview } from "../../vault/types";
import { previewIn, releaseIn, saveFolderIn, saveNoteIn } from "./write";

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

export async function preview(
  workspaceId: string,
  path: string,
): Promise<SharePreview | null> {
  return withSession<SharePreview | null>(null, (db) =>
    previewIn(db, workspaceId, path),
  );
}
