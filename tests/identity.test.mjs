// The signing code shared by the Edge Functions, run under node:test. Node
// loads the TypeScript module directly and every signing key is generated
// here, so nothing real is ever signed or printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadKey,
  signIdentity,
} from "../supabase/functions/_shared/identity.ts";

const BASE = "https://hive.example.supabase.co";
const NOW_MS = 1_800_000_000_123;
const NOW_S = 1_800_000_000;

const IDENTITY = {
  agent_id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  member_id: "33333333-3333-4333-8333-333333333333",
  workspace_id: "44444444-4444-4444-8444-444444444444",
  hive_id: "55555555-5555-4555-8555-555555555555",
  trust_tier: "self_hosted",
};

const b64urlToBytes = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const b64urlToJson = (s) =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// A key pair in the shape `supabase gen signing-key` writes, loaded the way a
// function loads it: through loadKey, from the secret's text.
async function makeSigning(kid = "identity-test-kid") {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const jwk = {
    kty: priv.kty,
    kid,
    use: "sig",
    key_ops: ["sign", "verify"],
    alg: "ES256",
    ext: true,
    d: priv.d,
    crv: priv.crv,
    x: priv.x,
    y: priv.y,
  };
  const signing = await loadKey(JSON.stringify(jwk));
  assert.ok(signing, "the generated key loads");
  return { signing, publicKey: pair.publicKey, kid };
}

test("signIdentity yields a JWT that verifies with the public key", async () => {
  const { signing, publicKey, kid } = await makeSigning();
  const { accessToken, exp } = await signIdentity(
    signing,
    IDENTITY,
    BASE,
    NOW_MS,
  );

  const parts = accessToken.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(b64urlToJson(parts[0]), {
    alg: "ES256",
    typ: "JWT",
    kid,
  });
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  assert.equal(verified, true);
  assert.equal(exp, NOW_S + 3600);
});

test("signIdentity writes exactly the agent claims, for one hour", async () => {
  const { signing } = await makeSigning();
  const { accessToken, exp } = await signIdentity(
    signing,
    IDENTITY,
    BASE,
    NOW_MS,
  );
  const claims = b64urlToJson(accessToken.split(".")[1]);

  assert.deepEqual(Object.keys(claims).sort(), [
    "agent_id",
    "aud",
    "exp",
    "iat",
    "iss",
    "role",
    "session_id",
    "sub",
    "trust_tier",
    "workspace_id",
  ]);
  const { session_id: sessionId, ...fixed } = claims;
  assert.deepEqual(fixed, {
    role: "authenticated",
    aud: "authenticated",
    sub: IDENTITY.user_id,
    agent_id: IDENTITY.agent_id,
    workspace_id: IDENTITY.workspace_id,
    trust_tier: IDENTITY.trust_tier,
    iat: NOW_S,
    exp: NOW_S + 3600,
    iss: `${BASE}/auth/v1`,
  });
  assert.equal(claims.exp, claims.iat + 3600);
  assert.equal(exp, claims.exp);
  assert.match(
    sessionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("signIdentity gives every token a different session_id", async () => {
  const { signing } = await makeSigning();
  const first = await signIdentity(signing, IDENTITY, BASE, NOW_MS);
  const second = await signIdentity(signing, IDENTITY, BASE, NOW_MS);
  const sessionOf = (jwt) => b64urlToJson(jwt.split(".")[1]).session_id;

  assert.notEqual(sessionOf(first.accessToken), sessionOf(second.accessToken));
  // Never an id from the database.
  for (const jwt of [first.accessToken, second.accessToken]) {
    assert.ok(!Object.values(IDENTITY).includes(sessionOf(jwt)));
  }
});
