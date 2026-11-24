import { afterEach, describe, expect, it, vi } from "vitest";
import { loadInbox, loadInboxCount, toData } from "./load-inbox";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const W1 = "00000000-0000-4000-8000-000000000b01";
const LINK = "00000000-0000-4000-8000-000000020001";
const NOTE = "00000000-0000-4000-8000-000000010001";
const HELD = "00000000-0000-4000-8000-000000010002";
const MEMBER = "00000000-0000-4000-8000-000000000c01";
const USER = "11111111-1111-4111-8111-111111111101";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });
const err = (message: string, code?: string): Res => ({
  data: null,
  error: { message, code, details: "secret payload" },
});

function link(over: Record<string, unknown> = {}) {
  return {
    id: LINK,
    tier: 3,
    created_at: "2026-11-22T09:00:00+00:00",
    proposed_by: "theirs",
    they_accepted: true,
    mine: {
      id: NOTE,
      title: "Acme pricing",
      path: "clients/acme/pricing.md",
      workspace_id: W1,
    },
    theirs: { member_name: "Ahmed", topic: "clients", title: "Acme renewal" },
    ...over,
  };
}

function held(over: Record<string, unknown> = {}) {
  return {
    id: HELD,
    title: "Draft",
    path: "inbox/draft.md",
    workspace_id: W1,
    agent_name: "Claude",
    updated_at: "2026-11-21T08:00:00+00:00",
    ...over,
  };
}

function answer(over: Record<string, unknown> = {}) {
  return {
    links: [link()],
    links_total: 140,
    held: [held()],
    held_total: 2,
    ...over,
  };
}

/** The session cookie's access token: its payload names the user. */
const tokenOf = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

const OWN = { id: MEMBER, hive_id: HIVE, hive: { name: "Synapse" } };

/**
 * A stand-in client: `from(table)` chains and `rpc` calls are recorded. `own` answers the read
 * of the person's own oldest membership.
 */
function stub(
  opts: {
    own?: Res;
    rpc?: Res | (() => never);
    user?: { id: string } | null;
  } = {},
) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(opts.own ?? ok([OWN])).then(res, rej);
    return chain;
  });
  const rpc = vi.fn(async (_name: string, _args: unknown) =>
    typeof opts.rpc === "function" ? opts.rpc() : (opts.rpc ?? ok(answer())),
  );
  const user = opts.user === undefined ? { id: USER } : opts.user;
  const auth = {
    getUser: vi.fn(),
    getSession: vi.fn(async () => ({
      data: { session: user ? { access_token: tokenOf(user.id) } : null },
      error: null,
    })),
  };
  return { db: { from, rpc, auth } as never, calls, from, rpc, auth };
}

const args = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toData", () => {
  it("maps a full answer field by field", () => {
    expect(toData(answer())).toEqual({
      links: [
        {
          id: LINK,
          tier: 3,
          createdAt: "2026-11-22T09:00:00+00:00",
          proposedBy: "theirs",
          theyAccepted: true,
          mine: {
            id: NOTE,
            title: "Acme pricing",
            path: "clients/acme/pricing.md",
            workspaceId: W1,
          },
          theirs: {
            memberName: "Ahmed",
            topic: "clients",
            title: "Acme renewal",
          },
        },
      ],
      linksTotal: 140,
      held: [
        {
          id: HELD,
          title: "Draft",
          path: "inbox/draft.md",
          workspaceId: W1,
          agentName: "Claude",
          updatedAt: "2026-11-21T08:00:00+00:00",
        },
      ],
      heldTotal: 2,
    });
  });

  it("maps an empty answer", () => {
    expect(
      toData({ links: [], links_total: 0, held: [], held_total: 0 }),
    ).toEqual({ links: [], linksTotal: 0, held: [], heldTotal: 0 });
  });

  it("keeps a null title of the other note and a null agent name", () => {
    const out = toData(
      answer({
        links: [
          link({ theirs: { member_name: "Ahmed", topic: "t", title: null } }),
        ],
        held: [held({ agent_name: null })],
      }),
    );
    expect(out?.links[0]?.theirs.title).toBeNull();
    expect(out?.held[0]?.agentName).toBeNull();
  });

  it("carries nothing the contract does not name", () => {
    const out = toData(
      answer({
        links: [
          link({
            body: "secret",
            theirs: {
              member_name: "Ahmed",
              topic: "t",
              title: null,
              id: "their-id",
              path: "their/path.md",
            },
          }),
        ],
      }),
    );
    expect(Object.keys(out!.links[0]!).sort()).toEqual(
      [
        "createdAt",
        "id",
        "mine",
        "proposedBy",
        "theirs",
        "theyAccepted",
        "tier",
      ].sort(),
    );
    expect(out!.links[0]!.theirs).toEqual({
      memberName: "Ahmed",
      topic: "t",
      title: null,
    });
  });

  it.each([
    ["null", null],
    ["a string", "inbox"],
    ["a number", 3],
    ["an array", []],
  ])("is null for %s", (_name, raw) => {
    expect(toData(raw)).toBeNull();
  });

  it.each([
    ["a missing links list", answer({ links: undefined })],
    ["a missing held list", answer({ held: undefined })],
    ["links that are not a list", answer({ links: {} })],
    ["a missing total", answer({ links_total: undefined })],
    ["a negative total", answer({ held_total: -1 })],
    ["a total that is not a number", answer({ links_total: "140" })],
    ["a tier of 0", answer({ links: [link({ tier: 0 })] })],
    ["a tier of 5", answer({ links: [link({ tier: 5 })] })],
    ["a tier that is a string", answer({ links: [link({ tier: "3" })] })],
    [
      "an unknown proposer",
      answer({ links: [link({ proposed_by: "agent" })] }),
    ],
    ["a link id that is not a string", answer({ links: [link({ id: 7 })] })],
    [
      "they_accepted that is not a boolean",
      answer({ links: [link({ they_accepted: null })] }),
    ],
    ["a link without its own note", answer({ links: [link({ mine: null })] })],
    [
      "a link without the other note",
      answer({ links: [link({ theirs: undefined })] }),
    ],
    [
      "another note with a title that is a number",
      answer({
        links: [
          link({ theirs: { member_name: "Ahmed", topic: "t", title: 4 } }),
        ],
      }),
    ],
    ["a link that is not an object", answer({ links: ["x"] })],
    ["a held id that is not a string", answer({ held: [held({ id: null })] })],
    [
      "a held agent name that is a number",
      answer({ held: [held({ agent_name: 1 })] }),
    ],
    [
      "a held note without updated_at",
      answer({ held: [held({ updated_at: undefined })] }),
    ],
  ])("is null for %s", (_name, raw) => {
    expect(toData(raw)).toBeNull();
  });

  it("drops nothing silently: one bad row among good ones makes it null", () => {
    expect(
      toData(answer({ links: [link(), link({ tier: 9 }), link()] })),
    ).toBeNull();
    expect(toData(answer({ held: [held(), held({ id: 1 })] }))).toBeNull();
  });
});

describe("loadInbox", () => {
  it("answers no-hive without asking for the inbox", async () => {
    const t = stub({ own: ok([]) });
    expect(await loadInbox(t.db)).toEqual({ state: "no-hive" });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("answers error when the hive cannot be read, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ own: err("denied", "42501") });
    expect(await loadInbox(t.db)).toEqual({ state: "error" });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "own hive query failed",
      "42501",
      "denied",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it("answers error when the function fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ rpc: err("not a member of this hive", "P0001") });
    expect(await loadInbox(t.db)).toEqual({ state: "error" });
    expect(log).toHaveBeenCalledWith(
      "inbox failed",
      "P0001",
      "not a member of this hive",
    );
  });

  it("answers error when the answer has the wrong shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ rpc: ok({ links: [] }) });
    expect(await loadInbox(t.db)).toEqual({ state: "error" });
  });

  it("answers ok with the data", async () => {
    const t = stub();
    expect(await loadInbox(t.db)).toEqual({
      state: "ok",
      data: toData(answer()),
    });
  });

  it("asks for the inbox of the hive of the person's own oldest membership", async () => {
    const t = stub();
    await loadInbox(t.db);
    expect(t.calls).toHaveLength(1);
    const [own] = t.calls;
    expect(own!.table).toBe("members");
    expect(own!.ops).toEqual([
      ["select", ["id, hive_id, hive:hives!hive_id(name, delete_after)"]],
      ["eq", ["user_id", USER]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [50]],
    ]);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("inbox", { p_hive: HIVE });
    // The id comes from the session's token: no call to the auth server is added.
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("answers error without a session, with no query at all", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ user: null });
    expect(await loadInbox(t.db)).toEqual({ state: "error" });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
  });
});

describe("loadInboxCount", () => {
  it("passes the number through, asked of the person's own hive", async () => {
    const t = stub({ rpc: ok(7) });
    expect(await loadInboxCount(t.db)).toBe(7);
    expect(t.rpc).toHaveBeenCalledWith("inbox_count", { p_hive: HIVE });
    expect(args(t.calls[0]!, "order")).toEqual([
      "created_at",
      { ascending: true },
    ]);
  });

  it("is 0 for zero", async () => {
    expect(await loadInboxCount(stub({ rpc: ok(0) }).db)).toBe(0);
  });

  it("is 0 when the function fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await loadInboxCount(stub({ rpc: err("inbox is for people") }).db),
    ).toBe(0);
  });

  it.each([
    ["a string", "7"],
    ["null", null],
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["not a number", Number.NaN],
    ["an object", { count: 7 }],
  ])("is 0 for %s", async (_name, data) => {
    expect(await loadInboxCount(stub({ rpc: ok(data) }).db)).toBe(0);
  });

  it("counts in the hive of the person's own oldest membership", async () => {
    const t = stub({ rpc: ok(7) });
    expect(await loadInboxCount(t.db)).toBe(7);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("members");
    expect(args(t.calls[0]!, "eq")).toEqual(["user_id", USER]);
    expect(t.rpc).toHaveBeenCalledWith("inbox_count", { p_hive: HIVE });
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("is 0 without a session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ user: null });
    expect(await loadInboxCount(t.db)).toBe(0);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("is 0 without a hive, with no call to the function", async () => {
    const t = stub({ own: ok([]) });
    expect(await loadInboxCount(t.db)).toBe(0);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("is 0 when the hive cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ own: err("denied", "42501") });
    expect(await loadInboxCount(t.db)).toBe(0);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("is 0 when the client throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: () => {
        throw new TypeError("fetch failed: secret payload");
      },
    });
    expect(await loadInboxCount(t.db)).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
    const broken = {
      from: () => {
        throw new Error("no client");
      },
      rpc: vi.fn(),
    } as never;
    expect(await loadInboxCount(broken)).toBe(0);
  });

  it("says once that the function is not there yet, then stays quiet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = err(
      "Could not find the function public.inbox_count(p_hive) in the schema cache",
      "PGRST202",
    );
    expect(await loadInboxCount(stub({ rpc: missing }).db)).toBe(0);
    expect(await loadInboxCount(stub({ rpc: missing }).db)).toBe(0);
    expect(await loadInboxCount(stub({ rpc: missing }).db)).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "inbox_count failed",
      "PGRST202",
      missing.error!.message,
    );
  });
});
