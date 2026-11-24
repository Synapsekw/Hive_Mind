import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock("../../lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import * as actions from "./actions";
import {
  cancelHiveDeletion,
  createHive,
  requestHiveDeletion,
  switchHive,
} from "./actions";

const ME = "00000000-0000-4000-8000-0000000000a1";
const HIVE = "00000000-0000-4000-8000-000000000b01";
const NEW_HIVE = "00000000-0000-4000-8000-000000000b07";

type Res = { data: unknown; error: { message: string; code?: string } | null };

function jar() {
  const sets: unknown[] = [];
  const store = { get: vi.fn(), set: vi.fn((c: unknown) => void sets.push(c)) };
  mocks.cookies.mockResolvedValue(store);
  return { store, sets };
}

function client(opts: { members?: Res; rpc?: Res } = {}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) chain[m] = () => chain;
  chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
    Promise.resolve(
      opts.members ?? { data: [{ hive_id: HIVE }], error: null },
    ).then(ok, no);
  const from = vi.fn(() => chain);
  const rpc = vi.fn(
    async (_n: string, _a?: unknown) =>
      opts.rpc ?? { data: NEW_HIVE, error: null },
  );
  const token = `h.${Buffer.from(JSON.stringify({ sub: ME })).toString("base64url")}.s`;
  mocks.createServerSupabase.mockResolvedValue({
    from,
    rpc,
    auth: {
      getSession: async () => ({
        data: { session: { access_token: token } },
        error: null,
      }),
    },
  });
  return { from, rpc };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("the actions file", () => {
  it("exposes the four actions and nothing else", () => {
    expect(Object.keys(actions).sort()).toEqual([
      "cancelHiveDeletion",
      "createHive",
      "requestHiveDeletion",
      "switchHive",
    ]);
  });
});

describe("switchHive", () => {
  it("sets the cookie for a hive the person is in", async () => {
    client();
    const c = jar();
    expect(await switchHive(HIVE)).toEqual({ ok: true });
    expect(c.sets).toHaveLength(1);
    expect(c.sets[0]).toMatchObject({
      name: "hm_hive",
      value: HIVE,
      httpOnly: true,
      path: "/",
    });
  });

  it("answers no and sets nothing for a hive the person is not in", async () => {
    client({ members: { data: [], error: null } });
    const c = jar();
    expect(await switchHive(HIVE)).toEqual({ ok: false });
    expect(c.sets).toEqual([]);
  });

  it("answers no for an id that is not one, asking nothing", async () => {
    const t = client();
    const c = jar();
    expect(await switchHive("x")).toEqual({ ok: false });
    expect(await switchHive({ id: HIVE } as never)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(c.sets).toEqual([]);
  });

  it("answers no when the app is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    jar();
    mocks.createServerSupabase.mockRejectedValue(new Error("not configured"));
    expect(await switchHive(HIVE)).toEqual({ ok: false });
  });
});

describe("createHive", () => {
  it("creates the hive and makes it the chosen one", async () => {
    const t = client();
    const c = jar();
    expect(await createHive(" Side ", "Danijel")).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("create_hive", {
      p_name: "Side",
      p_display_name: "Danijel",
    });
    expect(c.sets).toHaveLength(1);
    expect(c.sets[0]).toMatchObject({ name: "hm_hive", value: NEW_HIVE });
  });

  it("answers the reason, never the database's words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({
      rpc: { data: null, error: { message: "you already own 5 hives" } },
    });
    const c = jar();
    expect(await createHive("Side", "Danijel")).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(await createHive("", "Danijel")).toEqual({
      ok: false,
      reason: "name",
    });
    expect(await createHive("Side", " ")).toEqual({
      ok: false,
      reason: "display-name",
    });
    expect(c.sets).toEqual([]);
  });

  it("answers failed when the app is not configured, saying nothing of what was typed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    jar();
    mocks.createServerSupabase.mockRejectedValue(
      new Error("not configured: Side"),
    );
    expect(await createHive("Side", "Danijel")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Side");
  });
});

describe("requestHiveDeletion", () => {
  it("asks the database as the person, with the hive and the typed name", async () => {
    const t = client({
      rpc: { data: "2026-12-01T09:00:00+00:00", error: null },
    });
    expect(await requestHiveDeletion(HIVE, " Synapse ")).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("request_hive_deletion", {
      p_hive: HIVE,
      p_name: "Synapse",
    });
  });

  it("answers the reason, never the database's words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({
      rpc: {
        data: null,
        error: { message: "that is not the name of this hive" },
      },
    });
    expect(await requestHiveDeletion(HIVE, "Sinapse")).toEqual({
      ok: false,
      reason: "name",
    });
    client({
      rpc: {
        data: null,
        error: { message: "only the owner can delete a hive" },
      },
    });
    expect(await requestHiveDeletion(HIVE, "Synapse")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("answers failed when the app is not configured, saying nothing of what was typed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createServerSupabase.mockRejectedValue(
      new Error("not configured: Synapse"),
    );
    expect(await requestHiveDeletion(HIVE, "Synapse")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Synapse");
  });
});

describe("cancelHiveDeletion", () => {
  it("asks the database as the person, with the hive", async () => {
    const t = client({ rpc: { data: null, error: null } });
    expect(await cancelHiveDeletion(HIVE)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("cancel_hive_deletion", {
      p_hive: HIVE,
    });
  });

  it("answers no when the database refuses, for an id that is not one, and when the app is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = client({
      rpc: { data: null, error: { message: "this hive is not being deleted" } },
    });
    expect(await cancelHiveDeletion(HIVE)).toEqual({ ok: false });
    t.rpc.mockClear();
    expect(await cancelHiveDeletion("x")).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
    mocks.createServerSupabase.mockRejectedValue(new Error("not configured"));
    expect(await cancelHiveDeletion(HIVE)).toEqual({ ok: false });
  });
});
