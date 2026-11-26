import { test } from "node:test";
import assert from "node:assert/strict";
import { restStore } from "../src/rest-store.ts";
import { KeyRefused, Unreachable } from "../src/store.ts";

const session = { token: async () => "jwt" };
const cfg = { url: "https://p.supabase.co", anonKey: "pk" };

test("RPCs go to /rest/v1/rpc with the identity and the named arguments", async () => {
  const seen: { url: string; auth: string; body: unknown }[] = [];
  const store = restStore(cfg, session, async (url, init) => {
    const h = new Headers(init!.headers);
    seen.push({
      url: String(url),
      auth: h.get("Authorization")!,
      body: JSON.parse(String(init!.body)),
    });
    return new Response(
      JSON.stringify({ run_id: "r1", storage_prefix: "m/w/vault/" }),
      { status: 200 },
    );
  });
  assert.deepEqual(await store.openRun(true), {
    runId: "r1",
    storagePrefix: "m/w/vault/",
  });
  assert.equal(seen[0]!.url, "https://p.supabase.co/rest/v1/rpc/sync_open_run");
  assert.equal(seen[0]!.auth, "Bearer jwt");
  assert.deepEqual(seen[0]!.body, { p_confirm: true });
});

test("a refused identity is KeyRefused; a server error is Unreachable with no words kept", async () => {
  const refused = restStore(
    cfg,
    session,
    async () => new Response("{}", { status: 403 }),
  );
  await assert.rejects(refused.openRun(false), KeyRefused);
  const broken = restStore(
    cfg,
    session,
    async () =>
      new Response(
        JSON.stringify({ code: "22023", message: "a path: secret/x.md" }),
        { status: 400 },
      ),
  );
  await assert.rejects(broken.openRun(false), (e: Error) => {
    assert.ok(e instanceof Unreachable);
    assert.equal(e.message, "sync_open_run answered 400 (22023)");
    return true;
  });
});

test("an upload whose object is already there counts as stored", async () => {
  const urls: string[] = [];
  const store = restStore(cfg, session, async (url, init) => {
    urls.push(String(url));
    assert.equal(new Headers(init!.headers).get("x-upsert"), "false");
    return new Response(
      JSON.stringify({ statusCode: "409", error: "Duplicate" }),
      { status: 400 },
    );
  });
  await store.upload(
    "m/w/vault/ab/Deck v2.html",
    new Uint8Array([1]),
    "application/octet-stream",
  );
  assert.equal(
    urls[0],
    "https://p.supabase.co/storage/v1/object/files/m/w/vault/ab/Deck%20v2.html",
  );
});

const upload = (status: number, body: unknown) =>
  restStore(
    cfg,
    session,
    async () => new Response(JSON.stringify(body), { status }),
  ).upload("m/w/vault/ab/x.md", new Uint8Array([1]), "text/markdown");

test("Storage's refused policy, even inside a 400, is KeyRefused", async () => {
  await assert.rejects(upload(403, {}), KeyRefused);
  await assert.rejects(upload(401, {}), KeyRefused);
  await assert.rejects(
    upload(400, { statusCode: "403", error: "Unauthorized" }),
    KeyRefused,
  );
});

test("a bad name or a too-big object fails that file only; server trouble stops the run", async () => {
  for (const status of [400, 413]) {
    await assert.rejects(
      upload(status, { statusCode: String(status) }),
      (e: Error) => {
        assert.ok(!(e instanceof KeyRefused) && !(e instanceof Unreachable));
        assert.equal(e.message, `an upload answered ${status}`);
        return true;
      },
    );
  }
  for (const status of [408, 429, 500, 503]) {
    await assert.rejects(upload(status, {}), Unreachable);
  }
});

test("a dropped connection during an upload is Unreachable", async () => {
  const store = restStore(cfg, session, async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    store.upload("p", new Uint8Array([1]), "text/plain"),
    Unreachable,
  );
});

test("a refusal while signing in passes through as KeyRefused", async () => {
  const store = restStore(
    cfg,
    {
      token: async () => {
        throw new KeyRefused("no");
      },
    },
    async () => new Response("{}", { status: 200 }),
  );
  await assert.rejects(store.openRun(false), KeyRefused);
});
