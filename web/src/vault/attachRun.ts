// The loop a browser runs over the steps that attach a workspace's notes to the hive's topics.
// Each step is one request; the server reads the notes and the database decides what may be
// attached. Nothing here reads a note.
import type { ImportActions } from "../import/types";
import type { AttachResult } from "../topics/types";

export type AttachTally = {
  attached: number;
  already: number;
  none: number;
  failed: number;
  /** The hive's topics, as the last step counted them; 0 means there was nothing to attach to. */
  topics: number;
};
export type AttachEnd = "finished" | "stopped" | "halted";

/** Steps refused one after another before the run gives up. */
export const GIVE_UP_AFTER = 3;

type Step = Extract<AttachResult, { ok: true }>;

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
    count(a.attached) &&
    count(a.already) &&
    count(a.none) &&
    count(a.failed) &&
    count(a.topics)
    ? (a as Step)
    : null;
}

export async function runAttach(
  attach: ImportActions["attach"],
  workspaceId: string,
  on: { progress(done: number, total: number): void; stop(): boolean },
): Promise<{ tally: AttachTally; end: AttachEnd }> {
  const tally: AttachTally = {
    attached: 0,
    already: 0,
    none: 0,
    failed: 0,
    topics: 0,
  };
  let after: string | null = null;
  let done = 0;
  let streak = 0;
  for (;;) {
    let step: Step | null;
    try {
      step = answered(await attach(workspaceId, after));
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
    tally.attached += step.attached;
    tally.already += step.already;
    tally.none += step.none;
    tally.failed += step.failed;
    tally.topics = step.topics;
    // No topics: the server read no note, and there is nothing to walk.
    if (step.topics === 0) return { tally, end: "finished" };
    done += step.scanned;
    on.progress(done, step.total);
    if (step.next === null || step.scanned === 0)
      return { tally, end: "finished" };
    if (step.next === after) return { tally, end: "halted" };
    if (on.stop()) return { tally, end: "stopped" };
    after = step.next;
  }
}
