import { describe, expect, it, vi } from "vitest";
import { loadMap } from "./load-map";
import type { MapPayload } from "../map/types";

const payload: MapPayload = {
  members: [],
  agents: [],
  nodes: [],
  links: [],
  truncated: false,
};

type Err = { message: string; code?: string };

function stub(opts: {
  hives: { data: { id: string }[] | null; error: Err | null };
  rpc?: { data: unknown; error: Err | null };
}) {
  const limit = vi.fn().mockResolvedValue(opts.hives);
  const order = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi
    .fn()
    .mockResolvedValue(opts.rpc ?? { data: null, error: null });
  return { db: { from, rpc } as never, from, select, order, limit, rpc };
}

describe("loadMap", () => {
  it("loads the first hive with one bounded query and one map_graph call", async () => {
    const t = stub({
      hives: { data: [{ id: "h1" }], error: null },
      rpc: { data: payload, error: null },
    });
    const out = await loadMap(t.db);
    expect(out).toEqual({ state: "ok", payload });
    expect(t.from).toHaveBeenCalledWith("hives");
    expect(t.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(t.limit).toHaveBeenCalledWith(1);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("map_graph", { p_hive: "h1" });
  });

  it("is no-hive when the caller has no hive, and does not call map_graph", async () => {
    const t = stub({ hives: { data: [], error: null } });
    expect(await loadMap(t.db)).toEqual({ state: "no-hive" });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("is error when map_graph fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      hives: { data: [{ id: "h1" }], error: null },
      rpc: { data: null, error: { message: "boom", code: "XX000" } },
    });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
    spy.mockRestore();
  });

  it("is error when the hive query fails, and does not call map_graph", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      hives: { data: null, error: { message: "nope", code: "42501" } },
    });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
    expect(t.rpc).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is error when map_graph returns nothing", async () => {
    const t = stub({
      hives: { data: [{ id: "h1" }], error: null },
      rpc: { data: null, error: null },
    });
    expect(await loadMap(t.db)).toEqual({ state: "error" });
  });
});
