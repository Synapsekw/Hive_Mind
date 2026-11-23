// The invite-email Edge Function's logic, run under node:test. Node loads the
// TypeScript module directly; the database, Supabase Auth and Resend are one
// stub fetch, and every key and address here is made up, so nothing real is
// asked, mailed or printed.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/invite-email/send.ts";

const URL_ = "https://hive.example.supabase.co";
const ANON = "sb_publishable_test_anon_key";
const SECRET = "sb_secret_test_secret_key_0123456789";
const RESEND = "re_test_resend_key_0123456789";
const FROM = "Hive Mind <hive@mail.example.com>";
const SITE = "https://app.example.com";
const BEARER = "eyJhbGciOiJFUzI1NiJ9.owner-session-payload.owner-signature";
const INVITATION = "7b0c1f5e-2a6d-4c3b-9e1f-0a1b2c3d4e5f";
const EMAIL = "invited.person@guest.example.org";
const HASH = "3f9a1c0de5b7a2964d8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8a9b0";
const OTP = "481516";
const SUBJECT = "You have been invited to a hive on Hive Mind";

const RPC = `${URL_}/rest/v1/rpc/invitation_to_email`;
const LINK = `${URL_}/auth/v1/admin/generate_link`;
const MAIL = "https://api.resend.com/emails";
const USER_ID = "99999999-9999-4999-8999-999999999999";
const USER = `${URL_}/auth/v1/admin/users/${USER_ID}`;

const ENV = {
  url: URL_,
  anonKey: ANON,
  secretKey: SECRET,
  resendKey: RESEND,
  from: FROM,
  siteUrl: SITE,
};

const post = (body, headers = { Authorization: `Bearer ${BEARER}` }) =>
  new Request(`${URL_}/functions/v1/invite-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
const good = () => post(JSON.stringify({ invitation: INVITATION }));

// What Supabase Auth answers to generate_link: the user's own fields at the
// top level, beside the link, the code and the token hash.
const linkAnswer = (type, extra = {}) => ({
  id: USER_ID,
  email: EMAIL,
  action_link: `${URL_}/auth/v1/verify?token=${HASH}&type=${type}&redirect_to=${SITE}`,
  email_otp: OTP,
  hashed_token: HASH,
  verification_type: type,
  redirect_to: SITE,
  ...extra,
});

const EXISTS = () =>
  Response.json(
    {
      code: 422,
      error_code: "email_exists",
      msg: "A user with this email address has already been registered",
    },
    { status: 422 },
  );

// A fetch stub that records what it was asked and answers as the three
// services would. Each answer can be replaced; `link` sees the parsed body
// and how many times it has been asked before.
function stub(over = {}) {
  const calls = [];
  const answers = {
    rpc: () => Response.json(EMAIL),
    link: (body) => Response.json(linkAnswer(body.type)),
    user: () => Response.json({ id: USER_ID, email: EMAIL }),
    mail: () => Response.json({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }),
    ...over,
  };
  let links = 0;
  const fn = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === RPC) return answers.rpc();
    if (url === LINK) return answers.link(JSON.parse(init.body), links++);
    if (url.startsWith(`${URL_}/auth/v1/admin/users/`)) return answers.user();
    if (url === MAIL) return answers.mail();
    throw new Error("unexpected address");
  };
  return { fn, calls };
}

const header = (call, name) => new Headers(call.init.headers).get(name);
const bodyOf = (call) => JSON.parse(call.init.body);
const linkFor = (type, hash = HASH, site = SITE) =>
  `${site}/join?token_hash=${encodeURIComponent(hash)}&type=${type}`;

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

const NOT_SENT = "the email could not be sent";
const BAD_REQUEST = "send a JSON body with an invitation";

test("1. an owner's request makes one link and sends one email", async () => {
  const net = stub();
  const res = await handle(good(), ENV, net.fn);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Type"), /^application\/json/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);

  assert.deepEqual(
    net.calls.map((c) => c.url),
    [RPC, LINK, USER, LINK, MAIL],
  );
  const [rpc, link, , again, mail] = net.calls;
  assert.deepEqual(bodyOf(again), { type: "invite", email: EMAIL });
  assert.equal(header(again, "apikey"), SECRET);

  // The database is asked as the caller, with the publishable key.
  assert.equal(rpc.init.method, "POST");
  assert.equal(header(rpc, "apikey"), ANON);
  assert.equal(header(rpc, "Authorization"), `Bearer ${BEARER}`);
  assert.equal(header(rpc, "Content-Type"), "application/json");
  assert.deepEqual(bodyOf(rpc), { p_invitation: INVITATION });

  // Auth is asked with the secret key, for a link it does not send itself.
  assert.equal(link.init.method, "POST");
  assert.equal(header(link, "apikey"), SECRET);
  assert.equal(header(link, "Authorization"), `Bearer ${SECRET}`);
  assert.deepEqual(bodyOf(link), { type: "invite", email: EMAIL });

  // Resend gets exactly these five fields and its own key.
  assert.equal(mail.init.method, "POST");
  assert.equal(header(mail, "Authorization"), `Bearer ${RESEND}`);
  assert.equal(header(mail, "apikey"), null);
  const sent = bodyOf(mail);
  assert.deepEqual(Object.keys(sent).sort(), [
    "from",
    "html",
    "subject",
    "text",
    "to",
  ]);
  assert.equal(sent.from, FROM);
  assert.deepEqual(sent.to, [EMAIL]);
  assert.equal(sent.subject, SUBJECT);
  assert.ok(sent.text.includes(linkFor("invite")));
  assert.ok(sent.html.includes(linkFor("invite").replace(/&/g, "&amp;")));

  // No call follows a redirect, and every call has a time limit.
  for (const call of net.calls) {
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
  }
});

test("2. an address with an account gets a sign-in link, and the answer is the same", async () => {
  const shapes = {
    "error_code in the body": EXISTS,
    "newer body: code and message": () =>
      Response.json(
        {
          code: "email_exists",
          message: "A user with this email address has already been registered",
        },
        { status: 422 },
      ),
    "the error code header alone": () =>
      new Response("{}", {
        status: 422,
        headers: { "x-sb-error-code": "email_exists" },
      }),
    "the message alone": () =>
      Response.json(
        { msg: "A user with this email address has already been registered" },
        { status: 422 },
      ),
    "status 400": () =>
      Response.json(
        { code: 400, error_code: "email_exists", msg: "Email exists" },
        { status: 400 },
      ),
  };

  for (const [name, exists] of Object.entries(shapes)) {
    const net = stub({
      link: (body) =>
        body.type === "invite"
          ? exists()
          : Response.json(linkAnswer("magiclink")),
    });
    const res = await handle(good(), ENV, net.fn);

    assert.equal(res.status, 200, name);
    assert.deepEqual(await res.json(), { ok: true }, name);
    assert.deepEqual(
      net.calls.map((c) => c.url),
      [RPC, LINK, LINK, MAIL],
      name,
    );
    assert.deepEqual(bodyOf(net.calls[1]), { type: "invite", email: EMAIL });
    assert.deepEqual(bodyOf(net.calls[2]), { type: "magiclink", email: EMAIL });
    assert.equal(header(net.calls[2], "apikey"), SECRET);

    const sent = bodyOf(net.calls[3]);
    assert.equal(sent.subject, SUBJECT);
    assert.ok(sent.text.includes(linkFor("magiclink")), name);
    assert.ok(
      sent.html.includes(linkFor("magiclink").replace(/&/g, "&amp;")),
      name,
    );
    assert.ok(!sent.text.includes("type=invite"), name);
  }
});

test("3. the two emails differ only in the link's type", async () => {
  const fresh = stub();
  await handle(good(), ENV, fresh.fn);
  const known = stub({
    link: (body) =>
      body.type === "invite"
        ? EXISTS()
        : Response.json(linkAnswer("magiclink")),
  });
  await handle(good(), ENV, known.fn);

  const a = bodyOf(fresh.calls.at(-1));
  const b = bodyOf(known.calls.at(-1));
  const same = (s) => s.replaceAll("type=magiclink", "type=invite");
  assert.equal(same(b.text), a.text);
  assert.equal(same(b.html), a.html);
  assert.equal(b.subject, a.subject);
});

test("4. the email says what it must and names no hive and no person", async () => {
  const net = stub({
    // Whatever Auth knows about the person stays with Auth.
    link: (body) =>
      Response.json(
        linkAnswer(body.type, {
          user_metadata: { display_name: "Zebedee Quux" },
          invited_at: "2026-11-23T10:00:00Z",
        }),
      ),
  });
  await handle(good(), ENV, net.fn);
  const { text, html } = bodyOf(net.calls.at(-1));

  for (const part of [text, html]) {
    assert.match(part, /sign(s)? you in|after you sign in|signing in/i);
    assert.match(part, /once/i);
    assert.match(part, /limited time/i);
    assert.match(part, /ignore/i);
    assert.ok(!part.includes("Zebedee"));
    assert.ok(!part.includes(INVITATION));
    assert.ok(!part.includes(OTP));
    assert.ok(!part.includes("action_link"));
    assert.ok(!part.includes("/auth/v1/verify"));
    assert.ok(!part.includes(SECRET));
    assert.ok(!part.includes(RESEND));
    assert.ok(!part.includes(BEARER));
  }
  // One link, and it is the app's own Join page.
  assert.equal(text.match(/https?:\/\//g).length, 1);
  assert.equal(html.match(/href="/g).length, 1);
  assert.match(html, /^<!doctype html>/i);
});

test("5. only POST is answered", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]) {
    const net = stub();
    const res = await handle(
      new Request(`${URL_}/functions/v1/invite-email`, {
        method,
        headers: { Authorization: `Bearer ${BEARER}` },
      }),
      ENV,
      net.fn,
    );
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("Allow"), "POST");
    assert.equal(net.calls.length, 0);
  }
});

test("6. a body over 2 KB is refused, declared or not", async () => {
  const big = JSON.stringify({ invitation: INVITATION, pad: "x".repeat(3000) });

  const declared = stub();
  await expectError(
    await handle(post(big), ENV, declared.fn),
    413,
    "request too large",
  );
  assert.equal(declared.calls.length, 0);

  // No Content-Length to go by: the cap is on the bytes read.
  const streamed = stub();
  const req = new Request(`${URL_}/functions/v1/invite-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${BEARER}` },
    body: new ReadableStream({
      start(controller) {
        const chunk = new TextEncoder().encode("x".repeat(1024));
        for (let i = 0; i < 4; i++) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  });
  assert.equal(req.headers.get("content-length"), null);
  await expectError(
    await handle(req, ENV, streamed.fn),
    413,
    "request too large",
  );
  assert.equal(streamed.calls.length, 0);
});

test("7. anything but one invitation id is a bad request", async () => {
  const bad = [
    "",
    "not json",
    `{"invitation":"${INVITATION}"`,
    "null",
    "[]",
    `["${INVITATION}"]`,
    "{}",
    JSON.stringify({ invitation: 7 }),
    JSON.stringify({ invitation: null }),
    JSON.stringify({ invitation: "" }),
    JSON.stringify({ invitation: "not-a-uuid" }),
    JSON.stringify({ invitation: `${INVITATION}x` }),
    JSON.stringify({ invitation: ` ${INVITATION}` }),
    JSON.stringify({ invitation: INVITATION.replace(/-/g, "") }),
    JSON.stringify({ invitation: [INVITATION] }),
    // Nowhere to put an address, a type or a site of the caller's choosing.
    JSON.stringify({ invitation: INVITATION, email: "other@example.com" }),
    JSON.stringify({ invitation: INVITATION, type: "magiclink" }),
    JSON.stringify({ invitation: INVITATION, siteUrl: "https://evil.example" }),
    JSON.stringify({
      invitation: INVITATION,
      redirect_to: "https://evil.example",
    }),
    JSON.stringify({ token: INVITATION }),
  ];
  for (const body of bad) {
    const net = stub();
    await expectError(await handle(post(body), ENV, net.fn), 400, BAD_REQUEST);
    assert.equal(net.calls.length, 0, body);
  }

  // No body at all.
  const net = stub();
  const empty = new Request(`${URL_}/functions/v1/invite-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${BEARER}` },
  });
  await expectError(await handle(empty, ENV, net.fn), 400, BAD_REQUEST);
  assert.equal(net.calls.length, 0);

  // An id in capitals is the same id.
  const upper = stub();
  const res = await handle(
    post(JSON.stringify({ invitation: INVITATION.toUpperCase() })),
    ENV,
    upper.fn,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(bodyOf(upper.calls[0]), { p_invitation: INVITATION });
});

test("8. no bearer, no answer from the database", async () => {
  const headers = [
    {},
    { Authorization: "" },
    { Authorization: "Bearer" },
    { Authorization: "Bearer " },
    { Authorization: `Basic ${BEARER}` },
    { Authorization: BEARER },
    { Authorization: `Bearer ${BEARER} extra` },
    { Authorization: `Bearer ${"a".repeat(9000)}` },
    { Authorization: "Bearer badétoken" },
    { apikey: BEARER },
  ];
  for (const h of headers) {
    const net = stub();
    await expectError(
      await handle(
        post(JSON.stringify({ invitation: INVITATION }), h),
        ENV,
        net.fn,
      ),
      401,
      "sign in",
    );
    assert.equal(net.calls.length, 0, JSON.stringify(h));
  }
});

test("9. a missing or unusable secret is 503 and nothing is asked", async () => {
  const broken = [
    { url: "" },
    { anonKey: "" },
    { secretKey: "" },
    { resendKey: "" },
    { from: "" },
    { siteUrl: "" },
    { secretKey: undefined },
    { resendKey: undefined },
    { from: undefined },
    { siteUrl: undefined },
    // The site address is where the sign-in link points: https and no more.
    { siteUrl: "http://app.example.com" },
    { siteUrl: "app.example.com" },
    { siteUrl: "javascript:alert(1)" },
    { siteUrl: "https://app.example.com/some/path" },
    { siteUrl: "https://app.example.com/?next=/x" },
    { siteUrl: "https://app.example.com/#frag" },
    { siteUrl: "https://user:pass@app.example.com" },
    { siteUrl: "http://localhost.evil.example" },
    { siteUrl: "https://app.example.com\nhttps://evil.example" },
    { siteUrl: " https://app.example.com" },
    // A sender that could carry a second header.
    { from: "Hive Mind <hive@mail.example.com>\r\nBcc: x@evil.example" },
  ];
  for (const change of broken) {
    const net = stub();
    await expectError(
      await handle(good(), { ...ENV, ...change }, net.fn),
      503,
      "email is not set up",
    );
    assert.equal(net.calls.length, 0, JSON.stringify(change));
  }
});

test("10. the site address may end in a slash, and localhost may be plain http", async () => {
  const sites = {
    "https://app.example.com/": "https://app.example.com",
    "https://app.example.com:8443": "https://app.example.com:8443",
    "http://localhost:3000": "http://localhost:3000",
    "http://localhost:3000/": "http://localhost:3000",
    "http://localhost": "http://localhost",
  };
  for (const [siteUrl, site] of Object.entries(sites)) {
    const net = stub();
    const res = await handle(good(), { ...ENV, siteUrl }, net.fn);
    assert.equal(res.status, 200, siteUrl);
    const { text } = bodyOf(net.calls.at(-1));
    assert.ok(text.includes(linkFor("invite", HASH, site)), siteUrl);
    assert.ok(!text.includes("//join"), siteUrl);
  }

  // The project address may end in a slash too.
  const net = stub();
  const res = await handle(good(), { ...ENV, url: `${URL_}/` }, net.fn);
  assert.equal(res.status, 200);
  assert.deepEqual(
    net.calls.map((c) => c.url),
    [RPC, LINK, USER, LINK, MAIL],
  );
});

test("11. the database's refusal is passed on: 403, 429 or 409 for the two limits", async () => {
  const raise =
    (message, status = 400) =>
    () =>
      Response.json({ code: "P0001", message }, { status });
  const cases = [
    [raise("invitation not found"), 403, "not allowed"],
    [raise("only the hive owner can invite members"), 403, "not allowed"],
    [raise("sign in as a person"), 403, "not allowed"],
    [raise("something new"), 403, "not allowed"],
    [() => new Response("not json", { status: 400 }), 403, "not allowed"],
    [raise("permission denied for function", 403), 403, "not allowed"],
    [raise("wait before sending again"), 429, "wait before sending again"],
    [
      raise("too many emails for this invitation"),
      409,
      "too many emails for this invitation",
    ],
    // An expired or unknown session.
    [raise("JWT expired", 401), 401, "sign in"],
  ];
  for (const [rpc, status, message] of cases) {
    const net = stub({ rpc });
    await expectError(await handle(good(), ENV, net.fn), status, message);
    // Neither Auth nor Resend hears of a refused request.
    assert.deepEqual(
      net.calls.map((c) => c.url),
      [RPC],
    );
  }
});

test("12. a database that cannot answer is 502, and no link is made", async () => {
  const cases = {
    thrown: () => {
      throw new Error("connect ECONNREFUSED");
    },
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    404: () => Response.json({ message: "no such function" }, { status: 404 }),
    204: () => new Response(null, { status: 204 }),
    "not json": () => new Response("<html>", { status: 200 }),
    null: () => Response.json(null),
    "a row": () => Response.json([{ email: EMAIL }]),
    "not an address": () => Response.json("nobody"),
    "two addresses": () => Response.json(`${EMAIL}, other@evil.example`),
    "a named address": () => Response.json(`Mallory <${EMAIL}>`),
    "an address with a line break": () =>
      Response.json(`${EMAIL}\r\nBcc: other@evil.example`),
    "a very long address": () =>
      Response.json(`${"a".repeat(400)}@guest.example.org`),
    "255 characters": () => Response.json(`${"a".repeat(243)}@example.org`),
    "two @": () => Response.json("a@b@example.org"),
    "no name": () => Response.json("@example.org"),
    "no domain": () => Response.json("someone@"),
    "a space": () => Response.json("some one@example.org"),
    "a tab": () => Response.json("some\tone@example.org"),
    "a control character": () => Response.json("some\u0007one@example.org"),
    "a comma": () => Response.json("a@example.org,b@example.org"),
    "an angle bracket": () => Response.json("<a@example.org"),
    "a closing angle bracket": () => Response.json("a@example.org>"),
    "a quote": () => Response.json('"a"@example.org'),
  };
  for (const [name, rpc] of Object.entries(cases)) {
    const net = stub({ rpc });
    await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
    assert.deepEqual(
      net.calls.map((c) => c.url),
      [RPC],
      name,
    );
  }
});

test("12b. every address the database accepts and the mail service can take is mailed", async () => {
  const addresses = [
    "owner@intranet",
    "someone@localhost",
    "first.last+tag@sub.example.co.uk",
    "o'brien@example.org",
    "odd;name:(x)[y]\\z@example.org",
    `${"a".repeat(242)}@example.org`,
  ];
  for (const address of addresses) {
    const net = stub({ rpc: () => Response.json(address) });
    const res = await handle(good(), ENV, net.fn);
    assert.equal(res.status, 200, address);
    assert.deepEqual(bodyOf(net.calls[1]), { type: "invite", email: address });
    assert.deepEqual(bodyOf(net.calls.at(-1)).to, [address]);
  }
});

test("13. Auth failing is 502, and no email goes out", async () => {
  const cases = {
    thrown: () => {
      throw new Error("timeout");
    },
    500: () => Response.json({ msg: "boom" }, { status: 500 }),
    401: () => Response.json({ msg: "Invalid API key" }, { status: 401 }),
    "another 422": () =>
      Response.json(
        { code: 422, error_code: "validation_failed", msg: "bad email" },
        { status: 422 },
      ),
    "another 400": () =>
      Response.json({ code: 400, msg: "bad request" }, { status: 400 }),
    "not json": () => new Response("<html>", { status: 200 }),
    "no token": () =>
      Response.json({ ...linkAnswer("invite"), hashed_token: undefined }),
    "an empty token": () =>
      Response.json({ ...linkAnswer("invite"), hashed_token: "" }),
    "a token that is not a string": () =>
      Response.json({ ...linkAnswer("invite"), hashed_token: 12345 }),
    // The Join page takes 20 to 200 URL-safe characters; anything else would
    // be a link that cannot work, or one that carries more than a token.
    "a short token": () =>
      Response.json({ ...linkAnswer("invite"), hashed_token: "abc" }),
    "a token with a second parameter": () =>
      Response.json({
        ...linkAnswer("invite"),
        hashed_token: `${HASH}&type=recovery`,
      }),
    "a token with markup": () =>
      Response.json({
        ...linkAnswer("invite"),
        hashed_token: `${HASH}"><a href="https://evil.example">`,
      }),
    "a very long token": () =>
      Response.json({ ...linkAnswer("invite"), hashed_token: "a".repeat(201) }),
    "a link of another kind": () => Response.json(linkAnswer("signup")),
    "an array": () => Response.json([linkAnswer("invite")]),
  };
  for (const [name, link] of Object.entries(cases)) {
    const net = stub({ link });
    await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
    assert.deepEqual(
      net.calls.map((c) => c.url),
      [RPC, LINK],
      name,
    );
  }

  // The second link failing is the same failure.
  const net = stub({
    link: (body) =>
      body.type === "invite"
        ? EXISTS()
        : Response.json({ msg: "boom" }, { status: 500 }),
  });
  await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
  assert.deepEqual(
    net.calls.map((c) => c.url),
    [RPC, LINK, LINK],
  );

  // "Exists" twice over is not asked a third time.
  const twice = stub({ link: EXISTS });
  await expectError(await handle(good(), ENV, twice.fn), 502, NOT_SENT);
  assert.deepEqual(
    twice.calls.map((c) => c.url),
    [RPC, LINK, LINK],
  );
});

test("14. the token hash is also read from `properties`", async () => {
  const net = stub({
    link: (body) =>
      Response.json({
        user: { id: USER_ID, email: EMAIL },
        properties: {
          action_link: "https://unused.example",
          hashed_token: HASH,
          verification_type: body.type,
        },
      }),
  });
  const res = await handle(good(), ENV, net.fn);
  assert.equal(res.status, 200);
  assert.ok(bodyOf(net.calls.at(-1)).text.includes(linkFor("invite")));

  // A token with every allowed character is put in the link encoded.
  const odd = "pkce_" + "Ab0-_".repeat(8);
  const other = stub({
    link: (body) =>
      Response.json({ ...linkAnswer(body.type), hashed_token: odd }),
  });
  assert.equal((await handle(good(), ENV, other.fn)).status, 200);
  const { text } = bodyOf(other.calls.at(-1));
  assert.ok(
    text.includes(
      `${SITE}/join?token_hash=${encodeURIComponent(odd)}&type=invite`,
    ),
  );
});

test("15. Resend failing is 502", async () => {
  const cases = {
    thrown: () => {
      throw new Error("timeout");
    },
    401: () =>
      Response.json({ message: "API key is invalid" }, { status: 401 }),
    403: () =>
      Response.json({ message: "domain not verified" }, { status: 403 }),
    422: () => Response.json({ message: "invalid from" }, { status: 422 }),
    429: () => Response.json({ message: "rate limit" }, { status: 429 }),
    500: () => new Response("oops", { status: 500 }),
  };
  for (const [name, mail] of Object.entries(cases)) {
    const net = stub({ mail });
    await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
    assert.deepEqual(
      net.calls.map((c) => c.url),
      [RPC, LINK, USER, LINK, MAIL],
      name,
    );
  }
});

test("16. no answer and no log line carries the address, the token hash, the bearer or a key", async () => {
  const secrets = [
    EMAIL,
    EMAIL.split("@")[0],
    "guest.example.org",
    HASH,
    OTP,
    BEARER,
    SECRET,
    RESEND,
    ANON,
    FROM,
    "hive@mail.example.com",
  ];
  const leak = secrets.join(" ");
  const answers = [];

  const lines = await withConsoleSpy(async () => {
    const run = async (req, env, over) => {
      const res = await handle(req, env, stub(over).fn);
      answers.push({ status: res.status, text: await res.text() });
    };

    await run(good(), ENV);
    await run(good(), ENV, {
      link: (body) =>
        body.type === "invite"
          ? EXISTS()
          : Response.json(linkAnswer("magiclink")),
    });

    // Each service's own words, echoing everything, must not be passed on.
    await run(good(), ENV, {
      rpc: () =>
        Response.json({ code: "P0001", message: leak }, { status: 400 }),
    });
    await run(good(), ENV, {
      rpc: () => Response.json({ message: leak }, { status: 500 }),
    });
    await run(good(), ENV, {
      rpc: () => {
        throw new Error(leak);
      },
    });
    await run(good(), ENV, {
      rpc: () => Response.json({ message: leak }, { status: 401 }),
    });
    await run(good(), ENV, {
      rpc: () =>
        Response.json(
          { code: "P0001", message: "wait before sending again" },
          { status: 400 },
        ),
    });
    await run(good(), ENV, { rpc: () => Response.json(`${EMAIL} ${leak}`) });
    await run(good(), ENV, {
      link: () => Response.json({ msg: leak }, { status: 500 }),
    });
    await run(good(), ENV, {
      link: () => {
        throw new Error(leak);
      },
    });
    await run(good(), ENV, {
      link: () =>
        Response.json({ ...linkAnswer("invite"), hashed_token: leak }),
    });
    await run(good(), ENV, {
      link: (body) =>
        body.type === "invite"
          ? EXISTS()
          : Response.json({ msg: leak }, { status: 500 }),
    });
    await run(good(), ENV, {
      mail: () => Response.json({ message: leak }, { status: 422 }),
    });
    await run(good(), ENV, {
      mail: () => {
        throw new Error(leak);
      },
    });
    await run(good(), { ...ENV, resendKey: "" });
    await run(good(), { ...ENV, siteUrl: `https://app.example.com/${HASH}` });
    await run(post(JSON.stringify({ invitation: EMAIL })), ENV);
    await run(
      post(JSON.stringify({ invitation: INVITATION, email: EMAIL })),
      ENV,
    );
    await run(post(`{"invitation":"${BEARER}"`), ENV);
    await run(
      post(JSON.stringify({ invitation: INVITATION, pad: "x".repeat(3000) })),
      ENV,
    );
    await run(post(JSON.stringify({ invitation: INVITATION }), {}), ENV);
    await run(
      post(JSON.stringify({ invitation: INVITATION }), {
        Authorization: `Basic ${BEARER}`,
      }),
      ENV,
    );
    await run(
      new Request(
        `${URL_}/functions/v1/invite-email?email=${EMAIL}&token=${BEARER}`,
        { headers: { Authorization: `Bearer ${BEARER}` } },
      ),
      ENV,
    );
  });

  // Every failure says why, in one line of its own; a success says nothing.
  const failures = answers.filter((a) => a.status !== 200);
  assert.equal(answers.length - failures.length, 2);
  assert.equal(failures.length, 21);
  assert.equal(lines.length, failures.length);

  for (const line of lines) {
    assert.match(line, /^invite-email: [a-z0-9 _()-]+$/i);
    assert.ok(line.length < 120);
    for (const secret of secrets) assert.ok(!line.includes(secret), line);
  }
  for (const { status, text } of answers) {
    for (const secret of secrets) assert.ok(!text.includes(secret), status);
    if (status === 200) assert.equal(text, '{"ok":true}');
    else assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
  }
});

test("17. each key goes to its own service and nowhere else", async () => {
  const runs = [
    {},
    {
      link: (body) =>
        body.type === "invite"
          ? EXISTS()
          : Response.json(linkAnswer("magiclink")),
    },
    { mail: () => new Response("oops", { status: 500 }) },
    { link: () => Response.json({ msg: "boom" }, { status: 500 }) },
  ];
  let seen = 0;
  for (const over of runs) {
    const net = stub(over);
    await handle(good(), ENV, net.fn);
    for (const call of net.calls) {
      seen += 1;
      const everything =
        call.url +
        JSON.stringify([...new Headers(call.init.headers)]) +
        call.init.body;
      const has = (secret) => everything.includes(secret);
      if (call.url === RPC) {
        assert.ok(has(ANON) && has(BEARER));
        assert.ok(!has(SECRET) && !has(RESEND));
      } else if (call.url === LINK || call.url === USER) {
        assert.ok(has(SECRET));
        assert.ok(!has(RESEND) && !has(BEARER) && !has(ANON));
      } else {
        assert.equal(call.url, MAIL);
        assert.ok(has(RESEND));
        assert.ok(!has(SECRET) && !has(BEARER) && !has(ANON));
      }
      // Every address asked is the project's or Resend's, exactly.
      assert.ok([RPC, LINK, USER, MAIL].includes(call.url));
    }
  }
  assert.equal(seen, 5 + 4 + 5 + 2);
});

test("18. nothing in the request but the bearer and the id reaches any service", async () => {
  const net = stub();
  const req = new Request(
    `${URL_}/functions/v1/invite-email?type=magiclink&email=other@evil.example&redirect_to=https://evil.example`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEARER}`,
        apikey: "caller-supplied-key",
        Origin: "https://evil.example",
        "X-Forwarded-Host": "evil.example",
        "x-site-url": "https://evil.example",
      },
      body: JSON.stringify({ invitation: INVITATION }),
    },
  );
  const res = await handle(req, ENV, net.fn);
  assert.equal(res.status, 200);
  for (const call of net.calls) {
    const everything =
      call.url +
      JSON.stringify([...new Headers(call.init.headers)]) +
      call.init.body;
    assert.ok(!everything.includes("evil.example"));
    assert.ok(!everything.includes("caller-supplied-key"));
  }
  assert.deepEqual(bodyOf(net.calls[1]), { type: "invite", email: EMAIL });
});

const PASSWORD = /^[A-Za-z0-9_-]{43}aA1!$/;
const OTHER_HASH = "0a1b2c3d4e5f60718293a4b5c6d7e8f9" + "0a1b2c3d4e5f6071";
const urls = (net) => net.calls.map((c) => c.url);

test("19. a new account's password is replaced before the link is made and mailed", async () => {
  // Setting a password spends the link made before it, so the link that is
  // mailed is the one made after.
  const twoLinks = (body, n) =>
    Response.json(
      linkAnswer(body.type, { hashed_token: n === 0 ? OTHER_HASH : HASH }),
    );
  const passwords = [];
  const lines = await withConsoleSpy(async () => {
    for (let i = 0; i < 2; i++) {
      const net = stub({ link: twoLinks });
      const res = await handle(good(), ENV, net.fn);
      const answered = await res.text();
      assert.equal(res.status, 200);
      assert.deepEqual(urls(net), [RPC, LINK, USER, LINK, MAIL]);

      const set = net.calls[2];
      assert.equal(set.init.method, "PUT");
      assert.equal(header(set, "apikey"), SECRET);
      assert.equal(header(set, "Authorization"), `Bearer ${SECRET}`);
      assert.equal(header(set, "Content-Type"), "application/json");
      assert.equal(set.init.redirect, "error");
      assert.ok(set.init.signal instanceof AbortSignal);
      assert.deepEqual(Object.keys(bodyOf(set)), ["password"]);
      const { password } = bodyOf(set);
      assert.match(password, PASSWORD);
      passwords.push(password);

      // The password goes to Auth and nowhere else.
      const mail = net.calls[4].init.body;
      assert.ok(!mail.includes(password));
      assert.ok(!answered.includes(password));
      for (const i of [0, 1, 3]) {
        assert.ok(!net.calls[i].init.body.includes(password));
      }
      // The mailed link is the second one.
      assert.ok(bodyOf(net.calls[4]).text.includes(linkFor("invite")));
      assert.ok(!mail.includes(OTHER_HASH));
    }
  });
  assert.notEqual(passwords[0], passwords[1]);
  assert.equal(lines.length, 0);
});

test("20. a confirmed person's password is never touched", async () => {
  const net = stub({
    link: (body) =>
      body.type === "invite"
        ? EXISTS()
        : Response.json(linkAnswer("magiclink")),
  });
  const res = await handle(good(), ENV, net.fn);
  assert.equal(res.status, 200);
  assert.deepEqual(urls(net), [RPC, LINK, LINK, MAIL]);
  for (const call of net.calls) {
    assert.notEqual(call.init.method, "PUT");
    assert.ok(!call.url.includes("/admin/users"));
    assert.ok(!call.init.body.includes("password"));
  }
});

test("21. no usable account id, or a password that cannot be set, is 502 with no email", async () => {
  // Without an id nothing is changed and nothing is sent.
  const ids = {
    missing: undefined,
    empty: "",
    "not a uuid": "42",
    "a path": `${USER_ID}/factors`,
    "a path upwards": "../../rest/v1/rpc/x",
    "a number": 7,
  };
  for (const [name, id] of Object.entries(ids)) {
    const net = stub({
      link: (body) => Response.json(linkAnswer(body.type, { id })),
    });
    await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
    assert.deepEqual(urls(net), [RPC, LINK], name);
  }

  const failures = {
    thrown: () => {
      throw new Error("timeout");
    },
    500: () => Response.json({ msg: "boom" }, { status: 500 }),
    404: () => Response.json({ msg: "User not found" }, { status: 404 }),
    422: () =>
      Response.json(
        { code: 422, error_code: "weak_password", msg: "too weak" },
        { status: 422 },
      ),
    401: () => Response.json({ msg: "Invalid API key" }, { status: 401 }),
  };
  const passwords = [];
  const lines = await withConsoleSpy(async () => {
    for (const [name, user] of Object.entries(failures)) {
      const net = stub({ user });
      await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
      assert.deepEqual(urls(net), [RPC, LINK, USER], name);
      passwords.push(bodyOf(net.calls[2]).password);
    }
  });
  assert.equal(lines.length, Object.keys(failures).length);
  for (const line of lines) {
    assert.match(line, /^invite-email: [a-z0-9 _()-]+$/i);
    for (const password of passwords) assert.ok(!line.includes(password));
  }

  // The link made after the password must be usable and for the same account.
  const second = {
    500: () => Response.json({ msg: "boom" }, { status: 500 }),
    "confirmed meanwhile": EXISTS,
    "another account": () =>
      Response.json(
        linkAnswer("invite", { id: "88888888-8888-4888-8888-888888888888" }),
      ),
    "no token": () =>
      Response.json(linkAnswer("invite", { hashed_token: undefined })),
    "another kind": () => Response.json(linkAnswer("signup")),
  };
  for (const [name, later] of Object.entries(second)) {
    const net = stub({
      link: (body, n) =>
        n === 0 ? Response.json(linkAnswer(body.type)) : later(),
    });
    await expectError(await handle(good(), ENV, net.fn), 502, NOT_SENT);
    assert.deepEqual(urls(net), [RPC, LINK, USER, LINK], name);
  }
});

test("22. every call is given five seconds", async () => {
  const limits = [];
  const real = AbortSignal.timeout;
  const spy = mock.method(AbortSignal, "timeout", (ms) => {
    limits.push(ms);
    return real.call(AbortSignal, ms);
  });
  try {
    await handle(good(), ENV, stub().fn);
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual(limits, [5000, 5000, 5000, 5000, 5000]);
});
