import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseHomes, vaultFilesNote } from "../src/homes.ts";

test("a file lives in the first note, by path, that links to it", () => {
  const homes = chooseHomes(
    [
      { path: "b/Second.md", targets: ["deck.html"] },
      { path: "a/First.md", targets: ["../decks/deck.html"] },
      { path: "c/Other.md", targets: ["files/a b.pdf"] },
    ],
    ["decks/deck.html", "c/files/a b.pdf", "loose/x.png"],
  );
  assert.equal(homes.get("decks/deck.html"), "a/First.md");
  assert.equal(homes.get("c/files/a b.pdf"), "c/Other.md");
  assert.equal(homes.get("loose/x.png"), "loose/Vault files.md");
});

test("a name shared by two files means the one nearest the note", () => {
  const homes = chooseHomes(
    [{ path: "p/N.md", targets: ["img.png"] }],
    ["p/img.png", "q/img.png"],
  );
  assert.equal(homes.get("p/img.png"), "p/N.md");
  assert.equal(homes.get("q/img.png"), "q/Vault files.md");
});

test("a file at the top lives in the top Vault files note", () => {
  assert.equal(vaultFilesNote("x.pdf"), "Vault files.md");
});
