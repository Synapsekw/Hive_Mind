// Which hive is "the person's hive": the one of their own oldest membership. Not the oldest
// hive they can read: a hive's owner can add an existing person without asking, and a hive that
// was created earlier would then take the place of the one the person already uses. A later
// membership never comes before an earlier one, so it can never do that.
//
// Row-level security still decides what can be read; this only picks among the person's own
// memberships. One bounded read: `members` filtered by `user_id`, with the hive's name beside it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "./vault/validate";

export type OwnHive = {
  /** The hive's id. */
  id: string;
  name: string;
  /** The person's member id in that hive. */
  memberId: string;
};

/** The hive plus who the person is in it, for the rail. Opt in with `{ profile: true }`. */
export type OwnHiveProfile = OwnHive & {
  /** The person's display name in that hive. */
  displayName: string;
  /** The person's role in that hive, e.g. "owner" or "member". */
  role: string;
};

type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The hive is named through the membership's own `hive_id`, so no other path can be meant. */
const COLUMNS = "id, hive_id, hive:hives!hive_id(name)";
const PROFILE_COLUMNS =
  "id, hive_id, display_name, role, hive:hives!hive_id(name)";

/**
 * The user id the session's access token names, read from the cookie with no call to the auth
 * server. The token is not verified here and does not need to be: it is the same token every
 * query of this client is sent with, and the database verifies it there. A forged one fails
 * the query; a real one names the user the database also sees. Null when there is none.
 */
export async function sessionUserId(
  db: Pick<SupabaseClient, "auth">,
): Promise<string | null> {
  try {
    const { data } = await db.auth.getSession();
    const payload = data.session?.access_token.split(".");
    if (payload?.length !== 3) return null;
    const claims: unknown = JSON.parse(
      Buffer.from(payload[1]!, "base64url").toString("utf8"),
    );
    if (typeof claims !== "object" || claims === null) return null;
    const { sub } = claims as Record<string, unknown>;
    return isUuid(sub) ? sub : null;
  } catch {
    return null;
  }
}

/**
 * The hive of the person's oldest membership: null when they are in no hive, "error" when it
 * cannot be read. Ties on the time are broken by the membership's id, so the answer is always
 * the same one. Pass `userId` where the caller already holds the id the auth server answered
 * with; without it the id is the one the session's token names.
 */
export async function ownHive(
  db: Pick<SupabaseClient, "from" | "auth">,
  userId?: string,
): Promise<OwnHive | null | "error">;
export async function ownHive(
  db: Pick<SupabaseClient, "from" | "auth">,
  userId: string | undefined,
  opts: { profile: true },
): Promise<OwnHiveProfile | null | "error">;
export async function ownHive(
  db: Pick<SupabaseClient, "from" | "auth">,
  userId?: string,
  opts?: { profile?: boolean },
): Promise<OwnHive | OwnHiveProfile | null | "error"> {
  const profile = opts?.profile === true;
  const uid = userId ?? (await sessionUserId(db));
  if (!uid) {
    console.error("own hive read has no session");
    return "error";
  }
  const res = (await db
    .from("members")
    .select(profile ? PROFILE_COLUMNS : COLUMNS)
    .eq("user_id", uid)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)) as Res;
  if (res.error) {
    // Only the error's code and message, never a payload.
    console.error("own hive query failed", res.error.code, res.error.message);
    return "error";
  }
  if (Array.isArray(res.data) && res.data.length === 0) return null;
  const row = Array.isArray(res.data) ? res.data[0] : undefined;
  const own = profile ? toProfile(row) : toOwnHive(row);
  if (!own) console.error("own hive answer has an unexpected shape");
  return own ?? "error";
}

function toOwnHive(v: unknown): OwnHive | null {
  if (typeof v !== "object" || v === null) return null;
  const { id, hive_id, hive } = v as Record<string, unknown>;
  if (typeof id !== "string" || typeof hive_id !== "string") return null;
  if (typeof hive !== "object" || hive === null || Array.isArray(hive))
    return null;
  const { name } = hive as Record<string, unknown>;
  return typeof name === "string" ? { id: hive_id, name, memberId: id } : null;
}

function toProfile(v: unknown): OwnHiveProfile | null {
  const base = toOwnHive(v);
  if (!base) return null;
  const { display_name, role } = v as Record<string, unknown>;
  if (typeof display_name !== "string" || typeof role !== "string") return null;
  return { ...base, displayName: display_name, role };
}
