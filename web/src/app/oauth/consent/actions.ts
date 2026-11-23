"use server";

// The approval window's one write, as a server action. It is a public HTTP endpoint: it signs in
// as the person behind the session cookie (never a service key), and `decide.ts` checks its
// arguments, reads the request again from the auth server and lets the database decide. No
// session, no Supabase configuration or an unexpected failure answers `{ ok: false }`.
import { createServerSupabase } from "../../../lib/supabase/server";
import { decideIn, type Outcome } from "./decide";

export async function decide(
  authorizationId: string,
  decision: string,
  workspaceId: string,
): Promise<Outcome> {
  try {
    return await decideIn(await createServerSupabase(), {
      authorizationId,
      decision,
      workspaceId,
    });
  } catch (e) {
    console.error("consent action failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}
