"use server";

// The gallery's server actions. These are public HTTP endpoints: each one signs in as the person
// behind the session cookie (never a service key), checks its argument before any query, and
// lets the database decide. No session, no Supabase configuration or an unexpected failure
// answers `null` / `{ ok: false }`, the same as a file that is not there.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cursor, GalleryPage, Kind, Result } from "../../gallery/types";
import { createServerSupabase } from "../../lib/supabase/server";
import { loadPage } from "./load-gallery";
import { cleanCursor } from "./validate";
import { deleteIn, downloadIn, openIn } from "./write";

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
  return withSession<Result>({ ok: false }, (db) => deleteIn(db, id));
}

export async function loadMore(cursor: Cursor): Promise<GalleryPage | null> {
  const clean = cleanCursor(cursor);
  if (!clean) return null;
  return withSession<GalleryPage | null>(null, (db) => loadPage(db, clean));
}
