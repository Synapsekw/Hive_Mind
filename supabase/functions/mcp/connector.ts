// mcp: the remote connector. An app's pass in, the hive tools out.
//
// A connected app (Claude, ChatGPT) calls this with `Authorization: Bearer
// <pass>`, a pass the person approved for that app. The function hands the
// pass to the database function `connector_login`, which names the agent that
// stands for the app, signs that limited agent identity, and serves the six
// shared tools over MCP with a database client that carries the agent
// identity. The database decides what that identity may do; nothing here
// checks a permission.
//
// The pass goes to `connector_login` and nowhere else: not to the tools, not
// to the MCP layer, not to a log line. Nothing but the pass decides who the
// agent is. The function never logs or returns the pass, the key or the
// agent identity.
//
// Stateless: every request gets its own server and transport and is answered
// as JSON. Only POST is served.
//
// Web platform only (Request, Response, fetch, crypto.subtle) plus the three
// packages deno.json maps, so the same file runs in the Edge runtime and
// under `node --test`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import {
  identityFrom,
  loadKey,
  signIdentity,
  type Identity,
} from "../_shared/identity.ts";
import { registerTools } from "./tools.ts";

export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PASS_MAX = 8192;
const DATABASE_TIMEOUT_MS = 10_000;

const SIGN_IN = "sign in to the hive";
const UNREACHABLE = "the hive is not reachable";
const NOT_SET_UP = "the connector is not set up";

// What the transport needs to read an MCP request. Nothing else of the
// caller's request reaches it, least of all the Authorization header.
const FORWARDED_HEADERS = ["accept", "content-type", "mcp-protocol-version"];

function answer(
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

// A failure is logged as one fixed phrase: never the pass, the key, the
// database's own words or an exception's message.
function fail(
  status: number,
  error: string,
  reason: string,
  extra?: Record<string, string>,
): Response {
  console.error(`mcp: ${reason}`);
  return answer(status, { error }, extra);
}

// The pass from `Authorization: Bearer <pass>`: one token of the characters
// RFC 6750 allows, or nothing.
function passFrom(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(header);
  if (match === null) return null;
  const pass = match[1];
  return pass.length > PASS_MAX ? null : pass;
}

// The body as bytes, or 413. The cap is on the bytes actually read;
// Content-Length is only a way to refuse sooner. A body that cannot be read
// is passed on as empty, which the transport refuses as no JSON.
async function readBody(req: Request): Promise<ArrayBuffer | 413> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return 413;
  if (req.body === null) return new ArrayBuffer(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      chunks.push(value);
      length += value.byteLength;
    }
  } catch {
    return new ArrayBuffer(0);
  }
  const buffer = new ArrayBuffer(length);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

// Ask the database which agent the pass stands for. The pass is the caller
// of `connector_login`: PostgREST verifies it, the function reads the app
// from it. Answers the identity, or the response to refuse the request with.
async function login(
  pass: string,
  base: string,
  anonKey: string,
  fetchFn: typeof fetch,
): Promise<Identity | Response> {
  let rows: unknown;
  try {
    const res = await fetchFn(`${base}/rest/v1/rpc/connector_login`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${pass}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    });
    // 400 is the database refusing the pass (no connected agent for this app,
    // an app it does not know, an approval that was taken back); 401 is
    // PostgREST refusing the pass itself (invalid, expired). Both are the
    // app's to fix by signing in again. Any other answer (403, 404, 429,
    // 5xx) is the database refusing or failing this function, so the app is
    // not told its pass is bad.
    if (res.status === 400 || res.status === 401) {
      await res.body?.cancel().catch(() => {});
      return fail(401, SIGN_IN, `connector_login answered ${res.status}`);
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return fail(502, UNREACHABLE, `connector_login answered ${res.status}`);
    }
    rows = await res.json();
  } catch {
    return fail(502, UNREACHABLE, "connector_login could not be reached");
  }

  const identity = identityFrom(rows);
  if (identity === "none") {
    return fail(401, SIGN_IN, "connector_login returned no row");
  }
  if (identity === "malformed") {
    return fail(502, UNREACHABLE, "connector_login returned a malformed row");
  }
  return identity;
}

// Serve one MCP request as `identity`. The server, the transport and the
// database client live for this request only.
async function serve(
  req: Request,
  body: ArrayBuffer,
  identity: Identity,
  accessToken: string,
  base: string,
  anonKey: string,
  fetchFn: typeof fetch,
): Promise<Response> {
  const db = createClient(base, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: (input, init) => fetchFn(input, init),
    },
  });

  const server = new McpServer({ name: "hive-mind", version: "0.1.0" });
  registerTools(server, async () => ({ db, me: identity }));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // A fixed address: the caller's query string is no part of an MCP request.
  const forwarded = new Request(`${base}/functions/v1/mcp`, {
    method: "POST",
    headers,
    body,
  });

  try {
    await server.connect(transport);
    const res = await transport.handleRequest(forwarded);
    // In JSON mode the answer is complete when handleRequest resolves, so it
    // is read in full and the server can be closed before it is returned.
    const bytes = await res.arrayBuffer();
    const out = new Headers(res.headers);
    out.set("Cache-Control", "no-store");
    return new Response(bytes.byteLength === 0 ? null : bytes, {
      status: res.status,
      headers: out,
    });
  } finally {
    await server.close().catch(() => {});
  }
}

/**
 * Answer one request. `now` returns milliseconds, like `Date.now`.
 */
export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  const pass = passFrom(req.headers.get("authorization"));
  if (pass === null) return fail(401, SIGN_IN, "no bearer pass");

  // Stateless and JSON only: there is no stream to open with GET and no
  // session to end with DELETE. The MCP specification asks for 405 then.
  if (req.method !== "POST") {
    return fail(405, "use POST", "not a POST", { Allow: "POST" });
  }

  // The key is checked before the database is asked, so a function that
  // cannot sign never sends a pass anywhere.
  const base = env.url.replace(/\/+$/, "");
  if (!base || !env.anonKey) {
    return fail(500, NOT_SET_UP, "project address or key missing");
  }
  const signing = await loadKey(env.signingJwk);
  if (signing === null) {
    return fail(500, NOT_SET_UP, "signing key missing or unusable");
  }

  const body = await readBody(req);
  if (body === 413) return fail(413, "request too large", "body too large");

  const identity = await login(pass, base, env.anonKey, fetchFn);
  if (identity instanceof Response) return identity;

  let accessToken: string;
  try {
    ({ accessToken } = await signIdentity(signing, identity, base, now()));
  } catch {
    return fail(500, NOT_SET_UP, "signing failed");
  }

  try {
    return await serve(
      req,
      body,
      identity,
      accessToken,
      base,
      env.anonKey,
      fetchFn,
    );
  } catch {
    return fail(500, "the hive could not answer", "the MCP server failed");
  }
}
