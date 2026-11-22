import type { SupabaseClient } from "@supabase/supabase-js";
import type { MapPayload } from "../map/types";

export type MapLoad =
  | { state: "ok"; payload: MapPayload }
  | { state: "no-hive" }
  | { state: "error" };

// The caller's first hive (row-level security already limits `hives` to their own), then the
// map for it. One bounded query and one function call. Only the error code and message are
// logged, never a payload.
export async function loadMap(
  db: Pick<SupabaseClient, "from" | "rpc">,
): Promise<MapLoad> {
  const hives = await db
    .from("hives")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (hives.error) {
    console.error("hives query failed", hives.error.code, hives.error.message);
    return { state: "error" };
  }
  const id = hives.data?.[0]?.id as string | undefined;
  if (!id) return { state: "no-hive" };

  const graph = await db.rpc("map_graph", { p_hive: id });
  if (graph.error || !graph.data) {
    if (graph.error) {
      console.error("map_graph failed", graph.error.code, graph.error.message);
    }
    return { state: "error" };
  }
  return { state: "ok", payload: graph.data as MapPayload };
}
