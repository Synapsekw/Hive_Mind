"use client";

// The inbox's left column: everything waiting, as one listbox of two groups. A row only says
// what it is; the decision is in the detail pane beside it. ↑/↓ move the selection across both
// groups, Home and End go to the ends, Enter or a click opens a row. The selection is the
// screen's (`Inbox.tsx`), kept in client state.
import { useRef, type KeyboardEvent } from "react";
import { shortDate } from "../vault/format";
import { linkLine, proposer, theyAccepted, tierReason } from "./text";
import type { HeldItem, LinkItem } from "./types";
import s from "./inbox.module.css";

export function InboxList({
  links,
  held,
  linksLeft,
  heldLeft,
  linksTotal,
  heldTotal,
  loadedLinks,
  loadedHeld,
  now,
  selectedId,
  leaving,
  onSelect,
}: {
  links: LinkItem[];
  held: HeldItem[];
  linksLeft: number;
  heldLeft: number;
  linksTotal: number;
  heldTotal: number;
  loadedLinks: number;
  loadedHeld: number;
  now: number;
  selectedId: string | null;
  leaving: ReadonlySet<string>;
  /** `open`: Enter or a click, as opposed to moving with the arrow keys. */
  onSelect: (id: string, open: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = [
      ...(box.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([data-leaving])',
      ) ?? []),
    ];
    if (all.length === 0) return;
    const from = (e.target as HTMLElement).closest<HTMLElement>(
      '[role="option"]',
    );
    if (e.key === "Enter") {
      if (!from?.dataset.row) return;
      e.preventDefault();
      onSelect(from.dataset.row, true);
      return;
    }
    const at = all.findIndex((el) => el === from);
    const to =
      e.key === "ArrowDown"
        ? all[Math.min(at + 1, all.length - 1)]
        : e.key === "ArrowUp"
          ? all[Math.max(at - 1, 0)]
          : e.key === "Home"
            ? all[0]
            : e.key === "End"
              ? all[all.length - 1]
              : undefined;
    if (!to?.dataset.row) return;
    e.preventDefault();
    onSelect(to.dataset.row, false);
    to.focus();
  }

  const option = (id: string) => ({
    role: "option" as const,
    id: `opt-${id}`,
    "data-row": id,
    "aria-selected": id === selectedId,
    tabIndex: id === selectedId && !leaving.has(id) ? 0 : -1,
    "data-leaving": leaving.has(id) || undefined,
    inert: leaving.has(id) || undefined,
    className: s.option,
    onClick: () => onSelect(id, true),
  });

  return (
    <div
      ref={box}
      role="listbox"
      aria-label="Waiting for you"
      className={s.list}
      onKeyDown={onKeyDown}
    >
      {links.length > 0 && (
        <div role="group" aria-labelledby="inbox-links" className={s.group}>
          <h2 className={s.label}>
            <span id="inbox-links">Links to decide</span>
            <span className={s.count}>{linksLeft}</span>
          </h2>
          {links.map((l) => {
            const line = linkLine(l);
            return (
              <div key={l.id} {...option(l.id)}>
                <div className={s.optionBody}>
                  <p className={s.what}>
                    Link <em className={s.own}>{line.mine}</em> {line.rest}
                  </p>
                  <p className={s.meta}>
                    <span>{proposer(l)}</span>
                    <span>{tierReason(l.tier)}</span>
                    <span>{shortDate(l.createdAt, now)}</span>
                  </p>
                  {l.theyAccepted && (
                    <span className={s.tag}>
                      {theyAccepted(l.theirs.memberName)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {linksTotal > loadedLinks && (
            <p className={s.more}>Showing the newest 100 of {linksTotal}.</p>
          )}
        </div>
      )}
      {held.length > 0 && (
        <div role="group" aria-labelledby="inbox-held" className={s.group}>
          <h2 className={s.label}>
            <span id="inbox-held">Held notes</span>
            <span className={s.count}>{heldLeft}</span>
          </h2>
          {held.map((h) => (
            <div key={h.id} {...option(h.id)}>
              <div className={s.optionBody}>
                <p className={s.what}>
                  <span className={s.heldTitle}>{h.title || h.path}</span>
                </p>
                <p className={s.meta}>
                  <span>{h.agentName ?? "An agent"}</span>
                  <span>{shortDate(h.updatedAt, now)}</span>
                  <span className={s.metaPath}>{h.path}</span>
                </p>
              </div>
            </div>
          ))}
          {heldTotal > loadedHeld && (
            <p className={s.more}>Showing the newest 100 of {heldTotal}.</p>
          )}
        </div>
      )}
    </div>
  );
}
