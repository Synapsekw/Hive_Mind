import { describe, expect, it } from "vitest";
import { folderMark, noteMark } from "./marks";
import type { VaultNote } from "./types";

const members = [
  { id: "m-me", display_name: "Danijel" },
  { id: "m-a", display_name: "Ahmed" },
  { id: "m-s", display_name: "Sara" },
];

function note(extra: Partial<VaultNote>): VaultNote {
  return {
    id: "n",
    workspace_id: "w",
    member_id: "m-me",
    path: "a.md",
    title: "A",
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

describe("noteMark", () => {
  it("private", () => {
    expect(noteMark(note({}), members)).toEqual({
      kind: "private",
      from: null,
      label: "Private",
    });
  });
  it("group", () => {
    expect(
      noteMark(note({ visibility: "group", effective: "group" }), members),
    ).toEqual({ kind: "group", from: null, label: "Everyone" });
  });
  it("members, with names from effective_with", () => {
    expect(
      noteMark(
        note({
          visibility: "members",
          effective: "members",
          effective_with: ["m-a", "m-s"],
        }),
        members,
      ),
    ).toEqual({ kind: "members", from: null, label: "Ahmed and Sara" });
  });
  it("an unknown member id is someone", () => {
    expect(
      noteMark(
        note({ effective: "members", effective_with: ["m-a", "gone"] }),
        members,
      ).label,
    ).toBe("Ahmed and someone");
  });
  it("from is the rule folder only when the note has no own setting", () => {
    expect(
      noteMark(note({ effective: "group", rule_folder: "clients" }), members)
        .from,
    ).toBe("clients");
    expect(
      noteMark(
        note({
          visibility: "private",
          effective: "private",
          rule_folder: "clients",
        }),
        members,
      ).from,
    ).toBeNull();
  });
});

describe("folderMark", () => {
  it("is null with no rule or no visibility", () => {
    expect(folderMark(null, members)).toBeNull();
    expect(
      folderMark({ path: "x", visibility: null, shared_with: [] }, members),
    ).toBeNull();
  });
  it("labels each kind", () => {
    expect(
      folderMark({ path: "x", visibility: "group", shared_with: [] }, members),
    ).toEqual({ kind: "group", from: null, label: "Everyone" });
    expect(
      folderMark(
        { path: "x", visibility: "members", shared_with: ["m-a"] },
        members,
      ),
    ).toEqual({ kind: "members", from: null, label: "Ahmed" });
    expect(
      folderMark({ path: "x", visibility: "private", shared_with: [] }, members)
        ?.label,
    ).toBe("Private");
  });
});
