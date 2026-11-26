import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionKey, SESSION_HEADER } from "../mcp/src/session-key.ts";

test("one key per process, in the shape the database accepts", () => {
  assert.equal(SESSION_HEADER, "x-hive-session");
  assert.match(sessionKey(), /^[A-Za-z0-9-]{1,64}$/);
  assert.equal(sessionKey(), sessionKey());
});
