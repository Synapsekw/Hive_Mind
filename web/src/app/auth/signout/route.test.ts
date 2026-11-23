import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerSupabase: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

import * as route from "./route";

const ORIGIN = "http://localhost:3000";

function client() {
  const signOut = vi.fn(async (_o: unknown) => ({ error: null }));
  mocks.createServerSupabase.mockResolvedValue({ auth: { signOut } });
  return { signOut };
}

const post = (query = "") =>
  route.POST(
    new NextRequest(`${ORIGIN}/auth/signout${query}`, { method: "POST" }),
  );
const to = (res: Response) => res.headers.get("location");

afterEach(() => vi.resetAllMocks());

describe("POST /auth/signout", () => {
  it("signs this browser out and goes to sign-in", async () => {
    const t = client();
    const res = await post();
    expect(t.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.status).toBe(303);
    expect(to(res)).toBe(`${ORIGIN}/login`);
  });

  it("carries a same-site next, so sign-in returns to the Join page", async () => {
    client();
    expect(to(await post("?next=%2Fjoin"))).toBe(
      `${ORIGIN}/login?next=%2Fjoin`,
    );
  });

  it.each([
    "https%3A%2F%2Fevil.example",
    "%2F%2Fevil.example",
    "%2F%5Cevil",
    "javascript%3Aalert(1)",
    "",
  ])("drops a next that is not a path on this site: %s", async (next) => {
    client();
    expect(to(await post(`?next=${next}`))).toBe(`${ORIGIN}/login`);
  });

  it("still goes to sign-in when signing out fails or the app is not configured", async () => {
    mocks.createServerSupabase.mockRejectedValue(new Error("not configured"));
    expect(to(await post("?next=%2Fjoin"))).toBe(
      `${ORIGIN}/login?next=%2Fjoin`,
    );
  });

  it("answers nothing but POST, so a link or an image cannot sign a person out", () => {
    expect(Object.keys(route)).toEqual(["POST"]);
  });
});
