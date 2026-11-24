import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { initials, loadAccount } from "./account";

const jwt = (sub: string) =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
const UID = "11111111-1111-4111-8111-111111111111";
const H1 = "00000000-0000-4000-8000-000000000b01";
const H2 = "00000000-0000-4000-8000-000000000b02";
const ELSEWHERE = "00000000-0000-4000-8000-000000000b09";

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

/** The person's memberships as the database answers them: oldest first. */
const TWO = [
  {
    id: "m1",
    hive_id: H1,
    display_name: "Danijel",
    role: "owner",
    hive: { name: "Synapse" },
  },
  {
    id: "m2",
    hive_id: H2,
    display_name: "Dani J",
    role: "member",
    hive: { name: "Side" },
  },
];

afterEach(() => mocks.cookies.mockReset());

describe("initials", () => {
  it("does not split an astral first character", () => {
    expect(initials("𝓐lex 𝓑ob")).toBe("𝓐𝓑");
    expect(initials("𝓐𝓑c")).toBe("𝓐𝓑");
  });
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
    const d = db([TWO[0]]);
    expect(await loadAccount(d as never)).toEqual({
      name: "Danijel",
      role: "owner",
      hive: "Synapse",
      initials: "DA",
      hiveId: H1,
      hives: [{ id: H1, name: "Synapse", role: "owner", current: true }],
    });
    expect(d.from).toHaveBeenCalledTimes(1);
    expect(d.from).toHaveBeenCalledWith("members");
    expect(d.q.eq).toHaveBeenCalledWith("user_id", UID);
    expect(d.q.limit).toHaveBeenCalledWith(50);
  });

  it("lists every hive, oldest first, with the oldest current when none is chosen", async () => {
    const d = db(TWO);
    expect(await loadAccount(d as never, { chosen: null })).toEqual({
      name: "Danijel",
      role: "owner",
      hive: "Synapse",
      initials: "DA",
      hiveId: H1,
      hives: [
        { id: H1, name: "Synapse", role: "owner", current: true },
        { id: H2, name: "Side", role: "member", current: false },
      ],
    });
    expect(d.from).toHaveBeenCalledTimes(1);
  });

  it("is the person as they are in the chosen hive", async () => {
    expect(await loadAccount(db(TWO) as never, { chosen: H2 })).toEqual({
      name: "Dani J",
      role: "member",
      hive: "Side",
      initials: "DJ",
      hiveId: H2,
      hives: [
        { id: H1, name: "Synapse", role: "owner", current: false },
        { id: H2, name: "Side", role: "member", current: true },
      ],
    });
  });

  it("reads the choice from the hm_hive cookie", async () => {
    const get = vi.fn((name: string) =>
      name === "hm_hive" ? { name, value: H2 } : undefined,
    );
    mocks.cookies.mockResolvedValue({ get });
    const d = db(TWO);
    expect(await loadAccount(d as never)).toMatchObject({ hiveId: H2 });
    expect(d.from).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a hive the person is not in", ELSEWHERE],
    ["junk", "side"],
    ["nothing", null],
  ])("has exactly one current hive, the oldest, for %s", async (_n, chosen) => {
    const account = await loadAccount(db(TWO) as never, { chosen });
    expect(account?.hiveId).toBe(H1);
    expect(account?.hives.filter((h) => h.current)).toEqual([
      { id: H1, name: "Synapse", role: "owner", current: true },
    ]);
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
  it("is null when the hives cannot be read", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadAccount(db(null) as never)).toBeNull();
    spy.mockRestore();
  });
});
