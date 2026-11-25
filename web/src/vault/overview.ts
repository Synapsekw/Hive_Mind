// What the vault says when no note is open: counts and short lists over the loaded notes.
// "Today" is the UTC day of `now`, as the vault's dates are shown in UTC.
import { isShown, type TreeNode } from "./tree";
import type { VaultNote } from "./types";

const newestFirst = (a: VaultNote, b: VaultNote) =>
  a.updated_at < b.updated_at
    ? 1
    : a.updated_at > b.updated_at
      ? -1
      : a.id < b.id
        ? -1
        : 1;

function countShown(node: TreeNode): number {
  return node.children
    .filter(isShown)
    .reduce((sum, c) => sum + 1 + countShown(c), 0);
}

const dayOf = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function overview(notes: VaultNote[], root: TreeNode, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    notes: notes.length,
    folders: countShown(root),
    topics: new Set(notes.flatMap((x) => x.topics)).size,
    today: notes.filter((x) => dayOf(x.updated_at) === day).length,
    held: notes.filter((x) => x.quarantined).length,
    recent: [...notes].sort(newestFirst).slice(0, 6),
  };
}

export function sharedOverview(notes: VaultNote[]) {
  return {
    notes: notes.length,
    people: new Set(notes.map((x) => x.member_id)).size,
    newest: [...notes].sort(newestFirst).slice(0, 5),
  };
}
