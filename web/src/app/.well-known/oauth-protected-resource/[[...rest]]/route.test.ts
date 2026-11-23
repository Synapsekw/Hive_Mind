import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const SITE = "https://hive.example";
const BASE = `${SITE}/.well-known/oauth-protected-resource`;

const get = (
  rest: string[] | undefined,
  headers: Record<string, string> = {},
  url = rest ? `${BASE}/${rest.join("/")}` : BASE,
) =>
  GET(new NextRequest(url, { headers }), { params: Promise.resolve({ rest }) });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /.well-known/oauth-protected-resource", () => {
  it.each([
    ["the bare path", undefined],
    ["the path for /mcp", ["mcp"]],
  ])("answers the metadata on %s", async (_name, rest) => {
    const res = await get(rest);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      resource: `${SITE}/mcp`,
      authorization_servers: ["https://project.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
    });
  });

  it("does not double a slash the configured address ends with", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co/");
    const body = await (await get(undefined)).json();
    expect(body.authorization_servers).toEqual([
      "https://project.supabase.co/auth/v1",
    ]);
  });

  it("names the address a proxy forwarded for", async () => {
    const res = await get(
      undefined,
      { "x-forwarded-proto": "https", "x-forwarded-host": "hive.netlify.app" },
      "http://10.0.0.5:8888/.well-known/oauth-protected-resource",
    );
    expect((await res.json()).resource).toBe("https://hive.netlify.app/mcp");
  });

  it("answers 404 when the project address is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect((await get(undefined)).status).toBe(404);
  });

  it.each([[["other"]], [["mcp", "more"]], [[""]]])(
    "answers 404 for another path under it: %j",
    async (rest) => {
      expect((await get(rest)).status).toBe(404);
    },
  );
});
