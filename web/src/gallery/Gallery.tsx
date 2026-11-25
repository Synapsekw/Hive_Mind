"use client";

// The gallery screen and its only state holder: the loaded files, sessions, folders and which
// files each folder holds, the filters (backed by the address), the selected file, the open
// viewer and an upload in progress. Children get values and callbacks.
//
// Scopes, chips, folders, the view switch and selecting a card are client state over the loaded
// files: no request. Only when more files exist than are loaded and a server-side filter is on
// (`needsServer`) is the server asked, once per change after a 250 ms pause; an answer to an
// earlier change, or one arriving after the server filter is gone, is dropped. A server answer
// pages like the unfiltered list: "Load more" asks for the same filter after its last file. Every write goes through `actions`; the database decides what it
// may do, and the screen changes only when the server agrees.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Shell } from "../shell/Shell";
import { useSlidingPill } from "../shell/useSlidingPill";
import pillCss from "../shell/SlidingPill.module.css";
import { AddToFolder } from "./AddToFolder";
import { FileCard } from "./FileCard";
import { Facts, FilePanel } from "./FilePanel";
import { FilterBar } from "./FilterBar";
import {
  applyFilters,
  DEFAULT_FILTERS,
  folderTree,
  groupBySession,
  needsServer,
  scopeCounts,
  toServerFilter,
  viewable as canView,
} from "./filters";
import { SessionStream } from "./SessionStream";
import { Sidebar } from "./Sidebar";
import { uploadTitle } from "./text";
import type {
  Cursor,
  Filters,
  GalleryActions,
  GalleryData,
  GalleryFile,
  GalleryFolder,
  GallerySession,
  NoteChoice,
  NoteRef,
  View,
} from "./types";
import { UploadDialog } from "./UploadDialog";
import { useGalleryUrl } from "./useGalleryUrl";
import { Viewer } from "./Viewer";
import s from "./gallery.module.css";

const PAUSE = 250;
const VIEWS: { key: View; label: string }[] = [
  { key: "session", label: "By session" },
  { key: "grid", label: "Grid" },
];
const EMPTY = new Set<string>();

type Memberships = Map<string, Set<string>>;

/** Adds the folders each file says it is in. */
function withFolders(m: Memberships, files: GalleryFile[]): Memberships {
  const next = new Map(m);
  for (const f of files)
    for (const id of f.folders) {
      const set = new Set(next.get(id) ?? []);
      set.add(f.id);
      next.set(id, set);
    }
  return next;
}

function withSessions(
  m: Map<string, GallerySession>,
  list: GallerySession[],
): Map<string, GallerySession> {
  if (list.length === 0) return m;
  const next = new Map(m);
  for (const x of list) if (!next.has(x.id)) next.set(x.id, x);
  return next;
}

/** Appends the files not there yet. */
function merge(list: GalleryFile[], more: GalleryFile[]): GalleryFile[] {
  const have = new Set(list.map((f) => f.id));
  return [...list, ...more.filter((f) => !have.has(f.id))];
}

const newestFirst = (a: GalleryFile, b: GalleryFile) =>
  b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

export function Gallery({
  data,
  now,
  actions,
  inbox,
  viewable = canView,
}: {
  data: GalleryData;
  now: number;
  actions: GalleryActions;
  /** How much waits in the inbox, for the rail. */
  inbox?: number;
  /** Which files open in the viewer (the dev page can open every file). */
  viewable?: (f: GalleryFile) => boolean;
}) {
  const [files, setFiles] = useState(data.files);
  const [sessions, setSessions] = useState(
    () => new Map(data.sessions.map((x) => [x.id, x])),
  );
  const [folders, setFolders] = useState<GalleryFolder[]>(data.folders);
  // Every membership the loader handed over (files not loaded yet included), and the loaded
  // files' own.
  const [memberships, setMemberships] = useState<Memberships>(() => {
    const m: Memberships = new Map();
    for (const { folder_id, file_id } of data.memberships ?? [])
      m.set(folder_id, (m.get(folder_id) ?? new Set()).add(file_id));
    return withFolders(m, data.files);
  });
  const [filters, setFilters] = useGalleryUrl();
  const [next, setNext] = useState(data.next);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [serverResult, setServerResult] = useState<{
    key: string;
    files: GalleryFile[];
    next: Cursor | null;
  } | null>(null);
  const [serverError, setServerError] = useState(false);
  const [uploading, setUploading] = useState<File[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  // The files as of now, for an upload that ends after renders it did not see.
  const filesNow = useRef(files);
  useEffect(() => {
    filesNow.current = files;
  });
  const focusCard = useRef<string | null>(null);
  const asked = useRef(0);
  const views = useRef<HTMLDivElement>(null);
  const pill = useSlidingPill(views, '[aria-pressed="true"]', filters.view);

  const folderFiles = (id: string) => memberships.get(id) ?? EMPTY;
  const tree = useMemo(() => folderTree(folders), [folders]);
  const ordered = useMemo(
    () => tree.flatMap((t) => [t.folder, ...t.children]),
    [tree],
  );

  // The server is asked only when the loaded files cannot answer.
  const serverKey = needsServer(filters, next === null)
    ? JSON.stringify(toServerFilter(filters, now))
    : null;
  useEffect(() => {
    // Every change of the server filter, its clearing included, outdates what is on its way.
    const turn = ++asked.current;
    setMoreError(false);
    if (serverKey === null) {
      setServerError(false);
      return;
    }
    const timer = setTimeout(async () => {
      let page: Awaited<ReturnType<GalleryActions["loadPage"]>> = null;
      try {
        page = await actions.loadPage(JSON.parse(serverKey), null);
      } catch {
        page = null;
      }
      if (turn !== asked.current) return;
      setServerError(!page);
      if (!page) return;
      setServerResult({ key: serverKey, files: page.files, next: page.next });
      setSessions((m) => withSessions(m, page.sessions));
      setMemberships((m) => withFolders(m, page.files));
    }, PAUSE);
    return () => clearTimeout(timer);
    // `actions` are the server's, fixed for the page: only the filter starts a new ask.
  }, [serverKey]);

  // While the server's answer is on its way, the loaded files that match stand in for it.
  const pool =
    serverKey !== null && serverResult?.key === serverKey
      ? serverResult.files
      : files;
  const shown = applyFilters(pool, filters, sessions, folderFiles, now);
  const groups =
    filters.view === "session" ? groupBySession(shown, sessions) : null;
  const inOrder = groups
    ? groups.flatMap((g) => g.files)
    : [...shown].sort(newestFirst);
  const slides = inOrder.filter(viewable);
  const slide = viewing ? slides.findIndex((f) => f.id === viewing) : -1;
  const picked = shown.find((f) => f.id === selected) ?? null;

  const counts = scopeCounts(files);
  const loadedIds = useMemo(() => new Set(files.map((f) => f.id)), [files]);
  const folderCounts = new Map(
    folders.map((f) => [
      f.id,
      [...folderFiles(f.id)].filter((id) => loadedIds.has(id)).length,
    ]),
  );
  const holdingOf = (fileId: string) =>
    new Set(
      folders.filter((f) => folderFiles(f.id).has(fileId)).map((f) => f.id),
    );
  const sessionList = [...sessions.values()].sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  );
  const agents = [...new Set(sessionList.map((x) => x.agent))];

  // Runs after every render, once the viewer is gone and the page is no longer inert.
  useEffect(() => {
    const want = focusCard.current;
    if (!want) return;
    focusCard.current = null;
    [...(scroller.current?.querySelectorAll<HTMLElement>("[data-file]") ?? [])]
      .find((el) => el.dataset.file === want)
      ?.focus();
  });

  function change(patch: Partial<Filters>) {
    setFilters({ ...filters, ...patch });
  }

  /** The same change to a file wherever it is held. */
  function patchFile(id: string, fn: (f: GalleryFile) => GalleryFile) {
    const apply = (list: GalleryFile[]) =>
      list.map((f) => (f.id === id ? fn(f) : f));
    setFiles(apply);
    setServerResult((r) => (r ? { ...r, files: apply(r.files) } : r));
  }

  function setMember(folderId: string, fileId: string, on: boolean) {
    setMemberships((m) => {
      const nextMap = new Map(m);
      const set = new Set(nextMap.get(folderId) ?? []);
      if (on) set.add(fileId);
      else set.delete(fileId);
      nextMap.set(folderId, set);
      return nextMap;
    });
  }

  async function toggleFolder(folderId: string, fileId: string, on: boolean) {
    let ok = false;
    try {
      ok = (
        on
          ? await actions.addToFolder(folderId, [fileId])
          : await actions.removeFromFolder(folderId, fileId)
      ).ok;
    } catch {
      ok = false;
    }
    if (ok) setMember(folderId, fileId, on);
    return ok;
  }

  async function createFolder(name: string, parentId: string | null) {
    let made: GalleryFolder | null = null;
    try {
      made = await actions.createFolder(name, parentId);
    } catch {
      made = null;
    }
    if (made) setFolders((list) => [...list, made]);
    return !!made;
  }

  async function renameFolder(id: string, name: string) {
    let ok = false;
    try {
      ok = (await actions.renameFolder(id, name)).ok;
    } catch {
      ok = false;
    }
    if (ok)
      setFolders((list) => list.map((f) => (f.id === id ? { ...f, name } : f)));
    return ok;
  }

  async function deleteFolder(id: string) {
    let ok = false;
    try {
      ok = (await actions.deleteFolder(id)).ok;
    } catch {
      ok = false;
    }
    if (!ok) return false;
    // Its sub-folders go with it; the files stay.
    const gone = new Set([
      id,
      ...folders.filter((f) => f.parent_id === id).map((f) => f.id),
    ]);
    setFolders((list) => list.filter((f) => !gone.has(f.id)));
    setMemberships((m) => new Map([...m].filter(([k]) => !gone.has(k))));
    if (filters.folder && gone.has(filters.folder)) change({ folder: null });
    return true;
  }

  async function deleteFile(id: string) {
    let ok = false;
    try {
      ok = (await actions.deleteFile(id)).ok;
    } catch {
      ok = false;
    }
    if (!ok) return false;
    const drop = (list: GalleryFile[]) => list.filter((f) => f.id !== id);
    setFiles(drop);
    setServerResult((r) => (r ? { ...r, files: drop(r.files) } : r));
    setSelected((x) => (x === id ? null : x));
    setViewing((x) => (x === id ? null : x));
    return true;
  }

  async function setHome(id: string, note: NoteChoice | null) {
    let ok = false;
    try {
      ok = (await actions.setHome(id, note ? note.id : null)).ok;
    } catch {
      ok = false;
    }
    // Who can read it stays as loaded until the next load: the database works that out.
    if (ok)
      patchFile(id, (f) => ({
        ...f,
        note: note ? { id: note.id, title: note.title } : null,
      }));
    return ok;
  }

  function added(file: GalleryFile, batch: string, note: NoteRef) {
    setFiles((list) => merge([file], list));
    // Shown under a server filter too, when it matches (applyFilters decides, as for any file).
    setServerResult((r) => (r ? { ...r, files: merge([file], r.files) } : r));
    setMemberships((m) => withFolders(m, [file]));
    setSessions((m) =>
      m.has(batch)
        ? m
        : new Map(m).set(batch, {
            id: batch,
            title: uploadTitle(file.created_at),
            agent: "Browser upload",
            started_at: file.created_at,
            ended_at: null,
            note,
            mine: true,
          }),
    );
  }

  function ended(batch: string) {
    setSessions((m) => {
      const x = m.get(batch);
      if (!x) return m;
      const last = filesNow.current
        .filter((f) => f.session_id === batch)
        .reduce((t, f) => (f.created_at > t ? f.created_at : t), x.started_at);
      return new Map(m).set(batch, { ...x, ended_at: last });
    });
  }

  async function more() {
    if (!next || loading) return;
    setLoading(true);
    setMoreError(false);
    let page: Awaited<ReturnType<GalleryActions["loadPage"]>> = null;
    try {
      page = await actions.loadPage(toServerFilter(DEFAULT_FILTERS, now), next);
    } catch {
      page = null;
    }
    setLoading(false);
    if (!page) return setMoreError(true);
    const fresh = page.files;
    setFiles((list) => merge(list, fresh));
    setSessions((m) => withSessions(m, page.sessions));
    setMemberships((m) => withFolders(m, fresh));
    setNext(page.next);
  }

  /** The next page of the server's answer, for the same filter. */
  async function moreFiltered() {
    const key = serverKey;
    const after = serverResult?.key === key ? serverResult.next : null;
    if (key === null || !after || loading) return;
    const turn = asked.current;
    setLoading(true);
    setMoreError(false);
    let page: Awaited<ReturnType<GalleryActions["loadPage"]>> = null;
    try {
      page = await actions.loadPage(JSON.parse(key), after);
    } catch {
      page = null;
    }
    setLoading(false);
    // The filter changed or was cleared while this was on its way.
    if (turn !== asked.current) return;
    if (!page) return setMoreError(true);
    const fresh = page.files;
    const cursor = page.next;
    setServerResult((r) =>
      r && r.key === key
        ? { key, files: merge(r.files, fresh), next: cursor }
        : r,
    );
    setSessions((m) => withSessions(m, page.sessions));
    setMemberships((m) => withFolders(m, fresh));
  }

  function open(id: string) {
    setSelected(id);
    setViewing(id);
  }

  function closeViewer() {
    focusCard.current = viewing;
    setViewing(null);
  }

  const card = (f: GalleryFile) => (
    <FileCard
      key={f.id}
      file={f}
      selected={selected === f.id}
      onSelect={() => setSelected(f.id)}
      onOpen={viewable(f) ? () => open(f.id) : undefined}
    />
  );

  const clearChips = () =>
    change({
      kinds: [],
      date: "any",
      from: null,
      to: null,
      session: null,
      agent: null,
      owner: null,
    });
  const clearEverything = () =>
    setFilters({ ...DEFAULT_FILTERS, view: filters.view });

  let empty: ReactNode = null;
  if (files.length === 0 && pool.length === 0)
    empty =
      "No files yet. Files your agents save, and files you upload, appear here.";
  else if (shown.length === 0)
    empty = (
      <>
        No files match these filters.{" "}
        <button
          type="button"
          className={s.textButton}
          onClick={clearEverything}
        >
          Clear all
        </button>
      </>
    );

  // Where "Load more" continues: the unfiltered list, or the server's answer to this filter.
  const moreAfter =
    serverKey === null
      ? next
      : serverResult?.key === serverKey
        ? serverResult.next
        : null;

  const viewed = slide !== -1 ? slides[slide]! : null;
  const sessionOf = (f: GalleryFile) =>
    (f.session_id && sessions.get(f.session_id)) || null;
  const modal = viewed !== null || uploading !== null;

  return (
    <div className={s.root}>
      <div className={s.page} inert={modal || undefined}>
        <Shell current="gallery" inbox={inbox} />
        <main
          aria-label="Gallery"
          className={`${s.panel} rise`}
          data-panel={picked ? "" : undefined}
          style={{ "--rise-delay": "0.08s" } as CSSProperties}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            const dropped = [...e.dataTransfer.files];
            if (dropped.length === 0) return;
            e.preventDefault();
            setUploading(dropped);
          }}
        >
          <Sidebar
            counts={counts}
            scope={filters.scope}
            folder={filters.folder}
            tree={tree}
            folderCounts={folderCounts}
            onScope={(scope) => change({ scope, folder: null })}
            onFolder={(folder) => change({ folder })}
            onCreate={createFolder}
            onRename={renameFolder}
            onDelete={deleteFolder}
            onDropFile={(folderId, fileId) => {
              if (!folderFiles(folderId).has(fileId))
                void toggleFolder(folderId, fileId, true);
            }}
          />
          <div className={s.center}>
            <div className={s.bar}>
              <div
                ref={views}
                role="group"
                aria-label="View"
                className={s.tabs}
              >
                <span
                  aria-hidden="true"
                  className={pillCss.pill}
                  style={pill}
                />
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className={s.tab}
                    aria-pressed={filters.view === v.key}
                    onClick={() => {
                      change({ view: v.key });
                      scroller.current?.scrollTo({ top: 0 });
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <div className={s.filter}>
                <input
                  type="search"
                  aria-label="Filter by name"
                  placeholder="Filter by name"
                  className={s.search}
                  value={filters.q}
                  maxLength={200}
                  onChange={(e) => change({ q: e.currentTarget.value })}
                />
              </div>
              <button
                type="button"
                className={s.primary}
                onClick={() => setUploading([])}
              >
                Upload
              </button>
            </div>
            <FilterBar
              filters={filters}
              sessions={sessionList}
              agents={agents}
              members={data.members}
              onChange={change}
              onClearAll={clearChips}
            />
            <div ref={scroller} className={s.scroller}>
              {serverError && (
                <p role="alert" className={s.refused}>
                  Couldn&apos;t search the older files. These are the loaded
                  ones.
                </p>
              )}
              {empty ? (
                <p role="status" className={s.empty}>
                  {empty}
                </p>
              ) : groups ? (
                <SessionStream groups={groups} now={now} card={card} />
              ) : (
                <ul role="list" aria-label="Files" className={s.grid}>
                  {inOrder.map(card)}
                </ul>
              )}
              {(moreAfter || moreError) && (
                <div className={s.foot}>
                  {moreError && (
                    <p role="alert" className={s.refused}>
                      Couldn&apos;t load more files.
                    </p>
                  )}
                  {moreAfter && (
                    <button
                      type="button"
                      className={s.secondary}
                      aria-busy={loading || undefined}
                      onClick={serverKey === null ? more : moreFiltered}
                    >
                      {loading ? "Loading…" : "Load more"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {picked && (
            <FilePanel
              key={picked.id}
              file={picked}
              session={sessionOf(picked)}
              folders={ordered}
              holding={holdingOf(picked.id)}
              now={now}
              actions={actions}
              onOpen={viewable(picked) ? () => open(picked.id) : undefined}
              onClose={() => {
                focusCard.current = picked.id;
                setSelected(null);
              }}
              onDelete={() => deleteFile(picked.id)}
              onToggleFolder={(folderId, on) =>
                toggleFolder(folderId, picked.id, on)
              }
              onSetHome={(note) => setHome(picked.id, note)}
            />
          )}
        </main>
      </div>
      {viewed && (
        <Viewer
          files={slides}
          index={slide}
          actions={actions}
          onMove={(to) => {
            const f = slides[to];
            if (f) open(f.id);
          }}
          onClose={closeViewer}
          aside={
            <Facts
              file={viewed}
              session={sessionOf(viewed)}
              folders={ordered}
              holding={holdingOf(viewed.id)}
              now={now}
            />
          }
          toolbar={
            <AddToFolder
              key={viewed.id}
              folders={ordered}
              holding={holdingOf(viewed.id)}
              onToggle={(folderId, on) => toggleFolder(folderId, viewed.id, on)}
            />
          }
        />
      )}
      {uploading && (
        <UploadDialog
          files={uploading}
          folders={ordered}
          actions={actions}
          onAdded={added}
          onEnded={ended}
          onClose={() => setUploading(null)}
        />
      )}
    </div>
  );
}
