import { describe, expect, it } from "vitest";
import { fixtureInbox } from "./fixture";
import { inboxCount } from "./text";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const time = (iso: string) => new Date(iso).getTime();

describe("fixtureInbox", () => {
  const data = fixtureInbox();

  it("is deterministic", () => {
    expect(fixtureInbox()).toEqual(fixtureInbox());
    expect(fixtureInbox()).not.toBe(fixtureInbox());
  });

  it("has 3 links and 2 held notes, and totals that say so", () => {
    expect(data.links).toHaveLength(3);
    expect(data.linksTotal).toBe(3);
    expect(data.held).toHaveLength(2);
    expect(data.heldTotal).toBe(2);
    expect(inboxCount(data)).toBe(5);
  });

  it("gives every item, note and workspace a well-formed id, items unique", () => {
    const items = [...data.links, ...data.held].map((i) => i.id);
    expect(new Set(items).size).toBe(5);
    for (const id of items) expect(id).toMatch(UUID);
    for (const l of data.links) {
      expect(l.mine.id).toMatch(UUID);
      expect(l.mine.workspaceId).toMatch(UUID);
    }
    for (const h of data.held) expect(h.workspaceId).toMatch(UUID);
  });

  it("has fixed timestamps, newest first", () => {
    for (const l of data.links)
      expect(new Date(time(l.createdAt)).toISOString()).toBe(l.createdAt);
    for (const h of data.held)
      expect(new Date(time(h.updatedAt)).toISOString()).toBe(h.updatedAt);
    for (let i = 1; i < data.links.length; i++)
      expect(time(data.links[i]!.createdAt)).toBeLessThan(
        time(data.links[i - 1]!.createdAt),
      );
    for (let i = 1; i < data.held.length; i++)
      expect(time(data.held[i]!.updatedAt)).toBeLessThan(
        time(data.held[i - 1]!.updatedAt),
      );
  });

  it("has links of tiers 1, 3 and 4", () => {
    expect(data.links.map((l) => l.tier).sort()).toEqual([1, 3, 4]);
  });

  it("has one link the person's own agent proposed", () => {
    expect(data.links.filter((l) => l.proposedBy === "mine")).toHaveLength(1);
    expect(data.links.some((l) => l.proposedBy === "theirs")).toBe(true);
  });

  it("has one link whose other note has a readable title", () => {
    expect(data.links.filter((l) => l.theirs.title !== null)).toHaveLength(1);
  });

  it("has one link the other side has already accepted", () => {
    expect(data.links.filter((l) => l.theyAccepted)).toHaveLength(1);
  });

  it("has one held note with no agent named", () => {
    expect(data.held.filter((h) => h.agentName === null)).toHaveLength(1);
    expect(data.held.some((h) => h.agentName !== null)).toBe(true);
  });

  it("empty has nothing", () => {
    expect(fixtureInbox({ empty: true })).toEqual({
      links: [],
      linksTotal: 0,
      held: [],
      heldTotal: 0,
    });
  });

  it("many keeps the rows and raises the totals to 140 and 120", () => {
    const many = fixtureInbox({ many: true });
    expect(many.links).toEqual(data.links);
    expect(many.held).toEqual(data.held);
    expect(many.linksTotal).toBe(140);
    expect(many.heldTotal).toBe(120);
    expect(inboxCount(many)).toBe(260);
  });
});
