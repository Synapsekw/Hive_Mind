import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelHiveDeletionIn,
  createHiveIn,
  requestHiveDeletionIn,
  switchHiveIn,
} from "./write";

const ME = "00000000-0000-4000-8000-0000000000a1";
const HIVE = "00000000-0000-4000-8000-000000000b01";
const NEW_HIVE = "00000000-0000-4000-8000-000000000b07";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Op = [string, unknown[]];

/** A token whose payload names `sub`, as the session's access token does. */
const jwt = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

function jar() {
  const sets: unknown[] = [];
  return { sets, set: vi.fn((c: unknown) => void sets.push(c)) };
}

/**
 * A client signed in as ME (or as nobody) whose `members` read answers `members` and whose
 * `create_hive` answers `rpc`. Every query is recorded.
 */
function stub(
  opts: {
    members?: Res;
    rpc?: Res | (() => never);
    token?: string | null;
  } = {},
) {
  const calls: { table: string; ops: Op[] }[] = [];
  const from = vi.fn((table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"])
      chain[m] = (...args: unknown[]) => {
        ops.push([m, args]);
        return chain;
      };
    chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
      Promise.resolve(
        opts.members ?? { data: [{ hive_id: HIVE }], error: null },
      ).then(ok, no);
    return chain;
  });
  const rpc = vi.fn(async (_name: string, _args?: unknown) =>
    typeof opts.rpc === "function"
      ? opts.rpc()
      : (opts.rpc ?? { data: NEW_HIVE, error: null }),
  );
  const token = opts.token === undefined ? jwt(ME) : opts.token;
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: token === null ? null : { access_token: token } },
      error: null,
    })),
    getUser: vi.fn(),
  };
  return { db: { from, rpc, auth } as never, from, rpc, auth, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("switchHiveIn", () => {
  it("sets the cookie to a hive the person is in: a year, every page, no script can read it", async () => {
    const t = stub();
    const j = jar();
    expect(await switchHiveIn(t.db, j, HIVE)).toEqual({ ok: true });
    expect(j.sets).toEqual([
      {
        name: "hm_hive",
        value: HIVE,
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 31536000,
      },
    ]);
  });

  it("asks once: the person's own membership in that hive, one row", async () => {
    const t = stub();
    await switchHiveIn(t.db, jar(), HIVE);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("members");
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["hive_id"]],
      ["eq", ["user_id", ME]],
      ["eq", ["hive_id", HIVE]],
      ["limit", [1]],
    ]);
    expect(t.rpc).not.toHaveBeenCalled();
    // The session's own token says who asks; the database verifies it with the query.
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const j = jar();
    await switchHiveIn(stub().db, j, HIVE);
    expect(j.sets[0]).toMatchObject({ value: HIVE, secure: true });
  });

  it("stores the id in lower case", async () => {
    const j = jar();
    const upper = HIVE.toUpperCase();
    const t = stub({ members: { data: [{ hive_id: HIVE }], error: null } });
    expect(await switchHiveIn(t.db, j, upper)).toEqual({ ok: true });
    expect(j.sets[0]).toMatchObject({ value: HIVE });
  });

  it.each([
    ["a word", "synapse"],
    ["nothing", undefined],
    ["an empty text", ""],
    ["a number", 7],
    ["an object", { id: HIVE }],
    ["a filter", `${HIVE},role.eq.owner`],
    ["a path", "/settings"],
  ])("asks nothing and sets no cookie for %s", async (_n, id) => {
    const t = stub();
    const j = jar();
    expect(await switchHiveIn(t.db, j, id)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getSession).not.toHaveBeenCalled();
    expect(j.set).not.toHaveBeenCalled();
  });

  it("sets no cookie for a hive the person is not in", async () => {
    const t = stub({ members: { data: [], error: null } });
    const j = jar();
    expect(await switchHiveIn(t.db, j, HIVE)).toEqual({ ok: false });
    expect(t.from).toHaveBeenCalledTimes(1);
    expect(j.set).not.toHaveBeenCalled();
  });

  it.each([
    ["no answer", null],
    ["an answer that is not a list", { hive_id: HIVE }],
    ["a row that is not an object", ["x"]],
    ["a row naming another hive", [{ hive_id: NEW_HIVE }]],
    ["a row naming no hive", [{}]],
  ])("sets no cookie for %s", async (_n, data) => {
    const j = jar();
    const t = stub({ members: { data, error: null } });
    expect(await switchHiveIn(t.db, j, HIVE)).toEqual({ ok: false });
    expect(j.set).not.toHaveBeenCalled();
  });

  it("answers no without a session, asking nothing", async () => {
    const t = stub({ token: null });
    const j = jar();
    expect(await switchHiveIn(t.db, j, HIVE)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(j.set).not.toHaveBeenCalled();
  });

  it("answers no when the read fails, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      members: {
        data: null,
        error: { message: "denied", code: "42501", details: "secret payload" },
      },
    });
    const j = jar();
    expect(await switchHiveIn(t.db, j, HIVE)).toEqual({ ok: false });
    expect(j.set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("switch hive failed", "42501", "denied");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
    expect(JSON.stringify(log.mock.calls)).not.toContain(HIVE);
  });

  it("answers no when the client throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const j = jar();
    const db = {
      auth: stub().auth,
      from: () => {
        throw new Error("network");
      },
    };
    expect(await switchHiveIn(db as never, j, HIVE)).toEqual({ ok: false });
    expect(j.set).not.toHaveBeenCalled();
  });
});

describe("createHiveIn", () => {
  it("creates the hive with both names trimmed and makes it the chosen one", async () => {
    const t = stub();
    const j = jar();
    expect(
      await createHiveIn(t.db, j, "  Side project \n", "\tDanijel  "),
    ).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("create_hive", {
      p_name: "Side project",
      p_display_name: "Danijel",
    });
    expect(t.from).not.toHaveBeenCalled();
    expect(j.sets).toEqual([
      {
        name: "hm_hive",
        value: NEW_HIVE,
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 31536000,
      },
    ]);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const j = jar();
    await createHiveIn(stub().db, j, "Side", "Danijel");
    expect(j.sets[0]).toMatchObject({ value: NEW_HIVE, secure: true });
  });

  it("accepts names of exactly 60 characters, counting a character once however it is stored", async () => {
    const t = stub();
    const sixty = "𝓐".repeat(60);
    expect(await createHiveIn(t.db, jar(), sixty, "é".repeat(60))).toEqual({
      ok: true,
    });
    expect(t.rpc).toHaveBeenCalledWith("create_hive", {
      p_name: sixty,
      p_display_name: "é".repeat(60),
    });
  });

  it.each([
    ["an empty hive name", "", "Danijel", "name"],
    ["a hive name of spaces", " \t\n ", "Danijel", "name"],
    ["a hive name of 61 characters", "a".repeat(61), "Danijel", "name"],
    ["a hive name that is not text", 7, "Danijel", "name"],
    ["no hive name", undefined, "Danijel", "name"],
    ["an empty display name", "Side", "", "display-name"],
    ["a display name of spaces", "Side", "   ", "display-name"],
    ["a display name of 61 characters", "Side", "𝓐".repeat(61), "display-name"],
    ["a display name that is not text", "Side", { name: "D" }, "display-name"],
    ["both wrong: the hive name is named first", "", "", "name"],
  ])("refuses %s before any query", async (_n, name, displayName, reason) => {
    const t = stub();
    const j = jar();
    expect(await createHiveIn(t.db, j, name, displayName)).toEqual({
      ok: false,
      reason,
    });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
    expect(j.set).not.toHaveBeenCalled();
  });

  it.each([
    ["you already own 5 hives", "limit"],
    ["a hive needs a name", "name"],
    ["that hive name is too long", "name"],
    ["you need a name in the hive", "display-name"],
    ["that name is too long", "display-name"],
  ])("maps the database's '%s' to %s", async (message, reason) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ rpc: { data: null, error: { message, code: "P0001" } } });
    const j = jar();
    expect(await createHiveIn(t.db, j, "Side", "Danijel")).toEqual({
      ok: false,
      reason,
    });
    expect(j.set).not.toHaveBeenCalled();
  });

  it.each([
    ["sign in as a person"],
    ["an app pass cannot do this"],
    ['duplicate key value violates unique constraint "hives_pkey"'],
    ["toString"],
    ["You already own 5 hives."],
  ])(
    "answers failed for '%s', and never the database's words",
    async (message) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub({
        rpc: {
          data: null,
          error: { message, code: "23505", details: "secret payload" },
        },
      });
      const j = jar();
      const answer = await createHiveIn(t.db, j, "Side", "Danijel");
      expect(answer).toEqual({ ok: false, reason: "failed" });
      expect(JSON.stringify(answer)).not.toContain(message);
      expect(j.set).not.toHaveBeenCalled();
      // Code and message only: no payload, and neither name.
      expect(log).toHaveBeenCalledWith("create_hive failed", "23505", message);
      const said = JSON.stringify(log.mock.calls);
      expect(said).not.toContain("secret payload");
      expect(said).not.toContain("Side");
      expect(said).not.toContain("Danijel");
    },
  );

  it.each([
    ["nothing", null],
    ["a word", "created"],
    ["a row", { id: NEW_HIVE }],
  ])(
    "answers failed and sets no cookie when the database answers %s",
    async (_n, data) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const j = jar();
      const t = stub({ rpc: { data, error: null } });
      expect(await createHiveIn(t.db, j, "Side", "Danijel")).toEqual({
        ok: false,
        reason: "failed",
      });
      expect(j.set).not.toHaveBeenCalled();
    },
  );

  it("answers failed when the client throws, saying nothing of what was typed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const j = jar();
    const t = stub({
      rpc: () => {
        throw new Error("network: Side Danijel");
      },
    });
    expect(await createHiveIn(t.db, j, "Side", "Danijel")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(j.set).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("Side");
  });
});

describe("requestHiveDeletionIn", () => {
  const AFTER = "2026-12-01T09:00:00+00:00";

  it("asks the database once, with the hive and the name trimmed", async () => {
    const t = stub({ rpc: { data: AFTER, error: null } });
    expect(await requestHiveDeletionIn(t.db, HIVE, "  Synapse ")).toEqual({
      ok: true,
    });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("request_hive_deletion", {
      p_hive: HIVE,
      p_name: "Synapse",
    });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it.each([
    ["a word", "synapse"],
    ["nothing", undefined],
    ["an object", { id: HIVE }],
  ])("answers failed for an id that is %s, asking nothing", async (_n, id) => {
    const t = stub();
    expect(await requestHiveDeletionIn(t.db, id, "Synapse")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getSession).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["only spaces", " \t\n "],
    ["61 characters", "a".repeat(61)],
    ["not text", 7],
    ["nothing", undefined],
  ])("answers name for a name that is %s, asking nothing", async (_n, name) => {
    const t = stub();
    expect(await requestHiveDeletionIn(t.db, HIVE, name)).toEqual({
      ok: false,
      reason: "name",
    });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("accepts a name of exactly 60 characters", async () => {
    const t = stub({ rpc: { data: AFTER, error: null } });
    const name = "𝓐".repeat(60);
    expect(await requestHiveDeletionIn(t.db, HIVE, name)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("request_hive_deletion", {
      p_hive: HIVE,
      p_name: name,
    });
  });

  it("answers failed without a session, asking nothing", async () => {
    const t = stub({ token: null });
    expect(await requestHiveDeletionIn(t.db, HIVE, "Synapse")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("maps the database's refusal of the name to name", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: {
        data: null,
        error: { message: "that is not the name of this hive", code: "P0001" },
      },
    });
    expect(await requestHiveDeletionIn(t.db, HIVE, "Sinapse")).toEqual({
      ok: false,
      reason: "name",
    });
  });

  it.each([
    ["hive not found"],
    ["only the owner can delete a hive"],
    ["only a person can delete a hive"],
    ["an app pass cannot do this"],
    ["this hive is being deleted"],
    ["That is not the name of this hive"],
    ["toString"],
  ])(
    "answers failed for '%s', and never the database's words",
    async (message) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub({
        rpc: {
          data: null,
          error: { message, code: "P0001", details: "secret payload" },
        },
      });
      const answer = await requestHiveDeletionIn(t.db, HIVE, "Synapse");
      expect(answer).toEqual({ ok: false, reason: "failed" });
      expect(JSON.stringify(answer)).not.toContain(message);
      // Code and message only: no payload, and not what was typed.
      expect(log).toHaveBeenCalledWith(
        "request_hive_deletion failed",
        "P0001",
        message,
      );
      const said = JSON.stringify(log.mock.calls);
      expect(said).not.toContain("secret payload");
      expect(said).not.toContain("Synapse");
    },
  );

  it("answers failed when the client throws, saying nothing of what was typed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: () => {
        throw new Error("network: Synapse");
      },
    });
    expect(await requestHiveDeletionIn(t.db, HIVE, "Synapse")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Synapse");
  });
});

describe("cancelHiveDeletionIn", () => {
  it("asks the database once, with the hive", async () => {
    const t = stub({ rpc: { data: null, error: null } });
    expect(await cancelHiveDeletionIn(t.db, HIVE)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("cancel_hive_deletion", {
      p_hive: HIVE,
    });
    expect(t.from).not.toHaveBeenCalled();
  });

  it.each([
    ["a word", "synapse"],
    ["nothing", undefined],
  ])("answers no for an id that is %s, asking nothing", async (_n, id) => {
    const t = stub();
    expect(await cancelHiveDeletionIn(t.db, id)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.auth.getSession).not.toHaveBeenCalled();
  });

  it("answers no without a session, asking nothing", async () => {
    const t = stub({ token: null });
    expect(await cancelHiveDeletionIn(t.db, HIVE)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["this hive is not being deleted"],
    ["only the owner can delete a hive"],
    ["hive not found"],
  ])("answers no for '%s', logging code and message only", async (message) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: {
        data: null,
        error: { message, code: "P0001", details: "secret payload" },
      },
    });
    const answer = await cancelHiveDeletionIn(t.db, HIVE);
    expect(answer).toEqual({ ok: false });
    expect(log).toHaveBeenCalledWith(
      "cancel_hive_deletion failed",
      "P0001",
      message,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });

  it("answers no when the client throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: () => {
        throw new Error("network");
      },
    });
    expect(await cancelHiveDeletionIn(t.db, HIVE)).toEqual({ ok: false });
  });
});
