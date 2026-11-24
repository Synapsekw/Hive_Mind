import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  cookies: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("../../lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { continueWithLink, join, setPassword, skipPassword } from "./actions";

type Cookie = { name: string; value: string; maxAge: number; path: string };
const HIVE = "00000000-0000-4000-8000-000000000a01";

/** The browser's cookies as the actions see them; `sets` is what they sent back. */
function jar(has: Record<string, string> = {}) {
  const sets: Cookie[] = [];
  const store = {
    get: vi.fn((name: string) =>
      name in has ? { name, value: has[name]! } : undefined,
    ),
    set: vi.fn((c: Cookie) => {
      sets.push(c);
    }),
  };
  mocks.cookies.mockResolvedValue(store);
  return { store, sets };
}

const NEW = { hm_new: "1" };
const PASSWORD = "correct horse battery";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";
const INVITATION = "00000000-0000-4000-8000-00000000d001";

function client(
  opts: { verifyError?: unknown; rpcError?: unknown; rpcData?: unknown } = {},
) {
  let now: string | null = null;
  const verifyOtp = vi.fn(async (_a: unknown) => {
    if (opts.verifyError)
      return { data: { user: null }, error: opts.verifyError };
    now = "00000000-0000-4000-8000-0000000000b2";
    return { data: { user: { id: now } }, error: null };
  });
  const getUser = vi.fn(async () => ({
    data: { user: now ? { id: now } : null },
    error: null,
  }));
  const signOut = vi.fn(async (_o?: unknown) => ({ error: null }));
  const rpc = vi.fn(async (_n: string, _a?: unknown) => ({
    data: opts.rpcError ? null : (opts.rpcData ?? null),
    error: opts.rpcError ?? null,
  }));
  mocks.createServerSupabase.mockResolvedValue({
    auth: { verifyOtp, getUser, signOut },
    rpc,
  });
  return { verifyOtp, getUser, signOut, rpc };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  jar();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("continueWithLink", () => {
  it("spends the link, then goes to /join with no token in the address", async () => {
    const t = client();
    await expect(
      continueWithLink(form({ token_hash: TOKEN, type: "invite" })),
    ).rejects.toThrow("REDIRECT /join");
    expect(t.verifyOtp).toHaveBeenCalledWith({
      type: "invite",
      token_hash: TOKEN,
    });
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/join");
  });

  it("goes to the expired line when the auth server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({ verifyError: { message: "expired", code: "otp_expired" } });
    await expect(
      continueWithLink(form({ token_hash: TOKEN, type: "magiclink" })),
    ).rejects.toThrow("REDIRECT /join?error=expired");
  });

  it.each([
    ["no fields", {}],
    ["another type", { token_hash: TOKEN, type: "recovery" }],
    ["a malformed token", { token_hash: "x", type: "invite" }],
  ])(
    "goes to the expired line for %s, spending nothing",
    async (_n, fields) => {
      const t = client();
      await expect(continueWithLink(form(fields))).rejects.toThrow(
        "REDIRECT /join?error=expired",
      );
      expect(t.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("goes to the expired line when the app is not configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createServerSupabase.mockRejectedValue(new Error("not configured"));
    await expect(
      continueWithLink(form({ token_hash: TOKEN, type: "invite" })),
    ).rejects.toThrow("REDIRECT /join?error=expired");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("goes to /join?switched=1 when the link replaced another person's session", async () => {
    let now = "00000000-0000-4000-8000-0000000000a1";
    const getUser = vi.fn(async () => ({
      data: { user: { id: now } },
      error: null,
    }));
    const verifyOtp = vi.fn(async (_a: unknown) => {
      now = "00000000-0000-4000-8000-0000000000b2";
      return { data: { user: { id: now } }, error: null };
    });
    mocks.createServerSupabase.mockResolvedValue({
      auth: { getUser, verifyOtp },
    });
    await expect(
      continueWithLink(form({ token_hash: TOKEN, type: "invite" })),
    ).rejects.toThrow("REDIRECT /join?switched=1");
    expect(mocks.redirect).toHaveBeenCalledWith("/join?switched=1");
  });

  it("goes to the expired line, signed out and with no cookie, when the link did not sign its own person in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const A = "00000000-0000-4000-8000-0000000000a1";
    const getUser = vi.fn(async () => ({
      data: { user: { id: A } },
      error: null,
    }));
    const verifyOtp = vi.fn(async (_a: unknown) => ({
      data: { user: { id: "00000000-0000-4000-8000-0000000000b2" } },
      error: null,
    }));
    const signOut = vi.fn(async (_o?: unknown) => ({ error: null }));
    mocks.createServerSupabase.mockResolvedValue({
      auth: { getUser, verifyOtp, signOut },
    });
    const c = jar();
    await expect(
      continueWithLink(form({ token_hash: TOKEN, type: "invite" })),
    ).rejects.toThrow("REDIRECT /join?error=expired");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(c.sets).toEqual([]);
  });

  it("marks a new person after a first invitation link: one hour, Join pages only, no script can read it", async () => {
    client();
    const c = jar();
    await continueWithLink(form({ token_hash: TOKEN, type: "invite" })).catch(
      () => {},
    );
    expect(c.sets).toEqual([
      {
        name: "hm_new",
        value: "1",
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/join",
        maxAge: 3600,
      },
    ]);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    client();
    const c = jar();
    await continueWithLink(form({ token_hash: TOKEN, type: "invite" })).catch(
      () => {},
    );
    expect(c.sets[0]).toMatchObject({ value: "1", secure: true });
  });

  it("takes the mark away after a sign-in link for an existing account", async () => {
    client();
    const c = jar(NEW);
    await continueWithLink(
      form({ token_hash: TOKEN, type: "magiclink" }),
    ).catch(() => {});
    expect(c.sets).toHaveLength(1);
    expect(c.sets[0]).toMatchObject({
      name: "hm_new",
      value: "",
      maxAge: 0,
      path: "/join",
    });
  });

  it.each([
    ["a refused link", { token_hash: TOKEN, type: "invite" }, true],
    ["a malformed link", { token_hash: "x", type: "invite" }, false],
    ["another type", { token_hash: TOKEN, type: "recovery" }, false],
  ])("sets no cookie for %s", async (_n, fields, refuse) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client(refuse ? { verifyError: { message: "expired" } } : {});
    const c = jar();
    await continueWithLink(form(fields)).catch(() => {});
    expect(c.sets).toEqual([]);
  });

  it("still ends on /join when the cookie cannot be set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client();
    mocks.cookies.mockRejectedValue(new Error("no cookies here"));
    await expect(
      continueWithLink(form({ token_hash: TOKEN, type: "invite" })),
    ).rejects.toThrow("REDIRECT /join");
    expect(mocks.redirect).toHaveBeenCalledWith("/join");
  });

  it("never puts the token in the address it goes to", async () => {
    client();
    await continueWithLink(form({ token_hash: TOKEN, type: "invite" })).catch(
      () => {},
    );
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain(TOKEN);
  });
});

describe("join", () => {
  it("accepts the invitation and answers ok, on to the map", async () => {
    const t = client();
    expect(await join(INVITATION)).toEqual({ ok: true, next: "/" });
    expect(t.rpc).toHaveBeenCalledWith("accept_invitation", {
      p_invitation: INVITATION,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("makes the joined hive the chosen one: the id the database answered, a year, every page", async () => {
    client({ rpcData: HIVE });
    const c = jar();
    expect(await join(INVITATION)).toEqual({ ok: true, next: "/" });
    expect(c.sets).toEqual([
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

  it("marks that cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    client({ rpcData: HIVE });
    const c = jar();
    await join(INVITATION);
    expect(c.sets[0]).toMatchObject({ name: "hm_hive", secure: true });
  });

  it("chooses the joined hive for a new person too, and still leads on to the password page", async () => {
    client({ rpcData: HIVE });
    const c = jar(NEW);
    expect(await join(INVITATION)).toEqual({
      ok: true,
      next: "/join/password",
    });
    expect(c.sets).toHaveLength(1);
    expect(c.sets[0]).toMatchObject({ name: "hm_hive", value: HIVE });
  });

  it.each([
    ["nothing", null],
    ["a word", "joined"],
    ["an address", "/evil"],
  ])(
    "has joined but sets no cookie when the database answers %s",
    async (_n, rpcData) => {
      client({ rpcData });
      const c = jar();
      expect(await join(INVITATION)).toEqual({ ok: true, next: "/" });
      expect(c.sets).toEqual([]);
    },
  );

  it("has still joined when the cookie cannot be set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({ rpcData: HIVE });
    const c = jar();
    c.store.set.mockImplementation(() => {
      throw new Error("cookies are read-only here");
    });
    expect(await join(INVITATION)).toEqual({ ok: true, next: "/" });
  });

  it("sets no cookie when the database refuses or the id is not one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({ rpcError: { message: "invitation not found", code: "P0001" } });
    const c = jar();
    expect(await join(INVITATION)).toEqual({ ok: false });
    client({ rpcData: HIVE });
    expect(await join("x")).toEqual({ ok: false });
    expect(c.sets).toEqual([]);
  });

  it("sends a new person on to the password page, decided from the cookie on the server", async () => {
    client();
    jar(NEW);
    expect(await join(INVITATION)).toEqual({
      ok: true,
      next: "/join/password",
    });
  });

  it("goes to the map for a cookie with any other value", async () => {
    client();
    jar({ hm_new: "/evil" });
    expect(await join(INVITATION)).toEqual({ ok: true, next: "/" });
  });

  it("answers no when the database refuses, new person or not", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({ rpcError: { message: "invitation not found", code: "P0001" } });
    expect(await join(INVITATION)).toEqual({ ok: false });
    jar(NEW);
    expect(await join(INVITATION)).toEqual({ ok: false });
  });

  it("answers no for an id that is not one, asking nothing", async () => {
    const t = client();
    expect(await join("x")).toEqual({ ok: false });
    expect(await join({ id: INVITATION } as never)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("answers no when the app is not configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createServerSupabase.mockRejectedValue(new Error("not configured"));
    expect(await join(INVITATION)).toEqual({ ok: false });
  });
});

describe("setPassword", () => {
  function auth(opts: { user?: unknown; updateError?: unknown } = {}) {
    const getUser = vi.fn(async () => ({
      data: { user: opts.user === undefined ? { id: "u1" } : opts.user },
      error: null,
    }));
    const updateUser = vi.fn(async (_a: unknown) => ({
      data: {},
      error: opts.updateError ?? null,
    }));
    mocks.createServerSupabase.mockResolvedValue({
      auth: { getUser, updateUser },
    });
    return { getUser, updateUser };
  }
  const typed = (password = PASSWORD, repeat = password) =>
    form({ password, repeat });

  it("sets the password with the person's own session, then takes the cookie away", async () => {
    const t = auth();
    const c = jar(NEW);
    expect(await setPassword(typed())).toEqual({ ok: true });
    expect(t.updateUser).toHaveBeenCalledWith({ password: PASSWORD });
    expect(c.sets).toHaveLength(1);
    expect(c.sets[0]).toMatchObject({
      name: "hm_new",
      value: "",
      maxAge: 0,
      path: "/join",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does nothing without the cookie: no client, no change", async () => {
    const t = auth();
    jar();
    expect(await setPassword(typed())).toEqual({ ok: false, reason: "failed" });
    jar({ hm_new: "0" });
    expect(await setPassword(typed())).toEqual({ ok: false, reason: "failed" });
    expect(mocks.createServerSupabase).not.toHaveBeenCalled();
    expect(t.updateUser).not.toHaveBeenCalled();
  });

  it("does nothing for a visitor with no session, and keeps the cookie", async () => {
    const t = auth({ user: null });
    const c = jar(NEW);
    expect(await setPassword(typed())).toEqual({ ok: false, reason: "failed" });
    expect(t.updateUser).not.toHaveBeenCalled();
    expect(c.sets).toEqual([]);
  });

  it.each([
    ["short", typed("abc")],
    ["long", typed("a".repeat(73))],
    ["different", typed(PASSWORD, "something else")],
    ["short", form({})],
  ])(
    "answers %s, changing nothing and keeping the cookie",
    async (reason, fd) => {
      const t = auth();
      const c = jar(NEW);
      expect(await setPassword(fd)).toEqual({ ok: false, reason });
      expect(t.getUser).not.toHaveBeenCalled();
      expect(t.updateUser).not.toHaveBeenCalled();
      expect(c.sets).toEqual([]);
    },
  );

  it("answers refused, keeps the cookie, and says nothing of the password or the auth server's words", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    auth({
      updateError: {
        message: `${PASSWORD} has appeared in a data leak`,
        code: "weak_password",
        status: 422,
      },
    });
    const c = jar(NEW);
    const answer = await setPassword(typed());
    expect(answer).toEqual({ ok: false, reason: "refused" });
    expect(c.sets).toEqual([]);
    expect(JSON.stringify(answer)).not.toContain(PASSWORD);
    const said = JSON.stringify(log.mock.calls);
    expect(said).not.toContain(PASSWORD);
    expect(said).not.toContain("data leak");
  });

  it("fails without a word of the form when the app is not configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    jar(NEW);
    mocks.createServerSupabase.mockRejectedValue(
      new Error(`not configured ${PASSWORD}`),
    );
    expect(await setPassword(typed())).toEqual({ ok: false, reason: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD);
  });
});

describe("skipPassword", () => {
  it("takes the cookie away and touches nothing else", async () => {
    const c = jar(NEW);
    await skipPassword();
    expect(c.sets).toHaveLength(1);
    expect(c.sets[0]).toMatchObject({ name: "hm_new", value: "", maxAge: 0 });
    expect(mocks.createServerSupabase).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not throw when the cookies cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.cookies.mockRejectedValue(new Error("no cookies here"));
    await expect(skipPassword()).resolves.toBeUndefined();
  });
});
