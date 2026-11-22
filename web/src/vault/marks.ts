// The small label shown next to a note or folder: who can read it, and whether a folder rule
// says so. Uses only what the database returned; it never works out access itself.
import { people } from "./sentences";
import type { FolderRule, VaultData, VaultNote, Visibility } from "./types";

export type Mark = {
  kind: "private" | "members" | "group";
  from: string | null;
  label: string;
};

function label(
  kind: Visibility,
  ids: string[],
  members: VaultData["members"],
): string {
  if (kind === "private") return "Private";
  if (kind === "group") return "Everyone";
  return people(
    ids.map(
      (id) => members.find((m) => m.id === id)?.display_name ?? "someone",
    ),
  );
}

export function noteMark(n: VaultNote, members: VaultData["members"]): Mark {
  return {
    kind: n.effective,
    from: n.visibility === null && n.rule_folder ? n.rule_folder : null,
    label: label(n.effective, n.effective_with, members),
  };
}

export function folderMark(
  rule: FolderRule | null,
  members: VaultData["members"],
): Mark | null {
  if (!rule || rule.visibility === null) return null;
  return {
    kind: rule.visibility,
    from: null,
    label: label(rule.visibility, rule.shared_with, members),
  };
}
