"use server";

// The inbox's server actions. These are public HTTP endpoints: each one signs in as the person
// behind the session cookie (never a service key), checks its arguments before any query, and
// lets the database decide. No session, no Supabase configuration or an unexpected failure
// answers `{ ok: false }`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opening, Result } from "../../inbox/types";
import { createServerSupabase } from "../../lib/supabase/server";
import { releaseIn } from "../vault/write";
import { openingIn, respondIn } from "./write";

async function withSession(
  run: (db: SupabaseClient) => Promise<Result>,
): Promise<Result> {
  try {
    return await run(await createServerSupabase());
  } catch (e) {
    console.error("inbox action failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}

export async function respondToLink(
  id: string,
  accept: boolean,
): Promise<Result> {
  return withSession((db) => respondIn(db, id, accept));
}

export async function releaseNote(id: string): Promise<Result> {
  return withSession((db) => releaseIn(db, id));
}

export async function noteOpening(id: string): Promise<Opening> {
  try {
    return await openingIn(await createServerSupabase(), id);
  } catch (e) {
    console.error("inbox action failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}
