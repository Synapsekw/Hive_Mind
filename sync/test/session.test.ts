import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSession } from "../src/session.ts";
import { KeyRefused, Unreachable } from "../src/store.ts";

const KEY = "hsync_" + "b".repeat(64);

test("signs in once and refreshes five minutes before the hour is up", async () => {
  let calls = 0;
  let clock = 1_000_000;
  const s = syncSession(
    { url: "https://p.supabase.co/", anonKey: "pk", key: KEY },
    async (url, init) => {
      calls++;
      assert.equal(url, "https://p.supabase.co/functions/v1/sync-session");
      assert.deepEqual(JSON.parse(String(init!.body)), { key: KEY });
      return new Response(
        JSON.stringify({
          access_token: `t${calls}`,
          expires_at: clock / 1000 + 3600,
        }),
        { status: 200 },
      );
    },
    () => clock,
  );
  assert.equal(await s.token(), "t1");
  assert.equal(await s.token(), "t1");
  clock += 3_400_000;
  assert.equal(await s.token(), "t2");
});

test("a 401 is a refused key; anything else is unreachable", async () => {
  const refused = syncSession(
    { url: "https://p", anonKey: "pk", key: KEY },
    async () => new Response("{}", { status: 401 }),
  );
  await assert.rejects(refused.token(), KeyRefused);
  const down = syncSession(
    { url: "https://p", anonKey: "pk", key: KEY },
    async () => {
      throw new TypeError("fetch failed");
    },
  );
  await assert.rejects(down.token(), Unreachable);
  const odd = syncSession(
    { url: "https://p", anonKey: "pk", key: KEY },
    async () => new Response("{}", { status: 200 }),
  );
  await assert.rejects(odd.token(), Unreachable);
});

test("no error message carries the key", async () => {
  const s = syncSession(
    { url: "https://p", anonKey: "pk", key: KEY },
    async () => new Response("{}", { status: 401 }),
  );
  await assert.rejects(s.token(), (e: Error) => !e.message.includes(KEY));
});
