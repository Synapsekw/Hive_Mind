import { afterEach, describe, expect, it, vi } from "vitest";
import { ownHive, sessionUserId } from "./own-hive";

const ME = "00000000-0000-4000-8000-0000000000a1";
const STRANGER = "00000000-0000-4000-8000-0000000000a2";
const MINE = "00000000-0000-4000-8000-000000000b01";
const THEIRS = "00000000-0000-4000-8000-000000000b02";

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
  hive: { name: "Synapse" },
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("asks once: the person's own rows, oldest first, then by id, one row", async () => {
    const t = table([member({})]);
    await ownHive(t.db);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("members");
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["id, hive_id, hive:hives!hive_id(name)"]],
      ["eq", ["user_id", ME]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [1]],
    ]);
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
