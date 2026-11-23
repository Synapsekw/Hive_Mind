// What the settings server actions do, given a client signed in as the person. Each checks its
// arguments before any call and lets the database decide: `create_agent`, `revoke_agent`,
// `invite_member` and `revoke_invitation` refuse an agent, someone else's workspace or agent,
// and anyone but the owner.
//
// Revoking a connected app. `revoke_agent` is what cuts the app off: from then on the database
// refuses its pass. After it has succeeded, the app's sign-in at the auth server is ended as
// well (`revokeGrant`), so the auth server stops renewing the pass and asks the person again
// next time. That second step is best effort: when it fails the revoke still stands, and one
// fixed phrase is logged.
//
// The token. `create_agent` answers with the agent's token, once. It leaves `createIn` only in
// the returned value. Nothing the function answered is ever passed to `console.*`, whether the
// call worked or not: a log line here carries an error's code and message and nothing else,
// so never an email address or a name either.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Created, Invited, Result } from "../../settings/types";
import { ownHive } from "../own-hive";
import { isUuid } from "../vault/validate";
import { cleanEmail, cleanName, cleanNewAgent } from "./validate";

type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const NO: Result = { ok: false };
const YES: Result = { ok: true };
const NOT_CREATED: Created = { ok: false };
const FAILED: Invited = { ok: false, reason: "failed" };

/** Only the error's code and message, never the answer beside it. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

/** The id the auth server answers with, or null when nobody is signed in. */
async function userId(db: Db): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id || null;
}

async function signedIn(db: Db): Promise<boolean> {
  return (await userId(db)) !== null;
}

/** The token of the first row of `create_agent`'s answer, or null when it is not there. */
function tokenOf(data: unknown): string | null {
  const first: unknown = Array.isArray(data) ? data[0] : undefined;
  if (typeof first !== "object" || first === null) return null;
  const { token } = first as Record<string, unknown>;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function createIn(db: Db, raw: unknown): Promise<Created> {
  const input = cleanNewAgent(raw);
  if (!input) return NOT_CREATED;
  if (!(await signedIn(db))) return NOT_CREATED;
  const res = (await db.rpc("create_agent", {
    p_workspace: input.workspaceId,
    p_name: input.name,
    p_provider: input.provider,
    p_trust_tier: input.trustTier,
  })) as Res;
  if (failed("create_agent", res)) return NOT_CREATED;
  const token = tokenOf(res.data);
  if (token === null) {
    // Said without the answer: a malformed answer may still hold the token somewhere.
    console.error("create_agent answer has an unexpected shape");
    return NOT_CREATED;
  }
  return { ok: true, token };
}

export async function revokeIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  if (!(await signedIn(db))) return NO;
  const res = (await db.rpc("revoke_agent", { p_agent: id })) as Res;
  if (failed("revoke_agent", res)) return NO;
  await endSignIn(db, id);
  return YES;
}

const SIGN_IN_NOT_ENDED = "the app's sign-in could not be ended";

/** The `oauth_client_id` of the first row, null when there is none; undefined when unreadable. */
function clientOf(res: Res): string | null | undefined {
  if (res.error || !Array.isArray(res.data)) return undefined;
  const first: unknown = res.data[0];
  if (first === undefined) return null;
  if (typeof first !== "object" || first === null) return undefined;
  const { oauth_client_id } = first as Record<string, unknown>;
  if (oauth_client_id === null) return null;
  return isUuid(oauth_client_id) ? oauth_client_id : undefined;
}

/**
 * After an agent was revoked: when it stood for a connected app, and the person has no other
 * agent of that app still in use (the same app approved again in another hive), end the app's
 * sign-in at the auth server. Row-level security answers the person's own agents only. Never
 * throws and never changes the outcome of the revoke.
 */
async function endSignIn(db: Db, agentId: string): Promise<void> {
  try {
    const client = clientOf(
      (await db
        .from("agents")
        .select("oauth_client_id")
        .eq("id", agentId)
        .limit(1)) as Res,
    );
    // An agent with a token has no sign-in to end.
    if (client === null) return;
    if (client === undefined) {
      console.error(SIGN_IN_NOT_ENDED);
      return;
    }
    const live = (await db
      .from("agents")
      .select("id")
      .eq("oauth_client_id", client)
      .is("revoked_at", null)
      .limit(1)) as Res;
    if (live.error || !Array.isArray(live.data)) {
      console.error(SIGN_IN_NOT_ENDED);
      return;
    }
    if (live.data.length > 0) return;
    const ended = (await db.auth.oauth.revokeGrant({
      clientId: client,
    })) as Res;
    if (ended.error) console.error(SIGN_IN_NOT_ENDED);
  } catch {
    console.error(SIGN_IN_NOT_ENDED);
  }
}

/** Part of the message `invite_member` raises for someone who is in the hive already. */
const ALREADY_MEMBER = "already a member";
/** Part of the message it raises for an email with an invitation that is still open. */
const ALREADY_INVITED = "already invited";

export async function inviteIn(
  db: Db,
  email: unknown,
  name: unknown,
): Promise<Invited> {
  const cleanedEmail = cleanEmail(email);
  const cleanedName = cleanName(name);
  if (cleanedEmail === null || cleanedName === null) return FAILED;
  const uid = await userId(db);
  if (!uid) return FAILED;

  // The hive the person uses, so the one they see on `/settings`.
  const hive = await ownHive(db, uid);
  if (hive === "error" || hive === null) return FAILED;

  const res = (await db.rpc("invite_member", {
    p_hive: hive.id,
    p_email: cleanedEmail,
    p_display_name: cleanedName,
  })) as Res;
  if (res.error) {
    failed("invite_member", res);
    if (res.error.message.includes(ALREADY_MEMBER))
      return { ok: false, reason: "already-member" };
    if (res.error.message.includes(ALREADY_INVITED))
      return { ok: false, reason: "already-invited" };
    return FAILED;
  }
  if (res.data === "added" || res.data === "invited")
    return { ok: true, outcome: res.data };
  console.error("invite_member answer has an unexpected shape");
  return FAILED;
}

export async function revokeInvitationIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  if (!(await signedIn(db))) return NO;
  const res = (await db.rpc("revoke_invitation", { p_invitation: id })) as Res;
  return failed("revoke_invitation", res) ? NO : YES;
}
