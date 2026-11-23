"use client";

// The vault screen. The only state holder: the chosen folder, the open folders and the filter,
// all client state that survives choosing a note. The tab and the open note come from the URL;
// writes go through `actions`, and the database decides whether they are allowed.
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { Shell } from "../shell/Shell";
import { Folders } from "./Folders";
import { folderMark } from "./marks";
import { NoteList } from "./NoteList";
import { Preview } from "./Preview";
import { DELETE_FAILED, DELETED } from "./sentences";
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
  data: served,
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
  const router = useRouter();
  // Notes deleted here. They stay out even if a refresh is slow to drop them.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // What the last delete came to. It is shown until the person opens another note, deletes
  // again or dismisses it.
  const [said, setSaid] = useState<{ text: string; failed: boolean } | null>(
    null,
  );
  // The note this screen shows or is on its way to: the one last served, or the one the person
  // last asked for. The address is not asked; it changes only once a note has arrived.
  const servedOpen =
    served.open && "note" in served.open ? served.open.note.id : null;
  const wanted = useRef<string | null>(servedOpen);
  // A note that arrives is the one shown. A note that stops being served is not the person
  // going elsewhere: it may be the very note a delete has just removed.
  useEffect(() => {
    if (servedOpen) wanted.current = servedOpen;
  }, [servedOpen]);
  // Deletes on their way, by note: a second request for the same note joins the first.
  const deleting = useRef(new Map<string, Promise<boolean>>());
  const main = useRef<HTMLElement>(null);
  // Where the focus goes once a deleted note has left the page.
  const target = useRef<{ row: HTMLElement | null } | null>(null);

  // A press on a link to this screen says which note is wanted next, before it arrives.
  function follow(e: MouseEvent<HTMLElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const link = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target === "_blank") return;
    const to = new URL(link.href, window.location.href);
    if (to.origin !== window.location.origin || to.pathname !== base) return;
    const id = to.searchParams.get("note");
    if (id && id !== wanted.current) setSaid(null);
    wanted.current = id;
  }

  function dismiss() {
    // The button leaves the page: the focus goes to the open note's row, else as after a delete.
    target.current = {
      row:
        main.current?.querySelector<HTMLElement>(
          'nav[aria-label="Notes"] a[aria-current="page"]',
        ) ?? null,
    };
    setSaid(null);
  }

  const data = useMemo<VaultData>(() => {
    if (gone.size === 0) return served;
    const open = served.open;
    return {
      ...served,
      notes: served.notes.filter((n) => !gone.has(n.id)),
      open: open && "note" in open && gone.has(open.note.id) ? null : open,
    };
  }, [served, gone]);

  // Runs after every render, once the deleted note's row is out of the page.
  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    // The row beside the deleted one; else the first note; else the open tab.
    const next =
      (want.row?.isConnected ? want.row : null) ??
      main.current?.querySelector<HTMLElement>('nav[aria-label="Notes"] a') ??
      main.current?.querySelector<HTMLElement>(
        'nav[aria-label="Workspaces"] [aria-current="page"]',
      );
    next?.focus();
  });

  // The tab on screen when Delete was pressed.
  const shown = served.tab;
  function deleteNote(id: string): Promise<boolean> {
    const pending = deleting.current.get(id);
    if (pending) return pending;
    const run = (async () => {
      setSaid(null);
      let ok = false;
      try {
        ok = (await actions.deleteNote(id)).ok === true;
      } catch {
        ok = false;
      }
      deleting.current.delete(id);
      if (!ok) {
        setSaid({ text: DELETE_FAILED, failed: true });
        // It may have been refused because the note is already gone: re-read.
        router.refresh();
        return false;
      }
      // Asked of what the person last opened, not of this render or of the address: they may
      // have opened another note while the delete ran, and that one must stay open.
      const stillOpen = wanted.current === id;
      const at = document.activeElement;
      const note = main.current?.querySelector('section[aria-label="Note"]');
      // The focus is moved only from the note that is leaving, or from nowhere.
      if (stillOpen && (!at || at === document.body || note?.contains(at))) {
        const rows = [
          ...(main.current?.querySelectorAll<HTMLElement>(
            'nav[aria-label="Notes"] a',
          ) ?? []),
        ];
        const i = rows.findIndex(
          (el) => el.getAttribute("aria-current") === "page",
        );
        target.current = {
          row: i < 0 ? null : (rows[i + 1] ?? rows[i - 1] ?? null),
        };
      }
      setGone((set) => new Set(set).add(id));
      setSaid({ text: DELETED, failed: false });
      if (stillOpen) {
        // Close the note: the same address without it. The note chose the tab, so the address
        // now names that tab itself; else a bare link to the note would fall back to the first
        // workspace.
        wanted.current = null;
        const q = new URLSearchParams(window.location.search);
        q.delete("note");
        if (shown.kind === "shared") {
          q.delete("ws");
          q.set("tab", "shared");
        } else {
          q.delete("tab");
          q.set("ws", shown.id);
        }
        router.replace(`${base}?${q}`, { scroll: false });
      }
      router.refresh();
      return true;
    })();
    deleting.current.set(id, run);
    return run;
  }

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
      <main
        ref={main}
        aria-label="Vault"
        className={`${s.panel} rise`}
        style={{ "--rise-delay": "0.08s" } as CSSProperties}
        onClickCapture={follow}
      >
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
        {/* How the last delete went. The status element is always here, so it is announced. */}
        <div
          className={said ? s.said : s.srOnly}
          data-failed={said?.failed || undefined}
        >
          <p role="status" className={s.saidText}>
            {said?.text ?? ""}
          </p>
          {said && (
            <button
              type="button"
              className={s.quiet}
              aria-label="Dismiss message"
              onClick={dismiss}
            >
              Dismiss
            </button>
          )}
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
            onDelete={deleteNote}
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
