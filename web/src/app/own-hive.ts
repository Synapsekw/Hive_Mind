// Which hive is "the person's hive": the one they chose in the rail, or else the one of their
// own oldest membership. Not the oldest hive they can read: a hive's owner can add an existing
// person without asking, and a hive that was created earlier would then take the place of the
// one the person already uses. A later membership never comes before an earlier one, so it can
// never do that.
//
// Row-level security still decides what can be read; this only picks among the person's own
// memberships. One bounded read: `members` filtered by `user_id`, with the hive's name beside
// it, oldest first, 50 at most. The chosen hive's id comes from a cookie (`chosen-hive.ts`) and
// is only compared with the rows the database answered: a value that names no hive of the
// person's picks nothing, and the oldest membership is the answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chosenHiveId } from "./chosen-hive";
import { isUuid } from "./vault/validate";

export type OwnHive = {
  /** The hive's id. */
  id: string;
  name: string;
  /** The person's member id in that hive. */
  memberId: string;
  /** When the hive will be erased, while it is being deleted; null otherwise. */
  deleteAfter: string | null;
};

/** The hive plus who the person is in it, for the rail. Opt in with `{ profile: true }`. */
export type OwnHiveProfile = OwnHive & {
  /** The person's display name in that hive. */
  displayName: string;
  /** The person's role in that hive, e.g. "owner" or "member". */
  role: string;
};

/** One of the person's hives and who they are in it. */
export type Membership = {
  /** The hive's id. */
  id: string;
  name: string;
  role: string;
  memberId: string;
  displayName: string;
  /** When the hive will be erased, while it is being deleted; null otherwise. */
  deleteAfter: string | null;
};

type Db = Pick<SupabaseClient, "from" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The hive is named through the membership's own `hive_id`, so no other path can be meant. */
const COLUMNS = "id, hive_id, hive:hives!hive_id(name, delete_after)";
const PROFILE_COLUMNS =
  "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)";

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

/** The most memberships one read answers; a person in more sees their oldest 50. */
const MOST = 50;

/** The person's own memberships, oldest first; ties on the time are broken by the id. */
async function memberships(
  db: Db,
  uid: string,
  columns: string,
): Promise<unknown[] | "error"> {
  const res = (await db
    .from("members")
    .select(columns)
    .eq("user_id", uid)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MOST)) as Res;
  if (res.error) {
    // Only the error's code and message, never a payload.
    console.error("own hive query failed", res.error.code, res.error.message);
    return "error";
  }
  if (!Array.isArray(res.data)) {
    console.error("own hive answer has an unexpected shape");
    return "error";
  }
  return res.data;
}

/** An id as it is compared: lower case, or null when it is not an id at all. */
const asId = (v: unknown): string | null =>
  isUuid(v) ? v.toLowerCase() : null;

/** The hive id a row names, in lower case; null for a row that names none. */
function hiveIdOf(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  return asId((row as Record<string, unknown>).hive_id);
}

/**
 * The person's hive: the chosen one when it is among their memberships, else that of their
 * oldest membership. Null when they are in no hive, "error" when it cannot be read. Ties on the
 * time are broken by the membership's id, so the answer is always the same one. Pass `userId`
 * where the caller already holds the id the auth server answered with; without it the id is the
 * one the session's token names. `opts.chosen`, when the key is there, is used in place of the
 * cookie (tests, and callers that already hold it).
 */
export async function ownHive(
  db: Db,
  userId?: string,
  opts?: { profile?: undefined; chosen?: string | null },
): Promise<OwnHive | null | "error">;
export async function ownHive(
  db: Db,
  userId: string | undefined,
  opts: { profile: true; chosen?: string | null },
): Promise<OwnHiveProfile | null | "error">;
export async function ownHive(
  db: Db,
  userId?: string,
  opts?: { profile?: true; chosen?: string | null },
): Promise<OwnHive | OwnHiveProfile | null | "error"> {
  const profile = opts?.profile === true;
  const uid = userId ?? (await sessionUserId(db));
  if (!uid) {
    console.error("own hive read has no session");
    return "error";
  }
  const rows = await memberships(db, uid, profile ? PROFILE_COLUMNS : COLUMNS);
  if (rows === "error") return "error";
  if (rows.length === 0) return null;
  const chosen =
    opts && "chosen" in opts ? asId(opts.chosen) : await chosenHiveId();
  // The choice only picks among the rows the database answered for this person.
  const row = (chosen && rows.find((r) => hiveIdOf(r) === chosen)) || rows[0];
  const own = profile ? toProfile(row) : toOwnHive(row);
  if (!own) console.error("own hive answer has an unexpected shape");
  return own ?? "error";
}

/**
 * Every hive the person is in, oldest membership first, 50 at most: the rail's list. A row
 * that is not a membership is left out. "error" when there is no session or the read fails.
 */
export async function myHives(
  db: Db,
  userId?: string,
): Promise<Membership[] | "error"> {
  const uid = userId ?? (await sessionUserId(db));
  if (!uid) {
    console.error("own hive read has no session");
    return "error";
  }
  const rows = await memberships(db, uid, PROFILE_COLUMNS);
  if (rows === "error") return "error";
  const out: Membership[] = [];
  for (const row of rows) {
    const m = toProfile(row);
    if (m)
      out.push({
        id: m.id,
        name: m.name,
        role: m.role,
        memberId: m.memberId,
        displayName: m.displayName,
        deleteAfter: m.deleteAfter,
      });
  }
  return out;
}

/** The hive `chosen` names among `hives`, else the first (the oldest membership). */
export function currentOf(
  hives: Membership[],
  chosen: string | null,
): Membership | undefined {
  const id = asId(chosen);
  return (id && hives.find((h) => h.id.toLowerCase() === id)) || hives[0];
}

function toOwnHive(v: unknown): OwnHive | null {
  if (typeof v !== "object" || v === null) return null;
  const { id, hive_id, hive } = v as Record<string, unknown>;
  if (typeof id !== "string" || typeof hive_id !== "string") return null;
  if (typeof hive !== "object" || hive === null || Array.isArray(hive))
    return null;
  const { name, delete_after } = hive as Record<string, unknown>;
  if (typeof name !== "string") return null;
  return {
    id: hive_id,
    name,
    memberId: id,
    // Absent or not text: the hive is not being deleted.
    deleteAfter: typeof delete_after === "string" ? delete_after : null,
  };
}

function toProfile(v: unknown): OwnHiveProfile | null {
  const base = toOwnHive(v);
  if (!base) return null;
  const { display_name, role } = v as Record<string, unknown>;
  if (typeof display_name !== "string" || typeof role !== "string") return null;
  return { ...base, displayName: display_name, role };
}
