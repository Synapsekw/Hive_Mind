import { describe, expect, it, vi } from "vitest";
import { loadMap } from "./load-map";
import type { MapPayload } from "../map/types";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const MEMBER = "00000000-0000-4000-8000-000000000c01";
const USER = "11111111-1111-4111-8111-111111111101";

const payload: MapPayload = {
  members: [],
  agents: [],
  nodes: [],
  links: [],
  truncated: false,
};

type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

/** The session cookie's access token: its payload names the user. */
const tokenOf = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

const OWN = { id: MEMBER, hive_id: HIVE, hive: { name: "Synapse" } };

/** A stand-in client: `own` answers the read of the person's own oldest membership. */
function stub(opts: { own: Res; rpc?: Res; user?: { id: string } | null }) {
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
      Promise.resolve(opts.own).then(res, rej);
    return chain;
  });
  const rpc = vi
    .fn()
    .mockResolvedValue(opts.rpc ?? { data: null, error: null });
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

describe("loadMap", () => {
  it("loads the hive of the person's own oldest membership with one bounded query and one map_graph call", async () => {
    const t = stub({
      own: { data: [OWN], error: null },
      rpc: { data: payload, error: null },
    });
    const out = await loadMap(t.db);
    expect(out).toEqual({ state: "ok", payload });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("members");
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["id, hive_id, hive:hives!hive_id(name)"]],
      ["eq", ["user_id", USER]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [1]],
    ]);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("map_graph", { p_hive: HIVE });
    // The id comes from the session's token: no call to the auth server is added.
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("is no-hive when the caller has no hive, and does not call map_graph", async () => {
    const t = stub({ own: { data: [], error: null } });
    expect(await loadMap(t.db)).toEqual({ state: "no-hive" });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("is error without a session, with no query at all", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ own: { data: [OWN], error: null }, user: null });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is error when map_graph fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      own: { data: [OWN], error: null },
      rpc: {
        data: { nodes: [{ title: "Secret payload title" }] },
        error: {
          message: "boom",
          code: "XX000",
          details: "Secret payload title",
        } as Err,
      },
    });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("map_graph failed", "XX000", "boom");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    spy.mockRestore();
  });

  it("is error when the hive query fails, and does not call map_graph", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      own: { data: null, error: { message: "nope", code: "42501" } },
    });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("own hive query failed", "42501", "nope");
    spy.mockRestore();
  });

  it("is error when map_graph returns nothing", async () => {
    const t = stub({
      own: { data: [OWN], error: null },
      rpc: { data: null, error: null },
    });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
  });
});
