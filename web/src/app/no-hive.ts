// Where the home page sends a signed-in person who is in no hive. Nobody joins a hive without
// pressing Join, so the page never joins for them: when invitations are waiting for their
// address it sends them to `/join` to decide, and otherwise it stays and says so.
//
// One call, `my_invitations`, made only for a person with no hive. A failure stays: it must
// never stand between a person and the page, and `/join` only ever leads back here after a
// hive was joined, so this cannot loop.
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitingIn } from "./join/join";

export async function afterNoHive(
  db: Pick<SupabaseClient, "rpc">,
): Promise<"/join" | null> {
  const waiting = await waitingIn(db);
  return waiting !== "error" && waiting.length > 0 ? "/join" : null;
}
