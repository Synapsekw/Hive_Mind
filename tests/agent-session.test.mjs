// The agent-session Edge Function's logic, run under node:test. Node loads the
// TypeScript module directly; the database is a stub fetch and every signing
// key is generated here, so nothing real is ever signed or printed.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/agent-session/session.ts";

const URL_ = "https://hive.example.supabase.co";
const ANON = "sb_publishable_test_anon_key";
const TOKEN = "hm_" + "t".repeat(40);
const NOW_MS = 1_800_000_000_123;
const NOW_S = 1_800_000_000;

const ROW = {
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

// A key pair in the shape `supabase gen signing-key` writes: a private JWK
// with a kid and the descriptive fields importKey can trip over.
async function makeKey(kid = "test-kid-1") {
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
  return { jwk, publicKey: pair.publicKey, d: priv.d };
}

const envWith = (signingJwk) => ({ url: URL_, anonKey: ANON, signingJwk });

const post = (body, headers = {}) =>
  new Request(`${URL_}/functions/v1/agent-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
const good = () => post(JSON.stringify({ token: TOKEN }));

// A fetch stub that records what it was asked and answers as PostgREST would.
function stub(answer = () => Response.json([ROW])) {
  const calls = [];
  const fn = async (input, init) => {
    calls.push({ input, init });
    return answer();
  };
  return { fn, calls };
}

const now = () => NOW_MS;

// Everything the function prints lands here instead of in the test output.
const logged = [];
for (const name of ["log", "info", "warn", "error", "debug", "trace"]) {
  mock.method(console, name, (...args) => {
    logged.push(args.map(String).join(" "));
  });
}

async function withConsoleSpy(run) {
  const from = logged.length;
  await run();
  return logged.slice(from);
}

async function expectError(res, status, message) {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), { error: message });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
}

test("1. a good token gets a one-hour ES256 identity", async () => {
  const key = await makeKey();
  const db = stub();
  const res = await handle(
    good(),
    envWith(JSON.stringify(key.jwk)),
    db.fn,
    now,
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Type"), /^application\/json/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);

  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), [
    "access_token",
    "agent_id",
    "expires_at",
    "hive_id",
    "member_id",
    "trust_tier",
    "user_id",
    "workspace_id",
  ]);
  const { access_token, expires_at, ...rest } = body;
  assert.deepEqual(rest, ROW);
  assert.equal(expires_at, NOW_S + 3600);

  const parts = access_token.split(".");
  assert.equal(parts.length, 3);
  assert.doesNotMatch(access_token, /[+/=]/);

  // ES256 in a JWS is the raw 64-byte r||s, which is what Web Crypto verifies.
  const signature = b64urlToBytes(parts[2]);
  assert.equal(signature.length, 64);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key.publicKey,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  assert.equal(verified, true);

  assert.deepEqual(b64urlToJson(parts[0]), {
    alg: "ES256",
    typ: "JWT",
    kid: "test-kid-1",
  });
  assert.deepEqual(b64urlToJson(parts[1]), {
    role: "authenticated",
    aud: "authenticated",
    sub: ROW.user_id,
    agent_id: ROW.agent_id,
    workspace_id: ROW.workspace_id,
    trust_tier: ROW.trust_tier,
    iat: NOW_S,
    exp: NOW_S + 3600,
    iss: `${URL_}/auth/v1`,
  });
});

test("1b. the key may be an array (the first is used) or a bare JWK without the extras", async () => {
  const first = await makeKey("first");
  const second = await makeKey("second");
  const asArray = await handle(
    good(),
    envWith(JSON.stringify([first.jwk, second.jwk])),
    stub().fn,
    now,
  );
  assert.equal(asArray.status, 200);
  const jwt = (await asArray.json()).access_token;
  assert.equal(b64urlToJson(jwt.split(".")[0]).kid, "first");

  const { kty, crv, x, y, d, kid } = first.jwk;
  const bare = await handle(
    good(),
    envWith(JSON.stringify({ kty, crv, x, y, d, kid })),
    stub().fn,
    now,
  );
  assert.equal(bare.status, 200);

  // Fields that describe another use must not stop the import.
  const odd = await handle(
    good(),
    envWith(JSON.stringify({ ...first.jwk, key_ops: ["verify"], use: "enc" })),
    stub().fn,
    now,
  );
  assert.equal(odd.status, 200);
});

test("2. the database is asked once, as anon, with the token", async () => {
  const key = await makeKey();
  const db = stub();
  await handle(
    good(),
    { ...envWith(JSON.stringify(key.jwk)), url: `${URL_}/` },
    db.fn,
    now,
  );

  assert.equal(db.calls.length, 1);
  const { input, init } = db.calls[0];
  assert.equal(String(input), `${URL_}/rest/v1/rpc/agent_login`);
  assert.equal(init.method, "POST");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("apikey"), ANON);
  assert.equal(headers.get("Authorization"), `Bearer ${ANON}`);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(init.body), { p_token: TOKEN });
});

test("3. a token the database refuses is a 401 and nothing is signed", async () => {
  const key = await makeKey();
  const refusals = [
    () =>
      Response.json(
        {
          code: "P0001",
          details: null,
          hint: null,
          message: "unknown, expired or revoked token",
        },
        { status: 400 },
      ),
    () => Response.json([]),
    () => Response.json({ message: "no" }, { status: 404 }),
    () => new Response("not json", { status: 401 }),
  ];
  for (const answer of refusals) {
    const sign = mock.method(crypto.subtle, "sign");
    try {
      const db = stub(answer);
      const res = await handle(
        good(),
        envWith(JSON.stringify(key.jwk)),
        db.fn,
        now,
      );
      await expectError(res, 401, "unknown, expired or revoked token");
      assert.equal(db.calls.length, 1);
      assert.equal(sign.mock.callCount(), 0);
    } finally {
      sign.mock.restore();
    }
  }
});

test("4. an unreachable or failing database is a 502", async () => {
  const key = await makeKey();
  const failures = [
    () => {
      throw new TypeError("fetch failed");
    },
    () => Response.json({ message: "boom" }, { status: 500 }),
    () => new Response("bad gateway", { status: 503 }),
    () => new Response(null, { status: 302, headers: { Location: "/x" } }),
    () => new Response("<html>", { status: 200 }),
  ];
  for (const answer of failures) {
    const res = await handle(
      good(),
      envWith(JSON.stringify(key.jwk)),
      stub(answer).fn,
      now,
    );
    await expectError(res, 502, "the hive is not reachable");
  }
});

test("5. anything but a POST with exactly one usable token is refused before the database", async () => {
  const key = await makeKey();
  const env = envWith(JSON.stringify(key.jwk));
  const db = stub();
  const BAD = "send a JSON body with a token";

  for (const method of ["GET", "PUT", "DELETE", "HEAD", "OPTIONS"]) {
    const res = await handle(
      new Request(`${URL_}/functions/v1/agent-session`, { method }),
      env,
      db.fn,
      now,
    );
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("Allow"), "POST");
    if (method !== "HEAD")
      assert.deepEqual(await res.json(), { error: "use POST" });
  }

  const bodies = {
    "no body": undefined,
    "empty body": "",
    "invalid JSON": "{token:",
    "invalid UTF-8": new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]),
    null: "null",
    "a string": JSON.stringify(TOKEN),
    "an array": JSON.stringify([{ token: TOKEN }]),
    "no token": "{}",
    "a number": JSON.stringify({ token: 12345678901234567890 }),
    "a null token": JSON.stringify({ token: null }),
    "an object token": JSON.stringify({ token: { toString: TOKEN } }),
    "an array token": JSON.stringify({ token: [TOKEN] }),
    "19 characters": JSON.stringify({ token: "a".repeat(19) }),
    "201 characters": JSON.stringify({ token: "a".repeat(201) }),
    "an extra key": JSON.stringify({ token: TOKEN, note: "hi" }),
    "another spelling": JSON.stringify({ Token: TOKEN }),
    "a __proto__ key": `{"token":"${TOKEN}","__proto__":{"agent_id":"x"}}`,
  };
  for (const [name, body] of Object.entries(bodies)) {
    const res = await handle(post(body), env, db.fn, now);
    assert.equal(res.status, 400, name);
    assert.deepEqual(await res.json(), { error: BAD }, name);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }

  // The limits themselves are accepted.
  for (const length of [20, 200]) {
    const ok = await handle(
      post(JSON.stringify({ token: "a".repeat(length) })),
      env,
      stub().fn,
      now,
    );
    assert.equal(ok.status, 200, `${length} characters`);
  }

  const big = JSON.stringify({ token: TOKEN, pad: "x".repeat(2100) });
  await expectError(
    await handle(post(big), env, db.fn, now),
    413,
    "request too large",
  );

  // A stream has no Content-Length at all: the cap is on the bytes read.
  const chunk = new TextEncoder().encode(" ".repeat(512));
  let sent = 0;
  const endless = new ReadableStream({
    pull(controller) {
      sent += 1;
      if (sent > 64) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const streamed = new Request(`${URL_}/functions/v1/agent-session`, {
    method: "POST",
    body: endless,
    duplex: "half",
  });
  await expectError(
    await handle(streamed, env, db.fn, now),
    413,
    "request too large",
  );
  assert.ok(sent < 20, "the body is not read to its end");

  // A Content-Length that claims too much is refused without reading.
  const claimed = post(JSON.stringify({ token: TOKEN }), {
    "Content-Length": "999999",
  });
  await expectError(
    await handle(claimed, env, db.fn, now),
    413,
    "request too large",
  );

  assert.equal(db.calls.length, 0);
});

test("6. the key is checked before the database is asked", async () => {
  const key = await makeKey();
  const { d: _d, ...publicOnly } = key.jwk;
  const { kid: _kid, ...noKid } = key.jwk;
  const hmac = { kty: "oct", k: "c2VjcmV0", kid: "h", alg: "HS256" };
  const keys = {
    missing: undefined,
    empty: "",
    unparsable: "{not json",
    "a string": JSON.stringify("key"),
    null: "null",
    "an empty array": "[]",
    "public only": JSON.stringify(publicOnly),
    "no kid": JSON.stringify(noKid),
    "an empty kid": JSON.stringify({ ...key.jwk, kid: "" }),
    "another curve": JSON.stringify({ ...key.jwk, crv: "P-384" }),
    "a shared secret": JSON.stringify(hmac),
    "a broken d": JSON.stringify({ ...key.jwk, d: "AAAA" }),
    "an array led by a public key": JSON.stringify([publicOnly, key.jwk]),
  };
  for (const [name, signingJwk] of Object.entries(keys)) {
    const db = stub();
    const res = await handle(good(), envWith(signingJwk), db.fn, now);
    assert.equal(res.status, 500, name);
    assert.deepEqual(
      await res.json(),
      { error: "sign-in is not set up" },
      name,
    );
    assert.equal(db.calls.length, 0, name);
  }

  // Without the project's address or key there is nothing to ask either.
  for (const env of [
    { url: "", anonKey: ANON, signingJwk: JSON.stringify(key.jwk) },
    { url: URL_, anonKey: "", signingJwk: JSON.stringify(key.jwk) },
  ]) {
    const db = stub();
    const res = await handle(good(), env, db.fn, now);
    await expectError(res, 500, "sign-in is not set up");
    assert.equal(db.calls.length, 0);
  }
});

// Every answer the database could give that is not exactly one well-formed row.
const MALFORMED_ROWS = {
  "an object, not a list": ROW,
  "two rows": [ROW, ROW],
  "a null row": [null],
  "a string row": ["row"],
  "a list row": [[ROW]],
  null: null,
  ...Object.fromEntries(
    Object.keys(ROW).flatMap((field) => {
      const { [field]: _gone, ...without } = ROW;
      return [
        [`no ${field}`, [without]],
        [`null ${field}`, [{ ...ROW, [field]: null }]],
        [`empty ${field}`, [{ ...ROW, [field]: "" }]],
        [`numeric ${field}`, [{ ...ROW, [field]: 7 }]],
        [`object ${field}`, [{ ...ROW, [field]: { id: ROW[field] } }]],
        [`non-uuid ${field}`, [{ ...ROW, [field]: "not-a-uuid" }]],
      ];
    }),
  ),
  "an unknown trust tier": [{ ...ROW, trust_tier: "admin" }],
  "a trust tier in capitals": [{ ...ROW, trust_tier: "Self_Hosted" }],
  "a uuid with a tail": [{ ...ROW, agent_id: `${ROW.agent_id}\n` }],
};

test("7. a malformed row from the database is a 502 and nothing is signed", async () => {
  const key = await makeKey();
  const sign = mock.method(crypto.subtle, "sign");
  try {
    for (const [name, answer] of Object.entries(MALFORMED_ROWS)) {
      const res = await handle(
        good(),
        envWith(JSON.stringify(key.jwk)),
        stub(() => Response.json(answer)).fn,
        now,
      );
      assert.equal(res.status, 502, name);
      assert.deepEqual(
        await res.json(),
        { error: "the hive is not reachable" },
        name,
      );
    }
    assert.equal(sign.mock.callCount(), 0);
  } finally {
    sign.mock.restore();
  }
});

test("8. no answer and no log line carries the token, the JWT or the key", async () => {
  const key = await makeKey();
  const env = envWith(JSON.stringify(key.jwk));
  const secrets = [TOKEN, key.d, key.jwk.x, JSON.stringify(key.jwk), ANON];
  const answers = [];
  let jwt;

  const lines = await withConsoleSpy(async () => {
    const run = async (req, e, answer) => {
      const res = await handle(req, e, stub(answer).fn, now);
      const text = await res.text();
      answers.push({ status: res.status, text });
      return { status: res.status, text };
    };

    const ok = await run(good(), env);
    assert.equal(ok.status, 200);
    jwt = JSON.parse(ok.text).access_token;

    // The database's own words, echoing the token, must not be passed on.
    await run(good(), env, () =>
      Response.json(
        { code: "P0001", message: `bad token ${TOKEN}` },
        { status: 400 },
      ),
    );
    await run(good(), env, () => Response.json([]));
    await run(good(), env, () => {
      throw new Error(`could not send ${TOKEN} with ${ANON}`);
    });
    await run(good(), env, () =>
      Response.json({ message: `leak ${TOKEN}` }, { status: 500 }),
    );
    await run(good(), env, () => Response.json([{ ...ROW, agent_id: TOKEN }]));
    await run(post(JSON.stringify({ token: TOKEN, agent_id: "x" })), env);
    await run(post(`{"token":"${TOKEN}"`), env);
    await run(post(JSON.stringify({ token: TOKEN + "x".repeat(200) })), env);
    await run(
      post(JSON.stringify({ token: TOKEN, pad: "x".repeat(3000) })),
      env,
    );
    await run(good(), envWith(undefined));
    await run(good(), envWith(JSON.stringify({ ...key.jwk, kid: "" })));
    await run(good(), envWith(JSON.stringify({ ...key.jwk, crv: "P-384" })));
    await run(good(), envWith(`{"d":"${key.d}",`));
    await run(
      new Request(`${URL_}/functions/v1/agent-session?token=${TOKEN}`),
      env,
    );
  });

  // Every failure says why, in a line of its own.
  const failures = answers.filter((a) => a.status !== 200);
  assert.equal(failures.length, 14);
  assert.equal(lines.length, failures.length);

  for (const line of lines) {
    assert.match(line, /^agent-session: [a-z0-9 _-]+$/i);
    assert.ok(line.length < 120);
    assert.ok(!line.includes(jwt));
    for (const secret of secrets) assert.ok(!line.includes(secret));
  }
  for (const { status, text } of answers) {
    for (const secret of secrets) assert.ok(!text.includes(secret), status);
    if (status !== 200) {
      assert.ok(!text.includes(jwt));
      assert.ok(!text.includes("access_token"));
      assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
    }
  }
});

test("9. the identity is what the database returned, never what the request said", async () => {
  const key = await makeKey();
  const env = envWith(JSON.stringify(key.jwk));
  const claimsOf = async (res) =>
    b64urlToJson((await res.json()).access_token.split(".")[1]);

  // Each tier and each id is copied from the row.
  for (const trust_tier of ["vendor", "self_hosted"]) {
    const row = {
      ...ROW,
      trust_tier,
      agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspace_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };
    const res = await handle(
      good(),
      env,
      stub(() => Response.json([row])).fn,
      now,
    );
    const claims = await claimsOf(res);
    assert.equal(claims.trust_tier, trust_tier);
    assert.equal(claims.agent_id, row.agent_id);
    assert.equal(claims.workspace_id, row.workspace_id);
    assert.equal(claims.sub, row.user_id);
    assert.equal(claims.role, "authenticated");
  }

  // A request that names an identity of its own is refused outright.
  const smuggled = [
    { token: TOKEN, agent_id: ROW.member_id },
    { token: TOKEN, sub: ROW.member_id },
    { token: TOKEN, role: "service_role" },
    { token: TOKEN, trust_tier: "self_hosted" },
    { token: TOKEN, claims: { role: "service_role" } },
  ];
  for (const body of smuggled) {
    const db = stub();
    const res = await handle(post(JSON.stringify(body)), env, db.fn, now);
    assert.equal(res.status, 400);
    assert.equal(db.calls.length, 0);
  }

  // Neither the URL nor a header can add or change a claim.
  const dressed = new Request(
    `${URL_}/functions/v1/agent-session?role=service_role&agent_id=&sub=${ROW.member_id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer someone-else",
        "X-Agent-Id": ROW.member_id,
        "X-Role": "service_role",
      },
      body: JSON.stringify({ token: TOKEN }),
    },
  );
  const db = stub();
  const claims = await claimsOf(await handle(dressed, env, db.fn, now));
  assert.equal(claims.role, "authenticated");
  assert.equal(claims.sub, ROW.user_id);
  assert.equal(claims.agent_id, ROW.agent_id);
  assert.equal(
    new Headers(db.calls[0].init.headers).get("Authorization"),
    `Bearer ${ANON}`,
  );

  // Extra columns in the row are not copied into the identity or the answer.
  const extra = await handle(
    good(),
    env,
    stub(() =>
      Response.json([
        { ...ROW, role: "service_role", is_admin: true, exp: 9999999999 },
      ]),
    ).fn,
    now,
  );
  const extraBody = await extra.json();
  assert.equal(extraBody.role, undefined);
  assert.equal(extraBody.is_admin, undefined);
  const extraClaims = b64urlToJson(extraBody.access_token.split(".")[1]);
  assert.equal(extraClaims.role, "authenticated");
  assert.equal(extraClaims.is_admin, undefined);
  assert.equal(extraClaims.exp, NOW_S + 3600);
});

test("9b. there is no input that yields a token without agent_id", async () => {
  const key = await makeKey();
  const env = envWith(JSON.stringify(key.jwk));
  const requests = [
    () => good(),
    () => post(JSON.stringify({ token: TOKEN, agent_id: null })),
    () => post(JSON.stringify({ token: TOKEN, agent_id: "" })),
    () => post("{}"),
  ];
  let issued = 0;
  for (const answer of [[ROW], ...Object.values(MALFORMED_ROWS)]) {
    for (const request of requests) {
      const res = await handle(
        request(),
        env,
        stub(() => Response.json(answer)).fn,
        now,
      );
      if (res.status !== 200) {
        assert.equal((await res.json()).access_token, undefined);
        continue;
      }
      issued += 1;
      const body = await res.json();
      const claims = b64urlToJson(body.access_token.split(".")[1]);
      assert.equal(claims.agent_id, ROW.agent_id);
      assert.equal(body.agent_id, ROW.agent_id);
      assert.match(claims.agent_id, /^[0-9a-f-]{36}$/);
    }
  }
  // Only the well-formed row with the well-formed request got one.
  assert.equal(issued, 1);
});
