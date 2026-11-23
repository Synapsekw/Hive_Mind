import { afterEach, describe, expect, it, vi } from "vitest";
import { agentStatus, loadSettings } from "./load-settings";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const W1 = "00000000-0000-4000-8000-000000000b01";
const W2 = "00000000-0000-4000-8000-000000000b02";
const M_DANI = "00000000-0000-4000-8000-000000000c01";
const M_AHMED = "00000000-0000-4000-8000-000000000c02";
const U_DANI = "11111111-1111-4111-8111-111111111101";
const U_AHMED = "11111111-1111-4111-8111-111111111102";
const A1 = "00000000-0000-4000-8000-000000000d01";
const A2 = "00000000-0000-4000-8000-000000000d02";
const A3 = "00000000-0000-4000-8000-000000000d03";
const I1 = "00000000-0000-4000-8000-000000000e01";
const I2 = "00000000-0000-4000-8000-000000000e02";

const NOW = Date.parse("2026-11-23T12:00:00Z");

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };
/** `own` is the read of the person's own oldest membership, which is also from `members`. */
type Table = "own" | "members" | "workspaces" | "agents" | "invitations";

const ok = (data: unknown): Res => ({ data, error: null });
const err = (message: string, code?: string): Res => ({
  data: null,
  error: { message, code, details: "secret payload" },
});

function member(over: Record<string, unknown> = {}) {
  return {
    id: M_DANI,
    display_name: "Danijel",
    role: "owner",
    user_id: U_DANI,
    ...over,
  };
}

function agent(over: Record<string, unknown> = {}) {
  return {
    id: A1,
    member_id: M_DANI,
    workspace_id: W1,
    name: "Claude Code",
    provider: "Claude Code",
    trust_tier: "vendor",
    expires_at: null,
    revoked_at: null,
    last_used_at: "2026-11-22T18:00:00+00:00",
    created_at: "2026-11-20T09:00:00+00:00",
    ...over,
  };
}

function invitation(over: Record<string, unknown> = {}) {
  return {
    id: I1,
    email: "lea@example.com",
    display_name: "Lea",
    created_at: "2026-11-22T09:00:00+00:00",
    expires_at: "2026-12-06T09:00:00+00:00",
    ...over,
  };
}

const MEMBERS = [
  member(),
  member({
    id: M_AHMED,
    display_name: "Ahmed",
    role: "member",
    user_id: U_AHMED,
  }),
];
const WORKSPACES = [
  { id: W1, name: "Main" },
  { id: W2, name: "DRA" },
];
const AGENTS = [
  agent(),
  agent({
    id: A2,
    workspace_id: W2,
    name: "Local model",
    provider: "Other",
    trust_tier: "self_hosted",
    last_used_at: null,
    created_at: "2026-11-19T09:00:00+00:00",
  }),
  agent({
    id: A3,
    name: "Old laptop",
    provider: "claude",
    revoked_at: "2026-11-18T09:00:00+00:00",
    created_at: "2026-11-10T09:00:00+00:00",
  }),
];
const INVITATIONS = [
  invitation(),
  invitation({
    id: I2,
    email: "omar@example.com",
    display_name: "Omar",
    created_at: "2026-11-20T09:00:00+00:00",
    expires_at: "2026-12-04T09:00:00+00:00",
  }),
];

/** The session cookie's access token: its payload names the user. */
const tokenOf = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

const OWN = { id: M_DANI, hive_id: HIVE, hive: { name: "Synapse" } };

/** A stand-in client: every `from(table)` chain is recorded and answers that table's result. */
function stub(
  opts: Partial<Record<Table, Res>> & { user?: { id: string } | null } = {},
) {
  const calls: Call[] = [];
  const answers: Record<Table, Res> = {
    own: opts.own ?? ok([OWN]),
    members: opts.members ?? ok(MEMBERS),
    workspaces: opts.workspaces ?? ok(WORKSPACES),
    agents: opts.agents ?? ok(AGENTS),
    invitations: opts.invitations ?? ok(INVITATIONS),
  };
  const from = vi.fn((table: Table) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "order", "limit"])
      chain[m] = (...args: unknown[]) => {
        // The read of the person's own oldest membership is filed apart from the hive's members.
        if (table === "members" && m === "eq" && args[0] === "user_id")
          call.table = "own";
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answers[call.table as Table]).then(res, rej);
    return chain;
  });
  const user = opts.user === undefined ? { id: U_DANI } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    getSession: vi.fn(async () => ({
      data: { session: user ? { access_token: tokenOf(user.id) } : null },
      error: null,
    })),
  };
  const rpc = vi.fn();
  const of = (table: Table) => calls.find((c) => c.table === table);
  return { db: { from, auth, rpc } as never, calls, from, auth, rpc, of };
}

const args = (c: Call | undefined, name: string) =>
  c?.ops.find(([m]) => m === name)?.[1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agentStatus", () => {
  const past = "2026-11-23T11:00:00Z";
  const future = "2026-11-24T12:00:00Z";

  it("is active with neither date", () => {
    expect(agentStatus(null, null, NOW)).toBe("active");
  });

  it("is active while the expiry is ahead", () => {
    expect(agentStatus(null, future, NOW)).toBe("active");
  });

  it("is expired when the expiry has passed", () => {
    expect(agentStatus(null, past, NOW)).toBe("expired");
  });

  it("is expired at the very moment of expiry", () => {
    expect(agentStatus(null, new Date(NOW).toISOString(), NOW)).toBe("expired");
  });

  it("is revoked when revoked", () => {
    expect(agentStatus(past, null, NOW)).toBe("revoked");
  });

  it("is revoked before it is expired", () => {
    expect(agentStatus(past, past, NOW)).toBe("revoked");
  });

  it.each([
    ["a word", "soon"],
    ["an empty string", ""],
    ["a number", 5],
    ["undefined", undefined],
    ["an object", {}],
  ])("counts a date that is %s as not set", (_name, v) => {
    expect(agentStatus(v, null, NOW)).toBe("active");
    expect(agentStatus(null, v, NOW)).toBe("active");
    expect(agentStatus(v, "2026-11-23T11:00:00Z", NOW)).toBe("expired");
  });
});

describe("loadSettings", () => {
  it("answers no-hive without reading anything else", async () => {
    const t = stub({ own: ok([]) });
    expect(await loadSettings(t.db, NOW)).toEqual({ state: "no-hive" });
    expect(t.calls.map((c) => c.table)).toEqual(["own"]);
  });

  it.each(["own", "members", "workspaces", "agents", "invitations"] as const)(
    "answers error when the %s read fails, logging code and message only",
    async (table) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub({ [table]: err("denied", "42501") });
      expect(await loadSettings(t.db, NOW)).toEqual({ state: "error" });
      expect(log).toHaveBeenCalledWith(
        table === "own" ? "own hive query failed" : `${table} query failed`,
        "42501",
        "denied",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
    },
  );

  it("answers error without a session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ user: null });
    expect(await loadSettings(t.db, NOW)).toEqual({ state: "error" });
  });

  it("maps every field", async () => {
    const t = stub();
    expect(await loadSettings(t.db, NOW)).toEqual({
      state: "ok",
      data: {
        hiveName: "Synapse",
        isOwner: true,
        workspaces: [
          { id: W1, name: "Main" },
          { id: W2, name: "DRA" },
        ],
        agents: [
          {
            id: A1,
            name: "Claude Code",
            provider: "Claude Code",
            trustTier: "vendor",
            workspaceId: W1,
            createdAt: "2026-11-20T09:00:00+00:00",
            lastUsedAt: "2026-11-22T18:00:00+00:00",
            status: "active",
          },
          {
            id: A2,
            name: "Local model",
            provider: "Other",
            trustTier: "self_hosted",
            workspaceId: W2,
            createdAt: "2026-11-19T09:00:00+00:00",
            lastUsedAt: null,
            status: "active",
          },
          {
            id: A3,
            name: "Old laptop",
            provider: "claude",
            trustTier: "vendor",
            workspaceId: W1,
            createdAt: "2026-11-10T09:00:00+00:00",
            lastUsedAt: "2026-11-22T18:00:00+00:00",
            status: "revoked",
          },
        ],
        members: [
          { id: M_DANI, name: "Danijel", role: "owner", isMe: true },
          { id: M_AHMED, name: "Ahmed", role: "member", isMe: false },
        ],
        invitations: [
          {
            id: I1,
            email: "lea@example.com",
            name: "Lea",
            createdAt: "2026-11-22T09:00:00+00:00",
            expiresAt: "2026-12-06T09:00:00+00:00",
          },
          {
            id: I2,
            email: "omar@example.com",
            name: "Omar",
            createdAt: "2026-11-20T09:00:00+00:00",
            expiresAt: "2026-12-04T09:00:00+00:00",
          },
        ],
      },
    });
  });

  it("works the status out against the given time", async () => {
    const t = stub({
      agents: ok([agent({ expires_at: "2026-11-23T11:59:59+00:00" })]),
    });
    const out = await loadSettings(t.db, NOW);
    expect(out.state === "ok" && out.data.agents[0]?.status).toBe("expired");
    const earlier = await loadSettings(t.db, NOW - 60_000);
    expect(earlier.state === "ok" && earlier.data.agents[0]?.status).toBe(
      "active",
    );
  });

  it("marks the session's member as me, and a member as not the owner", async () => {
    const t = stub({ user: { id: U_AHMED } });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.isOwner).toBe(false);
    expect(out.data.members.map((m) => [m.name, m.isMe])).toEqual([
      ["Danijel", false],
      ["Ahmed", true],
    ]);
  });

  it("is not the owner when the session has no member row in the list", async () => {
    const t = stub({ user: { id: "11111111-1111-4111-8111-1111111111ff" } });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.isOwner).toBe(false);
    expect(out.data.members.some((m) => m.isMe)).toBe(false);
  });

  it("sends no user id and nothing the contract does not name", async () => {
    const t = stub({
      agents: ok([agent({ token_hash: "hash-of-a-token" })]),
      workspaces: ok([{ id: W1, name: "Main", member_id: M_DANI }]),
      invitations: ok([
        invitation({
          hive_id: HIVE,
          invited_by: M_DANI,
          accepted_at: null,
          revoked_at: null,
        }),
      ]),
    });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    const sent = JSON.stringify(out.data);
    expect(sent).not.toContain(U_DANI);
    expect(sent).not.toContain(U_AHMED);
    expect(sent).not.toContain("hash-of-a-token");
    expect(Object.keys(out.data.members[0]!).sort()).toEqual(
      ["id", "isMe", "name", "role"].sort(),
    );
    expect(Object.keys(out.data.workspaces[0]!).sort()).toEqual(["id", "name"]);
    expect(Object.keys(out.data.agents[0]!).sort()).toEqual(
      [
        "createdAt",
        "id",
        "lastUsedAt",
        "name",
        "provider",
        "status",
        "trustTier",
        "workspaceId",
      ].sort(),
    );
    expect(sent).not.toContain(HIVE);
    expect(Object.keys(out.data.invitations[0]!).sort()).toEqual(
      ["createdAt", "email", "expiresAt", "id", "name"].sort(),
    );
  });

  it("reads the hive of the person's own oldest membership, then the four lists", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    expect(t.calls.map((c) => c.table).sort()).toEqual(
      ["agents", "invitations", "members", "own", "workspaces"].sort(),
    );
    expect(t.calls[0]!.table).toBe("own");
    expect(t.from.mock.calls[0]).toEqual(["members"]);
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["id, hive_id, hive:hives!hive_id(name)"]],
      ["eq", ["user_id", U_DANI]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [1]],
    ]);
    // One call to the auth server, as before.
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);

    expect(args(t.of("members"), "select")).toEqual([
      "id, display_name, role, user_id",
    ]);
    expect(args(t.of("members"), "eq")).toEqual(["hive_id", HIVE]);
    expect(args(t.of("members"), "order")).toEqual([
      "created_at",
      { ascending: true },
    ]);

    expect(args(t.of("workspaces"), "select")).toEqual(["id, name"]);
    expect(args(t.of("workspaces"), "eq")).toEqual(["hive_id", HIVE]);
    expect(args(t.of("workspaces"), "order")).toEqual([
      "created_at",
      { ascending: true },
    ]);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("asks for at most 200 agents, newest first, and never for the hash", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    const agents = t.of("agents");
    expect(args(agents, "select")).toEqual([
      "id, member_id, workspace_id, name, provider, trust_tier, expires_at, revoked_at, last_used_at, created_at",
    ]);
    expect(String(args(agents, "select")![0])).not.toContain("token");
    // Active agents first, then newest: the cap can only cut off old revoked ones.
    expect(
      agents?.ops.filter(([m]) => m === "order").map(([, a]) => a),
    ).toEqual([
      ["revoked_at", { ascending: true, nullsFirst: true }],
      ["created_at", { ascending: false }],
    ]);
    expect(args(agents, "limit")).toEqual([200]);
  });

  it("asks for the hive's open invitations only, newest first, at most 100", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    const inv = t.of("invitations");
    expect(args(inv, "select")).toEqual([
      "id, email, display_name, created_at, expires_at",
    ]);
    expect(args(inv, "eq")).toEqual(["hive_id", HIVE]);
    expect(inv?.ops.filter(([m]) => m === "is").map(([, a]) => a)).toEqual([
      ["accepted_at", null],
      ["revoked_at", null],
    ]);
    expect(args(inv, "gt")).toEqual(["expires_at", "2026-11-23T12:00:00.000Z"]);
    expect(inv?.ops.filter(([m]) => m === "order").map(([, a]) => a)).toEqual([
      ["created_at", { ascending: false }],
    ]);
    expect(args(inv, "limit")).toEqual([100]);
  });

  it("answers no invitations when the database returns none", async () => {
    const t = stub({ user: { id: U_AHMED }, invitations: ok([]) });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.invitations).toEqual([]);
  });

  it("answers ok with empty lists", async () => {
    const t = stub({ agents: ok([]), workspaces: ok([]) });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.agents).toEqual([]);
    expect(out.data.workspaces).toEqual([]);
  });

  it.each([
    ["a hive without a name", { own: ok([{ ...OWN, hive: {} }]) }],
    ["a hive id that is a number", { own: ok([{ ...OWN, hive_id: 1 }]) }],
    ["members that are not a list", { members: ok(null) }],
    ["a member that is not an object", { members: ok(["x"]) }],
    [
      "a member without a name",
      { members: ok([member({ display_name: null })]) },
    ],
    [
      "a member with an unknown role",
      { members: ok([member({ role: "admin" })]) },
    ],
    [
      "a member without a user id",
      { members: ok([member({ user_id: null })]) },
    ],
    ["a member id that is a number", { members: ok([member({ id: 3 })]) }],
    ["workspaces that are not a list", { workspaces: ok({}) }],
    ["a workspace without a name", { workspaces: ok([{ id: W1 }]) }],
    [
      "a workspace id that is a number",
      { workspaces: ok([{ id: 1, name: "M" }]) },
    ],
    ["agents that are not a list", { agents: ok(undefined) }],
    ["an agent that is not an object", { agents: ok([null]) }],
    ["an agent id that is a number", { agents: ok([agent({ id: 9 })]) }],
    ["an agent without a name", { agents: ok([agent({ name: undefined })]) }],
    [
      "an agent provider that is null",
      { agents: ok([agent({ provider: null })]) },
    ],
    [
      "an unknown trust tier",
      { agents: ok([agent({ trust_tier: "trusted" })]) },
    ],
    [
      "an agent without a workspace",
      { agents: ok([agent({ workspace_id: null })]) },
    ],
    [
      "an agent without created_at",
      { agents: ok([agent({ created_at: null })]) },
    ],
    [
      "a last use that is a number",
      { agents: ok([agent({ last_used_at: 5 })]) },
    ],
    [
      "a revocation that is not a date",
      { agents: ok([agent({ revoked_at: "yes" })]) },
    ],
    [
      "a revocation that is a boolean",
      { agents: ok([agent({ revoked_at: true })]) },
    ],
    [
      "an expiry that is not a date",
      { agents: ok([agent({ expires_at: "never" })]) },
    ],
    ["invitations that are not a list", { invitations: ok(null) }],
    ["an invitation that is not an object", { invitations: ok(["x"]) }],
    [
      "an invitation id that is a number",
      { invitations: ok([invitation({ id: 4 })]) },
    ],
    [
      "an invitation without an email",
      { invitations: ok([invitation({ email: null })]) },
    ],
    [
      "an invitation without a name",
      { invitations: ok([invitation({ display_name: undefined })]) },
    ],
    [
      "an invitation created at no date",
      { invitations: ok([invitation({ created_at: "then" })]) },
    ],
    [
      "an invitation without an expiry",
      { invitations: ok([invitation({ expires_at: null })]) },
    ],
    [
      "an invitation expiry that is not a date",
      { invitations: ok([invitation({ expires_at: "never" })]) },
    ],
    [
      "one bad invitation among good ones",
      { invitations: ok([invitation(), invitation({ id: null })]) },
    ],
    [
      "one bad agent among good ones",
      { agents: ok([agent(), agent({ id: null }), agent()]) },
    ],
  ])("answers error for %s", async (_name, opts) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(opts);
    expect(await loadSettings(t.db, NOW)).toEqual({ state: "error" });
    expect(log).toHaveBeenCalled();
  });
});

describe("loadSettings and other hives", () => {
  it("leaves out an agent whose workspace is not one of this hive's", async () => {
    const t = stub({
      workspaces: { data: [{ id: W1, name: "Main" }], error: null },
    });
    const out = await loadSettings(t.db, NOW);
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    expect(out.data.agents.length).toBeGreaterThan(0);
    expect(out.data.agents.every((a) => a.workspaceId === W1)).toBe(true);
    expect(out.data.agents.some((a) => a.id === A2)).toBe(false);
  });
});
