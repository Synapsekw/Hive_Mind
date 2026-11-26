import { test } from "node:test";
import assert from "node:assert/strict";
import { notePairs } from "../src/links.ts";

test("wiki links resolve to note paths, by the web app's rules", () => {
  const pairs = notePairs(
    [{ path: "a/A.md", targets: ["B", "deck.html", "Missing", "A"] }],
    ["a/A.md", "b/B.md"],
  );
  assert.deepEqual(pairs, [{ from: "a/A.md", to: "b/B.md" }]);
});
