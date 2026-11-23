// A regression test for the report "signed in as A, pressed Continue on B's invitation link,
// and the next page still showed A". It runs `continueIn` through the real @supabase/ssr server
// client, over a stand-in cookie jar that starts with A's session in several cookie pieces and
// a stand-in auth server, and checks what the browser is left holding.
//
// What this covers: the client and `continueIn` together leave only B's session, with no piece
// of A's left over. What it cannot cover is the order in which a host puts the proxy's and the
// action's Set-Cookie headers on one response; `proxy.test.ts` pins that the proxy writes no
// session cookie on that request at all.
import { createServerClient } from "@supabase/ssr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { continueIn } from "./join";

const URL_ = "http://localhost:54321";
const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

const part = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);

/** A session as the auth server answers it; `pad` makes it span more or fewer cookies. */
function session(id: string, pad: number) {
  return {
    access_token: `${part({ alg: "HS256" })}.${part({ sub: id, exp: now() + 3600 })}.sig`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now() + 3600,
    refresh_token: `refresh-${id}`,
    user: { id, email: `${id}@example.com`, pad: "x".repeat(pad) },
  };
}

function world(opts: { padA: number; padB: number; refuse?: boolean }) {
  const a = session(A, opts.padA);
  const b = session(B, opts.padB);
  /** The browser's cookies. A cookie set with no life left is removed, as a browser does. */
  const jar = new Map<string, string>();
  const calls: string[] = [];
  const cookies = {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (
      list: { name: string; value: string; options: { maxAge?: number } }[],
    ) => {
      for (const { name, value, options } of list) {
        if (options.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const bearer = new Headers(init?.headers).get("authorization") ?? "";
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/user")) {
      if (bearer.endsWith(a.access_token)) return json(a.user);
      if (bearer.endsWith(b.access_token)) return json(b.user);
      return json({ code: 401, msg: "bad jwt" }, 401);
    }
    if (path.endsWith("/verify"))
      return opts.refuse
        ? json({ code: 403, error_code: "otp_expired", msg: "expired" }, 403)
        : json(b);
    if (path.endsWith("/logout")) return new Response(null, { status: 204 });
    return json({ msg: "unexpected" }, 500);
  };
  /** A fresh client over the same jar: one per request, as on the server. */
  const client = () =>
    createServerClient(URL_, "anon", {
      cookies,
      global: { fetch: fetchStub as typeof fetch },
    });
  const signedInAs = async () =>
    (await client().auth.getUser()).data.user?.id ?? null;
  return { a, b, jar, calls, client, signedInAs };
}

/** Puts A's session in the jar the way the library itself writes it. */
async function signInA(w: ReturnType<typeof world>) {
  await w.client().auth.setSession({
    access_token: w.a.access_token,
    refresh_token: w.a.refresh_token,
  });
  w.calls.length = 0;
}

afterEach(() => vi.restoreAllMocks());

describe("Continue on B's link in a browser signed in as A", () => {
  it.each([
    ["A in three cookies, B in two", { padA: 6000, padB: 2500 }, 3],
    ["A in two cookies, B in one", { padA: 2500, padB: 10 }, 2],
    ["A in one cookie, B in two", { padA: 10, padB: 2500 }, 1],
    ["both in two cookies", { padA: 2500, padB: 2500 }, 2],
  ])(
    "leaves the browser holding only B's session: %s",
    async (_n, pads, piecesOfA) => {
      const w = world(pads);
      await signInA(w);
      expect(w.jar.size).toBe(piecesOfA);
      expect(await w.signedInAs()).toBe(A);
      const before = new Map(w.jar);
      w.calls.length = 0;

      expect(await continueIn(w.client(), TOKEN, "invite")).toBe("switched");

      // The next request, with a new client over the same cookies, is B.
      expect(await w.signedInAs()).toBe(B);
      // No piece of A's session is left: every cookie is new, and together they are B's.
      for (const [name, value] of w.jar)
        expect(before.get(name)).not.toBe(value);
      const stored = [...w.jar.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([, v]) => v)
        .join("");
      const decoded = Buffer.from(
        stored.replace(/^base64-/, ""),
        "base64url",
      ).toString("utf8");
      expect(decoded).toContain(w.b.refresh_token);
      expect(decoded).not.toContain(w.a.refresh_token);
      expect(decoded).not.toContain(w.a.access_token);
      // A's session in this browser was ended at the auth server before the link was spent.
      expect(w.calls.slice(0, 3)).toEqual([
        "GET /auth/v1/user",
        "POST /auth/v1/logout",
        "POST /auth/v1/verify",
      ]);
    },
  );

  it("is plain ok, and B's, in a browser that held no session", async () => {
    const w = world({ padA: 2500, padB: 2500 });
    expect(await continueIn(w.client(), TOKEN, "invite")).toBe("ok");
    expect(await w.signedInAs()).toBe(B);
    expect(w.calls).not.toContain("POST /auth/v1/logout");
  });

  it("leaves nobody signed in when the link has expired: never A under a button that said sign out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = world({ padA: 6000, padB: 2500, refuse: true });
    await signInA(w);
    expect(await continueIn(w.client(), TOKEN, "invite")).toBe("expired");
    expect(w.jar.size).toBe(0);
    expect(await w.signedInAs()).toBeNull();
  });
});
