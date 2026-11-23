import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  claimIn: vi.fn(),
}));
vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));
vi.mock("../claim", () => ({ claimIn: mocks.claimIn }));

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
  const db = { auth };
  mocks.createServerSupabase.mockResolvedValue(db);
  mocks.claimIn.mockImplementation(async () => {
    steps.push("claim");
    return 1;
  });
  return { db, auth, steps };
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
  it("claims invitations once the code has become a session, then redirects", async () => {
    const t = client();
    const res = await get("?code=abc&next=/vault");
    expect(t.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(t.steps).toEqual(["exchange", "claim"]);
    expect(mocks.claimIn).toHaveBeenCalledTimes(1);
    // With the client that now holds the session.
    expect(mocks.claimIn).toHaveBeenCalledWith(t.db);
    expect(to(res)).toBe(`${ORIGIN}/vault`);
  });

  it("claims after a token hash has been verified, then redirects", async () => {
    const t = client();
    const res = await get("?token_hash=h1&type=email");
    expect(t.auth.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      token_hash: "h1",
    });
    expect(t.steps).toEqual(["verify", "claim"]);
    expect(to(res)).toBe(`${ORIGIN}/`);
  });

  it("does not answer with the redirect until the claim has finished", async () => {
    const t = client();
    let finish: (n: number) => void = () => {};
    mocks.claimIn.mockImplementation(
      () => new Promise<number>((resolve) => (finish = resolve)),
    );
    let answered = false;
    const pending = get("?code=abc").then((res) => {
      answered = true;
      return res;
    });
    await vi.waitFor(() => expect(mocks.claimIn).toHaveBeenCalledTimes(1));
    expect(t.steps).toEqual(["exchange"]);
    expect(answered).toBe(false);
    finish(1);
    expect(to(await pending)).toBe(`${ORIGIN}/`);
  });

  it("redirects all the same when nothing was joined", async () => {
    client();
    mocks.claimIn.mockResolvedValue(0);
    expect(to(await get("?code=abc"))).toBe(`${ORIGIN}/`);
  });

  it("does not claim when the code is refused: there is no session", async () => {
    const t = client(new Error("expired"));
    const res = await get("?code=abc");
    expect(t.steps).toEqual(["exchange"]);
    expect(mocks.claimIn).not.toHaveBeenCalled();
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

  it("does not claim when the token hash is refused", async () => {
    const t = client(new Error("expired"));
    const res = await get("?token_hash=h1&type=email");
    expect(t.steps).toEqual(["verify"]);
    expect(mocks.claimIn).not.toHaveBeenCalled();
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it.each([
    ["neither a code nor a token", ""],
    ["a token hash without its type", "?token_hash=h1"],
  ])("does not claim with %s", async (_name, query) => {
    const t = client();
    const res = await get(query);
    expect(t.steps).toEqual([]);
    expect(mocks.claimIn).not.toHaveBeenCalled();
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it("does not claim when signing in throws", async () => {
    const t = client();
    t.auth.exchangeCodeForSession.mockRejectedValue(new Error("network"));
    const res = await get("?code=abc");
    expect(mocks.claimIn).not.toHaveBeenCalled();
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });

  it("does not claim, or make a client, when the app is not configured", async () => {
    client();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await get("?code=abc");
    expect(mocks.createServerSupabase).not.toHaveBeenCalled();
    expect(mocks.claimIn).not.toHaveBeenCalled();
    expect(to(res)).toBe(`${ORIGIN}/login?error=link`);
  });
});
