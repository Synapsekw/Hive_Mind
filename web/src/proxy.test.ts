import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";

/** The auth server answers `user` for whoever asks. */
function session(user: { id: string } | null) {
  mocks.createServerClient.mockReturnValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  });
}

const visit = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`${ORIGIN}${path}`, { headers }));
const to = (res: Response) => res.headers.get("location");
/** True when the answer lets the request through. */
const passed = (res: Response) =>
  res.headers.get("x-middleware-next") === "1" && to(res) === null;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  session(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("proxy: the connector's addresses", () => {
  it.each([
    "/mcp",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])("%s passes with no session and no look at the cookies", async (path) => {
    const res = await visit(path, { cookie: "sb-access-token=x" });
    expect(passed(res)).toBe(true);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(res.headers.has("set-cookie")).toBe(false);
  });

  it("passes them when the app is not configured, too", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(passed(await visit("/mcp"))).toBe(true);
  });

  it("does not open a path that only begins the same way", async () => {
    expect(to(await visit("/mcpx"))).toBe(`${ORIGIN}/login`);
    expect(to(await visit("/.well-knownx"))).toBe(`${ORIGIN}/login`);
  });
});

describe("proxy: the approval window", () => {
  it("sends a visitor with no session to sign in, and back to the same address", async () => {
    const res = await visit("/oauth/consent?authorization_id=x");
    expect(to(res)).toBe(
      `${ORIGIN}/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx`,
    );
  });

  it("keeps every part of the query", async () => {
    const res = await visit("/oauth/consent?authorization_id=a%26b&x=1");
    const next = new URL(to(res)!).searchParams.get("next");
    expect(next).toBe("/oauth/consent?authorization_id=a%26b&x=1");
  });

  it("lets a signed-in person through", async () => {
    session({ id: "u1" });
    expect(passed(await visit("/oauth/consent?authorization_id=x"))).toBe(true);
  });

  it("is not open when the app is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(to(await visit("/oauth/consent?authorization_id=x"))).toBe(
      `${ORIGIN}/login`,
    );
  });
});

describe("proxy: everything else is as before", () => {
  it("sends other pages to a plain sign-in", async () => {
    expect(to(await visit("/vault?x=1"))).toBe(`${ORIGIN}/login`);
  });

  it("lets the sign-in page render for a visitor", async () => {
    expect(passed(await visit("/login?next=%2Fvault"))).toBe(true);
  });

  it("sends a signed-in person away from the sign-in page: home, or to a same-site next", async () => {
    session({ id: "u1" });
    expect(to(await visit("/login"))).toBe(`${ORIGIN}/`);
    expect(
      to(await visit("/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx")),
    ).toBe(`${ORIGIN}/oauth/consent?authorization_id=x`);
    expect(to(await visit("/login?next=https%3A%2F%2Fevil.example"))).toBe(
      `${ORIGIN}/`,
    );
    expect(to(await visit("/login?next=%2F%2Fevil.example"))).toBe(
      `${ORIGIN}/`,
    );
  });
});
