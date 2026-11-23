import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

const SITE = "https://hive.example";
const CONNECTOR = "https://project.example/functions/v1/mcp";
const METADATA = (origin: string) =>
  `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;

const fetchMock = vi.fn();

function answer(status = 200, body = '{"jsonrpc":"2.0","id":1,"result":{}}') {
  fetchMock.mockResolvedValue(
    new Response(body, {
      status,
      headers: {
        "content-type": "application/json",
        "set-cookie": "upstream=1",
        "x-internal": "1",
      },
    }),
  );
}

function request(
  method: string,
  headers: Record<string, string> = {},
  body?: BodyInit,
  url = `${SITE}/mcp`,
) {
  return new NextRequest(url, { method, headers, body });
}

const sent = () =>
  fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("HIVE_CONNECTOR_URL", CONNECTOR);
  answer();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("/mcp without a pass", () => {
  it.each([
    ["GET", GET],
    ["POST", POST],
    ["DELETE", DELETE],
  ])("%s answers 401 itself, naming the metadata", async (method, handler) => {
    const res = await handler(request(method));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(METADATA(SITE));
    expect(await res.json()).toEqual({ error: "sign in to the hive" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["another scheme", "Basic abc"],
    ["a bearer with no token", "Bearer "],
    ["only the word", "Bearer"],
  ])("treats %s as no pass", async (_name, authorization) => {
    const res = await POST(request("POST", { authorization }, "{}"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 401, not 503, when the connector is not configured either", async () => {
    vi.stubEnv("HIVE_CONNECTOR_URL", "");
    expect((await POST(request("POST"))).status).toBe(401);
  });
});

describe("/mcp: the address in the header", () => {
  it("comes from the forwarded host and scheme when a proxy set them", async () => {
    const res = await POST(
      request(
        "POST",
        {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "hive.netlify.app",
        },
        undefined,
        "http://10.0.0.5:8888/mcp",
      ),
    );
    expect(res.headers.get("www-authenticate")).toBe(
      METADATA("https://hive.netlify.app"),
    );
  });

  it("takes the first of several forwarded values", async () => {
    const res = await POST(
      request("POST", {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "hive.netlify.app, inner.local",
      }),
    );
    expect(res.headers.get("www-authenticate")).toBe(
      METADATA("https://hive.netlify.app"),
    );
  });

  it.each([
    ["a quote", 'evil.com"; x="'],
    ["a path", "evil.com/a"],
    ["a space", "evil.com x"],
    ["user info", "a@evil.com"],
    ["nothing", ""],
  ])(
    "falls back to the request's own address on a host with %s",
    async (_n, host) => {
      const res = await POST(request("POST", { "x-forwarded-host": host }));
      expect(res.headers.get("www-authenticate")).toBe(METADATA(SITE));
    },
  );

  it("ignores a forwarded scheme that is not http or https", async () => {
    const res = await POST(
      request("POST", {
        "x-forwarded-proto": "javascript",
        "x-forwarded-host": "hive.netlify.app",
      }),
    );
    expect(res.headers.get("www-authenticate")).toBe(
      METADATA("https://hive.netlify.app"),
    );
  });
});

describe("/mcp with a pass", () => {
  const BODY = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';

  it("forwards method, body and the five headers, and returns status and body", async () => {
    answer(200, '{"ok":1}');
    const res = await POST(
      request(
        "POST",
        {
          authorization: "Bearer pass-1",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          "mcp-session-id": "s-1",
          cookie: "sb-access-token=secret; hive-look=x",
          "x-forwarded-for": "1.2.3.4",
          "x-custom": "1",
        },
        BODY,
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = sent();
    expect(url).toBe(CONNECTOR);
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(BODY);
    expect(Object.fromEntries(init.headers.entries())).toEqual({
      authorization: "Bearer pass-1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": "s-1",
    });
    expect(init.redirect).toBe("manual");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":1}');
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("never forwards cookies, and returns none", async () => {
    const res = await POST(
      request(
        "POST",
        { authorization: "Bearer pass-1", cookie: "sb-access-token=secret" },
        BODY,
      ),
    );
    const [, init] = sent();
    expect(init.headers.has("cookie")).toBe(false);
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(res.headers.has("x-internal")).toBe(false);
  });

  it("forwards GET and DELETE without a body", async () => {
    for (const [method, handler] of [
      ["GET", GET],
      ["DELETE", DELETE],
    ] as const) {
      fetchMock.mockClear();
      answer(405, '{"error":"no"}');
      const res = await handler(
        request(method, { authorization: "Bearer pass-1" }),
      );
      const [, init] = sent();
      expect(init.method).toBe(method);
      expect(init.body).toBeUndefined();
      expect(res.status).toBe(405);
    }
  });

  it("adds the header to a 401 from the connector", async () => {
    answer(401, '{"error":"sign in to the hive"}');
    const res = await POST(
      request("POST", { authorization: "Bearer stale" }, BODY),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(METADATA(SITE));
    expect(await res.json()).toEqual({ error: "sign in to the hive" });
  });

  it("adds no such header to other answers", async () => {
    answer(502, '{"error":"x"}');
    const res = await POST(
      request("POST", { authorization: "Bearer pass-1" }, BODY),
    );
    expect(res.status).toBe(502);
    expect(res.headers.has("www-authenticate")).toBe(false);
  });

  it("never lets the request choose where it is forwarded", async () => {
    await POST(
      request(
        "POST",
        {
          authorization: "Bearer pass-1",
          "x-forwarded-host": "evil.example",
          "x-hive-connector-url": "https://evil.example/mcp",
        },
        BODY,
        `${SITE}/mcp?url=https://evil.example/mcp`,
      ),
    );
    expect(sent()[0]).toBe(CONNECTOR);
  });

  it.each([
    ["unset", ""],
    ["not an address", "nonsense"],
    ["not a web address", "file:///etc/passwd"],
  ])("answers 503 when the connector address is %s", async (_n, value) => {
    vi.stubEnv("HIVE_CONNECTOR_URL", value);
    const res = await POST(
      request("POST", { authorization: "Bearer pass-1" }, BODY),
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 413 to a body over 2 MB, by its declared length", async () => {
    const res = await POST(
      request(
        "POST",
        { authorization: "Bearer pass-1", "content-length": "2097153" },
        "{}",
      ),
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 413 to a body over 2 MB, whatever length it declares", async () => {
    const res = await POST(
      request(
        "POST",
        { authorization: "Bearer pass-1" },
        "x".repeat(2 * 1024 * 1024 + 1),
      ),
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a body of exactly 2 MB", async () => {
    const res = await POST(
      request(
        "POST",
        { authorization: "Bearer pass-1" },
        "x".repeat(2 * 1024 * 1024),
      ),
    );
    expect(res.status).toBe(200);
  });

  it("answers 502 when the connector cannot be reached, without the error's text", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED inner-host"));
    const res = await POST(
      request("POST", { authorization: "Bearer pass-1" }, BODY),
    );
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("inner-host");
  });
});
