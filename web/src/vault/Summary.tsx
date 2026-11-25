// What the pane shows when no note is open: the workspace's counts and its latest notes, or, on
// "Shared with me", how much colleagues have shared. Everything comes from the loaded data.
import Link from "next/link";
import { shortDate } from "./format";
import type { overview, sharedOverview } from "./overview";
import {
  heldSentence,
  NEWEST,
  RECENTLY_CHANGED,
  REVIEW,
  SHARED_HEADING,
  sharedLine,
  STAT_LABELS,
} from "./sentences";
import type { VaultNote } from "./types";
import s from "./vault.module.css";

type Props = {
  hrefFor: (n: VaultNote) => string;
  now: number;
} & (
  | {
      kind: "workspace";
      name: string;
      data: ReturnType<typeof overview>;
      onReview: () => void;
    }
  | {
      kind: "shared";
      data: ReturnType<typeof sharedOverview>;
    }
);

function Links({
  label,
  notes,
  hrefFor,
  now,
}: {
  label: string;
  notes: VaultNote[];
  hrefFor: (n: VaultNote) => string;
  now: number;
}) {
  if (notes.length === 0) return null;
  return (
    <>
      <h3 className={s.overviewLabel}>{label}</h3>
      <ul className={s.rows}>
        {notes.map((n) => (
          <li key={n.id}>
            <Link href={hrefFor(n)} prefetch={false} className={s.row}>
              <span className={s.rowTop}>
                <span className={s.rowTitle}>{n.title}</span>
                <span className={s.rowMeta}>
                  {shortDate(n.updated_at, now)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Summary(props: Props) {
  if (props.kind === "shared") {
    const { data } = props;
    return (
      <div className={s.overview}>
        <h2 className={s.overviewTitle}>{SHARED_HEADING}</h2>
        <p className={s.overviewLine}>{sharedLine(data.notes, data.people)}</p>
        <Links
          label={NEWEST}
          notes={data.newest}
          hrefFor={props.hrefFor}
          now={props.now}
        />
      </div>
    );
  }
  const { data } = props;
  const stats = (["notes", "folders", "topics", "today"] as const).map((k) => ({
    key: k,
    n: data[k],
    word: STAT_LABELS[k][data[k] === 1 ? 0 : 1],
  }));
  return (
    <div className={s.overview}>
      <h2 className={s.overviewTitle}>{props.name}</h2>
      <dl className={s.stats}>
        {stats.map((x) => (
          <div key={x.key} className={s.stat}>
            <dt className={s.statWord}>{x.word}</dt>
            <dd className={s.statNumber}>{x.n}</dd>
          </div>
        ))}
      </dl>
      {data.held > 0 && (
        <div className={s.release}>
          <p className={s.overviewLine}>{heldSentence(data.held)}</p>
          <div>
            <button
              type="button"
              className={s.secondary}
              onClick={props.onReview}
            >
              {REVIEW}
            </button>
          </div>
        </div>
      )}
      <Links
        label={RECENTLY_CHANGED}
        notes={data.recent}
        hrefFor={props.hrefFor}
        now={props.now}
      />
    </div>
  );
}
