// agent-session: an agent token in, a one-hour identity out.
//
// The function states who a token belongs to; the database decides what that
// identity may do. It signs only what `agent_login` returned, always with
// `agent_id`, and takes nothing else from the request. It never logs or
// returns the token, the key or (on failure) the JWT.
//
// Web platform only (Request, Response, fetch, crypto.subtle), so the same
// file runs in the Edge runtime and under `node --test`.

import { identityFrom, loadKey, signIdentity } from "../_shared/identity.ts";

export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};

const MAX_BODY_BYTES = 2048;
const TOKEN_MIN = 20;
const TOKEN_MAX = 200;
const DATABASE_TIMEOUT_MS = 10_000;

const BAD_REQUEST = "send a JSON body with a token";
const REFUSED = "unknown, expired or revoked token";
const UNREACHABLE = "the hive is not reachable";
const NOT_SET_UP = "sign-in is not set up";

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

// A failure is logged as one fixed phrase: never the token, the key, the
// database's own words or an exception's message.
function fail(
  status: number,
  error: string,
  reason: string,
  extra?: Record<string, string>,
): Response {
  console.error(`agent-session: ${reason}`);
  return answer(status, { error }, extra);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The body as text, or the status to refuse it with. The cap is on the bytes
// actually read; Content-Length is only a way to refuse sooner.
async function readBody(req: Request): Promise<string | 400 | 413> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return 413;
  if (req.body === null) return 400;

  const reader = req.body.getReader();
  const bytes = new Uint8Array(MAX_BODY_BYTES);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } catch {
    return 400;
  }
}

// Exactly `{ "token": "<20 to 200 characters>" }`. Any other key is refused,
// so a request has nowhere to put a claim.
function tokenFrom(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "token") return null;
  const token = parsed.token;
  if (typeof token !== "string") return null;
  if (token.length < TOKEN_MIN || token.length > TOKEN_MAX) return null;
  return token;
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
  if (req.method !== "POST") {
    return fail(405, "use POST", "not a POST", { Allow: "POST" });
  }

  const body = await readBody(req);
  if (body === 413) return fail(413, "request too large", "body too large");
  if (body === 400) return fail(400, BAD_REQUEST, "unreadable body");
  const token = tokenFrom(body);
  if (token === null) return fail(400, BAD_REQUEST, "no usable token in body");

  // The key is checked before the database is asked, so a function that
  // cannot sign never stamps a token as used.
  const base = env.url.replace(/\/+$/, "");
  if (!base || !env.anonKey) {
    return fail(500, NOT_SET_UP, "project address or key missing");
  }
  const signing = await loadKey(env.signingJwk);
  if (signing === null) {
    return fail(500, NOT_SET_UP, "signing key missing or unusable");
  }

  let rows: unknown;
  try {
    const res = await fetchFn(`${base}/rest/v1/rpc/agent_login`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_token: token }),
      redirect: "error",
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    });
    // Only 400 is the database raising "unknown, expired or revoked". Any
    // other 4xx (401, 403, 404, 429, ...) is the database refusing this
    // function, not the token: a wrong or revoked key, a missing grant, a
    // rate limit. That is ours to fix, so the agent is not told its token
    // is bad.
    if (res.status === 400) {
      await res.body?.cancel().catch(() => {});
      return fail(401, REFUSED, "agent_login answered 400");
    }
    if (res.status > 400 && res.status < 500) {
      await res.body?.cancel().catch(() => {});
      return fail(
        502,
        UNREACHABLE,
        `agent_login refused the function (${res.status})`,
      );
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return fail(502, UNREACHABLE, `agent_login answered ${res.status}`);
    }
    rows = await res.json();
  } catch {
    return fail(502, UNREACHABLE, "agent_login could not be reached");
  }

  const identity = identityFrom(rows);
  if (identity === "none") {
    return fail(401, REFUSED, "agent_login returned no row");
  }
  if (identity === "malformed") {
    return fail(502, UNREACHABLE, "agent_login returned a malformed row");
  }

  let accessToken: string;
  let exp: number;
  try {
    ({ accessToken, exp } = await signIdentity(signing, identity, base, now()));
  } catch {
    return fail(500, NOT_SET_UP, "signing failed");
  }

  return answer(200, {
    access_token: accessToken,
    expires_at: exp,
    agent_id: identity.agent_id,
    user_id: identity.user_id,
    member_id: identity.member_id,
    workspace_id: identity.workspace_id,
    hive_id: identity.hive_id,
    trust_tier: identity.trust_tier,
  });
}
