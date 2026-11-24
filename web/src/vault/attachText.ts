// Every sentence of attaching topics: the panel behind the vault's button, and the stage a
// folder import ends with. Copy is fixed; the numbers come from what the server answered.
import type { AttachTally } from "./attachRun";
import { num } from "./importText";

export const ATTACH = "Attach topics";
export const ATTACH_INTRO =
  "Puts each of your notes in this workspace under the hive's topics it belongs to, by its folder, tags, title and text. Only your own notes are attached.";
export const START = "Attach";
export const ATTACHING = "Attaching topics";
export const ATTACHED = "Topics attached";
export const ATTACH_STOPPED = "Attaching stopped";
export const ATTACH_HALTED =
  "Three steps in a row could not be saved, so attaching stopped. What was attached stays. Attach again to finish the rest.";
export const NO_TOPICS =
  "This hive has no topics yet. Its owner finds them in Settings, under Topics.";
export const AFTER_IMPORT_UNFINISHED =
  "Not every note was attached to its topics. Open the workspace and press Attach topics to finish.";

/** "120 of 480 notes read" */
export const attachProgress = (done: number, total: number) =>
  `${num(done)} of ${num(total)} ${total === 1 ? "note" : "notes"} read`;

/** The counts of a run, in the order they are shown; the fourth only when something failed. */
export function attachCounts(
  t: AttachTally,
): { label: string; value: string }[] {
  const counts = [
    { label: "Attached to a topic", value: num(t.attached) },
    { label: "Already attached", value: num(t.already) },
    { label: "Notes with no topic", value: num(t.none) },
  ];
  if (t.failed > 0)
    counts.push({ label: "Could not be saved", value: num(t.failed) });
  return counts;
}
