"use client";

// The inbox screen: the links waiting for the person's answer and the notes an agent held
// back, each with its decision beside it. The screen decides nothing about who may see what:
// it calls `actions` and the database answers. A row leaves when its action is answered
// `ok`, and the page is then refreshed from the server so every count follows; a refused
// action keeps its row and says so. The decline question is client state only.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Shell } from "../shell/Shell";
import { shortDate } from "../vault/format";
import {
  acceptEffect,
  inboxCount,
  proposer,
  theirNote,
  tierReason,
  vaultHref,
} from "./text";
import type {
  HeldItem,
  InboxActions,
  InboxData,
  LinkItem,
  Result,
} from "./types";
import s from "./inbox.module.css";

const FAILED = "That didn't work. Try again.";

/** Where the focus goes after the next render: a control of a row, or the heading. */
type Target = { row: string; pick?: "keep" | "decline" } | { heading: true };

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
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // The row showing the decline question.
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const target = useRef<Target | null>(null);

  const links = data.links.filter((l) => !gone.has(l.id));
  const held = data.held.filter((h) => !gone.has(h.id));
  // Only rows still in `data` are subtracted: after the refresh the server's totals already
  // leave them out, and they must not be taken off twice.
  const linksGone = data.links.length - links.length;
  const heldGone = data.held.length - held.length;
  const linksLeft = Math.max(0, data.linksTotal - linksGone);
  const heldLeft = Math.max(0, data.heldTotal - heldGone);
  const waiting = Math.max(0, inboxCount(data) - linksGone - heldGone);

  // Runs after every render, once the row that left is out of the page.
  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    if ("heading" in want) return heading.current?.focus();
    const row = rowOf(want.row);
    const control = want.pick
      ? row?.querySelector<HTMLElement>(`[data-pick="${want.pick}"]`)
      : row?.querySelector<HTMLElement>("[data-actions] :is(button, a)");
    (control ?? heading.current)?.focus();
  });

  function rowOf(id: string): HTMLElement | null {
    const rows = scroller.current?.querySelectorAll<HTMLElement>("[data-row]");
    return [...(rows ?? [])].find((el) => el.dataset.row === id) ?? null;
  }

  /** True when the focus is in this row, or nowhere: the only times it may be moved. */
  function holdsFocus(id: string): boolean {
    const at = document.activeElement;
    return !at || at === document.body || !!rowOf(id)?.contains(at);
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
    running.current.delete(id);
    setBusy((set) => without(set, id));
    setAsking((open) => (open === id ? null : open));
    if (!ok) {
      if (holdsFocus(id)) target.current = { row: id };
      setFailed((set) => withId(set, id));
      setSaid(FAILED);
      return;
    }
    if (holdsFocus(id)) {
      // The next row's first action; the one before when this was the last; else the heading.
      const rows = [
        ...(scroller.current?.querySelectorAll<HTMLElement>("[data-row]") ??
          []),
      ];
      const at = rows.findIndex((el) => el.dataset.row === id);
      const beside = rows[at + 1] ?? rows[at - 1];
      target.current = beside?.dataset.row
        ? { row: beside.dataset.row }
        : { heading: true };
    }
    setGone((set) => withId(set, id));
    setSaid(done);
    router.refresh();
  }

  function ask(id: string) {
    target.current = { row: id, pick: "keep" };
    setFailed((set) => without(set, id));
    setAsking(id);
  }

  function keep(id: string) {
    if (running.current.has(id)) return;
    target.current = { row: id, pick: "decline" };
    setAsking(null);
  }

  const nothing = links.length === 0 && held.length === 0;

  return (
    <div className={s.root}>
      <Shell current="inbox" inbox={waiting} />
      <main aria-label="Inbox" className={s.panel}>
        <header className={s.bar}>
          <h1 ref={heading} tabIndex={-1} className={s.title}>
            Inbox
            {waiting > 0 && (
              <span className={s.titleCount}>
                {waiting}
                <span className={s.srOnly}> waiting</span>
              </span>
            )}
          </h1>
          {!nothing && (
            <p className={s.lede}>
              Only you can answer these. Your agents can&apos;t.
            </p>
          )}
        </header>
        <div ref={scroller} className={s.scroller}>
          {links.length > 0 && (
            <section aria-labelledby="inbox-links" className={s.section}>
              <div className={s.sectionHead}>
                <h2 className={s.label}>
                  <span id="inbox-links">Links to decide</span>
                  <span className={s.count}>{linksLeft}</span>
                </h2>
              </div>
              <ul role="list" aria-label="Links to decide" className={s.rows}>
                {links.map((l) => (
                  <LinkRow
                    key={l.id}
                    item={l}
                    now={now}
                    busy={busy.has(l.id)}
                    failed={failed.has(l.id)}
                    asking={asking === l.id}
                    onAccept={() =>
                      act(
                        l.id,
                        () => actions.respondToLink(l.id, true),
                        "Link accepted.",
                      )
                    }
                    onAsk={() => ask(l.id)}
                    onKeep={() => keep(l.id)}
                    onDecline={() =>
                      act(
                        l.id,
                        () => actions.respondToLink(l.id, false),
                        "Link declined.",
                      )
                    }
                  />
                ))}
              </ul>
              {data.linksTotal > data.links.length && (
                <p className={s.more}>
                  Showing the newest 100 of {data.linksTotal}.
                </p>
              )}
            </section>
          )}
          {held.length > 0 && (
            <section aria-labelledby="inbox-held" className={s.section}>
              <div className={s.sectionHead}>
                <h2 className={s.label}>
                  <span id="inbox-held">Held notes</span>
                  <span className={s.count}>{heldLeft}</span>
                </h2>
                <p className={s.note}>
                  A held note is visible only to you until you release it.
                </p>
              </div>
              <ul role="list" aria-label="Held notes" className={s.rows}>
                {held.map((h) => (
                  <HeldRow
                    key={h.id}
                    item={h}
                    now={now}
                    busy={busy.has(h.id)}
                    failed={failed.has(h.id)}
                    onRelease={() =>
                      act(
                        h.id,
                        () => actions.releaseNote(h.id),
                        "Note released.",
                      )
                    }
                  />
                ))}
              </ul>
              {data.heldTotal > data.held.length && (
                <p className={s.more}>
                  Showing the newest 100 of {data.heldTotal}.
                </p>
              )}
            </section>
          )}
          {nothing &&
            (waiting > 0 ? (
              <div className={s.empty}>
                <p className={s.emptyTitle}>That&apos;s this page done.</p>
                <p className={s.emptyText}>
                  {waiting} more {waiting === 1 ? "is" : "are"} waiting. Reload
                  the page to see them.
                </p>
              </div>
            ) : (
              <div className={s.empty}>
                <p className={s.emptyTitle}>Nothing needs you.</p>
                <p className={s.emptyText}>
                  Links your agents propose between your notes and a
                  colleague&apos;s, and notes held for your release, appear
                  here.
                </p>
              </div>
            ))}
        </div>
        <p aria-live="polite" className={s.srOnly}>
          {said}
        </p>
      </main>
    </div>
  );
}

function LinkRow({
  item,
  now,
  busy,
  failed,
  asking,
  onAccept,
  onAsk,
  onKeep,
  onDecline,
}: {
  item: LinkItem;
  now: number;
  busy: boolean;
  failed: boolean;
  asking: boolean;
  onAccept: () => void;
  onAsk: () => void;
  onKeep: () => void;
  onDecline: () => void;
}) {
  const title = item.mine.title || item.mine.path;
  const off = busy || undefined;
  return (
    <li
      data-row={item.id}
      className={s.item}
      aria-busy={off}
      onKeyDown={(e) => {
        if (e.key === "Escape" && asking) onKeep();
      }}
    >
      <div className={s.text}>
        <p className={s.what}>
          Link your note{" "}
          <Link
            href={vaultHref(item.mine.workspaceId, item.mine.id)}
            className={s.own}
          >
            {title}
          </Link>{" "}
          with {theirNote(item)}
        </p>
        <p className={s.meta}>
          <span>{proposer(item)}</span>
          <span>{tierReason(item.tier)}</span>
          <span>{shortDate(item.createdAt, now)}</span>
        </p>
        <p className={s.effect}>
          <span aria-hidden="true" className={s.glyph} />
          <span>{acceptEffect(item)}</span>
        </p>
      </div>
      <div className={s.side}>
        <div
          role="group"
          aria-label={`Answer for ${title}`}
          data-actions
          className={s.actions}
        >
          {asking ? (
            <>
              <p className={s.ask}>Decline for good?</p>
              <button
                type="button"
                data-pick="decline"
                className={s.confirm}
                aria-disabled={off}
                onClick={onDecline}
              >
                Decline
              </button>
              <button
                type="button"
                data-pick="keep"
                className={s.secondary}
                aria-disabled={off}
                onClick={onKeep}
              >
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={s.primary}
                aria-disabled={off}
                onClick={onAccept}
              >
                Accept
              </button>
              <button
                type="button"
                data-pick="decline"
                className={s.secondary}
                aria-disabled={off}
                onClick={busy ? undefined : onAsk}
              >
                Decline
              </button>
            </>
          )}
        </div>
        {failed && <p className={s.refused}>{FAILED}</p>}
      </div>
    </li>
  );
}

function HeldRow({
  item,
  now,
  busy,
  failed,
  onRelease,
}: {
  item: HeldItem;
  now: number;
  busy: boolean;
  failed: boolean;
  onRelease: () => void;
}) {
  const title = item.title || item.path;
  return (
    <li data-row={item.id} className={s.item} aria-busy={busy || undefined}>
      <div className={s.text}>
        <p className={s.what}>
          <span className={s.heldTitle}>{title}</span>
        </p>
        <p className={s.path}>{item.path}</p>
        <p className={s.meta}>
          <span>
            {item.agentName
              ? `Written by ${item.agentName}`
              : "Written by an agent"}
          </span>
          <span>{shortDate(item.updatedAt, now)}</span>
        </p>
      </div>
      <div className={s.side}>
        <div
          role="group"
          aria-label={`Answer for ${title}`}
          data-actions
          className={s.actions}
        >
          <button
            type="button"
            className={s.primary}
            aria-disabled={busy || undefined}
            onClick={onRelease}
          >
            Release
          </button>
          <Link
            href={vaultHref(item.workspaceId, item.id)}
            className={s.secondary}
          >
            Open in vault
          </Link>
        </div>
        {failed && <p className={s.refused}>{FAILED}</p>}
      </div>
    </li>
  );
}
