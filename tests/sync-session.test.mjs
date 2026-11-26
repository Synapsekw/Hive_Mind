// The sync-session Edge Function's logic, run under node:test. The database is a stub fetch and
// every signing key is generated here, so nothing real is ever signed or printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/sync-session/session.ts";
import {
  signIdentity,
  loadKey,
} from "../supabase/functions/_shared/identity.ts";

const b64urlToJson = (s) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
      ),
    ),
  );
const decode = (jwt) => b64urlToJson(jwt.split(".")[1]);

async function makeJwk(kid = "sync-test-kid") {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { ...priv, kid, use: "sig", alg: "ES256", key_ops: ["sign"] };
}

const KEY = "hsync_" + "a".repeat(64);
const ROW = {
  sync_key_id: "11111111-1111-4111-8111-111111111111",
  agent_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  member_id: "44444444-4444-4444-8444-444444444444",
  workspace_id: "55555555-5555-4555-8555-555555555555",
  hive_id: "66666666-6666-4666-8666-666666666666",
  trust_tier: "vendor",
};
const post = (body) =>
  new Request("https://x/functions/v1/sync-session", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const env = async () => ({
  url: "https://p.supabase.co",
  anonKey: "pk",
  signingJwk: JSON.stringify(await makeJwk()),
});

test("a live key gets a one-hour identity with the sync claim", async () => {
  let asked;
  const res = await handle(
    post({ key: KEY }),
    await env(),
    async (url, init) => {
      asked = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify([ROW]), { status: 200 });
    },
    () => 1_000_000_000_000,
  );
  assert.equal(res.status, 200);
  assert.equal(asked.url, "https://p.supabase.co/rest/v1/rpc/sync_login");
  assert.deepEqual(asked.body, { p_key: KEY });
  const out = await res.json();
  const claims = decode(out.access_token);
  assert.equal(claims.sync_key_id, ROW.sync_key_id);
  assert.equal(claims.agent_id, ROW.agent_id);
  assert.equal(claims.sub, ROW.user_id);
  assert.equal(claims.workspace_id, ROW.workspace_id);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(out.sync_key_id, ROW.sync_key_id);
});

test("a refused key is 401 and the database's words are not repeated", async () => {
  const res = await handle(
    post({ key: KEY }),
    await env(),
    async () =>
      new Response(JSON.stringify({ message: "unknown or revoked sync key" }), {
        status: 400,
      }),
  );
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unknown or revoked sync key" });
});

test("only exactly {key} with a well-formed key is read", async () => {
  const e = await env();
  const never = async () => assert.fail("the database was asked");
  for (const body of [
    { key: "hive_" + "a".repeat(64) },
    { key: KEY, sync_key_id: "x" },
    { token: KEY },
    "not json",
  ]) {
    const res = await handle(post(body), e, never);
    assert.equal(res.status, 400);
  }
});

test("a row with a malformed sync_key_id is a broken answer, not an identity", async () => {
  const res = await handle(
    post({ key: KEY }),
    await env(),
    async () =>
      new Response(JSON.stringify([{ ...ROW, sync_key_id: "nope" }]), {
        status: 200,
      }),
  );
  assert.equal(res.status, 502);
});

test("extra claims can never replace a fixed claim", async () => {
  const signing = await loadKey(JSON.stringify(await makeJwk()));
  const { accessToken } = await signIdentity(
    signing,
    ROW,
    "https://p.supabase.co",
    1_000_000_000_000,
    { agent_id: "x", sub: "y", sync_key_id: ROW.sync_key_id },
  );
  const claims = decode(accessToken);
  assert.equal(claims.agent_id, ROW.agent_id);
  assert.equal(claims.sub, ROW.user_id);
  assert.equal(claims.sync_key_id, ROW.sync_key_id);
});
