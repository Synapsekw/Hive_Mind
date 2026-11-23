// A deterministic sample inbox for the dev page and the tests: 3 proposed links and 2 notes an
// agent held back, newest first. The edges the screen has to show are all there: a link the
// person's own agent proposed, one whose other note the person may already read (so it has a
// title), one the colleague has already accepted, and a held note with no agent named. Ids and
// timestamps are fixed; nothing is random and nothing reads the clock.
import type { HeldItem, InboxData, LinkItem } from "./types";

const WORKSPACE = "00000000-0000-4000-8000-0000000000e1";

const LINKS: LinkItem[] = [
  {
    id: "00000000-0000-4000-8000-00000000a001",
    tier: 1,
    createdAt: "2026-11-22T09:40:00.000Z",
    proposedBy: "mine",
    theyAccepted: false,
    mine: {
      id: "00000000-0000-4000-8000-00000000b001",
      title: "Harbour Logistics proposal",
      path: "clients/harbour-logistics/proposal.md",
      workspaceId: WORKSPACE,
    },
    theirs: { memberName: "Ahmed", topic: "clients", title: null },
  },
  {
    id: "00000000-0000-4000-8000-00000000a002",
    tier: 3,
    createdAt: "2026-11-21T15:05:00.000Z",
    proposedBy: "theirs",
    theyAccepted: false,
    mine: {
      id: "00000000-0000-4000-8000-00000000b002",
      title: "Northwind renewal, draft terms",
      path: "clients/northwind/renewal-draft.md",
      workspaceId: WORKSPACE,
    },
    theirs: { memberName: "Sara", topic: "pricing", title: "Pricing 2026" },
  },
  {
    id: "00000000-0000-4000-8000-00000000a003",
    tier: 4,
    createdAt: "2026-11-19T08:15:00.000Z",
    proposedBy: "theirs",
    theyAccepted: true,
    mine: {
      id: "00000000-0000-4000-8000-00000000b003",
      title: "Site visit, 18 November",
      path: "projects/site-visit-2026-11-18.md",
      workspaceId: WORKSPACE,
    },
    theirs: { memberName: "Ahmed", topic: "projects", title: null },
  },
];

const HELD: HeldItem[] = [
  {
    id: "00000000-0000-4000-8000-00000000b004",
    title: "Lead review, November",
    path: "sales/lead-review-november.md",
    workspaceId: WORKSPACE,
    agentName: "Claude",
    updatedAt: "2026-11-22T11:20:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-00000000b005",
    title: "Kickoff meeting notes",
    path: "clients/harbour-logistics/kickoff-notes.md",
    workspaceId: WORKSPACE,
    agentName: null,
    updatedAt: "2026-11-20T16:45:00.000Z",
  },
];

/**
 * The sample inbox. `empty` has nothing waiting; `many` keeps the same rows but says 140 links
 * and 120 held notes exist, the way a capped load does.
 */
export function fixtureInbox(
  opts: { empty?: boolean; many?: boolean } = {},
): InboxData {
  if (opts.empty) return { links: [], linksTotal: 0, held: [], heldTotal: 0 };
  const links = LINKS.map((l) => ({
    ...l,
    mine: { ...l.mine },
    theirs: { ...l.theirs },
  }));
  const held = HELD.map((h) => ({ ...h }));
  return {
    links,
    linksTotal: opts.many ? 140 : links.length,
    held,
    heldTotal: opts.many ? 120 : held.length,
  };
}
