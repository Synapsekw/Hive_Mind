// The folder tree and the note list for one scope. Pure; folders are paths, notes live at
// `folder/name.md`, and a folder's count is every note at or below it.
import type { FolderRule, VaultNote } from "./types";

export type TreeNode = {
  path: string;
  name: string;
  count: number;
  rule: FolderRule | null;
  children: TreeNode[];
};

export type Scope =
  { kind: "all" } | { kind: "folder"; path: string } | { kind: "held" };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function dirsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

const isBelow = (path: string, folder: string) =>
  folder === "" || path.startsWith(`${folder}/`);

/** Root has path "" and name "". Folders come from note paths and folder records. */
export function buildTree(notes: VaultNote[], folders: FolderRule[]): TreeNode {
  const nodes = new Map<string, TreeNode>();
  const make = (path: string): TreeNode => ({
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    count: 0,
    rule: null,
    children: [],
  });
  const root = make("");
  nodes.set("", root);
  const ensure = (path: string) => {
    if (!nodes.has(path)) nodes.set(path, make(path));
  };
  for (const n of notes) for (const d of dirsOf(n.path)) ensure(d);
  for (const f of folders) {
    for (const d of dirsOf(`${f.path}/x`)) ensure(d);
    nodes.get(f.path)!.rule = f;
  }
  for (const node of nodes.values()) {
    if (node.path === "") continue;
    nodes
      .get(node.path.slice(0, Math.max(0, node.path.lastIndexOf("/"))))!
      .children.push(node);
  }
  for (const node of nodes.values()) {
    node.children.sort((a, b) => cmp(a.name, b.name));
    node.count = notes.filter((n) => isBelow(n.path, node.path)).length;
  }
  return root;
}

/** Notes in a scope whose title or path contains `filter`, sorted by path. */
export function notesIn(
  notes: VaultNote[],
  scope: Scope,
  filter: string,
): VaultNote[] {
  const q = filter.trim().toLowerCase();
  return notes
    .filter((n) => {
      if (scope.kind === "held" && !n.quarantined) return false;
      if (scope.kind === "folder" && !isBelow(n.path, scope.path)) return false;
      return (
        q === "" ||
        n.title.toLowerCase().includes(q) ||
        n.path.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => cmp(a.path, b.path) || cmp(a.id, b.id));
}
