import { describe, expect, it } from "vitest";
import {
  fixturePreview,
  fixtureVault,
  GROUP_FOLDER,
  HOSTILE_BODY,
  HOSTILE_NOTE_ID,
} from "./fixture";
import type { FolderRule, VaultData, Visibility } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

describe("fixtureVault", () => {
  it("is deterministic", () => {
    expect(fixtureVault(NOW)).toEqual(fixtureVault(NOW));
  });

  it("has the documented shape", () => {
    const d = fixtureVault(NOW);
    expect(d.hive.name).toBe("Synapse");
    expect(d.members).toHaveLength(3);
    expect(d.workspaces).toHaveLength(2);
    expect(d.tab).toEqual({ kind: "workspace", id: d.workspaces[0]!.id });
    expect(d.open).toBeNull();
    expect(d.notes.length).toBeGreaterThanOrEqual(30);
    expect(d.notes.filter((n) => n.quarantined)).toHaveLength(2);
    expect(d.folders.filter((f) => f.visibility === "group")).toHaveLength(1);
    expect(d.folders.filter((f) => f.visibility === "members")).toHaveLength(1);
    for (const n of d.notes) {
      expect(n.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("has about sixty notes across the two workspaces", () => {
    const total = fixtureVault(NOW).workspaces.reduce(
      (sum, w) => sum + fixtureVault(NOW, { ws: w.id }).notes.length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(55);
    expect(total).toBeLessThanOrEqual(70);
  });

  it("selects the workspace, the shared tab and the open note from the query", () => {
    const base = fixtureVault(NOW);
    const second = base.workspaces[1]!;
    const d2 = fixtureVault(NOW, { ws: second.id });
    expect(d2.tab).toEqual({ kind: "workspace", id: second.id });
    expect(d2.notes.every((n) => n.workspace_id === second.id)).toBe(true);
    expect(d2.notes.every((n) => n.member_id === base.me)).toBe(true);

    const shared = fixtureVault(NOW, { tab: "shared" });
    expect(shared.tab).toEqual({ kind: "shared" });
    expect(shared.folders).toEqual([]);
    expect(shared.notes.length).toBeGreaterThanOrEqual(5);
    expect(shared.notes.every((n) => n.member_id !== base.me)).toBe(true);
    expect(shared.notes.filter((n) => n.access === "link")).toHaveLength(1);
    expect(shared.notes.some((n) => n.access === "shared")).toBe(true);
    expect(new Set(shared.notes.map((n) => n.member_id)).size).toBe(2);

    expect(fixtureVault(NOW, { note: "nope" }).open).toEqual({
      missing: true,
    });
  });

  it("links Findings draft with a colleague's note and with one of my own, seen from each side", () => {
    const all = [
      ...fixtureVault(NOW).notes,
      ...fixtureVault(NOW, { tab: "shared" }).notes,
    ];
    const id = (title: string) => all.find((n) => n.title === title)!.id;
    const linksOf = (title: string) => {
      const open = fixtureVault(NOW, { note: id(title) }).open;
      if (!open || !("note" in open)) throw new Error(title);
      return open.links;
    };
    const [withSara, withMine] = linksOf("Findings draft");
    expect(linksOf("Findings draft")).toHaveLength(2);
    expect(withSara).toMatchObject({
      note_id: id("Pricing options"),
      title: "Pricing options",
      owner: "Sara",
      mine: false,
    });
    expect(withMine).toMatchObject({
      note_id: id("Call notes"),
      title: "Call notes",
      owner: "Danijel",
      mine: true,
    });
    // The same two links from their other sides.
    expect(linksOf("Pricing options")).toEqual([
      {
        id: withSara!.id,
        note_id: id("Findings draft"),
        title: "Findings draft",
        owner: "Danijel",
        mine: true,
      },
    ]);
    expect(linksOf("Call notes")).toEqual([
      { ...linksOf("Pricing options")[0], id: withMine!.id },
    ]);
    expect(linksOf("Readme")).toEqual([]);
  });

  it("opens the hostile note with the hostile body", () => {
    const d = fixtureVault(NOW, { note: HOSTILE_NOTE_ID });
    expect(d.open).not.toBeNull();
    expect(d.open && "note" in d.open && d.open.note.id).toBe(HOSTILE_NOTE_ID);
    expect(d.open && "body" in d.open && d.open.body).toBe(HOSTILE_BODY);
    for (const piece of [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "[click](javascript:alert(1))",
      "![pixel](https://example.invalid/pixel.png)",
      "| ",
      "# ",
    ]) {
      expect(HOSTILE_BODY).toContain(piece);
    }
  });

  it("dates are relative to now", () => {
    const a = fixtureVault(NOW);
    const b = fixtureVault(NOW + 1000);
    expect(a.notes[0]!.updated_at).not.toBe(b.notes[0]!.updated_at);
    for (const n of a.notes) expect(Date.parse(n.updated_at)).toBeLessThan(NOW);
  });

  it("every note I own agrees with the folder rules", () => {
    for (const ws of fixtureVault(NOW).workspaces) {
      const d = fixtureVault(NOW, { ws: ws.id });
      const mine = d.notes.filter((n) => n.member_id === d.me);
      expect(mine.length).toBeGreaterThan(0);
      for (const n of mine) {
        const ruled = nearestRule(d.folders, n.path);
        let effective: Visibility = "private";
        let withIds: string[] = [];
        if (n.visibility !== null) {
          effective = n.visibility;
          withIds = n.shared_with;
        } else if (ruled) {
          effective = ruled.visibility!;
          withIds = ruled.shared_with;
        }
        expect(n.effective, n.path).toBe(effective);
        expect(n.effective_with, n.path).toEqual(
          effective === "members" ? withIds : [],
        );
        expect(n.rule_folder, n.path).toBe(ruled ? ruled.path : null);
        expect(n.access).toBe("own");
      }
    }
  });
});

function nearestRule(folders: FolderRule[], path: string): FolderRule | null {
  let best: FolderRule | null = null;
  for (const f of folders) {
    if (f.visibility === null || !path.startsWith(`${f.path}/`)) continue;
    if (!best || f.path.length > best.path.length) best = f;
  }
  return best;
}

describe("fixturePreview", () => {
  it("counts the group folder from the notes, all four non-zero", () => {
    const d: VaultData = fixtureVault(NOW);
    const p = fixturePreview(d, GROUP_FOLDER);
    expect(p.follows).toBeGreaterThan(0);
    expect(p.own_setting).toBeGreaterThan(0);
    expect(p.under_nested_rule).toBeGreaterThan(0);
    expect(p.held).toBeGreaterThan(0);
    const inside = d.notes.filter((n) => n.path.startsWith(`${GROUP_FOLDER}/`));
    expect(p.follows + p.own_setting + p.under_nested_rule).toBe(inside.length);
    expect(p.held).toBeLessThanOrEqual(p.follows);
  });

  it("follows the stated definitions on a tiny data set", () => {
    const d = fixtureVault(NOW);
    const mk = (path: string, extra: object) => ({
      ...d.notes[0]!,
      path,
      visibility: null,
      quarantined: false,
      ...extra,
    });
    const tiny: VaultData = {
      ...d,
      folders: [
        { path: "p", visibility: "group", shared_with: [] },
        { path: "p/q", visibility: "private", shared_with: [] },
        { path: "p/r", visibility: null, shared_with: [] },
      ],
      notes: [
        mk("p/a.md", {}),
        mk("p/b.md", { quarantined: true }),
        mk("p/c.md", { visibility: "group" }),
        mk("p/q/d.md", {}),
        mk("p/r/e.md", {}),
        mk("other/f.md", {}),
      ],
    };
    expect(fixturePreview(tiny, "p")).toEqual({
      follows: 3,
      own_setting: 1,
      under_nested_rule: 1,
      held: 1,
    });
  });
});
