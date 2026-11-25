import { describe, expect, it } from "vitest";
import {
  acceptEffect,
  badge,
  declineQuestion,
  inboxCount,
  linkLine,
  openingOf,
  proposer,
  theirNote,
  tierReason,
  vaultHref,
} from "./text";
import { fixtureInbox } from "./fixture";
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

describe("declineQuestion", () => {
  it("asks, and says a decline is final", () => {
    expect(declineQuestion()).toBe(
      "Decline this link? It cannot be proposed again.",
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

describe("linkLine", () => {
  const base = fixtureInbox().links;
  it("names their note's title when the person may read it", () => {
    const item = base.find((l) => l.theirs.title !== null)!;
    expect(linkLine(item)).toEqual({
      mine: "Northwind renewal, draft terms",
      rest: "with Sara's \u201cPricing 2026\u201d",
    });
  });
  it("says the note can't be seen yet when the title is unknown", () => {
    expect(linkLine(base[0]!)).toEqual({
      mine: "Harbour Logistics proposal",
      rest: "with a note of Ahmed's you can't see yet",
    });
  });
  it("falls back to the path when the person's own note has no title", () => {
    const item = { ...base[0]!, mine: { ...base[0]!.mine, title: "" } };
    expect(linkLine(item).mine).toBe("clients/harbour-logistics/proposal.md");
  });
});

describe("openingOf", () => {
  it("drops front matter and headings and joins the first lines", () => {
    const body =
      "---\ntags: [a]\n---\n# Title\n\nFirst line.\nSecond line.\n\n## Part\nThird.";
    expect(openingOf(body)).toBe("First line. Second line. Third.");
  });
  it("cuts at 280 characters on a word boundary and adds an ellipsis", () => {
    const body = Array.from({ length: 80 }, () => "word").join(" "); // 399 characters
    const out = openingOf(body);
    expect(out.endsWith("\u2026")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });
  it("keeps a short body whole", () => {
    expect(openingOf("Just this.")).toBe("Just this.");
  });
  it("answers an empty string for an empty or heading-only body", () => {
    expect(openingOf("")).toBe("");
    expect(openingOf("# Only a heading\n")).toBe("");
  });
  it("reads Windows line ends", () => {
    expect(openingOf("# T\r\nOne.\r\nTwo.")).toBe("One. Two.");
  });
});
