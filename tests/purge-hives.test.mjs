// The purge-hives Edge Function's logic, run under node:test. Node loads the
// TypeScript module directly; the database and Storage are one stub fetch, and
// every key, secret, id and path here is made up, so nothing real is asked,
// removed or printed.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/purge-hives/purge.ts";

const URL_ = "https://hive.example.supabase.co";
const KEY = "sb_secret_test_service_key_0123456789";
const SECRET =
  "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const ENV = { url: URL_, serviceKey: KEY, purgeSecret: SECRET };

const HIVE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HIVE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HIVE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HIVE_NAME = "Quux Zebedee Partners";

const RPC = `${URL_}/rest/v1/rpc`;
const DUE = `${RPC}/hives_due_for_purge`;
const BEGIN = `${RPC}/begin_hive_purge`;
const LIST = `${RPC}/hive_object_paths`;
const PURGE = `${RPC}/purge_hive`;
const ORPHANS = `${RPC}/sync_orphan_paths`;
const ORPHANS_CHECK = `${RPC}/sync_orphans_check`;
const ORPHANS_DONE = `${RPC}/sync_orphans_removed`;
const STORAGE = `${URL_}/storage/v1/object/files`;

const request = (init = {}, query = "") =>
  new Request(`${URL_}/functions/v1/purge-hives${query}`, {
    method: "POST",
    ...init,
  });
const good = (extra = {}) =>
  request({ headers: { "x-purge-secret": SECRET, ...extra } });

// Object names as the app writes them: member/workspace/name. Zero-padded, so
// their order as text is their order by number.
const pathsOf = (hive, count) =>
  Array.from(
    { length: count },
    (_, i) =>
      `member-of-${hive.slice(0, 4)}/workspace/secret plan ${String(i).padStart(5, "0")}.pdf`,
  );

// A fetch stub that answers as the database and Storage would for the hives it
// is given (`{ id: [object names] }`), and records every call. An object that
// was removed is gone from the next listing, as in the real bucket. `maxRows`
// is the server's own cap on a page; `steps` is how many times purge_hive
// answers false before it answers true; `partial` is a Storage that answers
// 200 to every removal but removes only the first name it was given. Each
// answer can be replaced; `defaults` are the ones that were, and `drop` takes
// names out of the bucket as a removal does.
function stub(
  hives = {},
  over = {},
  { maxRows = 1000, steps = 0, partial = false } = {},
) {
  const calls = [];
  const removed = [];
  const begun = [];
  const purged = [];
  const objects = Object.fromEntries(
    Object.entries(hives).map(([id, names]) => [id, new Set(names)]),
  );
  const drop = (names) => {
    removed.push(...names);
    for (const set of Object.values(objects)) {
      for (const name of names) set.delete(name);
    }
  };
  const asked = {};
  const defaults = {
    due: () => Response.json(Object.keys(hives).map((id) => ({ id }))),
    begin: (body) => {
      begun.push(body.p_hive);
      return new Response(null, { status: 204 });
    },
    list: (body) => {
      const limit = Math.min(body.p_limit, maxRows);
      const page = [...(objects[body.p_hive] ?? [])]
        .sort()
        .filter((name) => body.p_after === null || name > body.p_after)
        .slice(0, limit);
      return Response.json(page.map((name) => ({ name })));
    },
    remove: (body) => {
      const gone = partial ? body.prefixes.slice(0, 1) : body.prefixes;
      drop(gone);
      return Response.json(gone.map((name) => ({ name })));
    },
    purge: (body) => {
      asked[body.p_hive] = (asked[body.p_hive] ?? 0) + 1;
      if (asked[body.p_hive] <= steps) return Response.json(false);
      purged.push(body.p_hive);
      return Response.json(true);
    },
    // A `setof text` function answers a JSON array of strings.
    orphans: () => Response.json([]),
    // By default every listed path is still an orphan.
    orphansCheck: (body) => Response.json(body.p_paths),
    orphansDone: (body) => Response.json(body.p_paths.length),
  };
  const answers = { ...defaults, ...over };
  const fn = async (input, init) => {
    const url = new URL(String(input));
    const where = url.origin + url.pathname;
    const call = { url: String(input), where, init };
    calls.push(call);
    // No call carries anything in its address beyond the path.
    assert.equal(url.search, "");
    const body = JSON.parse(init.body);
    if (where === DUE) return answers.due();
    if (where === BEGIN) return answers.begin(body, call);
    if (where === LIST) return answers.list(body, call);
    if (where === STORAGE) return answers.remove(body, call);
    if (where === PURGE) return answers.purge(body, call);
    if (where === ORPHANS) return answers.orphans(body, call);
    if (where === ORPHANS_CHECK) return answers.orphansCheck(body, call);
    if (where === ORPHANS_DONE) return answers.orphansDone(body, call);
    throw new Error("unexpected address");
  };
  const at = (where) => calls.filter((c) => c.where === where);
  // The hives' calls in order; the orphan pass that closes every run is left
  // out unless asked for.
  const order = (all = false) =>
    calls.map((c) => c.where).filter((w) => all || w !== ORPHANS);
  // The pages asked for from the start: the first of a hive, and each one that
  // checks nothing is left.
  const fromStart = (hive) =>
    at(LIST).filter((c) => {
      const body = JSON.parse(c.init.body);
      return body.p_hive === hive && body.p_after === null;
    }).length;
  return {
    fn,
    calls,
    removed,
    begun,
    purged,
    at,
    order,
    drop,
    defaults,
    fromStart,
  };
}

const header = (call, name) => new Headers(call.init.headers).get(name);
const bodyOf = (call) => JSON.parse(call.init.body);

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

async function expectError(res, status) {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
}

async function expectDone(res, purged, failed, orphans = 0) {
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    purged,
    failed,
    orphans,
  });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Type"), /^application\/json/);
}

test("1. only POST is answered", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]) {
    const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 3) });
    const res = await handle(
      request({ method, headers: { "x-purge-secret": SECRET } }),
      ENV,
      net.fn,
    );
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("Allow"), "POST");
    assert.equal(net.calls.length, 0);
  }
});

test("2. a missing or empty secret, address or key is 503, with or without the header", async () => {
  const broken = [
    { purgeSecret: undefined },
    { purgeSecret: "" },
    { url: "" },
    { serviceKey: undefined },
    { serviceKey: "" },
  ];
  for (const change of broken) {
    // An empty header must never match an empty secret.
    for (const headers of [
      { "x-purge-secret": SECRET },
      { "x-purge-secret": "" },
      {},
    ]) {
      const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 3) });
      const res = await handle(
        request({ headers }),
        { ...ENV, ...change },
        net.fn,
      );
      await expectError(res, 503);
      assert.equal(net.calls.length, 0, JSON.stringify(change));
    }
  }
});

test("3. no header, a wrong one or one of another length is 401, and nothing is fetched", async () => {
  const wrong = [
    {},
    { "x-purge-secret": "" },
    { "x-purge-secret": SECRET.replace(/.$/, "1") },
    { "x-purge-secret": SECRET.replace(/^./, "1") },
    { "x-purge-secret": SECRET.slice(0, -1) },
    { "x-purge-secret": `${SECRET}0` },
    { "x-purge-secret": SECRET.slice(0, 8) },
    { "x-purge-secret": SECRET.toUpperCase() },
    { "x-purge-secret": ` ${SECRET}x` },
    { "x-purge-secret": "x".repeat(5000) },
    // The secret anywhere else is not the secret.
    { Authorization: `Bearer ${SECRET}` },
    { apikey: SECRET },
    { "x-purge-secret": KEY },
  ];
  for (const headers of wrong) {
    const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 3) });
    await expectError(await handle(request({ headers }), ENV, net.fn), 401);
    assert.equal(net.calls.length, 0, JSON.stringify(headers));
  }

  // Not in the address or the body either.
  const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 3) });
  const res = await handle(
    request(
      { body: JSON.stringify({ "x-purge-secret": SECRET }) },
      `?x-purge-secret=${SECRET}`,
    ),
    ENV,
    net.fn,
  );
  await expectError(res, 401);
  assert.equal(net.calls.length, 0);
});

test("4. the secret is compared whole, never cut short at the first difference", async () => {
  // Both sides are hashed before they are compared, so what is compared has
  // one length whatever was sent.
  const digests = [];
  const real = crypto.subtle.digest;
  const spy = mock.method(crypto.subtle, "digest", (algorithm, data) => {
    digests.push(data.byteLength);
    return real.call(crypto.subtle, algorithm, data);
  });
  try {
    for (const sent of ["", "x", SECRET.slice(0, 8), "y".repeat(300)]) {
      digests.length = 0;
      const res = await handle(
        request({ headers: { "x-purge-secret": sent } }),
        ENV,
        stub().fn,
      );
      assert.equal(res.status, 401);
      assert.deepEqual(
        [...digests].sort((a, b) => a - b),
        [sent.length, SECRET.length].sort((a, b) => a - b),
      );
    }
  } finally {
    spy.mock.restore();
  }
});

test("5. no hives due gives purged 0", async () => {
  const net = stub({});
  await expectDone(await handle(good(), ENV, net.fn), 0, 0);
  assert.deepEqual(net.order(), [DUE]);
  const [due] = net.calls;
  assert.equal(due.init.method, "POST");
  assert.equal(header(due, "apikey"), KEY);
  assert.equal(header(due, "Authorization"), `Bearer ${KEY}`);
  assert.equal(header(due, "Content-Type"), "application/json");
  assert.deepEqual(bodyOf(due), {});
});

test("5b. objects the vault sync left behind are removed, then forgotten", async () => {
  const path = "m/w/vault/x/a.pdf";
  const net = stub({}, { orphans: () => Response.json([path]) });
  await expectDone(await handle(good(), ENV, net.fn), 0, 0, 1);
  assert.deepEqual(net.order(true), [
    DUE,
    ORPHANS,
    ORPHANS_CHECK,
    STORAGE,
    ORPHANS_DONE,
  ]);
  assert.deepEqual(bodyOf(net.at(STORAGE)[0]), { prefixes: [path] });
  assert.equal(net.at(STORAGE)[0].init.method, "DELETE");
  assert.deepEqual(bodyOf(net.at(ORPHANS_DONE)[0]), { p_paths: [path] });
  assert.deepEqual(bodyOf(net.at(ORPHANS)[0]), { p_limit: 1000 });
});

test("5d. only the paths the check still answers are deleted and forgotten", async () => {
  const keep = "m/w/vault/x/restored.pdf";
  const gone = "m/w/vault/x/a.pdf";
  const net = stub(
    {},
    {
      orphans: () => Response.json([keep, gone]),
      orphansCheck: () => Response.json([gone]),
    },
  );
  await expectDone(await handle(good(), ENV, net.fn), 0, 0, 1);
  assert.deepEqual(bodyOf(net.at(ORPHANS_CHECK)[0]), { p_paths: [keep, gone] });
  assert.deepEqual(bodyOf(net.at(STORAGE)[0]), { prefixes: [gone] });
  assert.deepEqual(bodyOf(net.at(ORPHANS_DONE)[0]), { p_paths: [gone] });
  // Nothing still orphaned: nothing deleted.
  const none = stub(
    {},
    {
      orphans: () => Response.json([keep]),
      orphansCheck: () => Response.json([]),
    },
  );
  await expectDone(await handle(good(), ENV, none.fn), 0, 0, 0);
  assert.equal(none.at(STORAGE).length, 0);
});

test("5c. orphans failing never fails the run or forgets what was not removed", async () => {
  const path = "m/w/vault/x/a.pdf";
  const cases = {
    "list refused": { orphans: () => new Response("x", { status: 500 }) },
    "list unreachable": {
      orphans: () => {
        throw new Error("down");
      },
    },
    "list not an array": { orphans: () => Response.json({ a: 1 }) },
  };
  for (const [name, over] of Object.entries(cases)) {
    const net = stub({}, over);
    await withConsoleSpy(async () =>
      expectDone(await handle(good(), ENV, net.fn), 0, 0, 0),
    );
    assert.equal(net.at(STORAGE).length, 0, name);
  }
  const net = stub(
    {},
    {
      orphans: () => Response.json([path]),
      remove: () => new Response("x", { status: 500 }),
    },
  );
  await withConsoleSpy(async () =>
    expectDone(await handle(good(), ENV, net.fn), 0, 0, 0),
  );
  assert.equal(net.at(ORPHANS_DONE).length, 0);
});

test("6. a hive with 250 objects: begin, then list and remove, one list to confirm, then purge_hive", async () => {
  const paths = pathsOf(HIVE_A, 250);
  const net = stub({ [HIVE_A]: paths });
  await expectDone(await handle(good(), ENV, net.fn), 1, 0);

  // The point of no return comes first: nothing is listed or removed before
  // the database has closed the door on cancelling.
  assert.deepEqual(net.order(), [
    DUE,
    BEGIN,
    LIST,
    STORAGE,
    STORAGE,
    STORAGE,
    LIST,
    LIST,
    PURGE,
  ]);
  assert.deepEqual(bodyOf(net.at(BEGIN)[0]), { p_hive: HIVE_A });

  // The pages: this hive only, 1000 at most, each after the last name seen;
  // then exactly one more from the start, which must be empty.
  const sorted = [...paths].sort();
  assert.deepEqual(net.at(LIST).map(bodyOf), [
    { p_hive: HIVE_A, p_after: null, p_limit: 1000 },
    { p_hive: HIVE_A, p_after: sorted[249], p_limit: 1000 },
    { p_hive: HIVE_A, p_after: null, p_limit: 1000 },
  ]);
  assert.equal(net.fromStart(HIVE_A), 2);

  // The removals: 100, 100 and 50, from the bucket "files".
  assert.deepEqual(
    net.at(STORAGE).map((c) => bodyOf(c).prefixes.length),
    [100, 100, 50],
  );
  for (const call of net.at(STORAGE)) {
    assert.equal(call.init.method, "DELETE");
    assert.deepEqual(Object.keys(bodyOf(call)), ["prefixes"]);
  }
  assert.deepEqual(net.removed, sorted);

  assert.deepEqual(bodyOf(net.at(PURGE)[0]), { p_hive: HIVE_A });

  // Every call carries the service key, follows no redirect, has a time limit.
  for (const call of net.calls) {
    if (call.where !== STORAGE) assert.equal(call.init.method, "POST");
    assert.equal(header(call, "apikey"), KEY);
    assert.equal(header(call, "Authorization"), `Bearer ${KEY}`);
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.ok(call.url.startsWith(`${URL_}/`));
  }
});

test("7. a hive with no objects is purged with no removal", async () => {
  const net = stub({ [HIVE_A]: [] });
  await expectDone(await handle(good(), ENV, net.fn), 1, 0);
  // The first page being empty is itself the proof that nothing is left.
  assert.deepEqual(net.order(), [DUE, BEGIN, LIST, PURGE]);
  assert.deepEqual(net.purged, [HIVE_A]);
});

test("8. begin_hive_purge failing: nothing is listed, removed or purged, and the next hive is handled", async () => {
  const failures = {
    "not due": () =>
      Response.json(
        { code: "P0001", message: "this hive is not due" },
        { status: 400 },
      ),
    "not found": () =>
      Response.json(
        { code: "P0001", message: "hive not found" },
        { status: 400 },
      ),
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    thrown: () => {
      throw new Error("timeout");
    },
  };
  for (const [name, fail] of Object.entries(failures)) {
    const net = stub(
      { [HIVE_A]: pathsOf(HIVE_A, 5), [HIVE_B]: pathsOf(HIVE_B, 5) },
      {
        begin: (body) =>
          body.p_hive === HIVE_A ? fail() : new Response(null, { status: 204 }),
      },
    );
    await expectDone(await handle(good(), ENV, net.fn), 1, 1);
    assert.deepEqual(
      net.order(),
      [DUE, BEGIN, BEGIN, LIST, STORAGE, LIST, LIST, PURGE],
      name,
    );
    // Everything after the refused begin is about the other hive.
    for (const call of net.calls.slice(2)) {
      assert.ok(!call.init.body.includes(HIVE_A), name);
      assert.ok(!call.init.body.includes("member-of-aaaa"), name);
    }
    assert.deepEqual(net.purged, [HIVE_B], name);
  }
});

test("9. 2001 objects are read in three pages, each after the last name of the one before, every name removed once", async () => {
  const paths = pathsOf(HIVE_A, 2001);
  const net = stub({ [HIVE_A]: paths });
  await expectDone(await handle(good(), ENV, net.fn), 1, 0);

  // Three pages with objects, the empty one that ends them, and the one from
  // the start that confirms nothing is left.
  const sorted = [...paths].sort();
  assert.deepEqual(
    net.at(LIST).map((c) => bodyOf(c).p_after),
    [null, sorted[999], sorted[1999], sorted[2000], null],
  );
  for (const c of net.at(LIST)) assert.equal(bodyOf(c).p_hive, HIVE_A);

  // Every name removed once, none skipped at a page's edge, none twice.
  assert.equal(net.at(STORAGE).length, 21);
  assert.deepEqual(net.removed, sorted);
  assert.equal(new Set(net.removed).size, 2001);
  assert.deepEqual(net.purged, [HIVE_A]);
  // begin is before everything of the hive, purge_hive after everything.
  assert.equal(net.order()[1], BEGIN);
  assert.equal(net.order().at(-1), PURGE);
  assert.equal(net.at(PURGE).length, 1);
});

test("10. a server that gives smaller pages than asked for loses no object", async () => {
  // A short page is not the end: only an empty one is.
  const paths = pathsOf(HIVE_A, 250);
  const net = stub({ [HIVE_A]: paths }, {}, { maxRows: 100 });
  await expectDone(await handle(good(), ENV, net.fn), 1, 0);
  assert.equal(net.at(LIST).length, 5);
  assert.deepEqual(net.removed, [...paths].sort());
  assert.deepEqual(net.purged, [HIVE_A]);
});

test("11. a name with reserved characters is passed on whole", async () => {
  const odd = [
    "m/w/a&b=c, (d).txt",
    "m/w/50% #1?.txt",
    "m/w/ünï cödé +plus.txt",
    'm/w/"quoted" \\ back.txt',
  ];
  // Pages of one, so each odd name is used as the place to start after.
  const net = stub({ [HIVE_A]: odd }, {}, { maxRows: 1 });
  await expectDone(await handle(good(), ENV, net.fn), 1, 0);
  assert.deepEqual(net.removed, [...odd].sort());
  assert.equal(net.at(LIST).length, 6);
});

test("12. a storage failure after begin leaves purge_hive uncalled, and the next hive is still handled", async () => {
  const failures = {
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    403: () => Response.json({ message: "denied" }, { status: 403 }),
    thrown: () => {
      throw new Error("timeout");
    },
  };
  for (const [name, fail] of Object.entries(failures)) {
    let removals = 0;
    const net = stub(
      { [HIVE_A]: pathsOf(HIVE_A, 250), [HIVE_B]: pathsOf(HIVE_B, 20) },
      {
        // The second batch of the first hive fails.
        remove: (body) => {
          removals += 1;
          if (removals === 2) return fail();
          net.drop(body.prefixes);
          return Response.json([]);
        },
      },
    );
    await expectDone(await handle(good(), ENV, net.fn), 1, 1);
    assert.deepEqual(net.begun, [HIVE_A, HIVE_B], name);
    assert.deepEqual(
      net.at(PURGE).map((c) => bodyOf(c).p_hive),
      [HIVE_B],
      name,
    );
    // Nothing more is listed or removed for a hive once a removal failed.
    assert.equal(net.at(STORAGE).length, 3, name);
    assert.equal(net.removed.length, 120, name);
    assert.equal(
      net.at(LIST).filter((c) => bodyOf(c).p_hive === HIVE_A).length,
      1,
      name,
    );
  }
});

test("13. a page that cannot be read fails the hive: nothing more removed, not purged", async () => {
  const failures = {
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    thrown: () => {
      throw new Error("timeout");
    },
    "not json": () => new Response("<html>", { status: 200 }),
    "not a list": () => Response.json({ name: "a/b/c" }),
    "a row without a name": () => Response.json([{ id: 7 }]),
    "an empty name": () => Response.json([{ name: "" }]),
    "a name that is not text": () => Response.json([{ name: 7 }]),
    "a bare string": () => Response.json(["a/b/c"]),
  };
  for (const [name, fail] of Object.entries(failures)) {
    const net = stub(
      { [HIVE_A]: pathsOf(HIVE_A, 5), [HIVE_B]: pathsOf(HIVE_B, 5) },
      {
        list: (body) =>
          body.p_hive === HIVE_A ? fail() : net.defaults.list(body),
      },
    );
    await expectDone(await handle(good(), ENV, net.fn), 1, 1);
    assert.deepEqual(net.purged, [HIVE_B], name);
    assert.equal(net.removed.length, 5, name);
  }

  // A second page failing, after the first was removed, is the same.
  const net = stub(
    { [HIVE_A]: pathsOf(HIVE_A, 1500) },
    {
      list: (body) =>
        body.p_after === null
          ? Response.json(pathsOf(HIVE_A, 1000).map((n) => ({ name: n })))
          : Response.json({ message: "boom" }, { status: 500 }),
    },
  );
  await expectDone(await handle(good(), ENV, net.fn), 0, 1);
  assert.equal(net.removed.length, 1000);
  assert.equal(net.at(PURGE).length, 0);
});

test("14. an object list that does not advance fails the hive instead of spinning", async () => {
  const page = pathsOf(HIVE_A, 3).map((name) => ({ name }));
  const stuck = {
    // The same page whatever p_after says, and Storage removing nothing.
    "the same page again": () => Response.json(page),
    "only the name it was told to start after": (body) =>
      Response.json(body.p_after === null ? page : [{ name: body.p_after }]),
    "a page that holds the name to start after": (body) =>
      Response.json(
        body.p_after === null
          ? page
          : [{ name: "member-of-aaaa/workspace/zz.pdf" }, page[2]],
      ),
  };
  for (const [name, list] of Object.entries(stuck)) {
    const net = stub(
      { [HIVE_A]: [], [HIVE_B]: [] },
      {
        list: (body) =>
          body.p_hive === HIVE_A ? list(body) : Response.json([]),
        remove: () => Response.json([]),
      },
    );
    await expectDone(await handle(good(), ENV, net.fn), 1, 1);
    assert.equal(
      net.at(LIST).filter((c) => bodyOf(c).p_hive === HIVE_A).length,
      2,
      name,
    );
    assert.equal(net.at(STORAGE).length, 1, name);
    assert.deepEqual(net.purged, [HIVE_B], name);
  }

  // A list that never ends, each page new and in order, is cut off too.
  let n = 0;
  const endless = stub(
    { [HIVE_A]: [] },
    {
      list: () =>
        Response.json([{ name: `m/w/${String(n++).padStart(9, "0")}` }]),
    },
  );
  await expectDone(await handle(good(), ENV, endless.fn), 0, 1);
  assert.ok(endless.at(LIST).length <= 1000);
  assert.equal(endless.at(PURGE).length, 0);
});

test("15. purge_hive answering false is asked again until it answers true", async () => {
  const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 2) }, {}, { steps: 2 });
  await expectDone(await handle(good(), ENV, net.fn), 1, 0);
  assert.deepEqual(net.order(), [
    DUE,
    BEGIN,
    LIST,
    STORAGE,
    LIST,
    LIST,
    PURGE,
    PURGE,
    PURGE,
  ]);
  for (const call of net.at(PURGE)) {
    assert.deepEqual(bodyOf(call), { p_hive: HIVE_A });
  }
});

test("16. purge_hive still answering false at the step cap: the hive continues next run, it has not failed", async () => {
  const net = stub(
    { [HIVE_A]: [], [HIVE_B]: [] },
    {
      purge: (body) => {
        if (body.p_hive === HIVE_A) return Response.json(false);
        net.purged.push(body.p_hive);
        return Response.json(true);
      },
    },
  );
  const lines = await withConsoleSpy(async () => {
    // Every call succeeded: neither purged nor failed.
    await expectDone(await handle(good(), ENV, net.fn), 1, 0);
  });
  assert.equal(
    net.at(PURGE).filter((c) => bodyOf(c).p_hive === HIVE_A).length,
    500,
  );
  // The next hive is still handled in the same run.
  assert.deepEqual(net.purged, [HIVE_B]);
  assert.ok(
    lines.some((l) => l.includes(HIVE_A) && l.includes("continues")),
    lines.join("\n"),
  );
  assert.ok(lines.some((l) => l.includes("continuing 1")));

  // A step that fails after many that answered false is a failure.
  let n = 0;
  const broken = stub(
    { [HIVE_A]: [] },
    {
      purge: () =>
        ++n < 40
          ? Response.json(false)
          : Response.json({ message: "boom" }, { status: 500 }),
    },
  );
  await expectDone(await handle(good(), ENV, broken.fn), 0, 1);
  assert.equal(broken.at(PURGE).length, 40);
});

test("17. a purge_hive failure, or an answer that is neither true nor false, is counted as failed", async () => {
  const failures = {
    "not due": () =>
      Response.json(
        { code: "P0001", message: "this hive is not due" },
        { status: 400 },
      ),
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    thrown: () => {
      throw new Error("timeout");
    },
    "no content": () => new Response(null, { status: 204 }),
    null: () => Response.json(null),
    "the word true": () => Response.json("true"),
    one: () => Response.json(1),
    "a row": () => Response.json([{ purge_hive: true }]),
    "not json": () => new Response("<html>", { status: 200 }),
  };
  for (const [name, fail] of Object.entries(failures)) {
    const net = stub(
      { [HIVE_A]: pathsOf(HIVE_A, 2), [HIVE_B]: [], [HIVE_C]: [] },
      {
        purge: (body) => {
          if (body.p_hive === HIVE_B) return fail();
          net.purged.push(body.p_hive);
          return Response.json(true);
        },
      },
    );
    await expectDone(await handle(good(), ENV, net.fn), 2, 1);
    assert.deepEqual(net.purged, [HIVE_A, HIVE_C], name);
    // Asked once: a failure is not retried within the run.
    assert.equal(
      net.at(PURGE).filter((c) => bodyOf(c).p_hive === HIVE_B).length,
      1,
      name,
    );
  }
});

test("18. the due list failing is 502, and nothing is begun", async () => {
  const failures = {
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    401: () => Response.json({ message: "Invalid API key" }, { status: 401 }),
    thrown: () => {
      throw new Error("connect ECONNREFUSED");
    },
    "not json": () => new Response("<html>", { status: 200 }),
    "not a list": () => Response.json({ id: HIVE_A }),
  };
  for (const [name, due] of Object.entries(failures)) {
    const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 3) }, { due });
    await expectError(await handle(good(), ENV, net.fn), 502);
    assert.deepEqual(net.order(), [DUE], name);
  }
});

test("19. an id that is not a uuid is never sent on, and at most 20 hives are handled", async () => {
  const net = stub(
    { [HIVE_A]: [] },
    {
      due: () =>
        Response.json([
          { id: "../../auth/v1/admin/users" },
          { id: `${HIVE_B}&select=*` },
          { id: 7 },
          { name: HIVE_NAME },
          "x",
          null,
          { id: HIVE_A.toUpperCase() },
        ]),
    },
  );
  await expectDone(await handle(good(), ENV, net.fn), 1, 6);
  assert.deepEqual(net.begun, [HIVE_A]);
  assert.deepEqual(net.purged, [HIVE_A]);
  for (const call of net.calls) {
    assert.ok(!call.url.includes("auth/v1"));
    assert.ok(!call.init.body.includes("auth/v1"));
    assert.ok(!call.init.body.includes("select"));
  }

  // The database gives 20 at most; more than that is not taken.
  const many = Object.fromEntries(
    Array.from({ length: 25 }, (_, i) => [
      `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
      [],
    ]),
  );
  const big = stub(many);
  await expectDone(await handle(good(), ENV, big.fn), 20, 0);
  assert.equal(big.begun.length, 20);
  assert.equal(big.purged.length, 20);
});

test("20. the body is ignored, whatever it holds", async () => {
  const bodies = [
    undefined,
    "",
    "not json",
    JSON.stringify({ p_hive: HIVE_C, hives: [HIVE_C], limit: 9999 }),
    JSON.stringify([HIVE_C]),
    "x".repeat(100_000),
  ];
  for (const body of bodies) {
    const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 2) });
    const res = await handle(
      request({ headers: { "x-purge-secret": SECRET }, body }),
      ENV,
      net.fn,
    );
    await expectDone(res, 1, 0);
    assert.deepEqual(net.purged, [HIVE_A]);
    for (const call of net.calls) {
      assert.ok(!call.url.includes(HIVE_C));
      assert.ok(!call.init.body.includes(HIVE_C));
    }
  }

  // Nothing else in the request reaches a call either.
  const net = stub({ [HIVE_A]: [] });
  const res = await handle(
    request(
      {
        headers: {
          "x-purge-secret": SECRET,
          apikey: "caller-supplied-key",
          Authorization: "Bearer caller-supplied-key",
          "x-forwarded-host": "evil.example",
        },
      },
      `?p_hive=${HIVE_C}&url=https://evil.example`,
    ),
    ENV,
    net.fn,
  );
  await expectDone(res, 1, 0);
  for (const call of net.calls) {
    const everything =
      call.url +
      JSON.stringify([...new Headers(call.init.headers)]) +
      call.init.body;
    assert.ok(!everything.includes("evil.example"));
    assert.ok(!everything.includes("caller-supplied-key"));
    assert.ok(!everything.includes(HIVE_C));
    // The purge secret is for the caller to show, never passed on.
    assert.ok(!everything.includes(SECRET));
  }
});

test("21. no answer and no log line carries a name, a path, the secret or the key", async () => {
  const pathA = pathsOf(HIVE_A, 3);
  const secrets = [
    HIVE_NAME,
    "Zebedee",
    SECRET,
    KEY,
    ...pathA,
    "secret plan",
    "member-of-",
    "workspace",
  ];
  const leak = secrets.join(" ");
  const answers = [];

  const lines = await withConsoleSpy(async () => {
    const run = async (req, env, hives, over, options) => {
      const res = await handle(req, env, stub(hives, over, options).fn);
      answers.push({ status: res.status, text: await res.text() });
    };
    const two = { [HIVE_A]: pathA, [HIVE_B]: [] };
    const says = (status) => () =>
      Response.json({ code: "P0001", message: leak }, { status });
    const throws = () => {
      throw new Error(leak);
    };

    await run(good(), ENV, two);
    await run(good(), ENV, {});
    await run(good(), ENV, two, {}, { steps: 3 });
    // A due list that carries more than ids.
    await run(good(), ENV, two, {
      due: () =>
        Response.json([
          { id: HIVE_A, name: HIVE_NAME },
          { id: HIVE_NAME },
          { id: SECRET },
        ]),
    });
    // Each service's own words, echoing everything, must not be passed on.
    await run(good(), ENV, two, { due: says(500) });
    await run(good(), ENV, two, { due: throws });
    await run(good(), ENV, two, { begin: says(400) });
    await run(good(), ENV, two, { begin: throws });
    await run(good(), ENV, two, { list: says(500) });
    await run(good(), ENV, two, { list: throws });
    await run(good(), ENV, two, {
      list: () => Response.json([{ name: 7, path: leak }]),
    });
    // A list that does not advance: the name it stuck on is not logged.
    await run(good(), ENV, two, {
      list: () => Response.json(pathA.map((name) => ({ name }))),
      remove: () => Response.json([]),
    });
    await run(good(), ENV, two, { remove: says(500) });
    await run(good(), ENV, two, { remove: throws });
    await run(good(), ENV, two, { purge: says(400) });
    await run(good(), ENV, two, { purge: throws });
    await run(good(), ENV, two, { purge: () => Response.json(leak) });
    await run(good(), ENV, two, { purge: () => Response.json(false) });
    await run(request({ headers: { "x-purge-secret": KEY } }), ENV, two);
    await run(request({ headers: { "x-purge-secret": leak } }), ENV, two);
    await run(good(), { ...ENV, purgeSecret: "" }, two);
    await run(good(), { ...ENV, serviceKey: undefined }, two);
    await run(
      request({ method: "GET", headers: { "x-purge-secret": SECRET } }),
      ENV,
      two,
    );
  });

  // Every run says at least one line.
  assert.ok(lines.length >= answers.length);
  for (const line of lines) {
    // A fixed phrase, with ids and numbers only.
    assert.match(line, /^purge-hives: [a-z0-9 _(),:-]+$/i, line);
    assert.ok(line.length < 160, line);
    for (const secret of secrets) assert.ok(!line.includes(secret), line);
  }
  // A failed hive is named by its id, so it can be found.
  assert.ok(lines.some((line) => line.includes(HIVE_A)));

  for (const { status, text } of answers) {
    for (const secret of secrets) assert.ok(!text.includes(secret), status);
    // Counts only: not even an id.
    for (const id of [HIVE_A, HIVE_B]) assert.ok(!text.includes(id), status);
    const keys = Object.keys(JSON.parse(text));
    if (status === 200)
      assert.deepEqual(keys, ["ok", "purged", "failed", "orphans"]);
    else assert.deepEqual(keys, ["error"]);
  }
});

test("22. every outbound call has a time limit", async () => {
  const limits = [];
  const real = AbortSignal.timeout;
  const spy = mock.method(AbortSignal, "timeout", (ms) => {
    limits.push(ms);
    return real.call(AbortSignal, ms);
  });
  let net;
  try {
    net = stub({ [HIVE_A]: pathsOf(HIVE_A, 150) }, {}, { steps: 1 });
    await handle(good(), ENV, net.fn);
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual(net.order(), [
    DUE,
    BEGIN,
    LIST,
    STORAGE,
    STORAGE,
    LIST,
    LIST,
    PURGE,
    PURGE,
  ]);
  // Ten seconds for everything but a step of the erase, which gets twenty;
  // the orphan pass at the end is ten.
  assert.deepEqual(
    limits,
    [
      10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 20_000, 20_000,
      10_000,
    ],
  );
});

// A clock the test moves by hand, in milliseconds.
function clock() {
  let t = 1_000_000;
  return { now: () => t, add: (ms) => (t += ms) };
}
const BUDGET = 120_000;

test("23. a run that is out of time starts no new hive", async () => {
  const time = clock();
  const net = stub(
    { [HIVE_A]: [], [HIVE_B]: [], [HIVE_C]: [] },
    {
      // Each erase takes fifty seconds.
      purge: (body) => {
        time.add(50_000);
        net.purged.push(body.p_hive);
        return Response.json(true);
      },
    },
  );
  const lines = await withConsoleSpy(async () => {
    // 0 s: A. 50 s: B. 100 s: C. All three start inside the budget.
    await expectDone(await handle(good(), ENV, net.fn, time.now), 3, 0);
  });
  assert.ok(lines.every((line) => !line.includes("out of time")));

  const late = clock();
  const slow = stub(
    { [HIVE_A]: [], [HIVE_B]: [], [HIVE_C]: [] },
    {
      purge: (body) => {
        late.add(BUDGET);
        slow.purged.push(body.p_hive);
        return Response.json(true);
      },
    },
  );
  await expectDone(await handle(good(), ENV, slow.fn, late.now), 1, 0);
  // The other two were not even begun: their owners can still cancel.
  assert.deepEqual(slow.begun, [HIVE_A]);
  assert.deepEqual(slow.purged, [HIVE_A]);
  // No time left: the orphan pass made no call.
  assert.equal(slow.at(ORPHANS).length, 0);
});

test("24. out of time in the middle of a hive: it is neither purged nor failed, and continues next run", async () => {
  // While removing: twenty seconds a batch, so six batches fit; no seventh is
  // sent and no further page is read.
  const time = clock();
  const net = stub(
    { [HIVE_A]: pathsOf(HIVE_A, 1500), [HIVE_B]: [] },
    {
      remove: (body) => {
        time.add(20_000);
        net.removed.push(...body.prefixes);
        return Response.json([]);
      },
    },
  );
  const lines = await withConsoleSpy(async () => {
    await expectDone(await handle(good(), ENV, net.fn, time.now), 0, 0);
  });
  assert.deepEqual(net.begun, [HIVE_A]);
  assert.equal(net.at(LIST).length, 1);
  assert.equal(net.removed.length, 600);
  assert.equal(net.at(PURGE).length, 0);
  assert.ok(
    lines.some((l) => l.includes(HIVE_A) && l.includes("continues")),
    lines.join("\n"),
  );

  // While erasing: purge_hive is not asked again once the time is up.
  const later = clock();
  const steps = stub(
    { [HIVE_A]: [], [HIVE_B]: [] },
    {
      purge: () => {
        later.add(50_000);
        return Response.json(false);
      },
    },
  );
  await expectDone(await handle(good(), ENV, steps.fn, later.now), 0, 0);
  // 0 s, 50 s, 100 s: three steps, then the budget is spent.
  assert.equal(steps.at(PURGE).length, 3);
  assert.deepEqual(steps.begun, [HIVE_A]);
});

test("25. the next run resumes a hive that was left half way", async () => {
  const paths = pathsOf(HIVE_A, 250);
  const first = stub(
    { [HIVE_A]: paths },
    {
      // The first batch goes, the second fails.
      remove: (body) => {
        if (first.at(STORAGE).length === 2) {
          return Response.json({ message: "boom" }, { status: 500 });
        }
        first.removed.push(...body.prefixes);
        return Response.json([]);
      },
    },
  );
  await expectDone(await handle(good(), ENV, first.fn), 0, 1);
  assert.equal(first.removed.length, 100);

  // Objects already removed are simply not listed again.
  const left = [...paths].sort().slice(100);
  const second = stub({ [HIVE_A]: left });
  await expectDone(await handle(good(), ENV, second.fn), 1, 0);
  assert.deepEqual(second.begun, [HIVE_A]);
  assert.deepEqual(second.removed, left);
  assert.deepEqual(second.purged, [HIVE_A]);
});

test("26. the project address may end in a slash", async () => {
  const net = stub({ [HIVE_A]: pathsOf(HIVE_A, 1) });
  await expectDone(
    await handle(good(), { ...ENV, url: `${URL_}/` }, net.fn),
    1,
    0,
  );
  assert.deepEqual(net.order(), [DUE, BEGIN, LIST, STORAGE, LIST, LIST, PURGE]);
});

test("27. a store that answers 200 but removes only some names: healed by further passes, or failed with purge_hive uncalled", async () => {
  // One name goes per removal. Three names: gone after three passes.
  const three = pathsOf(HIVE_A, 3);
  const healed = stub({ [HIVE_A]: three }, {}, { partial: true });
  await expectDone(await handle(good(), ENV, healed.fn), 1, 0);
  assert.equal(healed.at(STORAGE).length, 3);
  assert.deepEqual([...healed.removed].sort(), [...three].sort());
  // Three passes from the start, then the one that found nothing left.
  assert.equal(healed.fromStart(HIVE_A), 4);
  assert.deepEqual(healed.purged, [HIVE_A]);
  // purge_hive only after the list came back empty from the start.
  const order = healed.order();
  assert.equal(order.at(-1), PURGE);
  assert.equal(order.at(-2), LIST);
  assert.equal(bodyOf(healed.calls.at(-3)).p_after, null);
  assert.equal(healed.at(PURGE).length, 1);

  // Five names: two are still there after three passes. Not erased.
  const lines = await withConsoleSpy(async () => {
    const stuck = stub(
      { [HIVE_A]: pathsOf(HIVE_A, 5), [HIVE_B]: [] },
      {},
      { partial: true },
    );
    await expectDone(await handle(good(), ENV, stuck.fn), 1, 1);
    assert.equal(stuck.at(STORAGE).length, 3);
    assert.equal(stuck.fromStart(HIVE_A), 4);
    assert.deepEqual(
      stuck.at(PURGE).map((c) => bodyOf(c).p_hive),
      [HIVE_B],
    );
  });
  assert.ok(
    lines.some((l) => l.includes(HIVE_A) && l.includes("remain")),
    lines.join("\n"),
  );

  // A store that answers 200 and removes nothing at all.
  const deaf = stub(
    { [HIVE_A]: pathsOf(HIVE_A, 150) },
    { remove: () => Response.json([]) },
  );
  await expectDone(await handle(good(), ENV, deaf.fn), 0, 1);
  assert.equal(deaf.at(STORAGE).length, 6);
  assert.equal(deaf.at(PURGE).length, 0);

  // Out of time between passes: it continues, it has not failed.
  let t = 0;
  const slow = stub(
    { [HIVE_A]: pathsOf(HIVE_A, 5) },
    {
      remove: (body) => {
        t += 100_000;
        return slow.defaults.remove(body);
      },
    },
    { partial: true },
  );
  await expectDone(await handle(good(), ENV, slow.fn, () => t), 0, 0);
  assert.equal(slow.at(STORAGE).length, 2);
  assert.equal(slow.at(PURGE).length, 0);
});

test("28. the list that confirms failing means no purge_hive", async () => {
  const failures = {
    500: () => Response.json({ message: "boom" }, { status: 500 }),
    thrown: () => {
      throw new Error("timeout");
    },
    "not a list": () => Response.json({ name: "a/b/c" }),
  };
  for (const [name, fail] of Object.entries(failures)) {
    let fromStart = 0;
    const net = stub(
      { [HIVE_A]: pathsOf(HIVE_A, 2) },
      {
        list: (body) =>
          body.p_after === null && ++fromStart === 2
            ? fail()
            : net.defaults.list(body),
      },
    );
    await expectDone(await handle(good(), ENV, net.fn), 0, 1);
    assert.equal(net.at(PURGE).length, 0, name);
    assert.equal(net.removed.length, 2, name);
  }
});
