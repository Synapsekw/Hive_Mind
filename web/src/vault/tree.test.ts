import { describe, expect, it } from "vitest";
import { buildTree, isShown, notesIn } from "./tree";
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
    fromVault: false,
    visibility: null,
    shared_with: [],
    quarantined: false,
    effective: "private",
    effective_with: [],
    rule_folder: null,
    access: "own",
    topics: [],
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

describe("notesIn by topic", () => {
  const notes = [
    note("a.md", { topics: ["t1", "t2"] }),
    note("b.md", { topics: ["t2"] }),
    note("c.md", { topics: [], title: "Pricing sheet" }),
    note("d.md", { topics: ["t1"], title: "Pricing call" }),
  ];

  it("keeps the notes that carry the topic, at any position", () => {
    const paths = (id: string) =>
      notesIn(notes, { kind: "topic", id }, "").map((n) => n.path);
    expect(paths("t1")).toEqual(["a.md", "d.md"]);
    expect(paths("t2")).toEqual(["a.md", "b.md"]);
    expect(paths("nope")).toEqual([]);
  });

  it("keeps the notes with no topic", () => {
    expect(
      notesIn(notes, { kind: "untopiced" }, "").map((n) => n.path),
    ).toEqual(["c.md"]);
  });

  it("applies the text filter on top", () => {
    expect(
      notesIn(notes, { kind: "topic", id: "t1" }, "pricing").map((n) => n.path),
    ).toEqual(["d.md"]);
    expect(
      notesIn(notes, { kind: "untopiced" }, "pricing").map((n) => n.path),
    ).toEqual(["c.md"]);
    expect(notesIn(notes, { kind: "untopiced" }, "call")).toEqual([]);
  });
});

describe("isShown", () => {
  it("hides a folder with no notes and no rule", () => {
    const root = buildTree(
      [note("a/x.md")],
      [{ path: "empty", visibility: null, shared_with: [] }],
    );
    expect(isShown(root.children.find((c) => c.path === "empty")!)).toBe(false);
  });
  it("keeps an empty folder that has a rule", () => {
    const root = buildTree([], [rule("ruled")]);
    expect(isShown(root.children[0]!)).toBe(true);
  });
  it("keeps an empty folder whose child has a rule", () => {
    const root = buildTree([], [rule("p/c")]);
    expect(isShown(root.children[0]!)).toBe(true);
  });
  it("keeps a folder with notes", () => {
    const root = buildTree([note("a/x.md")], []);
    expect(isShown(root.children[0]!)).toBe(true);
  });
});
