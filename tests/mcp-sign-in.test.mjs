// The MCP server's sign-in: the agent token goes to the agent-session function
// and a one-hour identity comes back. The function is a stub here; the module
// is loaded from source (Node strips the types), so no build is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signIn } from "../mcp/src/sign-in.ts";

const URL_ = "https://hive.example.test";
const ANON = "publishable-key-for-the-test";
const TOKEN = "hive_agent_token_that_must_never_leak_0123456789";
const ACCESS = "header.payload.signature-that-must-never-leak";
const args = { url: URL_, anonKey: ANON, token: TOKEN };

const good = () => ({
  access_token: ACCESS,
  expires_at: 1_800_000_000,
  agent_id: "a1",
  user_id: "u1",
  member_id: "m1",
  workspace_id: "w1",
  hive_id: "h1",
  trust_tier: "vendor",
});

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// A fetch stand-in that records what it was asked and answers with `answer`.
const stub = (answer) => {
  const calls = [];
  const fetchFn = async (input, init) => {
    calls.push({ input, init });
    return typeof answer === "function" ? answer() : answer;
  };
  return { calls, fetchFn };
};

const rejection = async (answer) => {
  const { fetchFn } = stub(answer);
  try {
    await signIn(args, fetchFn);
  } catch (e) {
    assert.ok(e instanceof Error);
    return e;
  }
  assert.fail("signIn did not throw");
};

const noSecrets = (e) => {
  const text = `${e.message}\n${e.stack}\n${String(e.cause ?? "")}`;
  assert.ok(!text.includes(TOKEN), "the agent token is in the error");
  assert.ok(!text.includes(ACCESS), "the access token is in the error");
};

test("posts the token to the agent-session function", async () => {
  const { calls, fetchFn } = stub(json(200, good()));
  await signIn(args, fetchFn);
  assert.equal(calls.length, 1);
  const { input, init } = calls[0];
  assert.equal(String(input), `${URL_}/functions/v1/agent-session`);
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("apikey"), ANON);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("Authorization"), null);
  assert.deepEqual(JSON.parse(init.body), { token: TOKEN });
});

test("a trailing slash on the url does not double up", async () => {
  const { calls, fetchFn } = stub(json(200, good()));
  await signIn({ ...args, url: `${URL_}/` }, fetchFn);
  assert.equal(String(calls[0].input), `${URL_}/functions/v1/agent-session`);
});

test("200 gives the access token, its expiry and who the agent is", async () => {
  const { fetchFn } = stub(json(200, good()));
  assert.deepEqual(await signIn(args, fetchFn), {
    accessToken: ACCESS,
    expiresAt: 1_800_000_000,
    me: {
      agent_id: "a1",
      user_id: "u1",
      member_id: "m1",
      workspace_id: "w1",
      hive_id: "h1",
      trust_tier: "vendor",
    },
  });
});

test("the self_hosted trust tier is accepted and extra fields are dropped", async () => {
  const { fetchFn } = stub(
    json(200, { ...good(), trust_tier: "self_hosted", role: "service_role" }),
  );
  const { me } = await signIn(args, fetchFn);
  assert.equal(me.trust_tier, "self_hosted");
  assert.deepEqual(Object.keys(me).sort(), [
    "agent_id",
    "hive_id",
    "member_id",
    "trust_tier",
    "user_id",
    "workspace_id",
  ]);
});

test("401 says the token is unknown, expired or revoked", async () => {
  const e = await rejection(
    json(401, { error: "unknown, expired or revoked token" }),
  );
  assert.equal(
    e.message,
    "Hive sign-in failed: unknown, expired or revoked token",
  );
  noSecrets(e);
});

test("404 names the function and the runbook", async () => {
  const e = await rejection(new Response("Not Found", { status: 404 }));
  assert.match(e.message, /^Hive sign-in failed: /);
  assert.match(e.message, /agent-session/);
  assert.match(e.message, /docs\/hosted-db-bringup\.md/);
  noSecrets(e);
});

test("any other status is reported by its number only", async () => {
  for (const status of [400, 403, 405, 413, 500, 502, 503]) {
    // A body that echoes the token must not reach the message.
    const e = await rejection(() =>
      json(status, { error: `bad ${TOKEN} ${ACCESS}` }),
    );
    assert.equal(e.message, `Hive sign-in failed: ${status}`);
    noSecrets(e);
  }
});

test("a 2xx that is not 200 is not a sign-in", async () => {
  const e = await rejection(() => json(201, good()));
  assert.equal(e.message, "Hive sign-in failed: 201");
  noSecrets(e);
});

test("a malformed 200 throws a short message", async () => {
  const without = (key) => {
    const body = good();
    delete body[key];
    return body;
  };
  const bodies = [
    ...Object.keys(good()).map(without),
    { ...good(), access_token: "" },
    { ...good(), access_token: 7 },
    { ...good(), expires_at: "1800000000" },
    { ...good(), expires_at: Number.NaN },
    { ...good(), expires_at: 0 },
    { ...good(), expires_at: 1.5 },
    { ...good(), agent_id: "" },
    { ...good(), user_id: null },
    { ...good(), member_id: 12 },
    { ...good(), workspace_id: {} },
    { ...good(), hive_id: ["h1"] },
    { ...good(), trust_tier: "admin" },
    [good()],
    null,
    "ok",
  ];
  for (const body of bodies) {
    const e = await rejection(() => json(200, body));
    assert.equal(
      e.message,
      "Hive sign-in failed: unexpected answer from agent-session",
      JSON.stringify(body)?.replace(ACCESS, "…"),
    );
    noSecrets(e);
  }
  const e = await rejection(
    () => new Response(`<html>${ACCESS}</html>`, { status: 200 }),
  );
  assert.equal(
    e.message,
    "Hive sign-in failed: unexpected answer from agent-session",
  );
  noSecrets(e);
});

test("a network error throws a short message without the cause", async () => {
  const { fetchFn } = stub(() => {
    throw new TypeError(`fetch failed for ${TOKEN}`);
  });
  await assert.rejects(signIn(args, fetchFn), (e) => {
    assert.equal(e.message, "Hive sign-in failed: the hive is not reachable");
    noSecrets(e);
    return true;
  });
});

test("nothing is written to the console", async (t) => {
  const seen = [];
  for (const level of ["log", "info", "warn", "error", "debug"])
    t.mock.method(console, level, (...a) => seen.push(a.join(" ")));
  await signIn(args, stub(json(200, good())).fetchFn);
  await rejection(json(401, {}));
  await rejection(json(500, {}));
  await rejection(json(200, {}));
  assert.deepEqual(seen, []);
});
