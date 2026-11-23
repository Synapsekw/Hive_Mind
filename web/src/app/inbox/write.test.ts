import { afterEach, describe, expect, it, vi } from "vitest";
import { respondIn } from "./write";

const LINK = "00000000-0000-4000-8000-000000020001";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };

const ok = (data: unknown): Res => ({ data, error: null });

function stub(opts: { rpc?: Res; user?: { id: string } | null } = {}) {
  const from = vi.fn();
  const rpc = vi.fn(
    async (_name: string, _args: unknown) => opts.rpc ?? ok("proposed"),
  );
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, rpc, auth } as never, from, rpc, auth };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("respondIn", () => {
  it.each([
    ["a word", "not-a-uuid"],
    ["an empty string", ""],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an object", { id: LINK }],
    ["a uuid with a filter appended", `${LINK},status.eq.accepted`],
  ])("refuses an id that is %s with no call at all", async (_name, id) => {
    const t = stub();
    expect(await respondIn(t.db, id, true)).toEqual({ ok: false });
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", "true"],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
  ])("refuses an accept that is %s with no call at all", async (_n, accept) => {
    const t = stub();
    expect(await respondIn(t.db, LINK, accept)).toEqual({ ok: false });
    expect(t.auth.getUser).not.toHaveBeenCalled();
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses without a session, before the function is called", async () => {
    const t = stub({ user: null });
    expect(await respondIn(t.db, LINK, true)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("accepts through respond_to_link and nothing else", async () => {
    const t = stub({ rpc: ok("accepted") });
    expect(await respondIn(t.db, LINK, true)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("respond_to_link", {
      p_link: LINK,
      p_accept: true,
    });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("declines with p_accept false", async () => {
    const t = stub({ rpc: ok("declined") });
    expect(await respondIn(t.db, LINK, false)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("respond_to_link", {
      p_link: LINK,
      p_accept: false,
    });
  });

  it("answers only ok, never what the function returned", async () => {
    const t = stub({ rpc: ok("accepted") });
    expect(Object.keys(await respondIn(t.db, LINK, true))).toEqual(["ok"]);
  });

  it("answers not ok when the database refuses, logging code and message only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      rpc: {
        data: null,
        error: {
          message: "link not found",
          code: "P0001",
          details: "secret payload",
        },
      },
    });
    expect(await respondIn(t.db, LINK, true)).toEqual({ ok: false });
    expect(log).toHaveBeenCalledWith(
      "respond_to_link failed",
      "P0001",
      "link not found",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret payload");
  });
});
