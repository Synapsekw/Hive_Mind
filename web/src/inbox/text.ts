// The sentences of an inbox item, and the count the rail shows. Plain functions, so the screen
// and the tests read the same words.
import type { InboxData, LinkItem, Tier } from "./types";

const REASONS: Record<Tier, string> = {
  1: "Same client or project",
  2: "One note refers to the other",
  3: "Shared topic",
  4: "Similar text",
};

/** Why the two notes were proposed as a pair. */
export function tierReason(tier: Tier): string {
  return REASONS[tier];
}

/** The colleague's note, by title only when the person may already read it. */
export function theirNote(item: LinkItem): string {
  const { memberName, topic, title } = item.theirs;
  return title === null
    ? `a note of ${memberName} in ${topic}, not shared with you`
    : `${memberName}'s note "${title}" in ${topic}`;
}

export function proposer(item: LinkItem): string {
  return item.proposedBy === "mine"
    ? "Proposed by your agent"
    : `Proposed from ${item.theirs.memberName}'s side`;
}

/** What accepting does: an accepted link opens both notes to each other. */
export function acceptEffect(item: LinkItem): string {
  const { memberName } = item.theirs;
  return (
    `Accepting lets ${memberName} read this note and lets you read theirs. ` +
    (item.theyAccepted
      ? `${memberName} has accepted, so it takes effect at once.`
      : `It takes effect when ${memberName} accepts too.`)
  );
}

/** What Decline asks before it counts. A declined pair of notes stays declined. */
export function declineQuestion(): string {
  return "Decline this link? It cannot be proposed again.";
}

/** Everything waiting, counted from the totals rather than the rows on the page. */
export function inboxCount(data: InboxData): number {
  return data.linksTotal + data.heldTotal;
}

/** The rail's count: nothing for none, "99+" above 99. */
export function badge(n: number): string | null {
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

export function vaultHref(workspaceId: string, noteId: string): string {
  return `/vault?ws=${encodeURIComponent(workspaceId)}&note=${encodeURIComponent(noteId)}`;
}

/** The row's sentence: the person's own note (emphasised by the screen), then the other one. */
export function linkLine(item: LinkItem): { mine: string; rest: string } {
  const { memberName, title } = item.theirs;
  return {
    mine: item.mine.title || item.mine.path,
    rest:
      title === null
        ? `with a note of ${memberName}'s you can't see yet`
        : `with ${memberName}'s “${title}”`,
  };
}

export const OPENING_MAX = 280;
const FRONT_MATTER = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const HEADING = /^#{1,6}(?:\s|$)/;

/** A note's first lines as plain text: no front matter, no headings, at most 280 characters. */
export function openingOf(body: string): string {
  const text = body.replace(/\r\n?/g, "\n").replace(FRONT_MATTER, "");
  const joined = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !HEADING.test(l))
    .join(" ")
    .replace(/\s+/g, " ");
  if (joined.length <= OPENING_MAX) return joined;
  const cut = joined.slice(0, OPENING_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const ONLY_YOU = "Only you can answer these.";
export const YOUR_NOTE = "Your note";
export const theirLabel = (name: string) => `${name}'s note`;
export const NOT_SHARED = "Not shared with you";
export const SEE_LATER = "You will see it once you both accept.";
export const ACCEPT_LINK = "Accept link";
export const FINAL_NOTE = "A declined link is final for this pair of notes.";
export const HELD_NOTE =
  "A held note is visible only to you until you release it.";
export const heldFrom = (agent: string | null, date: string) =>
  `Held from ${agent ?? "an agent"} · ${date}`;
export const theyAccepted = (name: string) => `${name} accepted`;
export const OPEN_VAULT = "Open the vault";
export const OPEN_IN_VAULT = "Open in vault";
export const BACK = "Inbox";
export const ALL_DONE = "All done.";
export const EMPTY_TITLE = "Nothing needs you.";
export const EMPTY_TEXT =
  "Link proposals between your notes and a colleague's, and notes your self-hosted agents hold for you, wait here.";
export const moreWaiting = (n: number) =>
  `${n} more ${n === 1 ? "is" : "are"} waiting. Reload the page to see them.`;
