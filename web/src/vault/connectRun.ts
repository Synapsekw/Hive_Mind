// The loop a browser runs over the steps that connect a workspace's wiki links. Each step is one
// request; the server reads the notes and the database decides what may be linked. Nothing here
// reads a note.
import type { ConnectResult, ImportActions } from "../import/types";

export type ConnectTally = {
  linked: number;
  already: number;
  missing: number;
  failed: number;
};

export type ConnectEnd = "finished" | "stopped" | "halted";

/** Steps refused one after another before the run gives up. */
export const GIVE_UP_AFTER = 3;

type Step = Extract<ConnectResult, { ok: true }>;

const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The step as answered, or null when it was refused or is not a step at all. */
function answered(r: unknown): Step | null {
  if (typeof r !== "object" || r === null) return null;
  const a = r as Partial<Step>;
  if (a.ok !== true) return null;
  if (a.next !== null && typeof a.next !== "string") return null;
  return count(a.total) &&
    count(a.scanned) &&
    count(a.linked) &&
    count(a.already) &&
    count(a.missing) &&
    count(a.failed)
    ? (a as Step)
    : null;
}

/**
 * Runs steps from the start until the workspace is done, `stop()` says so, or three steps in a
 * row are refused or throw. A refused step is tried again from the same cursor.
 */
export async function runConnect(
  connect: ImportActions["connect"],
  workspaceId: string,
  on: { progress(done: number, total: number): void; stop(): boolean },
): Promise<{ tally: ConnectTally; end: ConnectEnd }> {
  const tally: ConnectTally = { linked: 0, already: 0, missing: 0, failed: 0 };
  let after: string | null = null;
  let done = 0;
  let streak = 0;
  for (;;) {
    let step: Step | null;
    try {
      step = answered(await connect(workspaceId, after));
    } catch {
      step = null;
    }
    if (!step) {
      streak += 1;
      if (streak >= GIVE_UP_AFTER) return { tally, end: "halted" };
      if (on.stop()) return { tally, end: "stopped" };
      continue;
    }
    streak = 0;
    tally.linked += step.linked;
    tally.already += step.already;
    tally.missing += step.missing;
    tally.failed += step.failed;
    done += step.scanned;
    on.progress(done, step.total);
    // A step that read nothing has nothing after it, whatever cursor it names.
    if (step.next === null || step.scanned === 0)
      return { tally, end: "finished" };
    // A cursor that does not move would ask for the same notes for ever.
    if (step.next === after) return { tally, end: "halted" };
    if (on.stop()) return { tally, end: "stopped" };
    after = step.next;
  }
}
