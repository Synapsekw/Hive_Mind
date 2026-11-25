// The note column: one link per note with its last change, an agent or held tag, and its
// sharing mark. On the shared tab the notes are grouped by owner. Every title is a text node.
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { shortDate } from "./format";
import { noteMark } from "./marks";
import { Glyph, markText, markTitle } from "./MarkTag";
import { rowTopics, topicsById } from "./rowTopics";
import type { VaultData, VaultNote, VaultTopic } from "./types";
import s from "./vault.module.css";

type RowProps = {
  note: VaultNote;
  current: boolean;
  href: string;
  now: number;
  members: VaultData["members"];
  showMark: boolean;
  topics: Map<string, VaultTopic>;
};

function Row({
  note,
  current,
  href,
  now,
  members,
  showMark,
  topics,
}: RowProps) {
  const mark = noteMark(note, members);
  const { shown, more } = rowTopics(note.topics, topics);
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={s.row}
        aria-current={current ? "page" : undefined}
      >
        <span className={s.rowTop}>
          <span className={s.rowTitle}>{note.title}</span>
          {showMark && mark.kind !== "private" && (
            <span className={s.rowMark} title={markTitle(mark)}>
              <Glyph kind={mark.kind} />
              <span className={s.srOnly}>{markText(mark)}</span>
            </span>
          )}
          {showMark && mark.kind === "private" && (
            <span className={s.srOnly}>Private</span>
          )}
        </span>
        <span className={s.rowMeta}>
          <span>{shortDate(note.updated_at, now)}</span>
          {note.quarantined && <span className={s.tag}>Held</span>}
          {note.by_agent && <span className={s.tag}>Agent</span>}
          {note.access === "link" && (
            <span className={s.tag}>Opened by a link</span>
          )}
          {shown.map((t) => (
            <span key={t.id} className={s.rowTopic}>
              {t.name}
            </span>
          ))}
          {more > 0 && <span className={s.rowTopic}>+{more}</span>}
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
  topics,
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
  topics: VaultTopic[];
  empty: string | null;
  more: string | null;
}) {
  const byId = useMemo(() => topicsById(topics), [topics]);
  const row = (n: VaultNote, showMark: boolean) => (
    <Row
      key={n.id}
      note={n}
      current={n.id === openId}
      href={hrefFor(n)}
      now={now}
      members={members}
      showMark={showMark}
      topics={byId}
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
