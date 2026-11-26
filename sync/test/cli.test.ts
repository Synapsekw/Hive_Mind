import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.ts";

test("subcommands and flags", () => {
  assert.deepEqual(parseArgs(["now"]), {
    cmd: "now",
    confirmDeletes: false,
    scheduled: false,
  });
  assert.deepEqual(parseArgs(["--confirm-deletes"]), {
    cmd: "now",
    confirmDeletes: true,
    scheduled: false,
  });
  assert.deepEqual(parseArgs(["now", "--scheduled"]), {
    cmd: "now",
    confirmDeletes: false,
    scheduled: true,
  });
  assert.deepEqual(
    parseArgs([
      "setup",
      "--url",
      "https://p",
      "--publishable-key",
      "pk",
      "--folder",
      "/v",
    ]),
    {
      cmd: "setup",
      url: "https://p",
      anonKey: "pk",
      folder: "/v",
    },
  );
  assert.deepEqual(parseArgs(["status"]), { cmd: "status" });
  assert.deepEqual(parseArgs(["uninstall"]), { cmd: "uninstall" });
  assert.deepEqual(parseArgs(["nope"]), { cmd: "help" });
  assert.deepEqual(parseArgs([]), { cmd: "help" });
});
