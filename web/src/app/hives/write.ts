// What the hive switcher's two server actions do, given a client signed in as the person and
// the browser's cookies.
//
// Neither decides anything about who may see what. Switching reads the person's own membership
// in the hive they named (row-level security answers) and only then remembers the choice in a
// cookie; the cookie itself grants nothing (see `chosen-hive.ts`). Creating calls `create_hive`,
// where the database checks the names and the limit on owned hives.
//
// Arguments are checked before any query. A log line carries an error's code and message or
// the name of what was thrown: never an argument, a row or a cookie's value. The database's
// words are never answered to the caller, only one of the fixed reasons.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hiveCookie, type CookieToSet } from "../chosen-hive";
import { sessionUserId } from "../own-hive";
import { isUuid } from "../vault/validate";

type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };
/** The part of the request's cookies these actions use. */
export type Jar = { set(cookie: CookieToSet): unknown };

export type Created =
  | { ok: true }
  | { ok: false; reason: "name" | "display-name" | "limit" | "failed" };
type Reason = Extract<Created, { ok: false }>["reason"];

/** The longest a hive's name, and a person's name in it, may be: counted as the database does. */
const NAME_MAX = 60;

const production = () => process.env.NODE_ENV === "production";
const no = (reason: Reason): Created => ({ ok: false, reason });

/**
 * Makes `id` the hive the screens show, when the person is in it. An id that is not one asks
 * nothing; without a session nothing is asked either. The cookie is set only after the database
 * answered the person's own membership in that hive.
 */
export async function switchHiveIn(
  db: Db,
  jar: Jar,
  id: unknown,
): Promise<{ ok: boolean }> {
  if (!isUuid(id)) return { ok: false };
  try {
    const uid = await sessionUserId(db);
    if (!uid) return { ok: false };
    const res = (await db
      .from("members")
      .select("hive_id")
      .eq("user_id", uid)
      .eq("hive_id", id)
      .limit(1)) as Res;
    if (res.error) {
      console.error("switch hive failed", res.error.code, res.error.message);
      return { ok: false };
    }
    const row: unknown = Array.isArray(res.data) ? res.data[0] : undefined;
    if (typeof row !== "object" || row === null) return { ok: false };
    // The id the database answered, not the one that was sent.
    const found = (row as Record<string, unknown>).hive_id;
    if (!isUuid(found) || found.toLowerCase() !== id.toLowerCase())
      return { ok: false };
    jar.set(hiveCookie(found.toLowerCase(), production()));
    return { ok: true };
  } catch (e) {
    console.error("switch hive failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}

/** Trimmed text of 1 to 60 characters (code points, as Postgres counts them), else null. */
function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  const length = Array.from(text).length;
  return length >= 1 && length <= NAME_MAX ? text : null;
}

/** The database's refusals that have a reason of their own; every other one is "failed". */
const REFUSALS: Record<string, Reason> = {
  "a hive needs a name": "name",
  "that hive name is too long": "name",
  "you need a name in the hive": "display-name",
  "that name is too long": "display-name",
  "you already own 5 hives": "limit",
};

/**
 * Starts a hive owned by the person and makes it the one the screens show. Both names are
 * trimmed and must be 1 to 60 characters; one that is not is refused here, asking nothing. The
 * database checks them again, and counts the hives the person already owns.
 */
export async function createHiveIn(
  db: Db,
  jar: Jar,
  name: unknown,
  displayName: unknown,
): Promise<Created> {
  const hiveName = cleanName(name);
  if (hiveName === null) return no("name");
  const ownName = cleanName(displayName);
  if (ownName === null) return no("display-name");
  try {
    const res = (await db.rpc("create_hive", {
      p_name: hiveName,
      p_display_name: ownName,
    })) as Res;
    if (res.error) {
      console.error("create_hive failed", res.error.code, res.error.message);
      return no(
        Object.hasOwn(REFUSALS, res.error.message)
          ? REFUSALS[res.error.message]!
          : "failed",
      );
    }
    if (!isUuid(res.data)) {
      console.error("create_hive answer has an unexpected shape");
      return no("failed");
    }
    jar.set(hiveCookie(res.data.toLowerCase(), production()));
    return { ok: true };
  } catch (e) {
    console.error("create_hive failed", e instanceof Error ? e.name : "");
    return no("failed");
  }
}
