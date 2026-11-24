import { afterEach, describe, expect, it, vi } from "vitest";
import { afterNoHive } from "./no-hive";

type Res = { data: unknown; error: { message: string; code?: string } | null };

const ROW = {
  id: "00000000-0000-4000-8000-00000000d001",
  hive_name: "Synapse",
  invited_by: "Danijel",
  expires_at: "2026-12-07T10:00:00+00:00",
};

function stub(answer: Res) {
  const rpc = vi.fn(async (_name: string, _args?: unknown) => answer);
  return { db: { rpc } as never, rpc };
}

afterEach(() => vi.restoreAllMocks());

describe("afterNoHive: a signed-in person who is in no hive", () => {
  it("goes to /join when an invitation is waiting, after one call that joins nothing", async () => {
    const t = stub({ data: [ROW], error: null });
    expect(await afterNoHive(t.db)).toBe("/join");
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("my_invitations");
  });

  it("stays when nothing is waiting", async () => {
    expect(await afterNoHive(stub({ data: [], error: null }).db)).toBeNull();
  });

  it.each([
    ["the database refuses", { data: null, error: { message: "x" } }],
    ["the answer is malformed", { data: [{ id: 1 }], error: null }],
    ["the answer is not a list", { data: 2, error: null }],
  ])("stays when %s", async (_n, answer) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await afterNoHive(stub(answer).db)).toBeNull();
  });

  it("stays when the client throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await afterNoHive({} as never)).toBeNull();
  });
});
