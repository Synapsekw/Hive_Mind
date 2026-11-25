import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { currentOf, myHives, ownHive, sessionUserId } from "./own-hive";

const ME = "00000000-0000-4000-8000-0000000000a1";
const STRANGER = "00000000-0000-4000-8000-0000000000a2";
const MINE = "00000000-0000-4000-8000-000000000b01";
const THEIRS = "00000000-0000-4000-8000-000000000b02";
const NOT_MINE = "00000000-0000-4000-8000-000000000b09";

/** The browser's cookies as the request carries them; with no argument there is no request. */
function browser(has?: Record<string, string>) {
  if (!has) {
    mocks.cookies.mockRejectedValue(new Error("outside a request scope"));
    return;
  }
  mocks.cookies.mockResolvedValue({
    get: (name: string) =>
      name in has ? { name, value: has[name]! } : undefined,
  });
}

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Row = Record<string, unknown>;
type Op = [string, unknown[]];

/** A token whose payload names `sub`, as the session's access token does. */
const jwt = (payload: unknown) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

function auth(token: string | null | (() => never)) {
  return {
    getSession: vi.fn(async () =>
      typeof token === "function"
        ? token()
        : {
            data: { session: token === null ? null : { access_token: token } },
            error: null,
          },
    ),
    getUser: vi.fn(),
  };
}

/**
 * A stand-in for the `members` table that does what the database would with the query: keeps
 * the rows every `eq` names, sorts them by every `order` in turn and cuts them at `limit`.
 */
function table(rows: Row[], token: string | null = jwt({ sub: ME })) {
  const calls: { table: string; ops: Op[] }[] = [];
  const from = vi.fn((name: string) => {
    const ops: Op[] = [];
    calls.push({ table: name, ops });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"])
      chain[m] = (...args: unknown[]) => {
        ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) => {
      let out = [...rows];
      for (const [m, a] of ops)
        if (m === "eq") out = out.filter((r) => r[a[0] as string] === a[1]);
      const orders = ops.filter(([m]) => m === "order").map(([, a]) => a);
      out.sort((x, y) => {
        for (const [col, opt] of orders as [string, { ascending: boolean }][]) {
          const [a, b] = [String(x[col]), String(y[col])];
          if (a !== b) return (a < b ? -1 : 1) * (opt.ascending ? 1 : -1);
        }
        return 0;
      });
      const limit = ops.find(([m]) => m === "limit")?.[1][0] as number;
      return Promise.resolve({
        data: out.slice(0, limit),
        error: null,
      }).then(res, rej);
    };
    return chain;
  });
  const a = auth(token);
  return { db: { from, auth: a } as never, calls, from, auth: a };
}

/** A client whose one query answers `res`, whatever was asked. */
function answering(res: Res) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
  chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
    Promise.resolve(res).then(ok, no);
  const from = vi.fn(() => chain);
  return { db: { from, auth: auth(jwt({ sub: ME })) } as never, from };
}

const member = (over: Row): Row => ({
  id: "00000000-0000-4000-8000-00000000c001",
  hive_id: MINE,
  user_id: ME,
  created_at: "2026-11-20T10:00:00+00:00",
  display_name: "Danijel",
  role: "owner",
  hive: { name: "Synapse" },
  ...over,
});

beforeEach(() => browser());

afterEach(() => {
  vi.restoreAllMocks();
  mocks.cookies.mockReset();
});

/** Two hives of the person's own: Synapse joined first, Side later. */
const both = () => [
  member({
    id: "00000000-0000-4000-8000-00000000c002",
    hive_id: THEIRS,
    created_at: "2026-11-23T12:00:00+00:00",
    display_name: "Dani",
    role: "member",
    hive: { name: "Side" },
  }),
  member({ id: "00000000-0000-4000-8000-00000000c001" }),
];

describe("sessionUserId", () => {
  it("is the subject of the session's access token, with no call to the auth server", async () => {
    const a = auth(jwt({ sub: ME, role: "authenticated" }));
    expect(await sessionUserId({ auth: a } as never)).toBe(ME);
    expect(a.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["no session", null],
    ["a token that is not three parts", "abc"],
    ["a payload that is not JSON", "h.bm90IGpzb24.s"],
    ["a payload that is not an object", jwt("x")],
    ["no subject", jwt({ role: "authenticated" })],
    ["a subject that is not a user id", jwt({ sub: "someone" })],
    ["a subject that is a number", jwt({ sub: 7 })],
  ])("is null for %s", async (_name, token) => {
    expect(await sessionUserId({ auth: auth(token) } as never)).toBeNull();
  });

  it("is null when the session cannot be read", async () => {
    const a = auth(() => {
      throw new Error("cookies: secret payload");
    });
    expect(await sessionUserId({ auth: a } as never)).toBeNull();
  });
});

describe("ownHive", () => {
  it("is the hive of the person's oldest membership, even when another of their hives is older", async () => {
    // The stranger's hive existed first and its owner added the person to it later. Every row
    // here is one the person may read.
    const t = table([
      member({
        id: "00000000-0000-4000-8000-00000000c009",
        hive_id: THEIRS,
        user_id: STRANGER,
        created_at: "2026-01-01T00:00:00+00:00",
        hive: { name: "Stranger's" },
      }),
      member({
        id: "00000000-0000-4000-8000-00000000c002",
        hive_id: THEIRS,
        created_at: "2026-11-23T12:00:00+00:00",
        hive: { name: "Stranger's" },
      }),
      member({ id: "00000000-0000-4000-8000-00000000c001" }),
    ]);
    expect(await ownHive(t.db)).toEqual({
      id: MINE,
      name: "Synapse",
      memberId: "00000000-0000-4000-8000-00000000c001",
      deleteAfter: null,
    });
  });

  it("breaks a tie on the time by the membership's id", async () => {
    const t = table([
      member({
        id: "00000000-0000-4000-8000-00000000c002",
        hive_id: THEIRS,
        hive: { name: "Stranger's" },
      }),
      member({ id: "00000000-0000-4000-8000-00000000c001" }),
    ]);
    expect(await ownHive(t.db)).toMatchObject({ id: MINE });
  });

  it("asks once: the person's own rows, oldest first, then by id, 50 at most", async () => {
    const t = table([member({})]);
    await ownHive(t.db);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("members");
    expect(t.calls[0]!.ops).toEqual([
      [
        "select",
        [
          "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
        ],
      ],
      ["eq", ["user_id", ME]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [50]],
    ]);
  });

  it("asks once whichever hive is chosen", async () => {
    browser({ hm_hive: THEIRS });
    const t = table(both());
    await ownHive(t.db);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.ops).toContainEqual(["limit", [50]]);
  });

  it("uses the user id it is given and does not read the session", async () => {
    const t = table(
      [member({ user_id: STRANGER, hive_id: THEIRS })],
      jwt({ sub: ME }),
    );
    expect(await ownHive(t.db, STRANGER)).toMatchObject({ id: THEIRS });
    expect(t.auth.getSession).not.toHaveBeenCalled();
    expect(t.calls[0]!.ops[1]).toEqual(["eq", ["user_id", STRANGER]]);
  });

  it("is null for a person in no hive", async () => {
    expect(await ownHive(table([]).db)).toBeNull();
    // Someone else's membership is not theirs.
    expect(await ownHive(table([member({ user_id: STRANGER })]).db)).toBeNull();
  });

  it("is error without a session, and asks nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = table([member({})], null);
    expect(await ownHive(t.db)).toBe("error");
    expect(t.from).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("own hive read has no session");
  });

  it("is error when the read fails, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = answering({
      data: null,
      error: { message: "denied", code: "42501", details: "secret payload" },
    });
    expect(await ownHive(t.db)).toBe("error");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "own hive query failed",
      "42501",
      "denied",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it.each([
    ["an answer that is not a list", { id: "x" }],
    ["no answer", null],
    ["a row that is not an object", ["x"]],
    ["a membership without an id", [member({ id: undefined })]],
    ["a hive id that is a number", [member({ hive_id: 1 })]],
    ["no hive beside the membership", [member({ hive: null })]],
    ["a hive that is a list", [member({ hive: [{ name: "S" }] })]],
    ["a hive without a name", [member({ hive: {} })]],
  ])("is error for %s", async (_name, data) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ownHive(answering({ data, error: null }).db)).toBe("error");
    expect(log).toHaveBeenCalledWith("own hive answer has an unexpected shape");
  });
});

describe("ownHive: the chosen hive", () => {
  it("is the oldest membership's hive when the browser carries no choice", async () => {
    browser({});
    expect(await ownHive(table(both()).db)).toMatchObject({ id: MINE });
  });

  it("is the hive the cookie names when the person is in it", async () => {
    browser({ hm_hive: THEIRS });
    expect(await ownHive(table(both()).db)).toEqual({
      id: THEIRS,
      name: "Side",
      memberId: "00000000-0000-4000-8000-00000000c002",
      deleteAfter: null,
    });
  });

  it("answers who the person is in the chosen hive, not in the oldest", async () => {
    browser({ hm_hive: THEIRS });
    expect(
      await ownHive(table(both()).db, undefined, { profile: true }),
    ).toEqual({
      id: THEIRS,
      name: "Side",
      memberId: "00000000-0000-4000-8000-00000000c002",
      displayName: "Dani",
      deleteAfter: null,
      role: "member",
    });
  });

  it("matches the id whatever its case", async () => {
    browser({ hm_hive: THEIRS.toUpperCase() });
    expect(await ownHive(table(both()).db)).toMatchObject({ id: THEIRS });
  });

  it.each([
    ["a hive the person is not in", NOT_MINE],
    ["junk", "synapse"],
    ["nothing", ""],
    ["a filter", `${THEIRS},hive_id.neq.x`],
  ])(
    "is the oldest membership's hive for a cookie naming %s",
    async (_n, v) => {
      browser({ hm_hive: v });
      const t = table(both());
      expect(await ownHive(t.db)).toMatchObject({ id: MINE });
      // The cookie's value never reaches the query.
      expect(JSON.stringify(t.calls)).not.toContain(v || "hm_hive");
    },
  );

  it("never answers a hive that only someone else is in, even when the cookie names it", async () => {
    browser({ hm_hive: NOT_MINE });
    const t = table([
      ...both(),
      member({
        id: "00000000-0000-4000-8000-00000000c009",
        hive_id: NOT_MINE,
        user_id: STRANGER,
        hive: { name: "Stranger's" },
      }),
    ]);
    expect(await ownHive(t.db)).toMatchObject({ id: MINE });
  });

  it("is the oldest membership's hive outside a request", async () => {
    browser();
    expect(await ownHive(table(both()).db)).toMatchObject({ id: MINE });
  });

  it("uses opts.chosen in place of the cookie, and does not read the cookie", async () => {
    browser({ hm_hive: THEIRS });
    expect(
      await ownHive(table(both()).db, undefined, { chosen: null }),
    ).toMatchObject({ id: MINE });
    expect(
      await ownHive(table(both()).db, undefined, { chosen: MINE }),
    ).toMatchObject({ id: MINE });
    browser({});
    expect(
      await ownHive(table(both()).db, undefined, { chosen: THEIRS }),
    ).toMatchObject({ id: THEIRS });
    expect(
      await ownHive(table(both()).db, undefined, {
        profile: true,
        chosen: THEIRS,
      }),
    ).toMatchObject({ id: THEIRS, role: "member" });
    expect(
      await ownHive(table(both()).db, undefined, { chosen: NOT_MINE }),
    ).toMatchObject({ id: MINE });
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("is still null for a person in no hive, and error when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    browser({ hm_hive: THEIRS });
    expect(await ownHive(table([]).db)).toBeNull();
    expect(
      await ownHive(answering({ data: null, error: { message: "x" } }).db),
    ).toBe("error");
  });

  it("is error when the chosen row is malformed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    browser({ hm_hive: THEIRS });
    const data = [member({}), member({ hive_id: THEIRS, hive: null })];
    expect(await ownHive(answering({ data, error: null }).db)).toBe("error");
    expect(log).toHaveBeenCalledWith("own hive answer has an unexpected shape");
  });
});

describe("myHives", () => {
  it("lists the person's hives, oldest membership first, in one bounded read", async () => {
    const t = table(both());
    expect(await myHives(t.db)).toEqual([
      {
        id: MINE,
        name: "Synapse",
        role: "owner",
        memberId: "00000000-0000-4000-8000-00000000c001",
        displayName: "Danijel",
        deleteAfter: null,
      },
      {
        id: THEIRS,
        name: "Side",
        role: "member",
        memberId: "00000000-0000-4000-8000-00000000c002",
        displayName: "Dani",
        deleteAfter: null,
      },
    ]);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("members");
    expect(t.calls[0]!.ops).toEqual([
      [
        "select",
        [
          "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
        ],
      ],
      ["eq", ["user_id", ME]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [50]],
    ]);
  });

  it("is the same list whichever hive is chosen", async () => {
    browser({ hm_hive: THEIRS });
    const hives = await myHives(table(both()).db);
    expect(hives).toMatchObject([{ id: MINE }, { id: THEIRS }]);
  });

  it("uses the user id it is given and does not read the session", async () => {
    const t = table([member({ user_id: STRANGER, hive_id: THEIRS })]);
    expect(await myHives(t.db, STRANGER)).toMatchObject([{ id: THEIRS }]);
    expect(t.auth.getSession).not.toHaveBeenCalled();
  });

  it("leaves out rows that are not memberships", async () => {
    const data = [
      "x",
      null,
      member({ hive: null }),
      member({ role: 3 }),
      member({ display_name: undefined }),
      member({ id: "00000000-0000-4000-8000-00000000c007" }),
    ];
    expect(await myHives(answering({ data, error: null }).db)).toEqual([
      {
        id: MINE,
        name: "Synapse",
        role: "owner",
        memberId: "00000000-0000-4000-8000-00000000c007",
        displayName: "Danijel",
        deleteAfter: null,
      },
    ]);
  });

  it("is empty for a person in no hive", async () => {
    expect(await myHives(table([]).db)).toEqual([]);
  });

  it("is error without a session, when the read fails, and for an answer that is not a list", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = table([member({})], null);
    expect(await myHives(t.db)).toBe("error");
    expect(t.from).not.toHaveBeenCalled();
    expect(
      await myHives(
        answering({
          data: null,
          error: {
            message: "denied",
            code: "42501",
            details: "secret payload",
          },
        }).db,
      ),
    ).toBe("error");
    expect(await myHives(answering({ data: {}, error: null }).db)).toBe(
      "error",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });
});

describe("currentOf", () => {
  const hives = [
    {
      id: MINE,
      name: "Synapse",
      role: "owner",
      memberId: "m1",
      displayName: "D",
      deleteAfter: null,
    },
    {
      id: THEIRS,
      name: "Side",
      role: "member",
      memberId: "m2",
      displayName: "D",
      deleteAfter: null,
    },
  ];
  it("is the chosen hive when it is in the list, else the first", () => {
    expect(currentOf(hives, THEIRS)).toBe(hives[1]);
    expect(currentOf(hives, THEIRS.toUpperCase())).toBe(hives[1]);
    expect(currentOf(hives, NOT_MINE)).toBe(hives[0]);
    expect(currentOf(hives, "junk")).toBe(hives[0]);
    expect(currentOf(hives, null)).toBe(hives[0]);
    expect(currentOf([], THEIRS)).toBeUndefined();
  });
});

describe("ownHive with { profile: true }", () => {
  it("asks for the name and role too, in the same one query", async () => {
    const t = table([member({})]);
    await ownHive(t.db, undefined, { profile: true });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.ops[0]).toEqual([
      "select",
      [
        "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
      ],
    ]);
  });

  it("returns the hive with the person's display name and role", async () => {
    const t = table([member({})]);
    expect(await ownHive(t.db, undefined, { profile: true })).toEqual({
      id: MINE,
      name: "Synapse",
      memberId: "00000000-0000-4000-8000-00000000c001",
      displayName: "Danijel",
      deleteAfter: null,
      role: "owner",
    });
  });

  it("leaves the default shape without them", async () => {
    const t = table([member({})]);
    expect(await ownHive(t.db)).toEqual({
      id: MINE,
      name: "Synapse",
      memberId: "00000000-0000-4000-8000-00000000c001",
      deleteAfter: null,
    });
  });

  it.each([
    ["a membership without a display name", [member({ display_name: null })]],
    ["a membership without a role", [member({ role: 3 })]],
  ])("is error for %s", async (_name, data) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await ownHive(answering({ data, error: null }).db, undefined, {
        profile: true,
      }),
    ).toBe("error");
    expect(log).toHaveBeenCalledWith("own hive answer has an unexpected shape");
  });

  it("does not refuse those rows on the default path", async () => {
    const data = [member({ display_name: null, role: 3 })];
    expect(await ownHive(answering({ data, error: null }).db)).toMatchObject({
      id: MINE,
    });
  });
});

describe("a hive that is being deleted", () => {
  const AFTER = "2026-12-01T09:00:00+00:00";

  it("carries the date the hive goes, from the same one read", async () => {
    const t = table([
      member({ hive: { name: "Synapse", delete_after: AFTER } }),
    ]);
    expect(await ownHive(t.db)).toMatchObject({ id: MINE, deleteAfter: AFTER });
    expect(await ownHive(t.db, undefined, { profile: true })).toMatchObject({
      role: "owner",
      deleteAfter: AFTER,
    });
    expect(t.calls).toHaveLength(2);
    expect(String(t.calls[0]!.ops[0]![1][0])).toContain(
      "hive:hives!hive_id(name, delete_after)",
    );
  });

  it.each([
    ["absent", { name: "Synapse" }],
    ["null", { name: "Synapse", delete_after: null }],
    ["a number", { name: "Synapse", delete_after: 1 }],
    ["an object", { name: "Synapse", delete_after: {} }],
  ])("has no date when it is %s", async (_n, hive) => {
    expect(await ownHive(table([member({ hive })]).db)).toMatchObject({
      id: MINE,
      deleteAfter: null,
    });
  });

  it("marks each of the person's hives on its own", async () => {
    const rows = both();
    rows[0]!.hive = { name: "Side", delete_after: AFTER };
    const hives = await myHives(table(rows).db);
    if (hives === "error") throw new Error("not read");
    expect(hives.map((h) => [h.name, h.deleteAfter])).toEqual([
      ["Synapse", null],
      ["Side", AFTER],
    ]);
  });
});
