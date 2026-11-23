// Joining the hives that invited the signed-in person's own, confirmed email address. The
// database decides everything: whose email it is, whether it is confirmed, which invitations
// are still open. This only asks, and answers how many hives were joined.
//
// It runs on the way in (`/auth/confirm`) and on the home page of a person with no hive, so it
// must never stand between a person and the app: any failure answers 0 and nothing is thrown.
// A log line carries an error's code and message, or the name of what was thrown, and nothing
// else.
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = Pick<SupabaseClient, "rpc">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** How many hives the person joined just now; 0 when none, and 0 on any failure. */
export async function claimIn(db: Db): Promise<number> {
  try {
    const res = (await db.rpc("claim_invitations")) as Res;
    if (res.error) {
      console.error(
        "claim_invitations failed",
        res.error.code,
        res.error.message,
      );
      return 0;
    }
    const joined = res.data;
    if (typeof joined !== "number" || !Number.isInteger(joined) || joined < 0) {
      console.error("claim_invitations answer has an unexpected shape");
      return 0;
    }
    return joined;
  } catch (e) {
    console.error("claim_invitations failed", e instanceof Error ? e.name : "");
    return 0;
  }
}
