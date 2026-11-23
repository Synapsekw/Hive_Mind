// What the inbox's own server action does, given a client signed in as the person. It checks its
// arguments before any call, sends only the person's answer, and reports `{ ok }` alone: the
// database's `respond_to_link` decides whether the link is theirs to answer. Only an error's
// code and message are logged. Releasing a held note is the vault's `releaseIn`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Result } from "../../inbox/types";
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
