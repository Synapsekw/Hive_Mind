// What the settings server actions do, given a client signed in as the person. Each checks its
// arguments before any call and lets the database decide: `create_agent`, `revoke_agent`,
// `invite_member` and `revoke_invitation` refuse an agent, someone else's workspace or agent,
// and anyone but the owner.
//
// The invitation's email. Inviting saves the invitation (`invite_member` answers its id and
// never makes anyone a member), then asks the mail function `invite-email` to send it; Send
// again asks the mail function alone. The function is called from here, the server, with the
// person's own session token as the bearer, so the database decides there whether this person
// may send for this invitation. The token is read from the session only after the auth server
// has confirmed the person. Only the answer's status is looked at: 200 sent, 429 too soon, 409
// emailed as often as this invitation may be, anything else not sent. The token, the address and whatever the function answered
// are never passed to `console.*`; a failure is one fixed phrase and, at most, the status.
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
import type {
  Created,
  Invited,
  Result,
  Sent,
  WorkspaceDeleted,
} from "../../settings/types";
import { ownHive } from "../own-hive";
import { isUuid } from "../vault/validate";
import { cleanEmail, cleanName, cleanNewAgent } from "./validate";

type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const NO: Result = { ok: false };
const YES: Result = { ok: true };
const NOT_CREATED: Created = { ok: false };
const FAILED: Invited = { ok: false, reason: "failed" };
const SENT: Sent = { ok: true };
const NOT_SENT: Sent = { ok: false, reason: "failed" };

/** `fetch`, handed in so the tests can stand in for the mail function. */
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

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

/** The key of the first row of `create_sync_key`'s answer, or null when it is not there. */
function syncKeyOf(data: unknown): string | null {
  const first: unknown = Array.isArray(data) ? data[0] : undefined;
  if (typeof first !== "object" || first === null) return null;
  const { key } = first as Record<string, unknown>;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * Makes a sync key for one of the person's workspaces; the database refuses another's. The key
 * leaves here only in the returned value, like an agent's token, and is never logged.
 */
export async function createSyncKeyIn(
  db: Db,
  workspaceId: unknown,
): Promise<Created> {
  if (!isUuid(workspaceId)) return NOT_CREATED;
  if (!(await signedIn(db))) return NOT_CREATED;
  const res = (await db.rpc("create_sync_key", {
    p_workspace: workspaceId,
  })) as Res;
  if (failed("create_sync_key", res)) return NOT_CREATED;
  const token = syncKeyOf(res.data);
  if (token === null) {
    // Said without the answer: a malformed answer may still hold the key somewhere.
    console.error("create_sync_key answer has an unexpected shape");
    return NOT_CREATED;
  }
  return { ok: true, token };
}

export async function revokeSyncKeyIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  if (!(await signedIn(db))) return NO;
  const res = (await db.rpc("revoke_sync_key", { p_key: id })) as Res;
  return failed("revoke_sync_key", res) ? NO : YES;
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
/** Part of the message it raises once the hive has made its invitations for the day. */
const TOO_MANY = "too many invitations";

const MAIL_NOT_SENT = "the invitation email could not be sent";
/** How long the mail function gets to answer: the action itself has ten seconds. */
const MAIL_TIMEOUT_MS = 8_000;

/**
 * Asks the mail function to send the invitation's email, as the person. The caller has already
 * had the auth server confirm the person and checked that `id` is a uuid. Never throws.
 */
async function sendIn(db: Db, id: string, fetchFn: Fetch): Promise<Sent> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.error(MAIL_NOT_SENT);
      return NOT_SENT;
    }
    const { data } = await db.auth.getSession();
    const token = data.session?.access_token;
    if (typeof token !== "string" || token === "") {
      console.error(MAIL_NOT_SENT);
      return NOT_SENT;
    }
    const res = await fetchFn(
      `${url.replace(/\/+$/, "")}/functions/v1/invite-email`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invitation: id }),
        cache: "no-store",
        signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      },
    );
    // The body is never read: only the status says what happened.
    if (res.status === 200) return SENT;
    console.error(MAIL_NOT_SENT, res.status);
    if (res.status === 429) return { ok: false, reason: "wait" };
    if (res.status === 409) return { ok: false, reason: "limit" };
    return NOT_SENT;
  } catch {
    // Said without what was thrown: it may name the request.
    console.error(MAIL_NOT_SENT);
    return NOT_SENT;
  }
}

/** Send again: the email of an invitation that is still open, sent once more. */
export async function resendIn(
  db: Db,
  id: unknown,
  fetchFn: Fetch,
): Promise<Sent> {
  if (!isUuid(id)) return NOT_SENT;
  if (!(await signedIn(db))) return NOT_SENT;
  return sendIn(db, id, fetchFn);
}

export async function inviteIn(
  db: Db,
  email: unknown,
  name: unknown,
  fetchFn: Fetch,
  shownHive?: unknown,
): Promise<Invited> {
  const cleanedEmail = cleanEmail(email);
  const cleanedName = cleanName(name);
  if (cleanedEmail === null || cleanedName === null) return FAILED;
  const uid = await userId(db);
  if (!uid) return FAILED;

  // The hive the person uses, so the one they see on `/settings`.
  const hive = await ownHive(db, uid);
  if (hive === "error" || hive === null) return FAILED;
  // The page names the hive it was showing. When the person has since switched to another hive
  // in a second tab, this tab still shows the first one: inviting into the other hive would
  // put a person where the owner never meant them, so it is refused instead.
  if (
    shownHive !== undefined &&
    !(isUuid(shownHive) && shownHive.toLowerCase() === hive.id.toLowerCase())
  ) {
    console.error("invite refused: the page showed another hive");
    return FAILED;
  }

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
    if (res.error.message.includes(TOO_MANY))
      return { ok: false, reason: "too-many" };
    return FAILED;
  }
  const id = res.data;
  if (!isUuid(id)) {
    console.error("invite_member answer has an unexpected shape");
    return FAILED;
  }
  // The invitation stands whether or not its email goes out; Send again is the way forward,
  // once the two minutes the database stamped before the send have passed.
  const sent = await sendIn(db, id, fetchFn);
  return { ok: true, id, sent: sent.ok };
}

export async function revokeInvitationIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  if (!(await signedIn(db))) return NO;
  const res = (await db.rpc("revoke_invitation", { p_invitation: id })) as Res;
  return failed("revoke_invitation", res) ? NO : YES;
}

/** The database's refusals (20261124160731_workspace_delete.sql), told apart by their words. */
const SAYS_LAST = "you need at least one workspace";
const SAYS_AGENT = "this workspace still has an agent in use";
const SAYS_FILES = "this workspace still holds files";
const NOT_DELETED: WorkspaceDeleted = { ok: false, reason: "failed" };

/**
 * Deletes a workspace, with its folders, notes and links. Whose workspace it is, and whether it
 * may go, is the database's answer: row-level security lets a person delete only their own, and
 * its trigger keeps the last one, one with an agent in use and one that holds files. Somebody
 * else's workspace, or one that is not there, comes back as no row and is answered as a failure.
 */
export async function deleteWorkspaceIn(
  db: Db,
  id: unknown,
): Promise<WorkspaceDeleted> {
  if (!isUuid(id)) return NOT_DELETED;
  if (!(await signedIn(db))) return NOT_DELETED;
  const wanted = id.toLowerCase();
  const res = (await db
    .from("workspaces")
    .delete()
    .eq("id", wanted)
    .select("id")) as Res;
  if (res.error) {
    failed("workspace delete", res);
    const said = String(res.error.message ?? "");
    if (said.includes(SAYS_LAST)) return { ok: false, reason: "last" };
    if (said.includes(SAYS_AGENT)) return { ok: false, reason: "agents" };
    if (said.includes(SAYS_FILES)) return { ok: false, reason: "files" };
    return NOT_DELETED;
  }
  const rows: unknown[] = Array.isArray(res.data) ? res.data : [];
  const gone = rows.some(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      String((r as Record<string, unknown>).id).toLowerCase() === wanted,
  );
  if (!gone) {
    console.error("workspace delete removed no row");
    return NOT_DELETED;
  }
  return { ok: true };
}
