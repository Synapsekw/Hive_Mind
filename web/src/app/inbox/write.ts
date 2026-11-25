// What the inbox's own server action does, given a client signed in as the person. It checks its
// arguments before any call, sends only the person's answer, and reports `{ ok }` alone: the
// database's `respond_to_link` decides whether the link is theirs to answer. Only an error's
// code and message are logged. Releasing a held note is the vault's `releaseIn`.
import type { SupabaseClient } from "@supabase/supabase-js";
import { openingOf } from "../../inbox/text";
import type { Opening, Result } from "../../inbox/types";
import { isUuid } from "../vault/validate";

type Db = Pick<SupabaseClient, "rpc" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const NO: Result = { ok: false };
const YES: Result = { ok: true };

export async function respondIn(
  db: Db,
  id: unknown,
  accept: unknown,
): Promise<Result> {
  if (!isUuid(id) || typeof accept !== "boolean") return NO;
  const { data } = await db.auth.getUser();
  if (!data.user?.id) return NO;
  const res = (await db.rpc("respond_to_link", {
    p_link: id,
    p_accept: accept,
  })) as Res;
  if (res.error) {
    console.error("respond_to_link failed", res.error.code, res.error.message);
    return NO;
  }
  return YES;
}

/**
 * A note's opening lines, for the inbox's detail pane: one primary-key read of `body`, cut to
 * 280 characters before it leaves the server. Row-level security decides whether the person may
 * read it; an unreadable row answers `{ ok: false }`. Only the error's code is logged.
 */
export async function openingIn(
  db: Pick<SupabaseClient, "from">,
  id: unknown,
): Promise<Opening> {
  if (!isUuid(id)) return { ok: false };
  const res = (await db
    .from("notes")
    .select("body")
    .eq("id", id)
    .limit(1)) as unknown as {
    data: { body?: unknown }[] | null;
    error: { code?: string } | null;
  };
  if (res.error) {
    console.error("note opening failed", res.error.code);
    return { ok: false };
  }
  const body = res.data?.[0]?.body;
  return typeof body === "string"
    ? { ok: true, text: openingOf(body) }
    : { ok: false };
}
