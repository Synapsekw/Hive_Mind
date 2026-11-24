// What the folder import's two server actions answer, and the pair of them as the import screen
// takes it. Types only: safe to import anywhere.
import type { ImportNote } from "./plan";

export type Outcome = "created" | "updated" | "unchanged" | "failed";

/** One outcome per path of the batch, in the order sent; `ok: false` when the batch was refused. */
export type BatchResult =
  { ok: true; outcomes: { path: string; outcome: Outcome }[] } | { ok: false };

export type WorkspaceMade =
  | { ok: true; id: string }
  | { ok: false; reason: "name" | "taken" | "limit" | "failed" };

export type ImportActions = {
  /** Bound to the shown hive on the server. */
  createWorkspace(name: string): Promise<WorkspaceMade>;
  importBatch(workspaceId: string, notes: ImportNote[]): Promise<BatchResult>;
};
