import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerSupabase: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

import { GET } from "./route";

const ORIGIN = "http://localhost:3000";

/** A stand-in client whose two ways of signing in answer `error`; `steps` holds the order. */
function client(error: unknown = null) {
  const steps: string[] = [];
  const auth = {
    exchangeCodeForSession: vi.fn(async (_code: string) => {
      steps.push("exchange");
      return { error };
    }),
    verifyOtp: vi.fn(async (_args: unknown) => {
      steps.push("verify");
      return { error };
    }),
  };
  // Signing in joins no hive: any call to the database from this route is a mistake.
  const rpc = vi.fn();
  const from = vi.fn();
  const db = { auth, rpc, from };
  mocks.createServerSupabase.mockResolvedValue(db);
  return { db, auth, rpc, from, steps };
}

const get = (query: string) =>
  GET(new NextRequest(`${ORIGIN}/auth/confirm${query}`));
const to = (res: Response) => res.headers.get("location");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("GET /auth/confirm", () => {
  it("turns the code into a session, then redirects", async () => {
    const t = client();
    const res = await get("?code=abc&next=/vault");
    expect(t.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(t.steps).toEqual(["exchange"]);
    expect(to(res)).toBe(`${ORIGIN}/vault`);
  });

  it("verifies a token hash, then redirects", async () => {
    const t = client();
    const res = await get("?token_hash=h1&type=email");
    expect(t.auth.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "h1",
    });
    expect(t.steps).toEqual(["verify"]);
    expect(to(res)).toBe(`${ORIGIN}/`);
  });

  it("joins no hive and asks the database nothing: joining is the person's own press on /join", async () => {
    const t = client();
    await get("?code=abc");
    await get("?token_hash=h1&type=email");
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("returns to the Join page after a link asked for from there", async () => {
    client();
    expect(to(await get("?code=abc&next=%2Fjoin"))).toBe(`${ORIGIN}/join`);
  });

  it("goes back to sign-in when the code is refused", async () => {
    const t = client(new Error("expired"));
    const res = await get("?code=abc");
    expect(t.steps).toEqual(["exchange"]);
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it("keeps a same-site next on the way back to sign-in, so a new link returns there", async () => {
    client(new Error("expired"));
    const res = await get(
      "?code=abc&next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx",
    );
    expect(to(res)).toBe(
      `${ORIGIN}/login?error=link&next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx`,
    );
    const outside = await get("?code=abc&next=https%3A%2F%2Fevil.example");
    expect(to(outside)).toBe(`${ORIGIN}/login?error=link`);
  });

  it("returns to the approval window after an emailed link", async () => {
    client();
    const res = await get(
      "?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx&code=abc",
    );
    expect(to(res)).toBe(`${ORIGIN}/oauth/consent?authorization_id=x`);
  });

  it("goes back to sign-in when the token hash is refused", async () => {
    const t = client(new Error("expired"));
    const res = await get("?token_hash=h1&type=email");
    expect(t.steps).toEqual(["verify"]);
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it.each([
    ["neither a code nor a token", ""],
    ["a token hash without its type", "?token_hash=h1"],
  ])("signs nobody in with %s", async (_name, query) => {
    const t = client();
    const res = await get(query);
    expect(t.steps).toEqual([]);
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it("goes back to sign-in when signing in throws", async () => {
    const t = client();
    t.auth.exchangeCodeForSession.mockRejectedValue(new Error("network"));
    const res = await get("?code=abc");
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it("makes no client when the app is not configured", async () => {
    client();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await get("?code=abc");
    expect(mocks.createServerSupabase).not.toHaveBeenCalled();
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });
});
