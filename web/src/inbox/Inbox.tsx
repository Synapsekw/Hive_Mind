"use client";

// The inbox screen: the links waiting for the person's answer and the notes an agent held
// back, as a list on the left and the one selected item with its decision on the right. The
// screen decides nothing about who may see what: it calls `actions` and the database answers.
// An item leaves when its action is answered `ok`, the next one is selected, and the page is
// then refreshed from the server so every count follows; a refused action keeps its item
// selected and says so. The selection and the decline question are client state only.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Shell } from "../shell/Shell";
import { FAILED, InboxDetail, type Current } from "./InboxDetail";
import { InboxList } from "./InboxList";
import {
  EMPTY_TEXT,
  EMPTY_TITLE,
  ONLY_YOU,
  OPEN_VAULT,
  inboxCount,
} from "./text";
import type { InboxActions, InboxData, Result } from "./types";
import { useOpening } from "./useOpening";
import s from "./inbox.module.css";

/** How long an answered row takes to collapse before it leaves the list. */
const LEAVE_MS = 350;
/** A confirming Decline sooner than this after the question opened is taken as a double click. */
const CONFIRM_AFTER_MS = 500;

/**
 * Where the focus goes after the next render, inside the detail pane: one of its controls, its
 * first action, or its heading.
 */
type Target =
  { pick: "keep" | "decline" } | { actions: true } | { heading: true };

type Entry = NonNullable<Current>;

const withId = (set: ReadonlySet<string>, id: string) => new Set(set).add(id);
const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

export function Inbox({
  data,
  now,
  actions,
}: {
  data: InboxData;
  now: number;
  actions: InboxActions;
}) {
  const router = useRouter();
  // Rows answered with `ok`. They stay out even if a refresh is slow to drop them.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // Rows answered with `ok` that are collapsing: they leave `gone` after LEAVE_MS.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // The row showing the decline question.
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // The selected item; `null` (or an id no longer listed) means the first one.
  const [selected, setSelected] = useState<string | null>(null);
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(new Set<string>());
  // The collapse timers, cleared on unmount so nothing refreshes after the page is left.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
      all.clear();
    };
  }, []);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const target = useRef<Target | null>(null);
  // When the decline question was last opened.
  const askedAt = useRef(0);

  const links = data.links.filter((l) => !gone.has(l.id));
  const held = data.held.filter((h) => !gone.has(h.id));
  // Only rows still in `data` are subtracted: after the refresh the server's totals already
  // leave them out, and they must not be taken off twice.
  const linksGone = data.links.length - links.length;
  const heldGone = data.held.length - held.length;
  const linksLeft = Math.max(0, data.linksTotal - linksGone);
  const heldLeft = Math.max(0, data.heldTotal - heldGone);
  const waiting = Math.max(0, inboxCount(data) - linksGone - heldGone);

  const items: Entry[] = [
    ...links.map((l) => ({ kind: "link" as const, item: l })),
    ...held.map((h) => ({ kind: "held" as const, item: h })),
  ];
  // A collapsing row is never the current one, even before the selection has moved on.
  const current: Current =
    items.find((i) => i.item.id === selected && !leaving.has(i.item.id)) ??
    items.find((i) => !leaving.has(i.item.id)) ??
    null;
  const currentId = current?.item.id ?? null;
  // Only ever the person's own note: `mine.id`, or the held note itself.
  const opening = useOpening(
    current === null
      ? null
      : current.kind === "link"
        ? current.item.mine.id
        : current.item.id,
    actions.noteOpening,
  );

  // Runs after every render, once the row that left is out of the page.
  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const pane = detailHeading.current?.closest("section");
    const control =
      "pick" in want
        ? pane?.querySelector<HTMLElement>(`[data-pick="${want.pick}"]`)
        : "actions" in want
          ? pane?.querySelector<HTMLElement>("[data-actions] :is(button, a)")
          : null;
    (control ?? detailHeading.current)?.focus();
  });

  /** True when the focus is in the detail pane, on this item's row, or nowhere. */
  function holdsFocus(id: string): boolean {
    const at = document.activeElement;
    if (!at || at === document.body) return true;
    const pane = detailHeading.current?.closest("section");
    return !!pane?.contains(at) || at.id === `opt-${id}`;
  }

  /** The item to select once `id` is answered: the next in its group, else the other group. */
  function nextAfter(id: string): string | null {
    const open = (list: { id: string }[]) =>
      list.filter((x) => x.id !== id && !running.current.has(x.id));
    const isLink = links.some((l) => l.id === id);
    const same = isLink ? links : held;
    const other = isLink ? held : links;
    const at = same.findIndex((x) => x.id === id);
    const after = open(same.slice(at + 1))[0];
    return (after ?? open(same)[0] ?? open(other)[0])?.id ?? null;
  }

  async function act(id: string, run: () => Promise<Result>, done: string) {
    if (running.current.has(id)) return;
    running.current.add(id);
    setBusy((set) => withId(set, id));
    setFailed((set) => without(set, id));
    setSaid("");
    let ok = false;
    try {
      ok = (await run()).ok === true;
    } catch {
      ok = false;
    }
    setAsking((open) => (open === id ? null : open));
    if (!ok) {
      running.current.delete(id);
      setBusy((set) => without(set, id));
      if (holdsFocus(id)) target.current = { actions: true };
      setFailed((set) => withId(set, id));
      setSaid(FAILED);
      // The row may be refused because it is no longer waiting (answered elsewhere): re-read,
      // so a row the server no longer lists leaves instead of failing for ever.
      router.refresh();
      return;
    }
    const next = nextAfter(id);
    // Move on only from the item answered; a person who has already picked another keeps it.
    setSelected((cur) => (cur === null || cur === id ? next : cur));
    if (holdsFocus(id)) target.current = { heading: true };
    setSaid(done);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // An answered row stays `running` and `busy` until it is gone, so a second press cannot
    // answer it again while it collapses.
    const leave = () => {
      running.current.delete(id);
      setBusy((set) => without(set, id));
      setGone((set) => withId(set, id));
      setLeaving((set) => without(set, id));
      router.refresh();
    };
    if (still) return leave();
    setLeaving((set) => withId(set, id));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      leave();
    }, LEAVE_MS);
    timers.current.add(timer);
  }

  function ask(id: string) {
    askedAt.current = Date.now();
    target.current = { pick: "keep" };
    setFailed((set) => without(set, id));
    setAsking(id);
  }

  function keep(id: string) {
    if (running.current.has(id)) return;
    target.current = { pick: "decline" };
    setAsking(null);
  }

  function select(id: string) {
    if (id === currentId) return;
    setSelected(id);
    // A question left open on one item is not carried to another.
    setAsking(null);
  }

  // Nothing loaded and nothing counted: one block instead of the columns.
  const empty =
    data.links.length + data.held.length === 0 && inboxCount(data) === 0;
  const id = currentId ?? "";

  return (
    <div className={s.root}>
      <Shell current="inbox" inbox={waiting} />
      <main
        aria-label="Inbox"
        className={`${s.panel} rise`}
        style={{ "--rise-delay": "0.08s" } as CSSProperties}
      >
        <header className={s.bar}>
          <h1 tabIndex={-1} className={s.title}>
            Inbox
            {waiting > 0 && (
              <span className={s.titleCount}>
                {waiting}
                <span className={s.srOnly}> waiting</span>
              </span>
            )}
          </h1>
          {waiting > 0 && <p className={s.lede}>{ONLY_YOU}</p>}
        </header>
        {empty ? (
          <div className={s.empty}>
            <p className={s.emptyTitle}>{EMPTY_TITLE}</p>
            <p className={s.emptyText}>{EMPTY_TEXT}</p>
            <Link href="/vault" className={s.secondary}>
              {OPEN_VAULT}
            </Link>
          </div>
        ) : (
          <div className={s.split}>
            <InboxList
              links={links}
              held={held}
              linksLeft={linksLeft}
              heldLeft={heldLeft}
              linksTotal={data.linksTotal}
              heldTotal={data.heldTotal}
              loadedLinks={data.links.length}
              loadedHeld={data.held.length}
              now={now}
              selectedId={currentId}
              leaving={leaving}
              onSelect={(to) => select(to)}
            />
            <InboxDetail
              current={current}
              opening={opening}
              now={now}
              busy={busy.has(id)}
              failed={failed.has(id)}
              asking={asking === id}
              waiting={waiting}
              headingRef={detailHeading}
              onAccept={() =>
                act(id, () => actions.respondToLink(id, true), "Link accepted.")
              }
              onAsk={() => ask(id)}
              onKeep={() => keep(id)}
              onDecline={() => {
                // The second press of a double click lands where the question has just put
                // this button: too soon to be an answer to it.
                if (Date.now() - askedAt.current < CONFIRM_AFTER_MS) return;
                void act(
                  id,
                  () => actions.respondToLink(id, false),
                  "Link declined.",
                );
              }}
              onRelease={() =>
                act(id, () => actions.releaseNote(id), "Note released.")
              }
            />
          </div>
        )}
        <p aria-live="polite" className={s.srOnly}>
          {said}
        </p>
      </main>
    </div>
  );
}
