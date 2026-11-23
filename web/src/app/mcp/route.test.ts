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

  it("passes the connector's Allow header through", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":"method not allowed"}', {
        status: 405,
        headers: { "content-type": "application/json", allow: "POST" },
      }),
    );
    const res = await GET(request("GET", { authorization: "Bearer pass-1" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });

  it("returns no Allow header the connector did not send", async () => {
    const res = await POST(
      request("POST", { authorization: "Bearer pass-1" }, BODY),
    );
    expect(res.headers.get("allow")).toBeNull();
  });
});

describe("/mcp: a connector that is slow or says too much", () => {
  const MB = 1024 * 1024;
  const TOO_LATE = { error: "the connector took too long" };
  const TOO_LARGE = { error: "the connector's answer was too large" };
  const BODY = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}';
  const post = () =>
    POST(request("POST", { authorization: "Bearer pass-1" }, BODY));

  afterEach(() => vi.useRealTimers());

  it("gives the connector 30 seconds, then answers 504 with a fixed body", async () => {
    vi.useFakeTimers();
    // Never answers; fails the way fetch does when its signal aborts.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted inner-host", "AbortError")),
          );
        }),
    );
    const pending = post();
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(TOO_LATE);
  });

  it("counts the answer's body in the same 30 seconds", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    // Headers at once, then a body that never ends.
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"jsonrpc"'));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const pending = post();
    await vi.advanceTimersByTimeAsync(30_000);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual(TOO_LATE);
    expect(cancelled).toBe(true);
  });

  it("leaves no timer behind after an answer in time", async () => {
    vi.useFakeTimers();
    const res = await post();
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("answers 502 to an answer over 8 MB, whatever length it declares", async () => {
    fetchMock.mockResolvedValue(
      new Response("x".repeat(8 * MB + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(TOO_LARGE);
  });

  it("answers 502 to an answer that declares more than 8 MB, without reading it through", async () => {
    let sent = 0;
    let cancelled = false;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            sent += 1024;
            controller.enqueue(new Uint8Array(1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200, headers: { "content-length": String(8 * MB + 1) } },
      ),
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(TOO_LARGE);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(MB);
  });

  it("stops reading an endless answer once it passes 8 MB", async () => {
    let sent = 0;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            sent += MB;
            controller.enqueue(new Uint8Array(MB));
          },
        }),
        { status: 200 },
      ),
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(TOO_LARGE);
    expect(sent).toBeLessThanOrEqual(10 * MB);
  });

  it("returns an answer of exactly 8 MB", async () => {
    fetchMock.mockResolvedValue(
      new Response("x".repeat(8 * MB), { status: 200 }),
    );
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(8 * MB);
  });

  it("answers 502 when the answer breaks off, without the error's text", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("socket hang up inner-host"));
          },
        }),
        { status: 200 },
      ),
    );
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("inner-host");
  });
});
