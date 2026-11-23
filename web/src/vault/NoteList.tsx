// The note column: one link per note with its last change, an agent or held tag, and its
// sharing mark. On the shared tab the notes are grouped by owner. Every title is a text node.
import Link from "next/link";
import type { ReactNode } from "react";
import { shortDate } from "./format";
import { noteMark } from "./marks";
import { MarkTag } from "./MarkTag";
import type { VaultData, VaultNote } from "./types";
import s from "./vault.module.css";

type RowProps = {
  note: VaultNote;
  current: boolean;
  href: string;
  now: number;
  members: VaultData["members"];
  showMark: boolean;
};

function Row({ note, current, href, now, members, showMark }: RowProps) {
  const mark = noteMark(note, members);
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={s.row}
        aria-current={current ? "page" : undefined}
      >
        <span className={s.rowTitle}>{note.title}</span>
        <span className={s.rowMeta}>
          <span>{shortDate(note.updated_at, now)}</span>
          {note.quarantined && <span className={s.tag}>Held</span>}
          {note.by_agent && <span className={s.tag}>Agent</span>}
          {note.access === "link" && (
            <span className={s.tag}>Opened by a link</span>
          )}
          {showMark && mark.kind !== "private" && (
            <span className={s.rowMark}>
              <MarkTag mark={mark} />
            </span>
          )}
          {showMark && mark.kind === "private" && (
            <span className={s.srOnly}>Private</span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function NoteList({
  header,
  notes,
  groups,
  openId,
  hrefFor,
  now,
  members,
  empty,
  more,
}: {
  header: ReactNode;
  notes: VaultNote[];
  /** On the shared tab: owner name and that owner's notes, newest first. */
  groups: { owner: string; notes: VaultNote[] }[] | null;
  openId: string | null;
  hrefFor: (n: VaultNote) => string;
  now: number;
  members: VaultData["members"];
  empty: string | null;
  more: string | null;
}) {
  const row = (n: VaultNote, showMark: boolean) => (
    <Row
      key={n.id}
      note={n}
      current={n.id === openId}
      href={hrefFor(n)}
      now={now}
      members={members}
      showMark={showMark}
    />
  );
  return (
    <div className={s.notes}>
      {header}
      <nav aria-label="Notes" className={s.noteNav}>
        {empty && <p className={s.empty}>{empty}</p>}
        {groups ? (
          groups.map((g) => (
            <section key={g.owner} className={s.group}>
              <h3 className={s.groupName}>{g.owner}</h3>
              <ul className={s.rows}>{g.notes.map((n) => row(n, false))}</ul>
            </section>
          ))
        ) : (
          <ul className={s.rows}>{notes.map((n) => row(n, true))}</ul>
        )}
        {more && <p className={s.more}>{more}</p>}
      </nav>
    </div>
  );
}
