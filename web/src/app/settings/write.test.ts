import { afterEach, describe, expect, it, vi } from "vitest";
import { createIn, inviteIn, revokeIn, revokeInvitationIn } from "./write";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const W1 = "00000000-0000-4000-8000-000000000b01";
const AGENT = "00000000-0000-4000-8000-000000000d01";
const MEMBER = "00000000-0000-4000-8000-000000000c09";
const INVITATION = "00000000-0000-4000-8000-000000000e01";
/** A connected app's id at the auth server. */
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
// Made up for these tests; shaped like the real thing so a leak would be caught the same way.
const TOKEN = `hive_${"ab12".repeat(16)}`;

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });
const err = (message: string, code?: string): Res => ({
  data: null,
  error: { message, code, details: "secret payload" },
});

function stub(
  opts: {
    rpc?: Res | (() => never);
    /** The read of the person's own oldest membership. */
    own?: Res;
    user?: { id: string } | null;
    /** The read of the revoked agent's own row. */
    agent?: Res | (() => never);
    /** The read of the person's agents of the same app that are still in use. */
    live?: Res;
    revokeGrant?: Res | (() => never);
  } = {},
) {
  const calls: Call[] = [];
  const steps: string[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit"])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) => {
      steps.push(table);
      const byId = call.ops.some(([m, a]) => m === "eq" && a[0] === "id");
      const answer = (): Res => {
        if (table !== "agents")
          return (
            opts.own ??
            ok([{ id: MEMBER, hive_id: HIVE, hive: { name: "Synapse" } }])
          );
        if (!byId) return opts.live ?? ok([]);
        if (typeof opts.agent === "function") return opts.agent();
        return opts.agent ?? ok([{ oauth_client_id: null }]);
      };
      return new Promise<Res>((resolve) => resolve(answer())).then(res, rej);
    };
    return chain;
  });
  const rpc = vi.fn(async (name: string, _args: unknown) => {
    steps.push(name);
    return typeof opts.rpc === "function" ? opts.rpc() : (opts.rpc ?? ok(null));
  });
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const revokeGrant = vi.fn(async (_o: { clientId: string }) => {
    steps.push("revokeGrant");
    return typeof opts.revokeGrant === "function"
      ? opts.revokeGrant()
      : (opts.revokeGrant ?? { data: {}, error: null });
  });
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    oauth: { revokeGrant },
  };
  return {
    db: { from, rpc, auth } as never,
    calls,
    steps,
    from,
    rpc,
    auth,
    revokeGrant,
  };
}

const args = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];

/** Every console channel, silenced and watched. */
function consoles() {
  const spies = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
  ];
  return {
    error: spies[0]!,
    /** Everything said on any channel, as one string. */
    said: () => JSON.stringify(spies.map((s) => s.mock.calls)),
    count: () => spies.reduce((n, s) => n + s.mock.calls.length, 0),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createIn", () => {
  const input = {
    name: "Claude Code",
    workspaceId: W1,
    provider: "Claude Code",
    trustTier: "vendor",
  };
  const made = ok([{ agent_id: AGENT, token: TOKEN }]);

  it.each([
    ["null", null],
    ["a string", "agent"],
    ["an empty name", { ...input, name: " " }],
    ["a workspace that is not a uuid", { ...input, workspaceId: "main" }],
    ["an unknown provider", { ...input, provider: "Gemini" }],
    ["an unknown tier", { ...input, trustTier: "root" }],
  ])("refuses %s with no call at all", async (_name, raw) => {
    const t = stub({ rpc: made });
    expect(await createIn(t.db, raw)).toEqual({ ok: false });
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses without a session, before the function is called", async () => {
    const t = stub({ rpc: made, user: null });
    expect(await createIn(t.db, input)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("calls create_agent with the four cleaned values and nothing else", async () => {
    const t = stub({ rpc: made });
    await createIn(t.db, {
      ...input,
      name: "  Laptop ",
      trustTier: "self_hosted",
      memberId: "someone-else",
    });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("create_agent", {
      p_workspace: W1,
      p_name: "Laptop",
      p_provider: "Claude Code",
      p_trust_tier: "self_hosted",
    });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("returns the token of the first row, and only ok and the token", async () => {
    const t = stub({ rpc: made });
    const out = await createIn(t.db, input);
    expect(out).toEqual({ ok: true, token: TOKEN });
    expect(Object.keys(out).sort()).toEqual(["ok", "token"]);
  });

  it("says nothing on any console channel when it works", async () => {
    const c = consoles();
    const t = stub({ rpc: made });
    expect(await createIn(t.db, input)).toEqual({ ok: true, token: TOKEN });
    expect(c.count()).toBe(0);
    expect(c.said()).not.toContain(TOKEN);
  });

  it("answers not ok when the database refuses, logging code and message only", async () => {
    const c = consoles();
    const t = stub({ rpc: err("that workspace is not yours", "P0001") });
    expect(await createIn(t.db, input)).toEqual({ ok: false });
    expect(c.error).toHaveBeenCalledWith(
      "create_agent failed",
      "P0001",
      "that workspace is not yours",
    );
    expect(c.said()).not.toContain("secret payload");
  });

  it("never logs the token when the answer carries a row and an error", async () => {
    const c = consoles();
    const t = stub({
      rpc: {
        data: [{ agent_id: AGENT, token: TOKEN }],
        error: { message: "connection reset", code: "08006" },
      },
    });
    expect(await createIn(t.db, input)).toEqual({ ok: false });
    expect(c.count()).toBeGreaterThan(0);
    expect(c.said()).not.toContain(TOKEN);
  });

  it.each([
    ["no rows", []],
    ["null", null],
    ["a row without a token", [{ agent_id: AGENT }]],
    ["a token that is empty", [{ agent_id: AGENT, token: "" }]],
    ["a token that is not a string", [{ agent_id: AGENT, token: 7 }]],
    ["a row that is not an object", ["x"]],
  ])("answers not ok for %s", async (_name, data) => {
    const c = consoles();
    const t = stub({ rpc: ok(data) });
    expect(await createIn(t.db, input)).toEqual({ ok: false });
    expect(c.error).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the token where a row should be", TOKEN],
    ["a row that is a bare token", [TOKEN]],
    ["a token that is a list", [{ agent_id: AGENT, token: [TOKEN] }]],
    ["a token under another name", [{ agent_id: AGENT, secret: TOKEN }]],
    ["a row nested one level down", [[{ agent_id: AGENT, token: TOKEN }]]],
    ["an object where the list should be", { agent_id: AGENT, token: TOKEN }],
  ])(
    "never logs the token when the answer is malformed: %s",
    async (_name, data) => {
      const c = consoles();
      const t = stub({ rpc: ok(data) });
      expect(await createIn(t.db, input)).toEqual({ ok: false });
      expect(c.count()).toBeGreaterThan(0);
      expect(c.said()).not.toContain(TOKEN);
    },
  );

  it("never logs the token when the session cannot be read", async () => {
    const c = consoles();
    const t = stub({ rpc: made, user: null });
    await createIn(t.db, input);
    expect(c.said()).not.toContain(TOKEN);
  });
});

describe("revokeIn", () => {
  it.each([
    ["a word", "not-a-uuid"],
    ["an empty string", ""],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an object", { id: AGENT }],
    ["a uuid with a filter appended", `${AGENT},revoked_at.is.null`],
  ])("refuses an id that is %s with no call at all", async (_name, id) => {
    const t = stub();
    expect(await revokeIn(t.db, id)).toEqual({ ok: false });
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses without a session, before the function is called", async () => {
    const t = stub({ user: null });
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("revokes an agent with a token through revoke_agent, and ends no sign-in", async () => {
    const t = stub();
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("revoke_agent", { p_agent: AGENT });
    // One read, of that agent's own row and of the one column.
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("agents");
    expect(args(t.calls[0]!, "select")).toEqual(["oauth_client_id"]);
    expect(args(t.calls[0]!, "eq")).toEqual(["id", AGENT]);
    expect(t.revokeGrant).not.toHaveBeenCalled();
  });

  it("revokes a connected app, then ends its sign-in at the auth server", async () => {
    const t = stub({ agent: ok([{ oauth_client_id: CLIENT }]) });
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: true });
    // The revoke comes first: the sign-in is ended only once the database has cut the app off.
    expect(t.steps).toEqual([
      "revoke_agent",
      "agents",
      "agents",
      "revokeGrant",
    ]);
    expect(t.revokeGrant).toHaveBeenCalledTimes(1);
    expect(t.revokeGrant).toHaveBeenCalledWith({ clientId: CLIENT });
    // The second read: the person's agents of the same app that are still in use.
    expect(args(t.calls[1]!, "eq")).toEqual(["oauth_client_id", CLIENT]);
    expect(args(t.calls[1]!, "is")).toEqual(["revoked_at", null]);
    expect(args(t.calls[1]!, "limit")).toEqual([1]);
  });

  it("keeps the sign-in while another agent of the same app is still in use", async () => {
    const t = stub({
      agent: ok([{ oauth_client_id: CLIENT }]),
      live: ok([{ id: "00000000-0000-4000-8000-000000000d02" }]),
    });
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: true });
    expect(t.revokeGrant).not.toHaveBeenCalled();
  });

  it("ends no sign-in when the database refused the revoke", async () => {
    const c = consoles();
    const t = stub({
      rpc: err("that agent is not yours", "P0001"),
      agent: ok([{ oauth_client_id: CLIENT }]),
    });
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.revokeGrant).not.toHaveBeenCalled();
    expect(c.said()).not.toContain("sign-in");
  });

  it.each([
    ["the auth server refuses", { revokeGrant: err("grant not found", "404") }],
    [
      "the auth server cannot be reached",
      {
        revokeGrant: () => {
          throw new Error(`network ${CLIENT}`);
        },
      },
    ],
    ["the agent's row cannot be read", { agent: err("denied", "42501") }],
    [
      "reading the agent's row throws",
      {
        agent: () => {
          throw new Error("network");
        },
      },
    ],
    ["the other agents cannot be read", { live: err("denied", "42501") }],
    [
      "the client id is not a uuid",
      { agent: ok([{ oauth_client_id: "client-a" }]) },
    ],
    ["the agent's row is malformed", { agent: ok(["nonsense"]) }],
  ])(
    "the revoke still stands when %s, and one fixed phrase is logged",
    async (_name, opts) => {
      const c = consoles();
      const t = stub({ agent: ok([{ oauth_client_id: CLIENT }]), ...opts });
      expect(await revokeIn(t.db, AGENT)).toEqual({ ok: true });
      expect(c.error).toHaveBeenCalledTimes(1);
      expect(c.error).toHaveBeenCalledWith(
        "the app's sign-in could not be ended",
      );
      expect(c.said()).not.toContain("secret payload");
      expect(c.said()).not.toContain(CLIENT);
    },
  );

  it("ends nothing when the agent's row is not there", async () => {
    const c = consoles();
    const t = stub({ agent: ok([]) });
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: true });
    expect(t.revokeGrant).not.toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
  });

  it("answers not ok when the database refuses, logging code and message only", async () => {
    const c = consoles();
    const t = stub({ rpc: err("that agent is not yours", "P0001") });
    expect(await revokeIn(t.db, AGENT)).toEqual({ ok: false });
    expect(c.error).toHaveBeenCalledWith(
      "revoke_agent failed",
      "P0001",
      "that agent is not yours",
    );
    expect(c.said()).not.toContain("secret payload");
  });
});

describe("inviteIn", () => {
  const FAILED = { ok: false, reason: "failed" };

  it.each([
    ["an email without @", "ahmed.example.com", "Ahmed"],
    ["an email with a space", "ah med@example.com", "Ahmed"],
    ["an email that is a number", 7, "Ahmed"],
    ["an empty name", "ahmed@example.com", "  "],
    ["a name of 61 characters", "ahmed@example.com", "a".repeat(61)],
    ["a name that is null", "ahmed@example.com", null],
  ])("refuses %s with no call at all", async (_name, email, name) => {
    const t = stub({ rpc: ok("invited") });
    expect(await inviteIn(t.db, email, name)).toEqual(FAILED);
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses without a session, before any query", async () => {
    const t = stub({ rpc: ok("invited"), user: null });
    expect(await inviteIn(t.db, "ahmed@example.com", "Ahmed")).toEqual(FAILED);
    expect(t.from).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("finds the hive of the person's own oldest membership, then calls invite_member with cleaned values", async () => {
    const t = stub({ rpc: ok("invited") });
    expect(await inviteIn(t.db, " Ahmed@Example.com ", "  Ahmed ")).toEqual({
      ok: true,
      outcome: "invited",
    });
    expect(t.calls).toHaveLength(1);
    const [own] = t.calls;
    expect(own!.table).toBe("members");
    expect(own!.ops).toEqual([
      ["select", ["id, hive_id, hive:hives!hive_id(name)"]],
      ["eq", ["user_id", "u-me"]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [1]],
    ]);
    // The id is the one the auth server answered with, asked for once.
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("invite_member", {
      p_hive: HIVE,
      p_email: "ahmed@example.com",
      p_display_name: "Ahmed",
    });
  });

  it.each(["added", "invited"] as const)(
    "answers the outcome %s, and only ok and the outcome",
    async (outcome) => {
      const c = consoles();
      const t = stub({ rpc: ok(outcome) });
      const out = await inviteIn(t.db, "ahmed@example.com", "Ahmed");
      expect(out).toEqual({ ok: true, outcome });
      expect(Object.keys(out).sort()).toEqual(["ok", "outcome"]);
      expect(c.count()).toBe(0);
    },
  );

  it.each([
    ["null", null],
    ["an unknown word", "joined"],
    ["a member id", MEMBER],
    ["a list", ["invited"]],
    ["an object", { outcome: "added" }],
    ["a number", 1],
  ])(
    "answers failed when the function returned %s, without logging it",
    async (_name, data) => {
      const c = consoles();
      const t = stub({ rpc: ok(data) });
      expect(await inviteIn(t.db, "ahmed@example.com", "Ahmed")).toEqual(
        FAILED,
      );
      expect(c.error).toHaveBeenCalledTimes(1);
      expect(c.error).toHaveBeenCalledWith(
        "invite_member answer has an unexpected shape",
      );
    },
  );

  it("answers failed without a hive, with no call to the function", async () => {
    const t = stub({ own: ok([]) });
    expect(await inviteIn(t.db, "ahmed@example.com", "Ahmed")).toEqual(FAILED);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("answers failed when the hive cannot be read", async () => {
    const c = consoles();
    const t = stub({ own: err("denied", "42501") });
    expect(await inviteIn(t.db, "ahmed@example.com", "Ahmed")).toEqual(FAILED);
    expect(t.rpc).not.toHaveBeenCalled();
    expect(c.error).toHaveBeenCalledWith(
      "own hive query failed",
      "42501",
      "denied",
    );
  });

  it("answers already-member when the database says so", async () => {
    const c = consoles();
    const t = stub({ rpc: err("that person is already a member", "P0001") });
    expect(await inviteIn(t.db, "ahmed@example.com", "Ahmed")).toEqual({
      ok: false,
      reason: "already-member",
    });
    expect(c.said()).not.toContain("secret payload");
  });

  it("answers already-invited when the database says so", async () => {
    const c = consoles();
    const t = stub({ rpc: err("that email is already invited", "P0001") });
    expect(await inviteIn(t.db, "new@example.com", "New")).toEqual({
      ok: false,
      reason: "already-invited",
    });
    expect(c.said()).not.toContain("secret payload");
  });

  it.each([
    ["not the owner", err("only the hive owner can invite members", "P0001")],
    ["an error without a code", err("something else")],
    ["a unique violation", err("duplicate key value", "23505")],
    ["a constraint", err("null value in column", "23502")],
  ])(
    "answers failed for %s, logging code and message only",
    async (_n, res) => {
      const c = consoles();
      const t = stub({ rpc: res });
      expect(await inviteIn(t.db, "ahmed@example.com", "Ahmed")).toEqual(
        FAILED,
      );
      expect(c.error).toHaveBeenCalledWith(
        "invite_member failed",
        res.error!.code,
        res.error!.message,
      );
      expect(c.said()).not.toContain("secret payload");
    },
  );

  it("never logs the email or the name", async () => {
    const c = consoles();
    for (const rpc of [
      err("that person is already a member", "P0001"),
      err("boom", "XX000"),
      ok(null),
    ]) {
      const t = stub({ rpc });
      await inviteIn(t.db, "ahmed@example.com", "Ahmed Person");
    }
    await inviteIn(
      stub({ user: null }).db,
      "ahmed@example.com",
      "Ahmed Person",
    );
    await inviteIn(stub().db, "ahmed@example", 7);
    expect(c.count()).toBeGreaterThan(0);
    expect(c.said()).not.toContain("ahmed@");
    expect(c.said()).not.toContain("Ahmed Person");
  });
});

describe("revokeInvitationIn", () => {
  it.each([
    ["a word", "not-a-uuid"],
    ["an empty string", ""],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an object", { id: INVITATION }],
    ["a uuid with a filter appended", `${INVITATION},revoked_at.is.null`],
  ])("refuses an id that is %s with no call at all", async (_name, id) => {
    const t = stub();
    expect(await revokeInvitationIn(t.db, id)).toEqual({ ok: false });
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses without a session, before the function is called", async () => {
    const t = stub({ user: null });
    expect(await revokeInvitationIn(t.db, INVITATION)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("revokes through revoke_invitation and nothing else", async () => {
    const t = stub();
    const out = await revokeInvitationIn(t.db, INVITATION);
    expect(out).toEqual({ ok: true });
    expect(Object.keys(out)).toEqual(["ok"]);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("revoke_invitation", {
      p_invitation: INVITATION,
    });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("answers not ok when the database refuses, logging code and message only", async () => {
    const c = consoles();
    const t = stub({ rpc: err("invitation not found", "P0001") });
    expect(await revokeInvitationIn(t.db, INVITATION)).toEqual({ ok: false });
    expect(c.error).toHaveBeenCalledWith(
      "revoke_invitation failed",
      "P0001",
      "invitation not found",
    );
    expect(c.said()).not.toContain("secret payload");
  });
});
