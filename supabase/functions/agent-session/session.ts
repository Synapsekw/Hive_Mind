// agent-session: an agent token in, a one-hour identity out.
//
// The function states who a token belongs to; the database decides what that
// identity may do. It signs only what `agent_login` returned, always with
// `agent_id`, and takes nothing else from the request. It never logs or
// returns the token, the key or (on failure) the JWT.
//
// Web platform only (Request, Response, fetch, crypto.subtle), so the same
// file runs in the Edge runtime and under `node --test`.

export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};

type Identity = {
  agent_id: string;
  user_id: string;
  member_id: string;
  workspace_id: string;
  hive_id: string;
  trust_tier: string;
};

type SigningKey = { key: CryptoKey; kid: string };

const MAX_BODY_BYTES = 2048;
const TOKEN_MIN = 20;
const TOKEN_MAX = 200;
const LIFETIME_SECONDS = 3600;
const DATABASE_TIMEOUT_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// public.trust_tier in supabase/migrations/20261120000001_schema.sql.
const TRUST_TIERS = ["vendor", "self_hosted"];
const ID_FIELDS = [
  "agent_id",
  "user_id",
  "member_id",
  "workspace_id",
  "hive_id",
] as const;

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

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
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

// The private ES256 key from AGENT_SIGNING_JWK, as `supabase gen signing-key`
// writes it: one JWK, or a list whose first entry is used. Only the fields
// that are the key itself are imported; `use`, `key_ops`, `alg` and `ext`
// describe it and can make importKey refuse a perfectly good key.
async function loadKey(raw: string | undefined): Promise<SigningKey | null> {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const jwk = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(jwk)) return null;
  const { kty, crv, x, y, d, kid } = jwk;
  if (kty !== "EC" || crv !== "P-256") return null;
  if (typeof x !== "string" || typeof y !== "string") return null;
  if (typeof d !== "string" || d === "") return null;
  if (typeof kid !== "string" || kid === "") return null;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty, crv, x, y, d },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    return { key, kid };
  } catch {
    return null;
  }
}

// Exactly one row with exactly the types `agent_login` declares; anything
// else is treated as a broken answer, not as an identity.
function identityFrom(rows: unknown): Identity | "none" | "malformed" {
  if (!Array.isArray(rows)) return "malformed";
  if (rows.length === 0) return "none";
  if (rows.length !== 1) return "malformed";
  const row: unknown = rows[0];
  if (!isRecord(row)) return "malformed";
  for (const field of ID_FIELDS) {
    const value = row[field];
    if (typeof value !== "string" || !UUID.test(value)) return "malformed";
  }
  const tier = row.trust_tier;
  if (typeof tier !== "string" || !TRUST_TIERS.includes(tier)) {
    return "malformed";
  }
  // Copied field by field: an extra column never becomes a claim.
  return {
    agent_id: row.agent_id as string,
    user_id: row.user_id as string,
    member_id: row.member_id as string,
    workspace_id: row.workspace_id as string,
    hive_id: row.hive_id as string,
    trust_tier: tier,
  };
}

async function sign(
  signing: SigningKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid: signing.kid };
  const input = `${base64urlJson(header)}.${base64urlJson(claims)}`;
  // Web Crypto's ECDSA signature is already the raw r||s that ES256 wants.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signing.key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
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
    if (res.status >= 400 && res.status < 500) {
      await res.body?.cancel().catch(() => {});
      return fail(401, REFUSED, `agent_login answered ${res.status}`);
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

  const iat = Math.floor(now() / 1000);
  const exp = iat + LIFETIME_SECONDS;
  let accessToken: string;
  try {
    accessToken = await sign(signing, {
      role: "authenticated",
      aud: "authenticated",
      sub: identity.user_id,
      agent_id: identity.agent_id,
      workspace_id: identity.workspace_id,
      trust_tier: identity.trust_tier,
      iat,
      exp,
      iss: `${base}/auth/v1`,
    });
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
