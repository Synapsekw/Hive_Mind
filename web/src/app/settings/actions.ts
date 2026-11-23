"use server";

// The settings server actions. These are public HTTP endpoints: each one signs in as the person
// behind the session cookie (never a service key), checks its arguments before any query, and
// lets the database decide. No session, no Supabase configuration or an unexpected failure
// answers the action's "not ok". `createAgent` is the one place an agent's token passes through:
// it goes back to the caller and nowhere else, and the log line below carries only the name of
// what was thrown, never its message or the answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "../../lib/supabase/server";
import type { Created, Invited, NewAgent, Result } from "../../settings/types";
import { createIn, inviteIn, revokeIn, revokeInvitationIn } from "./write";

async function withSession<T>(
  run: (db: SupabaseClient) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run(await createServerSupabase());
  } catch (e) {
    console.error("settings action failed", e instanceof Error ? e.name : "");
    return fallback;
  }
}

export async function createAgent(input: NewAgent): Promise<Created> {
  return withSession<Created>((db) => createIn(db, input), { ok: false });
}

export async function revokeAgent(id: string): Promise<Result> {
  return withSession<Result>((db) => revokeIn(db, id), { ok: false });
}

export async function inviteMember(
  email: string,
  name: string,
): Promise<Invited> {
  return withSession<Invited>((db) => inviteIn(db, email, name), {
    ok: false,
    reason: "failed",
  });
}

export async function revokeInvitation(id: string): Promise<Result> {
  return withSession<Result>((db) => revokeInvitationIn(db, id), { ok: false });
}
