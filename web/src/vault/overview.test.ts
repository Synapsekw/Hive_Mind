import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";
import { overview, sharedOverview } from "./overview";
import type { VaultNote } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12);
const n = (
  id: string,
  path: string,
  day: number,
  extra: Partial<VaultNote> = {},
): VaultNote => ({
  id,
  workspace_id: "w",
  member_id: "me",
  path,
  title: id,
  updated_at: new Date(Date.UTC(2026, 10, day, 9)).toISOString(),
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
});

describe("overview", () => {
  const notes = [
    n("a", "x/a.md", 22, { topics: ["t1", "t2"] }),
    n("b", "x/y/b.md", 21, { topics: ["t1"], quarantined: true }),
    n("c", "c.md", 20),
    n("o1", "z/o1.md", 1),
    n("o2", "z/o2.md", 2),
    n("o3", "z/o3.md", 3),
    n("o4", "z/o4.md", 4),
    n("o5", "z/o5.md", 5),
  ];
  const root = buildTree(notes, [
    { path: "empty", visibility: null, shared_with: [] },
  ]);
  const o = overview(notes, root, NOW);
  it("counts notes, shown folders, distinct topics, today and held", () => {
    expect(o).toMatchObject({
      notes: 8,
      folders: 3,
      topics: 2,
      today: 1,
      held: 1,
    });
  });
  it("lists the six most recently changed, newest first", () => {
    expect(o.recent.map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
      "o5",
      "o4",
      "o3",
    ]);
  });
  it("an empty workspace counts zeros", () => {
    expect(overview([], buildTree([], []), NOW)).toEqual({
      notes: 0,
      folders: 0,
      topics: 0,
      today: 0,
      held: 0,
      recent: [],
    });
  });
});

describe("sharedOverview", () => {
  it("counts notes and colleagues and keeps the five newest", () => {
    const notes = [1, 2, 3, 4, 5, 6].map((d) =>
      n(`s${d}`, `s${d}.md`, d, {
        member_id: d % 2 ? "m1" : "m2",
        access: "shared",
      }),
    );
    const s = sharedOverview(notes);
    expect(s.notes).toBe(6);
    expect(s.people).toBe(2);
    expect(s.newest.map((x) => x.id)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
  });
});
