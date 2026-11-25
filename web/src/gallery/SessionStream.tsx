// The "By session" view: one group per agent session, newest first, each headed by its title,
// agent, time span, count and a link to its note when the note is readable; files no session
// saved come last, under "No session". The cards are drawn by the screen.
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { spanText } from "./text";
import type { GalleryFile, GallerySession } from "./types";
import s from "./gallery.module.css";

export type Group = { session: GallerySession | null; files: GalleryFile[] };

function Header({
  session,
  count,
  now,
  id,
}: {
  session: GallerySession | null;
  count: number;
  now: number;
  id: string;
}) {
  const files = `${count} ${count === 1 ? "file" : "files"}`;
  return (
    <header className={s.groupHead}>
      <h3 id={id} className={s.groupTitle}>
        {session ? session.title : "No session"}
      </h3>
      <p className={s.groupMeta}>
        {session && (
          <>
            <span>{session.agent}</span>
            <span aria-hidden="true">·</span>
            <span>{spanText(session, now)}</span>
            {!session.ended_at && (
              <span className={s.openMark}>
                <span aria-hidden="true" className={s.openDot} />
                open
              </span>
            )}
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{files}</span>
      </p>
      {session?.note && (
        <Link
          href={`/vault?note=${encodeURIComponent(session.note.id)}`}
          prefetch={false}
          className={s.groupLink}
        >
          Session note
        </Link>
      )}
    </header>
  );
}

function GroupSection({
  group,
  now,
  card,
}: {
  group: Group;
  now: number;
  card: (f: GalleryFile) => ReactNode;
}) {
  const id = useId();
  const title = group.session ? group.session.title : "No session";
  return (
    <section aria-labelledby={id} className={s.group}>
      <Header
        session={group.session}
        count={group.files.length}
        now={now}
        id={id}
      />
      <ul role="list" aria-label={`Files from ${title}`} className={s.grid}>
        {group.files.map(card)}
      </ul>
    </section>
  );
}

export function SessionStream({
  groups,
  now,
  card,
}: {
  groups: Group[];
  now: number;
  card: (f: GalleryFile) => ReactNode;
}) {
  return (
    <div className={s.stream}>
      {groups.map((g) => (
        <GroupSection
          key={g.session?.id ?? "none"}
          group={g}
          now={now}
          card={card}
        />
      ))}
    </div>
  );
}
