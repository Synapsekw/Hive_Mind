import { describe, expect, it } from "vitest";
import { fixtureSettings } from "./fixture";
import { PROVIDERS } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const fixed = (iso: string) => new Date(iso).toISOString() === iso;

describe("fixtureSettings", () => {
  const data = fixtureSettings();

  it("is deterministic and hands out fresh copies", () => {
    expect(fixtureSettings()).toEqual(fixtureSettings());
    expect(fixtureSettings()).not.toBe(fixtureSettings());
    const a = fixtureSettings();
    a.agents[0]!.name = "changed";
    a.members.pop();
    a.workspaces[0]!.name = "changed";
    a.invitations[0]!.name = "changed";
    a.invitations.pop();
    expect(fixtureSettings()).toEqual(data);
  });

  it("is the hive Synapse, seen by its owner", () => {
    expect(data.hiveName).toBe("Synapse");
    expect(data.isOwner).toBe(true);
  });

  it("has the workspaces Main and DRA", () => {
    expect(data.workspaces.map((w) => w.name)).toEqual(["Main", "DRA"]);
  });

  it("has an active Claude Code in Main that was used recently", () => {
    const a = data.agents.find((x) => x.name === "Claude Code")!;
    expect(a.status).toBe("active");
    expect(a.provider).toBe("Claude Code");
    expect(a.trustTier).toBe("vendor");
    expect(a.workspaceId).toBe(data.workspaces[0]!.id);
    expect(a.lastUsedAt).not.toBeNull();
  });

  it("has an active self-hosted Local model in DRA that was never used", () => {
    const a = data.agents.find((x) => x.name === "Local model")!;
    expect(a.status).toBe("active");
    expect(a.trustTier).toBe("self_hosted");
    expect(a.workspaceId).toBe(data.workspaces[1]!.id);
    expect(a.lastUsedAt).toBeNull();
  });

  it("has a revoked Old laptop, and nothing else", () => {
    const a = data.agents.find((x) => x.name === "Old laptop")!;
    expect(a.status).toBe("revoked");
    expect(data.agents).toHaveLength(3);
  });

  it("gives every agent a known provider and a workspace of the hive", () => {
    const workspaces = data.workspaces.map((w) => w.id);
    for (const a of data.agents) {
      expect(PROVIDERS).toContain(a.provider);
      expect(workspaces).toContain(a.workspaceId);
    }
  });

  it("has the members Danijel (owner, me), Ahmed and Sara", () => {
    expect(data.members.map((m) => [m.name, m.role, m.isMe])).toEqual([
      ["Danijel", "owner", true],
      ["Ahmed", "member", false],
      ["Sara", "member", false],
    ]);
  });

  it("has two pending invitations, the newest first", () => {
    expect(data.invitations).toEqual([
      {
        id: "00000000-0000-4000-8000-00000000c001",
        email: "lena@example.com",
        name: "Lena",
        createdAt: "2026-11-22T16:00:00.000Z",
        expiresAt: "2026-12-06T16:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-00000000c002",
        email: "marko@example.com",
        name: "Marko",
        createdAt: "2026-11-20T09:30:00.000Z",
        expiresAt: "2026-12-04T09:30:00.000Z",
      },
    ]);
  });

  it("gives every invitation a lower-case email and fourteen days", () => {
    const days = 14 * 24 * 60 * 60 * 1000;
    for (const i of data.invitations) {
      expect(i.email).toBe(i.email.toLowerCase());
      expect(
        new Date(i.expiresAt).getTime() - new Date(i.createdAt).getTime(),
      ).toBe(days);
    }
  });

  it("has well-formed ids, unique across the data", () => {
    const ids = [
      ...data.workspaces.map((w) => w.id),
      ...data.agents.map((a) => a.id),
      ...data.members.map((m) => m.id),
      ...data.invitations.map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it("has fixed timestamps", () => {
    for (const a of data.agents) {
      expect(fixed(a.createdAt)).toBe(true);
      if (a.lastUsedAt !== null) expect(fixed(a.lastUsedAt)).toBe(true);
    }
    for (const i of data.invitations) {
      expect(fixed(i.createdAt)).toBe(true);
      expect(fixed(i.expiresAt)).toBe(true);
    }
  });

  it("member: not the owner, and Ahmed is me", () => {
    const m = fixtureSettings({ member: true });
    expect(m.isOwner).toBe(false);
    expect(m.members.map((x) => [x.name, x.role, x.isMe])).toEqual([
      ["Danijel", "owner", false],
      ["Ahmed", "member", true],
      ["Sara", "member", false],
    ]);
    expect(m.agents).toEqual(data.agents);
    expect(m.workspaces).toEqual(data.workspaces);
    expect(m.hiveName).toBe("Synapse");
    expect(m.invitations).toEqual([]);
  });

  it("none: no agents, the rest unchanged", () => {
    const n = fixtureSettings({ none: true });
    expect(n.agents).toEqual([]);
    expect(n.workspaces).toEqual(data.workspaces);
    expect(n.members).toEqual(data.members);
    expect(n.invitations).toEqual(data.invitations);
    expect(n.isOwner).toBe(true);
  });

  it("member and none combine", () => {
    const b = fixtureSettings({ member: true, none: true });
    expect(b.isOwner).toBe(false);
    expect(b.agents).toEqual([]);
    expect(b.invitations).toEqual([]);
    expect(b.members.find((x) => x.isMe)!.name).toBe("Ahmed");
  });
});
