import { test } from "node:test";
import assert from "node:assert/strict";
import { isSkipped, parseIgnore } from "../src/skip.ts";

const none = parseIgnore("");

test("dot parts and videos are skipped; HTML and everything else is kept", () => {
  assert.equal(isSkipped(".obsidian/app.json", none), true);
  assert.equal(isSkipped("a/.trash/x.md", none), true);
  assert.equal(isSkipped("a/.DS_Store", none), true);
  assert.equal(isSkipped("talks/demo.MOV", none), true);
  assert.equal(isSkipped("talks/demo.mp4", none), true);
  assert.equal(isSkipped("decks/pitch.html", none), false);
  assert.equal(isSkipped("notes/a.md", none), false);
  assert.equal(isSkipped("img/a.svg", none), false);
});

test(".hivesyncignore: names, folders, globs, anchors and comments", () => {
  const ig = parseIgnore(
    "# comment\n\nscratch/\n*.tmp\n/outputs/drafts\nlogs/**/*.log\n!keep.md\n",
  );
  assert.equal(isSkipped("scratch/a.md", ig), true);
  assert.equal(isSkipped("x/scratch/a.md", ig), true);
  assert.equal(isSkipped("scratch.md", ig), false);
  assert.equal(isSkipped("a/b.tmp", ig), true);
  assert.equal(isSkipped("outputs/drafts/a.md", ig), true);
  assert.equal(isSkipped("x/outputs/drafts/a.md", ig), false);
  assert.equal(isSkipped("logs/2026/11/a.log", ig), true);
  // Negation is not supported: the line is ignored, nothing is re-included.
  assert.equal(isSkipped("keep.md", ig), false);
});
