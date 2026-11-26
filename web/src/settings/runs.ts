// Which sync run the Sync tab reads its too-big list from. Client state only.
import type { SyncRun } from "./types";

/** The newest run that has finished, from a newest-first list; one still going has no list yet. */
export function newestFinished(runs: SyncRun[]): SyncRun | null {
  return runs.find((r) => r.finishedAt !== null) ?? null;
}
