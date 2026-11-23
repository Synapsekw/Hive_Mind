import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("../../lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { continueWithLink, join } from "./actions";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";
const INVITATION = "00000000-0000-4000-8000-00000000d001";

function client(opts: { verifyError?: unknown; rpcError?: unknown } = {}) {
  const verifyOtp = vi.fn(async (_a: unknown) => ({
    error: opts.verifyError ?? null,
  }));
  const rpc = vi.fn(async (_n: string, _a?: unknown) => ({
    data: null,
    error: opts.rpcError ?? null,
  }));
  mocks.createServerSupabase.mockResolvedValue({ auth: { verifyOtp }, rpc });
  return { verifyOtp, rpc };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
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

  it("never puts the token in the address it goes to", async () => {
    client();
    await continueWithLink(form({ token_hash: TOKEN, type: "invite" })).catch(
      () => {},
    );
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain(TOKEN);
  });
});

describe("join", () => {
  it("accepts the invitation and answers ok", async () => {
    const t = client();
    expect(await join(INVITATION)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("accept_invitation", {
      p_invitation: INVITATION,
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("answers no when the database refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client({ rpcError: { message: "invitation not found", code: "P0001" } });
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
