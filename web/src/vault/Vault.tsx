"use client";

// The vault screen. The only state holder: the chosen folder, the open folders and the filter,
// all client state that survives choosing a note. The tab and the open note come from the URL;
// writes go through `actions`, and the database decides whether they are allowed.
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Shell } from "../shell/Shell";
import { Folders } from "./Folders";
import { folderMark } from "./marks";
import { NoteList } from "./NoteList";
import { Preview } from "./Preview";
import { ShareControl } from "./ShareControl";
import { Tabs } from "./Tabs";
import { buildTree, notesIn, type Scope, type TreeNode } from "./tree";
import type { VaultActions, VaultData, VaultNote } from "./types";
import s from "./vault.module.css";

const ancestors = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

function find(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children) {
    if (path === c.path || path.startsWith(`${c.path}/`)) return find(c, path);
  }
  return null;
}

const count = (n: number) =>
  `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${n === 1 ? "note" : "notes"}`;

type Local = {
  tab: string;
  scope: Scope;
  opened: Set<string>;
  q: string;
};

function fresh(data: VaultData, tab: string): Local {
  const open = data.open && "note" in data.open ? data.open.note : null;
  return {
    tab,
    scope: { kind: "all" },
    opened: new Set(open ? ancestors(open.path) : []),
    q: "",
  };
}

export function Vault({
  data,
  now,
  actions,
  inbox,
}: {
  data: VaultData;
  now: number;
  actions: VaultActions;
  /** How much waits in the inbox, for the rail. */
  inbox?: number;
}) {
  const base = usePathname();
  const tabKey = data.tab.kind === "shared" ? "shared" : data.tab.id;
  const [local, setLocal] = useState<Local>(() => fresh(data, tabKey));
  // A new tab starts from "All notes" with nothing filtered.
  if (local.tab !== tabKey) setLocal(fresh(data, tabKey));

  const shared = data.tab.kind === "shared";
  const wsId = data.tab.kind === "workspace" ? data.tab.id : null;
  const tree = useMemo(
    () => buildTree(data.notes, data.folders),
    [data.notes, data.folders],
  );
  const held = data.notes.filter((n) => n.quarantined).length;

  // Drop a chosen folder or "Held" that the refreshed data no longer has.
  let scope = local.scope;
  const folderNode = scope.kind === "folder" ? find(tree, scope.path) : null;
  if (
    (scope.kind === "folder" && !folderNode) ||
    (scope.kind === "held" && held === 0)
  )
    scope = { kind: "all" };

  const listed = notesIn(data.notes, scope, local.q);
  const groups = shared ? byOwner(listed, data) : null;

  const hrefWorkspace = (id: string) => `${base}?ws=${encodeURIComponent(id)}`;
  const hrefShared = `${base}?tab=shared`;
  const hrefFor = (n: VaultNote) =>
    shared
      ? `${hrefShared}&note=${encodeURIComponent(n.id)}`
      : `${hrefWorkspace(wsId!)}&note=${encodeURIComponent(n.id)}`;

  const openId = data.open && "note" in data.open ? data.open.note.id : null;

  let empty: string | null = null;
  if (data.notes.length === 0)
    empty = shared
      ? "Nobody has shared a note with you yet."
      : "Nothing here yet. Notes your agent writes appear in this workspace.";
  else if (listed.length === 0) empty = "No notes match the filter.";

  const more = data.truncated
    ? shared
      ? "Showing the first 500 notes."
      : "Showing the first 2,000 notes."
    : null;

  let title = shared ? "Shared with me" : "All notes";
  if (scope.kind === "held") title = "Held";
  if (scope.kind === "folder") title = scope.path;

  const header = (
    <div className={s.listHead}>
      <div className={s.listTitleRow}>
        <h2 className={s.listTitle} title={title}>
          {title}
        </h2>
        <span className={s.listCount}>{count(listed.length)}</span>
      </div>
      {scope.kind === "folder" && folderNode && wsId && (
        <ShareControl
          key={`${wsId}:${scope.path}`}
          subject="folder"
          path={scope.path}
          mark={folderMark(folderNode.rule, data.members)}
          current={
            folderNode.rule
              ? {
                  visibility: folderNode.rule.visibility,
                  shared_with: folderNode.rule.shared_with,
                }
              : { visibility: null, shared_with: [] }
          }
          hive={data.hive}
          members={data.members}
          me={data.me}
          loadPreview={() => actions.preview(wsId, scope.path)}
          onSave={(c) => actions.saveFolder(wsId, scope.path, c)}
        />
      )}
    </div>
  );

  return (
    <div className={s.root}>
      <Shell current="vault" inbox={inbox} />
      <main aria-label="Vault" className={s.panel}>
        <div className={s.bar}>
          <Tabs
            data={data}
            hrefWorkspace={hrefWorkspace}
            hrefShared={hrefShared}
          />
          <label className={s.filter}>
            <span className={s.srOnly}>Filter notes</span>
            <input
              type="search"
              className={s.search}
              placeholder="Filter by title or path"
              value={local.q}
              onChange={(e) => {
                const q = e.currentTarget.value;
                setLocal((l) => ({ ...l, q }));
              }}
            />
          </label>
        </div>
        <div className={s.cols} data-shared={shared || undefined}>
          {!shared && (
            <Folders
              root={tree}
              scope={scope}
              opened={local.opened}
              held={held}
              members={data.members}
              onScope={(next) =>
                setLocal((l) => {
                  const opened = new Set(l.opened);
                  if (next.kind === "folder") opened.add(next.path);
                  return { ...l, scope: next, opened };
                })
              }
              onToggle={(path) =>
                setLocal((l) => {
                  const opened = new Set(l.opened);
                  if (opened.has(path)) opened.delete(path);
                  else opened.add(path);
                  return { ...l, opened };
                })
              }
            />
          )}
          <NoteList
            header={header}
            notes={listed}
            groups={groups}
            openId={openId}
            hrefFor={hrefFor}
            now={now}
            members={data.members}
            empty={empty}
            more={more}
          />
          <Preview
            data={data}
            onSave={actions.saveNote}
            onRelease={actions.release}
          />
        </div>
      </main>
    </div>
  );
}

/** Owners by name; each owner's notes newest first. */
function byOwner(notes: VaultNote[], data: VaultData) {
  const name = (id: string) =>
    data.members.find((m) => m.id === id)?.display_name ?? "Someone";
  const map = new Map<string, VaultNote[]>();
  for (const n of notes) {
    const key = name(n.member_id);
    map.set(key, [...(map.get(key) ?? []), n]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([owner, list]) => ({
      owner,
      notes: [...list].sort((a, b) =>
        a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
      ),
    }));
}
