// sync-session: a sync key in, a one-hour identity out.
//
// The same shape as agent-session: the function states who a key belongs to, the database
// decides what that identity may do. It signs only what `sync_login` returned, always with
// `agent_id` and `sync_key_id`, and takes nothing else from the request. It never logs or
// returns the key, the signing key or (on failure) the JWT.
//
// Web platform only, so the same file runs in the Edge runtime and under `node --test`.

import { readBody } from "../_shared/body.ts";
import { identityFrom, loadKey, signIdentity } from "../_shared/identity.ts";

export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};

const MAX_BODY_BYTES = 1024;
const KEY = /^hsync_[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATABASE_TIMEOUT_MS = 10_000;

const BAD_REQUEST = "send a JSON body with a key";
const REFUSED = "unknown or revoked sync key";
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

function fail(
  status: number,
  error: string,
  reason: string,
  extra?: Record<string, string>,
): Response {
  console.error(`sync-session: ${reason}`);
  return answer(status, { error }, extra);
}

function keyFrom(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "key") return null;
  const key = (parsed as Record<string, unknown>).key;
  return typeof key === "string" && KEY.test(key) ? key : null;
}

export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  if (req.method !== "POST")
    return fail(405, "use POST", "not a POST", { Allow: "POST" });
  const body = await readBody(req, MAX_BODY_BYTES);
  if (body === 413) return fail(413, "request too large", "body too large");
  if (body === 400) return fail(400, BAD_REQUEST, "unreadable body");
  const key = keyFrom(body);
  if (key === null) return fail(400, BAD_REQUEST, "no usable key in body");

  const base = env.url.replace(/\/+$/, "");
  if (!base || !env.anonKey)
    return fail(500, NOT_SET_UP, "project address or key missing");
  const signing = await loadKey(env.signingJwk);
  if (signing === null)
    return fail(500, NOT_SET_UP, "signing key missing or unusable");

  let rows: unknown;
  try {
    const res = await fetchFn(`${base}/rest/v1/rpc/sync_login`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_key: key }),
      redirect: "error",
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    });
    if (res.status === 400) {
      await res.body?.cancel().catch(() => {});
      return fail(401, REFUSED, "sync_login answered 400");
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return fail(502, UNREACHABLE, `sync_login answered ${res.status}`);
    }
    rows = await res.json();
  } catch {
    return fail(502, UNREACHABLE, "sync_login could not be reached");
  }

  const identity = identityFrom(rows);
  if (identity === "none")
    return fail(401, REFUSED, "sync_login returned no row");
  if (identity === "malformed")
    return fail(502, UNREACHABLE, "sync_login returned a malformed row");
  const keyId = (rows as Record<string, unknown>[])[0].sync_key_id;
  if (typeof keyId !== "string" || !UUID.test(keyId)) {
    return fail(502, UNREACHABLE, "sync_login returned a malformed row");
  }

  let accessToken: string;
  let exp: number;
  try {
    ({ accessToken, exp } = await signIdentity(signing, identity, base, now(), {
      sync_key_id: keyId,
    }));
  } catch {
    return fail(500, NOT_SET_UP, "signing failed");
  }
  return answer(200, {
    access_token: accessToken,
    expires_at: exp,
    sync_key_id: keyId,
    workspace_id: identity.workspace_id,
  });
}
