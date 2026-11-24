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
