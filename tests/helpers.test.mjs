import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHive } from "./helpers/hive.mjs";

const h = await setupHive();

test("as() passes request headers to the database", async () => {
  const [r] = await h.as(
    h.person("dani"),
    `select current_setting('request.headers', true)::jsonb ->> 'x-hive-session' as k`,
    [],
    { headers: { "x-hive-session": "abc" } },
  );
  assert.equal(r.k, "abc");
});

test("headers do not leak into the next call", async () => {
  const [r] = await h.as(
    h.person("dani"),
    `select current_setting('request.headers', true)::jsonb ->> 'x-hive-session' as k`,
  );
  assert.equal(r.k, null);
});

test("an agent identity can save a file through the helper", async () => {
  const agent = await h.agentFor("dani");
  const row = await h.saveFile(agent, "dani", "a.pdf");
  assert.match(row.id, /^[0-9a-f-]{36}$/);
});
