import { describe, expect, it } from "vitest";
import {
  acceptEffect,
  badge,
  inboxCount,
  proposer,
  theirNote,
  tierReason,
  vaultHref,
} from "./text";
import type { InboxData, LinkItem } from "./types";

function link(over: Partial<LinkItem> = {}): LinkItem {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    tier: 1,
    createdAt: "2026-11-20T09:00:00.000Z",
    proposedBy: "mine",
    theyAccepted: false,
    mine: {
      id: "00000000-0000-4000-8000-00000000b001",
      title: "Harbour Logistics proposal",
      path: "clients/harbour-logistics/proposal.md",
      workspaceId: "00000000-0000-4000-8000-00000000c001",
    },
    theirs: { memberName: "Ahmed", topic: "clients", title: null },
    ...over,
  };
}

describe("tierReason", () => {
  it.each([
    [1, "Same client or project"],
    [2, "One note refers to the other"],
    [3, "Shared topic"],
    [4, "Similar text"],
  ] as const)("tier %d → %j", (tier, text) => {
    expect(tierReason(tier)).toBe(text);
  });
});

describe("theirNote", () => {
  it("names the note when its title is known", () => {
    expect(
      theirNote(
        link({
          theirs: {
            memberName: "Sara",
            topic: "pricing",
            title: "Pricing 2026",
          },
        }),
      ),
    ).toBe(`Sara's note "Pricing 2026" in pricing`);
  });

  it("says only whose and where when the title is not known", () => {
    expect(theirNote(link())).toBe(
      "a note of Ahmed in clients, not shared with you",
    );
  });
});

describe("proposer", () => {
  it("names the person's own agent", () => {
    expect(proposer(link({ proposedBy: "mine" }))).toBe(
      "Proposed by your agent",
    );
  });

  it("names the colleague's side", () => {
    expect(proposer(link({ proposedBy: "theirs" }))).toBe(
      "Proposed from Ahmed's side",
    );
  });
});

describe("acceptEffect", () => {
  it("waits for the other side when they have not accepted", () => {
    expect(acceptEffect(link({ theyAccepted: false }))).toBe(
      "Accepting lets Ahmed read this note and lets you read theirs. It takes effect when Ahmed accepts too.",
    );
  });

  it("takes effect at once when they have accepted", () => {
    expect(acceptEffect(link({ theyAccepted: true }))).toBe(
      "Accepting lets Ahmed read this note and lets you read theirs. Ahmed has accepted, so it takes effect at once.",
    );
  });
});

describe("inboxCount", () => {
  it("adds the totals, not the rows on the page", () => {
    const data: InboxData = {
      links: [link()],
      linksTotal: 140,
      held: [],
      heldTotal: 120,
    };
    expect(inboxCount(data)).toBe(260);
  });

  it("is 0 for an empty inbox", () => {
    expect(
      inboxCount({ links: [], linksTotal: 0, held: [], heldTotal: 0 }),
    ).toBe(0);
  });
});

describe("badge", () => {
  it.each([
    [0, null],
    [-3, null],
    [1, "1"],
    [7, "7"],
    [99, "99"],
    [100, "99+"],
    [260, "99+"],
  ])("%d → %j", (n, text) => {
    expect(badge(n)).toBe(text);
  });
});

describe("vaultHref", () => {
  it("leads to the note in its workspace", () => {
    expect(vaultHref("ws-1", "note-1")).toBe("/vault?ws=ws-1&note=note-1");
  });

  it("encodes both values", () => {
    expect(vaultHref("a b&c", "n/1?x=y")).toBe(
      "/vault?ws=a%20b%26c&note=n%2F1%3Fx%3Dy",
    );
  });
});
