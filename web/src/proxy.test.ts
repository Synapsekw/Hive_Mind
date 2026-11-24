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
const post = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers }));
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

describe("proxy: requests that change who is signed in", () => {
  // Regression: signed in as A, Continue on B's invitation link, and the browser stayed A.
  // The proxy refreshed A's session on the same request and its cookies landed after the
  // action's. It must be no writer of session cookies there at all.
  const COOKIE = { cookie: "sb-x-auth-token.0=a; sb-x-auth-token.1=b" };

  it("lets the Continue button's request through without reading or refreshing the session", async () => {
    const res = await post("/join?token_hash=abc&type=invite", COOKIE);
    expect(passed(res)).toBe(true);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(res.headers.has("x-middleware-set-cookie")).toBe(false);
  });

  it.each([
    ["GET", "/auth/confirm?code=abc"],
    ["GET", "/auth/confirm?token_hash=abc&type=email"],
    ["POST", "/auth/signout"],
    ["POST", "/auth/signout?next=%2Fjoin"],
  ])("does the same for %s %s", async (method, path) => {
    const res = await (method === "POST" ? post : visit)(path, COOKIE);
    expect(passed(res)).toBe(true);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(res.headers.has("set-cookie")).toBe(false);
  });

  it("still handles the session for every other request to the Join pages", async () => {
    session({ id: "u1" });
    // Opening the link (a GET) and pressing Join or saving a password (POSTs with no token).
    await visit("/join?token_hash=abc&type=invite");
    await post("/join");
    await post("/join/password");
    expect(mocks.createServerClient).toHaveBeenCalledTimes(3);
  });

  it("still closes the Join pages' other POSTs to a visitor with no session", async () => {
    expect(to(await post("/join"))).toBe(`${ORIGIN}/login?next=%2Fjoin`);
    expect(to(await post("/join/password?token_hash=abc"))).toBe(
      `${ORIGIN}/login`,
    );
    expect(to(await post("/vault?token_hash=abc"))).toBe(`${ORIGIN}/login`);
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

describe("proxy: the Join page", () => {
  it("lets a visitor with no session open an emailed link", async () => {
    expect(passed(await visit("/join?token_hash=abc&type=invite"))).toBe(true);
    expect(passed(await visit("/join/?token_hash=abc&type=magiclink"))).toBe(
      true,
    );
  });

  it("lets a visitor with no session read that a link has expired", async () => {
    expect(passed(await visit("/join?error=expired"))).toBe(true);
  });

  it.each([
    "/join",
    "/join?error=other",
    "/join?type=invite",
    "/join?x=1",
    "/join?switched=1",
  ])(
    "sends a visitor with no session and no link to sign in and back: %s",
    async (path) => {
      const res = await visit(path);
      expect(to(res)).toBe(`${ORIGIN}/login?next=%2Fjoin`);
      expect(new URL(to(res)!).searchParams.get("next")).toBe("/join");
    },
  );

  it("lets a signed-in person through, with a link or without", async () => {
    session({ id: "u1" });
    expect(passed(await visit("/join"))).toBe(true);
    expect(passed(await visit("/join?token_hash=abc&type=invite"))).toBe(true);
  });

  it("opens nothing beside the page itself", async () => {
    expect(to(await visit("/joinx?token_hash=abc"))).toBe(`${ORIGIN}/login`);
    expect(to(await visit("/join/more?token_hash=abc"))).toBe(
      `${ORIGIN}/login`,
    );
    expect(to(await visit("/vault?token_hash=abc"))).toBe(`${ORIGIN}/login`);
  });

  it("keeps the password page closed to a visitor with no session, whatever the query", async () => {
    for (const path of [
      "/join/password",
      "/join/password?token_hash=abc&type=invite",
      "/join/password?error=expired",
      "/join/password/",
    ])
      expect(to(await visit(path, { cookie: "hm_new=1" }))).toBe(
        `${ORIGIN}/login`,
      );
    session({ id: "u1" });
    expect(passed(await visit("/join/password"))).toBe(true);
  });

  it("is not open when the app is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(to(await visit("/join?token_hash=abc&type=invite"))).toBe(
      `${ORIGIN}/login`,
    );
  });

  it("returns a person who signs in to the Join page", async () => {
    session({ id: "u1" });
    expect(to(await visit("/login?next=%2Fjoin"))).toBe(`${ORIGIN}/join`);
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
