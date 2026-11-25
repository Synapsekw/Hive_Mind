// The membership read is shared within one server render. Outside a render (these tests, and
// server actions) React's `cache` calls straight through, so a stand-in that keeps answers by
// argument identity, as React does within a render, takes its place here.
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const kept: { args: A; out: R }[] = [];
      return (...args: A): R => {
        const hit = kept.find(
          (k) =>
            k.args.length === args.length &&
            k.args.every((a, i) => Object.is(a, args[i])),
        );
        if (hit) return hit.out;
        const out = fn(...args);
        kept.push({ args, out });
        return out;
      };
    },
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { myHives, ownHive } from "./own-hive";

const ME = "00000000-0000-4000-8000-0000000000a1";
const HIVE = "00000000-0000-4000-8000-000000000b01";
const token = `h.${Buffer.from(JSON.stringify({ sub: ME })).toString("base64url")}.s`;
const ROW = {
  id: "00000000-0000-4000-8000-00000000c001",
  hive_id: HIVE,
  display_name: "Danijel",
  role: "owner",
  hive: { name: "Synapse", delete_after: null },
};

function client() {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
    chain.then = (ok: (r: unknown) => unknown) =>
      Promise.resolve({ data: [ROW], error: null }).then(ok);
    return chain;
  });
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: token } },
      error: null,
    })),
    getUser: vi.fn(),
  };
  return { db: { from, auth } as never, from };
}

describe("one membership read per client in a render", () => {
  it("answers the rail, the page's hive and the inbox count from one read", async () => {
    const t = client();
    const [hives, own, profile] = await Promise.all([
      myHives(t.db, ME),
      ownHive(t.db),
      ownHive(t.db, undefined, { profile: true }),
    ]);
    expect(t.from).toHaveBeenCalledTimes(1);
    expect(hives).not.toBe("error");
    expect(own).toMatchObject({ id: HIVE, name: "Synapse" });
    expect(profile).toMatchObject({ id: HIVE, displayName: "Danijel" });
  });

  it("does not share an answer between two clients", async () => {
    const a = client();
    const b = client();
    await ownHive(a.db);
    await ownHive(b.db);
    expect(a.from).toHaveBeenCalledTimes(1);
    expect(b.from).toHaveBeenCalledTimes(1);
  });
});
