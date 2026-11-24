// One step of turning a workspace's wiki links into links, given a client signed in as the person.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectResult } from "../../import/types";

type Db = Pick<SupabaseClient, "from" | "auth">;

export async function connectBatchIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<ConnectResult> {
  void db;
  void workspaceId;
  void after;
  return { ok: false };
}
