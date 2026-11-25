import { describe, expect, it, vi } from "vitest";

// Within a render React's `cache` keeps one answer per arguments; a stand-in does so here.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <R>(fn: () => R) => {
      let kept: { out: R } | null = null;
      return (): R => (kept ??= { out: fn() }).out;
    },
  };
});
const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(() => ({})) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { createServerSupabase } from "./server";

describe("createServerSupabase", () => {
  it("is one client for the layout and the page of a render", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    const a = await createServerSupabase();
    const b = await createServerSupabase();
    expect(a).toBe(b);
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });
});
