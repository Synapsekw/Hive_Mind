import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteWorkspaceIn } from "./write";

const W1 = "00000000-0000-4000-8000-000000000b01";

type Res = { data: unknown; error: { message: string; code?: string } | null };

/** A client whose one delete answers `res`. Every step of the query is recorded. */
function stub(
  res: Res | (() => never) = { data: [{ id: W1 }], error: null },
  user: { id: string } | null = { id: "u-me" },
) {
  const ops: [string, unknown[]][] = [];
  const from = vi.fn((table: string) => {
    ops.push(["from", [table]]);
    const chain: Record<string, unknown> = {};
    for (const m of ["delete", "eq", "select"])
      chain[m] = (...args: unknown[]) => {
        ops.push([m, args]);
        return chain;
      };
    chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
      new Promise<Res>((resolve) =>
        resolve(typeof res === "function" ? res() : res),
      ).then(ok, no);
    return chain;
  });
  const rpc = vi.fn();
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, rpc, auth } as never, ops, from, rpc, auth };
}

const FAILED = { ok: false, reason: "failed" };

afterEach(() => vi.restoreAllMocks());

describe("deleteWorkspaceIn", () => {
  it.each([
    ["a word", "not-a-uuid"],
    ["an empty string", ""],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an object", { id: W1 }],
    ["a uuid with a filter appended", `${W1},name.eq.Main`],
  ])("refuses an id that is %s with no call at all", async (_name, id) => {
    const t = stub();
    expect(await deleteWorkspaceIn(t.db, id)).toEqual(FAILED);
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses without a session, before any query", async () => {
    const t = stub(undefined, null);
    expect(await deleteWorkspaceIn(t.db, W1)).toEqual(FAILED);
    expect(t.from).not.toHaveBeenCalled();
  });

  it("deletes that one workspace by its id and nothing else", async () => {
    const t = stub();
    const out = await deleteWorkspaceIn(t.db, W1.toUpperCase());
    expect(out).toEqual({ ok: true });
    expect(t.ops).toEqual([
      ["from", ["workspaces"]],
      ["delete", []],
      ["eq", ["id", W1]],
      ["select", ["id"]],
    ]);
    expect(t.from).toHaveBeenCalledTimes(1);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["you need at least one workspace", "last"],
    ["this workspace still has an agent in use", "agents"],
    ["this workspace still holds files", "files"],
    ["this hive is being deleted", "failed"],
    ["something else", "failed"],
  ])("tells the refusal %s apart as %s", async (message, reason) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ data: null, error: { message, code: "P0001" } });
    expect(await deleteWorkspaceIn(t.db, W1)).toEqual({ ok: false, reason });
    expect(error).toHaveBeenCalledWith(
      "workspace delete failed",
      "P0001",
      message,
    );
  });

  it.each([
    ["no row, as for somebody else's workspace", []],
    [
      "another workspace's row",
      [{ id: "00000000-0000-4000-8000-000000000b02" }],
    ],
    ["an answer that is not a list", { id: W1 }],
    ["nothing", null],
  ])("answers a failure for %s", async (_name, data) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ data, error: null });
    expect(await deleteWorkspaceIn(t.db, W1)).toEqual(FAILED);
    expect(error).toHaveBeenCalledWith("workspace delete removed no row");
  });
});
