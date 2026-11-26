import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentStatus,
  loadSettings,
  toSyncKey,
  toSyncRun,
} from "./load-settings";

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
const K1 = "00000000-0000-4000-8000-000000000f01";
const K2 = "00000000-0000-4000-8000-000000000f02";
const R1 = "00000000-0000-4000-8000-000000000a11";

const NOW = Date.parse("2026-11-23T12:00:00Z");

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };
/** `own` is the read of the person's own oldest membership, which is also from `members`. */
type Table =
  | "own"
  | "members"
  | "workspaces"
  | "agents"
  | "invitations"
  | "entities"
  | "sync_keys"
  | "sync_runs";

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
  { id: W1, name: "Main", notes: [{ count: 128 }] },
  { id: W2, name: "DRA", notes: [{ count: 0 }] },
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

/** The person's own membership, as the one read answers it: they own the hive. */
const OWN = {
  id: M_DANI,
  hive_id: HIVE,
  display_name: "Danijel",
  role: "owner",
  hive: { name: "Synapse" },
};
const PREVIEW = [{ members: 2, notes: 41, files: 6 }];

/** A stand-in client: every `from(table)` chain is recorded and answers that table's result. */
function stub(
  opts: Partial<Record<Table, Res>> & {
    user?: { id: string } | null;
    /** What `hive_deletion_preview` answers, or a function that throws. */
    preview?: Res | (() => never);
  } = {},
) {
  const calls: Call[] = [];
  const answers: Record<Table, Res> = {
    own: opts.own ?? ok([OWN]),
    members: opts.members ?? ok(MEMBERS),
    workspaces: opts.workspaces ?? ok(WORKSPACES),
    agents: opts.agents ?? ok(AGENTS),
    invitations: opts.invitations ?? ok(INVITATIONS),
    entities: opts.entities ?? ok([]),
    sync_keys: opts.sync_keys ?? ok([]),
    sync_runs: opts.sync_runs ?? ok([]),
  };
  const from = vi.fn((table: Table) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "gt", "order", "limit"])
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
    getUser: vi.fn(async (): Promise<never> => {
      throw new Error("a loader must not call the auth server");
    }),
    getSession: vi.fn(async () => ({
      data: { session: user ? { access_token: tokenOf(user.id) } : null },
      error: null,
    })),
  };
  const rpc = vi.fn(async (_name: string, _args?: unknown) =>
    typeof opts.preview === "function"
      ? opts.preview()
      : (opts.preview ?? ok(PREVIEW)),
  );
  const of = (table: Table) => calls.find((c) => c.table === table);
  return { db: { from, auth, rpc } as never, calls, from, auth, rpc, of };
}

const args = (c: Call | undefined, name: string) =>
  c?.ops.find(([m]) => m === name)?.[1];

afterEach(() => {
  vi.restoreAllMocks();
});

function syncKey(over: Record<string, unknown> = {}) {
  return {
    id: K1,
    workspace_id: W1,
    created_at: "2026-11-22T09:00:00+00:00",
    last_used_at: "2026-11-23T11:00:00+00:00",
    revoked_at: null,
    ...over,
  };
}

function syncRun(over: Record<string, unknown> = {}) {
  return {
    id: R1,
    key_id: K1,
    started_at: "2026-11-23T11:00:00+00:00",
    finished_at: "2026-11-23T11:00:05+00:00",
    added: 3,
    changed: 1,
    moved: 0,
    deleted: 2,
    skipped: 4,
    too_big: 1,
    too_big_paths: ["talks/keynote.key"],
    refused_deletes: [],
    error: null,
    ...over,
  };
}

describe("sync keys and runs", () => {
  it("hides the agents the sync made", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    expect(args(t.of("agents"), "neq")).toEqual(["provider", "hive-sync"]);
  });

  it("reads the newest 20 keys, never the hash, and no runs when there are no keys", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    const keys = t.of("sync_keys");
    expect(args(keys, "select")).toEqual([
      "id, workspace_id, created_at, last_used_at, revoked_at",
    ]);
    expect(args(keys, "order")).toEqual(["created_at", { ascending: false }]);
    expect(args(keys, "limit")).toEqual([20]);
    expect(t.of("sync_runs")).toBeUndefined();
  });

  it("reads the last 20 runs of those keys in one follow-up read", async () => {
    const t = stub({
      sync_keys: ok([
        syncKey(),
        syncKey({ id: K2, revoked_at: "2026-11-23T00:00:00+00:00" }),
      ]),
      sync_runs: ok([syncRun()]),
    });
    const out = await loadSettings(t.db, NOW);
    const runs = t.of("sync_runs");
    expect(args(runs, "in")).toEqual(["key_id", [K1, K2]]);
    expect(args(runs, "order")).toEqual(["started_at", { ascending: false }]);
    expect(args(runs, "limit")).toEqual([20]);
    expect(String(args(runs, "select")![0])).toContain("too_big_paths");
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.syncKeys.map((k) => [k.id, k.status])).toEqual([
      [K1, "active"],
      [K2, "revoked"],
    ]);
    expect(out.data.syncRuns).toHaveLength(1);
  });

  it("leaves out the keys of a workspace in another hive", async () => {
    const t = stub({
      sync_keys: ok([
        syncKey({ workspace_id: "00000000-0000-4000-8000-0000000000ff" }),
      ]),
    });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.syncKeys).toEqual([]);
    expect(t.of("sync_runs")).toBeUndefined();
  });

  it("answers error when the keys read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ sync_keys: err("denied", "42501") });
    expect(await loadSettings(t.db, NOW)).toEqual({ state: "error" });
  });

  it("keeps the page when only the runs read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      sync_keys: ok([syncKey()]),
      sync_runs: err("denied", "42501"),
    });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.data.syncKeys).toHaveLength(1);
    expect(out.data.syncRuns).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "sync runs query failed",
      "42501",
      "denied",
    );
  });

  it("toSyncKey maps a row and drops a malformed one", () => {
    expect(toSyncKey(syncKey())).toEqual({
      id: K1,
      workspaceId: W1,
      createdAt: "2026-11-22T09:00:00+00:00",
      lastUsedAt: "2026-11-23T11:00:00+00:00",
      status: "active",
    });
    expect(
      toSyncKey(syncKey({ revoked_at: "2026-11-23T00:00:00Z" }))?.status,
    ).toBe("revoked");
    expect(toSyncKey(syncKey({ last_used_at: null }))?.lastUsedAt).toBeNull();
    expect(toSyncKey(syncKey({ id: 5 }))).toBeNull();
    expect(toSyncKey(syncKey({ created_at: "soon" }))).toBeNull();
    expect(toSyncKey(syncKey({ revoked_at: "soon" }))).toBeNull();
    expect(toSyncKey(null)).toBeNull();
  });

  it("toSyncRun maps a row, counting held-back deletes and capping the paths at 200", () => {
    expect(toSyncRun(syncRun())).toEqual({
      id: R1,
      keyId: K1,
      startedAt: "2026-11-23T11:00:00+00:00",
      finishedAt: "2026-11-23T11:00:05+00:00",
      added: 3,
      changed: 1,
      moved: 0,
      deleted: 2,
      skipped: 4,
      tooBig: 1,
      tooBigPaths: ["talks/keynote.key"],
      heldBack: 0,
      error: null,
    });
    const held = toSyncRun(
      syncRun({
        refused_deletes: Array.from({ length: 40 }, (_, i) => `n${i}.md`),
        too_big_paths: Array.from({ length: 300 }, (_, i) => `f${i}`),
        finished_at: null,
        error: "offline",
      }),
    );
    expect(held?.heldBack).toBe(40);
    expect(held?.tooBigPaths).toHaveLength(200);
    expect(held?.finishedAt).toBeNull();
    expect(held?.error).toBe("offline");
    expect(JSON.stringify(held)).not.toContain("n0.md");
  });

  it("toSyncRun drops a malformed row", () => {
    expect(toSyncRun(syncRun({ added: -1 }))).toBeNull();
    expect(toSyncRun(syncRun({ started_at: "soon" }))).toBeNull();
    expect(toSyncRun(syncRun({ too_big_paths: "x" }))).toBeNull();
    expect(toSyncRun(syncRun({ refused_deletes: null }))).toBeNull();
    expect(toSyncRun(syncRun({ error: 5 }))).toBeNull();
    expect(toSyncRun(undefined)).toBeNull();
  });
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

  it("answers error when the topics read fails, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ entities: err("denied", "42501") });
    expect(await loadSettings(t.db, NOW)).toEqual({ state: "error" });
    expect(log).toHaveBeenCalledWith("topics query failed", "42501", "denied");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it("answers error without a session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ user: null });
    expect(await loadSettings(t.db, NOW)).toEqual({ state: "error" });
  });

  it("maps every field", async () => {
    const t = stub();
    expect(await loadSettings(t.db, NOW)).toEqual({
      state: "ok",
      hiveId: HIVE,
      deletion: { members: 2, notes: 41, files: 6 },
      closing: null,
      data: {
        hiveName: "Synapse",
        isOwner: true,
        workspaces: [
          { id: W1, name: "Main", notes: 128 },
          { id: W2, name: "DRA", notes: 0 },
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
        topics: [],
        syncKeys: [],
        syncRuns: [],
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
    expect(Object.keys(out.data.workspaces[0]!).sort()).toEqual([
      "id",
      "name",
      "notes",
    ]);
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

  it("reads the hive of the person's own oldest membership, then the lists", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    expect(t.calls.map((c) => c.table).sort()).toEqual(
      [
        "agents",
        "entities",
        "invitations",
        "members",
        "own",
        "sync_keys",
        "workspaces",
      ].sort(),
    );
    expect(t.calls[0]!.table).toBe("own");
    expect(t.from.mock.calls[0]).toEqual(["members"]);
    expect(t.calls[0]!.ops).toEqual([
      [
        "select",
        [
          "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
        ],
      ],
      ["eq", ["user_id", U_DANI]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [50]],
    ]);
    // No call to the auth server: the user id is the one the session's token names.
    expect(t.auth.getUser).not.toHaveBeenCalled();

    expect(args(t.of("members"), "select")).toEqual([
      "id, display_name, role, user_id",
    ]);
    expect(args(t.of("members"), "eq")).toEqual(["hive_id", HIVE]);
    expect(args(t.of("members"), "order")).toEqual([
      "created_at",
      { ascending: true },
    ]);

    expect(args(t.of("workspaces"), "select")).toEqual([
      "id, name, notes(count)",
    ]);
    expect(args(t.of("workspaces"), "eq")).toEqual(["hive_id", HIVE]);
    expect(args(t.of("workspaces"), "order")).toEqual([
      "created_at",
      { ascending: true },
    ]);
    // The owner's preview, once.
    expect(t.rpc.mock.calls).toEqual([
      ["hive_deletion_preview", { p_hive: HIVE }],
    ]);
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

  it("reads the hive's topics for the owner with their note counts, and none for a member", async () => {
    const t = stub({
      entities: ok([
        {
          id: "t1",
          type: "client",
          canonical_name: "Zain",
          note_entities: [{ count: 12 }],
        },
        {
          id: "t2",
          type: "weird",
          canonical_name: "Dropped",
          note_entities: [],
        },
      ]),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await loadSettings(t.db, NOW);
    // A row whose kind is unknown makes the whole answer unreadable, as for the other lists.
    expect(out.state).toBe("error");
    const good = stub({
      entities: ok([
        {
          id: "t1",
          type: "client",
          canonical_name: "Zain",
          note_entities: [{ count: 12 }],
        },
      ]),
    });
    const loaded = await loadSettings(good.db, NOW);
    if (loaded.state !== "ok") throw new Error("expected ok");
    expect(loaded.data.topics).toEqual([
      { id: "t1", kind: "client", name: "Zain", notes: 12 },
    ]);
    const read = good.of("entities");
    expect(args(read, "select")).toEqual([
      "id, type, canonical_name, note_entities(count)",
    ]);
    expect(args(read, "eq")).toEqual(["hive_id", HIVE]);
    expect(args(read, "limit")).toEqual([2000]);
    // A member is not asked at all.
    const member = stub({
      own: ok([{ ...OWN, id: M_AHMED, role: "member" }]),
      user: { id: U_AHMED },
      entities: ok([
        {
          id: "t1",
          type: "client",
          canonical_name: "Zain",
          note_entities: [],
        },
      ]),
    });
    const seen = await loadSettings(member.db, NOW);
    if (seen.state !== "ok") throw new Error("expected ok");
    expect(seen.data.topics).toEqual([]);
    expect(member.of("entities")).toBeUndefined();
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

describe("loadSettings and deleting the hive", () => {
  const AS_MEMBER = {
    ...OWN,
    id: M_AHMED,
    display_name: "Ahmed",
    role: "member",
  };

  it("asks an owner's preview in the same batch as the four lists, not after them", async () => {
    const order: string[] = [];
    const t = stub();
    t.rpc.mockImplementation(async () => {
      order.push("preview asked");
      await new Promise((r) => setTimeout(r, 5));
      order.push("preview answered");
      return ok(PREVIEW);
    });
    const from = t.from.getMockImplementation()!;
    t.from.mockImplementation((table) => {
      const chain = from(table) as { then: (...a: unknown[]) => unknown };
      const then = chain.then;
      chain.then = (...a: unknown[]) => {
        order.push(`${table} awaited`);
        return then(...a);
      };
      return chain;
    });
    const out = await loadSettings(t.db, NOW);
    expect(out.state === "ok" && out.deletion).toEqual({
      members: 2,
      notes: 41,
      files: 6,
    });
    // Every list was already asked for when the preview's answer came.
    const answered = order.indexOf("preview answered");
    for (const table of ["workspaces", "agents", "invitations"])
      expect(order.indexOf(`${table} awaited`)).toBeLessThan(answered);
    expect(order.indexOf("preview asked")).toBeLessThan(answered);
    expect(t.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a person who is not an owner, and answers no counts", async () => {
    const t = stub({ own: ok([AS_MEMBER]), user: { id: U_AHMED } });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.deletion).toBeNull();
    expect(out.data.isOwner).toBe(false);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("reads the person's role with the same one read of their membership", async () => {
    const t = stub();
    await loadSettings(t.db, NOW);
    expect(t.calls.filter((c) => c.table === "own")).toHaveLength(1);
    expect(args(t.of("own"), "select")).toEqual([
      "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
    ]);
  });

  it("survives a refused preview: the page loads without counts, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      preview: err("only the owner can delete a hive", "P0001"),
    });
    const out = await loadSettings(t.db, NOW);
    if (out.state !== "ok") throw new Error("not ok");
    expect(out.deletion).toBeNull();
    expect(out.data.members).toHaveLength(2);
    expect(log).toHaveBeenCalledWith(
      "hive deletion preview failed",
      "P0001",
      "only the owner can delete a hive",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it("survives a preview that throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      preview: () => {
        throw new Error("network: secret payload");
      },
    });
    const out = await loadSettings(t.db, NOW);
    expect(out.state === "ok" && out.deletion).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it.each([
    ["nothing", null],
    ["no row", []],
    ["a word", "many"],
    ["a count that is text", [{ members: "2", notes: 41, files: 6 }]],
    ["a negative count", [{ members: 2, notes: -1, files: 6 }]],
    ["a fraction", [{ members: 2, notes: 1.5, files: 6 }]],
    ["a missing count", [{ members: 2, notes: 41 }]],
  ])("answers no counts when the preview answers %s", async (_n, data) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await loadSettings(stub({ preview: ok(data) }).db, NOW);
    expect(out.state === "ok" && out.deletion).toBeNull();
  });

  it("accepts the one row on its own, and names only the three counts", async () => {
    const out = await loadSettings(
      stub({ preview: ok({ members: 1, notes: 0, files: 0, name: "Synapse" }) })
        .db,
      NOW,
    );
    expect(out.state === "ok" && out.deletion).toEqual({
      members: 1,
      notes: 0,
      files: 0,
    });
  });

  it("carries the date a hive that is being deleted goes, for an owner and for a member", async () => {
    const AFTER = "2026-12-01T09:00:00+00:00";
    const hive = { name: "Synapse", delete_after: AFTER };
    const owner = await loadSettings(
      stub({ own: ok([{ ...OWN, hive }]) }).db,
      NOW,
    );
    expect(owner.state === "ok" && owner.closing).toBe(AFTER);
    const member = await loadSettings(
      stub({ own: ok([{ ...AS_MEMBER, hive }]), user: { id: U_AHMED } }).db,
      NOW,
    );
    expect(member.state === "ok" && member.closing).toBe(AFTER);
    expect(member.state === "ok" && member.deletion).toBeNull();
  });

  it.each([
    ["no count beside it", undefined],
    ["a count that is not a list", { count: 3 }],
    ["an empty list", []],
    ["a count that is text", [{ count: "3" }]],
    ["a count below zero", [{ count: -1 }]],
    ["a count that is not whole", [{ count: 1.5 }]],
  ])(
    "keeps a workspace whose notes have %s, with the number unknown",
    async (_name, notes) => {
      const t = stub({ workspaces: ok([{ id: W1, name: "Main", notes }]) });
      const out = await loadSettings(t.db, NOW);
      if (out.state !== "ok") throw new Error("expected ok");
      expect(out.data.workspaces).toEqual([
        { id: W1, name: "Main", notes: null },
      ]);
    },
  );
});
