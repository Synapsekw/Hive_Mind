// The agent identity the Edge Functions sign: one row from the database in,
// a one-hour JWT out.
//
// A function states who the caller is; the database decides what that
// identity may do. Only what the database returned is signed, always with
// `agent_id`, and nothing here logs or returns the key or the JWT.
//
// Web platform only (crypto.subtle, TextEncoder, btoa), so the same file runs
// in the Edge runtime and under `node --test`.

export type Identity = {
  agent_id: string;
  user_id: string;
  member_id: string;
  workspace_id: string;
  hive_id: string;
  trust_tier: string;
};

export type SigningKey = { key: CryptoKey; kid: string };

const LIFETIME_SECONDS = 3600;

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

// The private ES256 key from AGENT_SIGNING_JWK, as `supabase gen signing-key`
// writes it: one JWK, or a list whose first entry is used. Only the fields
// that are the key itself are imported; `use`, `key_ops`, `alg` and `ext`
// describe it and can make importKey refuse a perfectly good key.
async function importSigningKey(raw: string): Promise<SigningKey | null> {
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

// The imported key of this function instance, kept with the exact secret text
// it came from, so the JWK is parsed and imported once and not per request. A
// different text is a different key and is imported afresh; a key that could
// not be imported is not remembered.
let imported: { raw: string; signing: SigningKey } | null = null;

export async function loadKey(
  raw: string | undefined,
): Promise<SigningKey | null> {
  if (!raw) return null;
  if (imported !== null && imported.raw === raw) return imported.signing;
  const signing = await importSigningKey(raw);
  if (signing !== null) imported = { raw, signing };
  return signing;
}

// Exactly one row with exactly the types the login function declares
// (`agent_login`, `connector_login`); anything else is treated as a broken
// answer, not as an identity.
export function identityFrom(rows: unknown): Identity | "none" | "malformed" {
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
 * Sign `identity` as a one-hour agent JWT. `base` is the project address
 * without a trailing slash; `nowMs` is milliseconds, like `Date.now()`.
 * Rejects if the key cannot sign; the caller decides what to answer.
 */
export async function signIdentity(
  signing: SigningKey,
  identity: Identity,
  base: string,
  nowMs: number,
): Promise<{ accessToken: string; exp: number }> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + LIFETIME_SECONDS;
  const accessToken = await sign(signing, {
    role: "authenticated",
    aud: "authenticated",
    sub: identity.user_id,
    agent_id: identity.agent_id,
    workspace_id: identity.workspace_id,
    trust_tier: identity.trust_tier,
    // Makes the token useless at Supabase Auth. `sub` is the member's own
    // user id, so without this an agent could call /auth/v1/user and
    // change the person's password. Auth refuses a token whose session_id
    // matches no session; PostgREST and Storage ignore the claim. Fresh
    // and random on every token, never an id from the database. Guarded
    // live by tests/mcp.integration.test.mjs, "Auth refuses an agent
    // identity".
    session_id: crypto.randomUUID(),
    iat,
    exp,
    iss: `${base}/auth/v1`,
  });
  return { accessToken, exp };
}
