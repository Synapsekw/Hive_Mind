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
import type { ImportActions } from "../import/types";
import { Shell } from "../shell/Shell";
import { Connect } from "./Connect";
import { CONNECT } from "./connectText";
import { Attach } from "./Attach";
import { ATTACH } from "./attachText";
import { Folders } from "./Folders";
import { Import } from "./Import";
import { IMPORT } from "./importText";
import { folderMark } from "./marks";
import { NoteList } from "./NoteList";
import { Preview } from "./Preview";
import { DELETE_FAILED, DELETED, UNLINK_FAILED } from "./sentences";
import { ShareControl } from "./ShareControl";
import { Tabs } from "./Tabs";
import { TopicList } from "./TopicList";
import {
  ALL_NOTES,
  added,
  BY_FOLDERS,
  BY_TOPICS,
  NO_TOPIC,
  removed,
  SWITCH,
} from "./topicText";
import { topicTree } from "./topicTree";
import { buildTree, notesIn, type Scope, type TreeNode } from "./tree";
import type { TopicChange, VaultActions, VaultData, VaultNote } from "./types";
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
  /** The left column: the folder tree or the topic list. */
  by: "folders" | "topics";
  /** The kinds open in the topic list. */
  kinds: Set<string>;
};

function fresh(data: VaultData, tab: string): Local {
  const open = data.open && "note" in data.open ? data.open.note : null;
  return {
    tab,
    scope: { kind: "all" },
    opened: new Set(open ? ancestors(open.path) : []),
    q: "",
    by: "folders",
    kinds: new Set(),
  };
}

export function Vault({
  data: served,
  now,
  actions,
  importer,
  inbox,
}: {
  data: VaultData;
  now: number;
  actions: VaultActions;
  /** Importing a folder of notes. Without it the vault offers no import. */
  importer?: ImportActions;
  /** How much waits in the inbox, for the rail. */
  inbox?: number;
}) {
  const base = usePathname();
  const router = useRouter();
  // Notes deleted here. They stay out even if a refresh is slow to drop them.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // Links ended here. They stay out even if a refresh is slow to drop them.
  const [unlinked, setUnlinked] = useState<ReadonlySet<string>>(new Set());
  // What the last delete came to, or that an unlink did not work. It is shown until the person
  // opens another note, deletes or unlinks again, or dismisses it.
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
  // The panel under the bar: the import, connecting wiki links, attaching topics, or none; never
  // two. While one is at work it cannot be closed and the others cannot be opened.
  const [panel, setPanel] = useState<"import" | "connect" | "attach" | null>(
    null,
  );
  const [panelBusy, setPanelBusy] = useState(false);
  // The workspace the connect and attach panels were opened on: they keep it, whatever tab is
  // opened meanwhile.
  const [connectIn, setConnectIn] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const importOpener = useRef<HTMLButtonElement>(null);
  const connectOpener = useRef<HTMLButtonElement>(null);
  const attachOpener = useRef<HTMLButtonElement>(null);
  const importing = panel === "import";
  const connecting = panel === "connect" && connectIn !== null;
  const attaching = panel === "attach" && connectIn !== null;
  function closeImport() {
    setPanel(null);
    importOpener.current?.focus();
  }
  function closeConnect() {
    setPanel(null);
    // Its opener is not there on "Shared with me", reached while a run was in flight: the
    // import's is, so the focus never falls to the page.
    (connectOpener.current ?? importOpener.current)?.focus();
  }
  function closeAttach() {
    setPanel(null);
    (attachOpener.current ?? importOpener.current)?.focus();
  }
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
    if (gone.size === 0 && unlinked.size === 0) return served;
    let open = served.open;
    if (open && "note" in open)
      open = gone.has(open.note.id)
        ? null
        : { ...open, links: open.links.filter((l) => !unlinked.has(l.id)) };
    return {
      ...served,
      notes: served.notes.filter((n) => !gone.has(n.id)),
      open,
    };
  }, [served, gone, unlinked]);

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

  // Ends a link of the open note. The database decides whether it may be ended and what is
  // still readable afterwards; the page is read again either way.
  async function unlink(linkId: string): Promise<boolean> {
    const from = wanted.current;
    setSaid(null);
    let ok = false;
    try {
      ok = (await actions.unlink(linkId)).ok === true;
    } catch {
      ok = false;
    }
    if (!ok) {
      setSaid({ text: UNLINK_FAILED, failed: true });
      router.refresh();
      return false;
    }
    // The row and its question leave the page. The focus goes to the open note's row in the
    // list, and only from the note the link was on, or from nowhere.
    const at = document.activeElement;
    const note = main.current?.querySelector('section[aria-label="Note"]');
    if (
      wanted.current === from &&
      (!at || at === document.body || note?.contains(at))
    )
      target.current = {
        row:
          main.current?.querySelector<HTMLElement>(
            'nav[aria-label="Notes"] a[aria-current="page"]',
          ) ?? null,
      };
    setUnlinked((set) => new Set(set).add(linkId));
    router.refresh();
    return true;
  }

  // Takes a topic off a note. The database decides whether the caller may; the page is read again
  // once, and only when it worked. A refusal is said beside the chips, not here.
  async function removeTopic(
    noteId: string,
    topicId: string,
  ): Promise<boolean> {
    setSaid(null);
    let ok = false;
    try {
      ok = (await actions.detachTopic(noteId, topicId)).ok === true;
    } catch {
      ok = false;
    }
    if (!ok) return false;
    const name = served.topics.find((t) => t.id === topicId)?.name ?? "";
    setSaid({ text: removed(name), failed: false });
    router.refresh();
    return true;
  }

  async function addTopic(
    noteId: string,
    topicId: string,
  ): Promise<TopicChange> {
    setSaid(null);
    let change: TopicChange = { ok: false, reason: "failed" };
    try {
      change = await actions.addTopic(noteId, topicId);
    } catch {
      change = { ok: false, reason: "failed" };
    }
    if (!change.ok) return change;
    const name = served.topics.find((t) => t.id === topicId)?.name ?? "";
    setSaid({ text: added(name), failed: false });
    router.refresh();
    return change;
  }

  const tabKey = data.tab.kind === "shared" ? "shared" : data.tab.id;
  const [local, setLocal] = useState<Local>(() => fresh(data, tabKey));
  // A new tab starts from "All notes" with nothing filtered.
  if (local.tab !== tabKey) {
    setLocal(fresh(data, tabKey));
    // The connect and attach panels belong to the workspace they were opened on. A run goes on
    // to its counts.
    if ((panel === "connect" || panel === "attach") && !panelBusy)
      setPanel(null);
  }

  const shared = data.tab.kind === "shared";
  const wsId = data.tab.kind === "workspace" ? data.tab.id : null;
  // A workspace tab is always one of the person's own.
  const ownWorkspace = wsId
    ? (data.workspaces.find((w) => w.id === wsId) ?? null)
    : null;
  const tree = useMemo(
    () => buildTree(data.notes, data.folders),
    [data.notes, data.folders],
  );
  const held = data.notes.filter((n) => n.quarantined).length;
  const byTopic = useMemo(
    () => topicTree(data.notes, data.topics),
    [data.notes, data.topics],
  );

  // Drop a chosen folder, "Held" or topic that the refreshed data no longer has.
  let scope = local.scope;
  const folderNode = scope.kind === "folder" ? find(tree, scope.path) : null;
  const topicNow = scope.kind === "topic" ? scope.id : null;
  if (
    (scope.kind === "folder" && !folderNode) ||
    (scope.kind === "held" && held === 0) ||
    (scope.kind === "topic" &&
      !byTopic.kinds.some((k) => k.topics.some((x) => x.id === topicNow))) ||
    (scope.kind === "untopiced" && byTopic.none === 0)
  )
    scope = { kind: "all" };

  const listed = notesIn(data.notes, scope, local.q);
  const groups = shared ? byOwner(listed, data) : null;

  const hrefWorkspace = (id: string) => `${base}?ws=${encodeURIComponent(id)}`;
  const hrefShared = `${base}?tab=shared`;
  // The note alone: the open note decides the tab.
  const hrefNote = (id: string) => `${base}?note=${encodeURIComponent(id)}`;
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
  if (scope.kind === "untopiced") title = NO_TOPIC;
  if (scope.kind === "topic")
    title = data.topics.find((x) => x.id === scope.id)?.name ?? ALL_NOTES;

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
          {importer && (
            <div className={s.openers}>
              <button
                ref={importOpener}
                type="button"
                className={s.secondary}
                aria-expanded={importing}
                aria-controls={importing ? "vault-import" : undefined}
                aria-disabled={panelBusy || undefined}
                onClick={() => {
                  if (panelBusy) return;
                  if (importing) closeImport();
                  else setPanel("import");
                }}
              >
                {IMPORT}
              </button>
              {ownWorkspace && (
                <button
                  ref={connectOpener}
                  type="button"
                  className={s.secondary}
                  aria-expanded={connecting}
                  aria-controls={connecting ? "vault-connect" : undefined}
                  aria-disabled={panelBusy || undefined}
                  onClick={() => {
                    if (panelBusy) return;
                    if (connecting) closeConnect();
                    else {
                      setConnectIn(ownWorkspace);
                      setPanel("connect");
                    }
                  }}
                >
                  {CONNECT}
                </button>
              )}
              {ownWorkspace && (
                <button
                  ref={attachOpener}
                  type="button"
                  className={s.secondary}
                  aria-expanded={attaching}
                  aria-controls={attaching ? "vault-attach" : undefined}
                  aria-disabled={panelBusy || undefined}
                  onClick={() => {
                    if (panelBusy) return;
                    if (attaching) closeAttach();
                    else {
                      setConnectIn(ownWorkspace);
                      setPanel("attach");
                    }
                  }}
                >
                  {ATTACH}
                </button>
              )}
            </div>
          )}
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
        {/* How the last delete or unlink went. The status element is always here, so it is announced. */}
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
        {importer && importing && (
          <Import
            workspaces={data.workspaces}
            current={wsId}
            actions={importer}
            hrefWorkspace={hrefWorkspace}
            onClose={closeImport}
            onBusy={setPanelBusy}
          />
        )}
        {importer && connecting && connectIn && (
          <Connect
            workspace={connectIn}
            connect={importer.connect}
            onClose={closeConnect}
            onBusy={setPanelBusy}
          />
        )}
        {importer && attaching && connectIn && (
          <Attach
            workspace={connectIn}
            attach={importer.attach}
            onClose={closeAttach}
            onBusy={setPanelBusy}
          />
        )}
        <div className={s.cols} data-shared={shared || undefined}>
          {!shared && (
            <div className={s.folders}>
              <div
                role="group"
                aria-label={SWITCH}
                className={`${s.tabs} ${s.switch}`}
              >
                {(
                  [
                    ["folders", BY_FOLDERS],
                    ["topics", BY_TOPICS],
                  ] as const
                ).map(([by, label]) => (
                  <button
                    key={by}
                    type="button"
                    className={s.tab}
                    aria-pressed={local.by === by}
                    onClick={() =>
                      setLocal((l) =>
                        l.by === by ? l : { ...l, by, scope: { kind: "all" } },
                      )
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {local.by === "topics" ? (
                <TopicList
                  tree={byTopic}
                  total={data.notes.length}
                  hiveEmpty={data.topics.length === 0}
                  scope={scope}
                  opened={local.kinds}
                  onScope={(next) => setLocal((l) => ({ ...l, scope: next }))}
                  onToggle={(kind) =>
                    setLocal((l) => {
                      const kinds = new Set(l.kinds);
                      if (kinds.has(kind)) kinds.delete(kind);
                      else kinds.add(kind);
                      return { ...l, kinds };
                    })
                  }
                />
              ) : (
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
            </div>
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
            onUnlink={unlink}
            onRemoveTopic={removeTopic}
            onAddTopic={addTopic}
            hrefNote={hrefNote}
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
