import { describe, expect, it } from "vitest";
import {
  INVITATIONS_NOTE,
  INVITE_HELP,
  CONNECT_TITLE,
  MCP_COMMAND,
  REVOKE_ITEM,
  DELETE_HIVE_ITEM,
  INVITED,
  INVITE_TITLE,
  KEEP_HIVE,
  REVOKE_INVITATION,
  SEND_AGAIN,
  agentLine,
  invitationLine,
  envLine,
  foldedAgents,
  inviteFailure,
  inviteNotice,
  sendFailure,
  sentAgain,
  sortAgents,
  statusText,
  tierHelp,
  tierText,
} from "./text";
import type { Agent, Invitation } from "./types";

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

describe("deleting the hive", () => {
  it("says what would be erased, with one of each in the singular", async () => {
    const t = await import("./text");
    expect(t.deletionCounts({ members: 3, notes: 128, files: 14 })).toBe(
      "Deleting this hive erases 128 notes and 14 files of 3 members.",
    );
    expect(t.deletionCounts({ members: 1, notes: 1, files: 1 })).toBe(
      "Deleting this hive erases 1 note and 1 file of 1 member.",
    );
    expect(t.deletionCounts({ members: 2, notes: 0, files: 0 })).toBe(
      "Deleting this hive erases 0 notes and 0 files of 2 members.",
    );
    expect(t.DELETE_UNCOUNTED).toBe(
      "Deleting this hive erases every member's notes and files.",
    );
  });

  it("names the section, the field and the two buttons", async () => {
    const t = await import("./text");
    expect(t.DELETE_TITLE).toBe("Delete this hive");
    expect(t.DELETE_FIELD).toBe("Type the hive's name to confirm");
    expect(t.DELETE_HIVE).toBe("Delete hive");
    expect(t.CANCEL_DELETION).toBe("Cancel deletion");
    expect(t.DELETED_ON).toBe("This hive will be deleted on");
  });

  it("says why Delete hive cannot be pressed yet, naming the hive", async () => {
    const t = await import("./text");
    expect(t.deleteHint("Synapse")).toBe(
      'Delete hive can be pressed once you have typed "Synapse" exactly.',
    );
  });

  it("says one line for each refusal", async () => {
    const t = await import("./text");
    expect(t.deleteFailure("name")).toBe("That is not this hive's name.");
    expect(t.deleteFailure("failed")).toBe("That didn't work. Try again.");
    expect(t.deleteFailure("other" as never)).toBe(
      "That didn't work. Try again.",
    );
  });
});

describe("the workspaces", () => {
  it("says how many notes a workspace holds", async () => {
    const { workspaceNotes } = await import("./text");
    const w = { id: "w", name: "DRA" };
    expect(workspaceNotes({ ...w, notes: 25 })).toBe("25 notes");
    expect(workspaceNotes({ ...w, notes: 1 })).toBe("1 note");
    expect(workspaceNotes({ ...w, notes: 0 })).toBe("No notes");
    expect(workspaceNotes({ ...w, notes: null })).toBeNull();
  });

  it("asks before deleting, naming the workspace and what goes with it", async () => {
    const { workspaceQuestion } = await import("./text");
    const w = { id: "w", name: "DRA" };
    expect(workspaceQuestion({ ...w, notes: 25 })).toBe(
      "Delete DRA and its 25 notes?",
    );
    expect(workspaceQuestion({ ...w, notes: 1 })).toBe(
      "Delete DRA and its 1 note?",
    );
    expect(workspaceQuestion({ ...w, notes: 0 })).toBe("Delete DRA?");
    expect(workspaceQuestion({ ...w, notes: null })).toBe("Delete DRA?");
  });

  it("says one line for each refusal, and that the computer's files stay", async () => {
    const { workspaceFailure, workspaceDeleted, WORKSPACES_NOTE } =
      await import("./text");
    expect(workspaceFailure("last")).toBe("You need at least one workspace.");
    expect(workspaceFailure("agents")).toBe(
      "Revoke this workspace's agents first.",
    );
    expect(workspaceFailure("files")).toBe(
      "Delete this workspace's files in the Gallery first.",
    );
    expect(workspaceFailure("failed")).toBe("That didn't work. Try again.");
    expect(workspaceFailure("other" as never)).toBe(
      "That didn't work. Try again.",
    );
    expect(workspaceDeleted("DRA")).toBe("DRA deleted.");
    expect(WORKSPACES_NOTE).toContain("files on your computer are not touched");
  });
});

describe("the Agents tab", () => {
  it("names the dialog and the menu item", () => {
    expect(CONNECT_TITLE).toBe("Connect an agent");
    expect(REVOKE_ITEM).toBe("Revoke…");
  });
  it("folds the revoked agents in one line", () => {
    expect(foldedAgents(1)).toBe("1 revoked or expired agent");
    expect(foldedAgents(3)).toBe("3 revoked or expired agents");
  });
  it("says an agent in one line", () => {
    const now = Date.UTC(2026, 10, 23, 12);
    const a = {
      id: "a",
      name: "C",
      provider: "Claude",
      trustTier: "vendor",
      workspaceId: "w",
      createdAt: "2026-11-20T00:00:00Z",
      lastUsedAt: null,
      status: "active",
    } as const;
    expect(agentLine(a, "Main", now)).toEqual([
      "Claude",
      "Vendor-hosted",
      "Main",
      "Never used",
    ]);
    expect(agentLine(a, null, now)).toEqual([
      "Claude",
      "Vendor-hosted",
      "Never used",
    ]);
  });
  it("says when an agent was last used", () => {
    const now = Date.UTC(2026, 10, 23, 12);
    const a = agent({ lastUsedAt: "2026-11-22T08:00:00Z" });
    expect(agentLine(a, null, now).at(-1)).toBe("Last used 22 Nov");
  });
});

describe("invitationLine", () => {
  const invitation: Invitation = {
    id: "00000000-0000-4000-8000-0000000000b1",
    email: "lena@example.com",
    name: "Lena",
    createdAt: "2026-11-22T09:00:00.000Z",
    expiresAt: "2026-12-06T09:00:00.000Z",
  };
  it("is the email, when it was sent and when it expires", () => {
    const now = Date.UTC(2026, 10, 23, 12);
    expect(invitationLine(invitation, now)).toEqual([
      "lena@example.com",
      "Invited 22 Nov",
      "Expires 6 Dec",
    ]);
  });
});

describe("the People and Hive words", () => {
  it("are the ones the spec names", () => {
    expect(INVITE_TITLE).toBe("Invite someone");
    expect(INVITED).toBe("Invited");
    expect(SEND_AGAIN).toBe("Send again");
    expect(REVOKE_INVITATION).toBe("Revoke invitation");
    expect(DELETE_HIVE_ITEM).toBe("Delete hive\u2026");
    expect(KEEP_HIVE).toBe("Keep the hive");
  });
});
