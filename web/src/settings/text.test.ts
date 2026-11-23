import { describe, expect, it } from "vitest";
import {
  INVITATIONS_NOTE,
  INVITE_HELP,
  MCP_COMMAND,
  envLine,
  inviteFailure,
  inviteNotice,
  sendFailure,
  sentAgain,
  sortAgents,
  statusText,
  tierHelp,
  tierText,
} from "./text";
import type { Agent } from "./types";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    name: "Claude Code",
    provider: "Claude Code",
    trustTier: "vendor",
    workspaceId: "00000000-0000-4000-8000-0000000000e1",
    createdAt: "2026-11-20T09:00:00.000Z",
    lastUsedAt: null,
    status: "active",
    ...over,
  };
}

describe("tierText", () => {
  it.each([
    ["vendor", "Vendor-hosted"],
    ["self_hosted", "Self-hosted, notes held for release"],
  ] as const)("%s → %j", (tier, text) => {
    expect(tierText(tier)).toBe(text);
  });
});

describe("tierHelp", () => {
  it.each([
    [
      "vendor",
      "For Claude, ChatGPT and other agents run by their vendor. Notes are saved at once.",
    ],
    [
      "self_hosted",
      "For open-source or local agents. Its notes are held until you release them.",
    ],
  ] as const)("%s → %j", (tier, text) => {
    expect(tierHelp(tier)).toBe(text);
  });
});

describe("statusText", () => {
  it.each([
    ["active", null],
    ["revoked", "Revoked"],
    ["expired", "Expired"],
  ] as const)("%s → %j", (status, text) => {
    expect(statusText(status)).toBe(text);
  });
});

describe("inviteFailure", () => {
  it.each([
    ["already-member", "That person is already a member."],
    ["already-invited", "That email is already invited."],
    ["too-many", "Too many invitations today. Try again tomorrow."],
    ["failed", "That didn't work. Try again."],
  ] as const)("%s → %j", (reason, text) => {
    expect(inviteFailure(reason)).toBe(text);
  });
});

describe("sendFailure", () => {
  it.each([
    ["wait", "Sent a moment ago. Wait two minutes and try again."],
    [
      "limit",
      "This address has had as many invitation emails as allowed. Try again tomorrow.",
    ],
    ["failed", "That didn't work. Try again."],
  ] as const)("%s → %j", (reason, text) => {
    expect(sendFailure(reason)).toBe(text);
  });
});

describe("inviteNotice", () => {
  it("says where the invitation was sent", () => {
    expect(inviteNotice("lena@example.com", true)).toBe(
      "Invitation sent to lena@example.com.",
    );
  });

  it("says what to do when the email could not be sent", () => {
    expect(inviteNotice("lena@example.com", false)).toBe(
      "Invitation saved, but the email could not be sent. Wait two minutes, then use Send again.",
    );
  });
});

describe("sentAgain", () => {
  it("says whose invitation was sent again", () => {
    expect(sentAgain("Lena")).toBe("Invitation for Lena sent again.");
  });
});

describe("the texts about joining", () => {
  it("INVITE_HELP says the person gets an email and joins by pressing Join", () => {
    expect(INVITE_HELP).toBe(
      "They get an email with a link to the invitation and become a member when they press Join.",
    );
  });

  it("INVITATIONS_NOTE says the same of the open invitations", () => {
    expect(INVITATIONS_NOTE).toBe(
      "Not members yet. Each has an email with a link and joins by pressing Join.",
    );
  });

  it("no text tells the owner to pass an address on, or says anyone is added", () => {
    const all = [
      INVITE_HELP,
      INVITATIONS_NOTE,
      inviteNotice("lena@example.com", true),
      inviteNotice("lena@example.com", false),
      sentAgain("Lena"),
    ].join(" ");
    expect(all).not.toMatch(/added|Ask |\/login|first sign in/);
  });
});

describe("sortAgents", () => {
  const oldActive = agent({ id: "a", createdAt: "2026-11-01T00:00:00.000Z" });
  const newActive = agent({ id: "b", createdAt: "2026-11-20T00:00:00.000Z" });
  const newRevoked = agent({
    id: "c",
    status: "revoked",
    createdAt: "2026-11-22T00:00:00.000Z",
  });
  const oldExpired = agent({
    id: "d",
    status: "expired",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const midRevoked = agent({
    id: "e",
    status: "revoked",
    createdAt: "2026-11-10T00:00:00.000Z",
  });

  it("puts active agents first, then the rest", () => {
    const sorted = sortAgents([newRevoked, oldActive, oldExpired, newActive]);
    expect(sorted.map((a) => a.status)).toEqual([
      "active",
      "active",
      "revoked",
      "expired",
    ]);
  });

  it("puts the newest first inside each group", () => {
    const sorted = sortAgents([
      oldExpired,
      oldActive,
      midRevoked,
      newActive,
      newRevoked,
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["b", "a", "c", "e", "d"]);
  });

  it("does not mutate its input", () => {
    const input = [newRevoked, oldActive, newActive];
    const before = [...input];
    const sorted = sortAgents(input);
    expect(sorted).not.toBe(input);
    expect(input).toEqual(before);
    expect(input[0]).toBe(newRevoked);
  });

  it("gives an empty list for none", () => {
    expect(sortAgents([])).toEqual([]);
  });
});

describe("envLine", () => {
  it("is the line for the .env file", () => {
    expect(envLine("hive_abc123")).toBe("HIVE_AGENT_TOKEN=hive_abc123");
  });
});

describe("MCP_COMMAND", () => {
  it("is the command that adds the hive server", () => {
    expect(MCP_COMMAND).toBe(
      "claude mcp add --scope user hive -- node --env-file=<path to Hive_Mind>/.env <path to Hive_Mind>/mcp/dist/index.js",
    );
  });
});
