import { describe, expect, it } from "vitest";
import {
  MCP_COMMAND,
  addFailure,
  envLine,
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

describe("addFailure", () => {
  it.each([
    ["no-account", "Nobody with that email has an account yet."],
    ["already-member", "That person is already a member."],
    ["failed", "That didn't work. Try again."],
  ] as const)("%s → %j", (reason, text) => {
    expect(addFailure(reason)).toBe(text);
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
