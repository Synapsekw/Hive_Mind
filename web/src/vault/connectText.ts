// Every sentence of connecting wiki links: the panel behind the vault's button, and the stage a
// folder import ends with. Copy is fixed; the numbers come from what the server answered.
import type { ConnectTally } from "./connectRun";
import { num } from "./importText";

export const CONNECT = "Connect wiki links";
export const CONNECT_INTRO =
  "Turns the [[wiki links]] between your notes in this workspace into links. Only your own notes are linked. Links that are already there stay as they are.";
export const START = "Connect";
export const CONNECTING = "Connecting wiki links";
export const CONNECTED = "Wiki links connected";
export const CONNECT_STOPPED = "Connecting stopped";
export const CONNECT_HALTED =
  "Three steps in a row could not be saved, so connecting stopped. The links that were made stay. Connect again to finish the rest.";
export const AFTER_IMPORT_UNFINISHED =
  "Not every wiki link was connected. Open the workspace and press Connect wiki links to finish.";

/** "120 of 480 notes read" */
export const connectProgress = (done: number, total: number) =>
  `${num(done)} of ${num(total)} ${total === 1 ? "note" : "notes"} read`;

/** The counts of a run, in the order they are shown; the fourth only when something failed. */
export function connectCounts(
  t: ConnectTally,
): { label: string; value: string }[] {
  const counts = [
    { label: "Links made", value: num(t.linked) },
    { label: "Already linked", value: num(t.already) },
    { label: "Pointing at no note", value: num(t.missing) },
  ];
  if (t.failed > 0)
    counts.push({ label: "Could not be saved", value: num(t.failed) });
  return counts;
}
