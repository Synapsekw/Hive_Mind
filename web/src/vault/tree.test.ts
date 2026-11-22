import { describe, expect, it } from "vitest";
import { buildTree, notesIn } from "./tree";
import type { FolderRule, VaultNote } from "./types";

function note(path: string, extra: Partial<VaultNote> = {}): VaultNote {
  return {
    id: `id-${path}`,
    workspace_id: "w1",
    member_id: "m1",
    path,
    title: `Title of ${path}`,
    updated_at: "2026-11-01T00:00:00.000Z",
    by_agent: false,
    visibility: null,
    shared_with: [],
    quarantined: false,
    effective: "private",
    effective_with: [],
    rule_folder: null,
    access: "own",
    ...extra,
  };
}
const rule = (path: string): FolderRule => ({
  path,
  visibility: "group",
  shared_with: [],
});

describe("buildTree", () => {
  it("counts root notes on the root", () => {
    const t = buildTree([note("a.md"), note("b.md")], []);
    expect(t.path).toBe("");
    expect(t.name).toBe("");
    expect(t.count).toBe(2);
    expect(t.children).toEqual([]);
  });

  it("builds nested folders from note paths with counts at or below", () => {
    const t = buildTree(
      [note("a/b/c.md"), note("a/d.md"), note("a/b/e.md"), note("z.md")],
      [],
    );
    expect(t.count).toBe(4);
    expect(t.children.map((c) => c.name)).toEqual(["a"]);
    const a = t.children[0]!;
    expect(a.path).toBe("a");
    expect(a.count).toBe(3);
    expect(a.children.map((c) => c.path)).toEqual(["a/b"]);
    expect(a.children[0]!.count).toBe(2);
  });

  it("keeps a folder record that has no notes, with its rule", () => {
    const r = rule("empty/deeper");
    const t = buildTree([note("a.md")], [r]);
    const empty = t.children.find((c) => c.name === "empty")!;
    expect(empty.count).toBe(0);
    expect(empty.rule).toBeNull();
    expect(empty.children[0]!.path).toBe("empty/deeper");
    expect(empty.children[0]!.rule).toEqual(r);
  });

  it("sorts children by name and counts held notes", () => {
    const t = buildTree(
      [note("b/x.md"), note("a/x.md", { quarantined: true }), note("c/x.md")],
      [],
    );
    expect(t.children.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(t.children[0]!.count).toBe(1);
  });
});

describe("notesIn", () => {
  const notes = [
    note("clients/b.md", { title: "Beta Kickoff" }),
    note("clients/a/x.md", { title: "Alpha" }),
    note("clientsx/y.md", { title: "Other" }),
    note("root.md", { title: "Root", quarantined: true }),
  ];

  it("all returns every note sorted by path", () => {
    expect(notesIn(notes, { kind: "all" }, "").map((n) => n.path)).toEqual([
      "clients/a/x.md",
      "clients/b.md",
      "clientsx/y.md",
      "root.md",
    ]);
  });

  it("folder returns notes at or below the path, not sibling prefixes", () => {
    expect(
      notesIn(notes, { kind: "folder", path: "clients" }, "").map(
        (n) => n.path,
      ),
    ).toEqual(["clients/a/x.md", "clients/b.md"]);
  });

  it("held returns quarantined notes", () => {
    expect(notesIn(notes, { kind: "held" }, "").map((n) => n.path)).toEqual([
      "root.md",
    ]);
  });

  it("filter matches title or path, case-insensitively", () => {
    expect(
      notesIn(notes, { kind: "all" }, "KICKOFF").map((n) => n.path),
    ).toEqual(["clients/b.md"]);
    expect(
      notesIn(notes, { kind: "all" }, "CLIENTSX/").map((n) => n.path),
    ).toEqual(["clientsx/y.md"]);
  });
});
