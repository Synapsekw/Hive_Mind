import type { SupabaseClient } from "@supabase/supabase-js";
import type { MapPayload } from "../map/types";
import { ownHive } from "./own-hive";

export type MapLoad =
  | { state: "ok"; payload: MapPayload }
  | { state: "no-hive" }
  | { state: "error" };

// The caller's own hive (the one of their oldest membership), then the map for it. One bounded
// query and one function call. Only the error code and message are logged, never a payload.
export async function loadMap(
  db: Pick<SupabaseClient, "from" | "rpc" | "auth">,
): Promise<MapLoad> {
  const hive = await ownHive(db);
  if (hive === "error") return { state: "error" };
  if (hive === null) return { state: "no-hive" };

  const graph = await db.rpc("map_graph", { p_hive: hive.id });
  if (graph.error || !graph.data) {
    if (graph.error) {
      console.error("map_graph failed", graph.error.code, graph.error.message);
    }
    return { state: "error" };
  }
  return { state: "ok", payload: graph.data as MapPayload };
}
