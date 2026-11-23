import { describe, expect, it, vi } from "vitest";
import { initials, loadAccount } from "./account";

const jwt = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const UID = "11111111-1111-4111-8111-111111111111";

function db(rows: unknown, token: string | null = jwt(UID)) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  };
  return {
    from: vi.fn(() => q),
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: token ? { access_token: token } : null },
      })),
    },
    q,
  };
}

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("Danijel Jovanovic")).toBe("DJ");
  });
  it("takes two letters of a single word", () => {
    expect(initials("sara")).toBe("SA");
  });
  it("has a fallback", () => {
    expect(initials("  ")).toBe("?");
  });
});

describe("loadAccount", () => {
  it("reads the member's name, role and hive in one bounded query", async () => {
    const d = db([
      {
        id: "m1",
        hive_id: "h1",
        display_name: "Danijel",
        role: "owner",
        hive: { name: "Synapse" },
      },
    ]);
    expect(await loadAccount(d as never)).toEqual({
      name: "Danijel",
      role: "owner",
      hive: "Synapse",
      initials: "DA",
    });
    expect(d.from).toHaveBeenCalledWith("members");
    expect(d.q.limit).toHaveBeenCalledWith(1);
  });
  it("is null without a session, without logging", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadAccount(db([], null) as never)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("is null when the person is in no hive", async () => {
    expect(await loadAccount(db([]) as never)).toBeNull();
  });
});
