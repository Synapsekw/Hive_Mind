"use client";

// The gallery screen. The only state holder: the loaded files, the tab, the filter and which
// file is open, all client state, so tabs, filtering and selecting a card make no request.
// Opening, downloading, deleting and loading more go through `actions`; the database decides
// what they may do. A deleted file leaves the list in place and nothing is re-read.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Shell } from "../shell/Shell";
import { useSlidingPill } from "../shell/useSlidingPill";
import pillCss from "../shell/SlidingPill.module.css";
import { Details } from "./Details";
import { FileCard } from "./FileCard";
import { defaultTab, tabCounts, viewable, visibleFiles } from "./select";
import type { GalleryActions, GalleryData, Tab } from "./types";
import { Viewer } from "./Viewer";
import s from "./gallery.module.css";

const TABS: { key: Tab; label: string }[] = [
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared with me" },
  { key: "all", label: "All" },
];

/** Where the focus goes after the next render: a file's card, or the filter when none is left. */
type Target = { card: string } | { filter: true };

export function Gallery({
  data,
  now,
  actions,
  inbox,
}: {
  data: GalleryData;
  now: number;
  actions: GalleryActions;
  /** How much waits in the inbox, for the rail. */
  inbox?: number;
}) {
  const [files, setFiles] = useState(data.files);
  const [next, setNext] = useState(data.next);
  const [tab, setTab] = useState<Tab>(() => defaultTab(data.files));
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  // The open file as of now, for answers that arrive from an earlier render (see `removed`).
  const openNow = useRef<string | null>(null);
  useEffect(() => {
    openNow.current = open;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const target = useRef<Target | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const pill = useSlidingPill(group, '[aria-pressed="true"]', tab);

  const counts = tabCounts(files);
  const shown = visibleFiles(files, tab, filter);
  const slides = shown.filter(viewable);
  const opened = shown.find((f) => f.id === open) ?? null;
  const viewing = opened !== null && viewable(opened);
  const slide = viewing ? slides.findIndex((f) => f.id === opened.id) : -1;

  // Runs after every render, once the viewer is gone and the page is no longer inert.
  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const card =
      "card" in want
        ? [
            ...(scroller.current?.querySelectorAll<HTMLElement>(
              "[data-file]",
            ) ?? []),
          ].find((el) => el.dataset.file === want.card)
        : null;
    (card ?? search.current)?.focus();
  });

  function close(back = true) {
    if (back && open) target.current = { card: open };
    setOpen(null);
  }

  function move(by: -1 | 1) {
    const to = slides[slide + by];
    if (slide !== -1 && to) setOpen(to.id);
  }

  function removed(id: string) {
    setFiles((list) => list.filter((f) => f.id !== id));
    // The answer can arrive after the person has moved on to another file: only when the
    // deleted file is still the open one does its viewer or popover close and the focus move.
    if (openNow.current !== id) return;
    const at = shown.findIndex((f) => f.id === id);
    const beside = shown[at + 1] ?? shown[at - 1];
    target.current = beside ? { card: beside.id } : { filter: true };
    setOpen(null);
  }

  async function more() {
    if (!next || loading) return;
    setLoading(true);
    setError(null);
    let page: Awaited<ReturnType<GalleryActions["loadMore"]>> = null;
    try {
      page = await actions.loadMore(next);
    } catch {
      page = null;
    }
    setLoading(false);
    if (!page) return setError("Couldn't load more files.");
    const have = new Set(files.map((f) => f.id));
    const fresh = page.files.filter((f) => !have.has(f.id));
    // "Load more" may be gone after this: the focus moves to the first file it brought.
    const firstShown = visibleFiles(fresh, tab, filter)[0];
    target.current = firstShown ? { card: firstShown.id } : { filter: true };
    setFiles((list) => {
      const ids = new Set(list.map((f) => f.id));
      return [...list, ...fresh.filter((f) => !ids.has(f.id))];
    });
    setNext(page.next);
  }

  let empty: string | null = null;
  if (files.length === 0)
    empty = "No files yet. Files your agents save appear here.";
  else if (shown.length === 0) empty = "No files match.";

  return (
    <div className={s.root}>
      <div className={s.page} inert={viewing || undefined}>
        <Shell current="gallery" inbox={inbox} />
        <main
          aria-label="Gallery"
          className={`${s.panel} rise`}
          style={{ "--rise-delay": "0.08s" } as CSSProperties}
        >
          <div className={s.bar}>
            <div ref={group} role="group" aria-label="Show" className={s.tabs}>
              <span aria-hidden="true" className={pillCss.pill} style={pill} />
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={s.tab}
                  aria-pressed={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setOpen(null);
                    scroller.current?.scrollTo({ top: 0 });
                  }}
                >
                  {t.label} <span className={s.count}>{counts[t.key]}</span>
                  <span className={s.srOnly}>
                    {counts[t.key] === 1 ? " file" : " files"}
                  </span>
                </button>
              ))}
            </div>
            <div className={s.filter}>
              <input
                ref={search}
                type="search"
                aria-label="Filter files"
                placeholder="Filter by name"
                className={s.search}
                value={filter}
                onChange={(e) => {
                  setFilter(e.currentTarget.value);
                  setOpen(null);
                }}
              />
            </div>
          </div>
          <div ref={scroller} className={s.scroller}>
            {empty ? (
              <p role="status" className={s.empty}>
                {empty}
              </p>
            ) : (
              <ul role="list" aria-label="Files" className={s.grid}>
                {shown.map((f) => {
                  const expanded = !viewing && opened?.id === f.id;
                  return (
                    <FileCard
                      key={f.id}
                      file={f}
                      now={now}
                      expanded={expanded}
                      onSelect={() => setOpen(expanded ? null : f.id)}
                    >
                      {expanded && (
                        <Details
                          file={f}
                          actions={actions}
                          onClose={close}
                          onDeleted={removed}
                        />
                      )}
                    </FileCard>
                  );
                })}
              </ul>
            )}
            {(next || error) && (
              <div className={s.foot}>
                {error && (
                  <p role="alert" className={s.refused}>
                    {error}
                  </p>
                )}
                {next && (
                  <button
                    type="button"
                    className={s.secondary}
                    aria-busy={loading || undefined}
                    onClick={more}
                  >
                    {loading ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
      {viewing && (
        <Viewer
          file={opened}
          position={slide + 1}
          total={slides.length}
          now={now}
          actions={actions}
          onMove={move}
          onClose={close}
          onDeleted={removed}
        />
      )}
    </div>
  );
}
