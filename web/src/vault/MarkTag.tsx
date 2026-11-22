// A sharing mark: a shape (none for private, half-filled for named people, filled for the
// whole hive) and its words, so the meaning never rests on the shape alone.
import type { Mark } from "./marks";
import s from "./vault.module.css";

/** "Everyone, from clients": the rule folder is named by its last segment. */
export function markText(mark: Mark): string {
  if (!mark.from) return mark.label;
  return `${mark.label}, from ${mark.from.slice(mark.from.lastIndexOf("/") + 1)}`;
}

/** The same with the rule folder's whole path, for a tooltip. */
export function markTitle(mark: Mark): string {
  return mark.from ? `${mark.label}, from ${mark.from}` : mark.label;
}

export function Glyph({ kind }: { kind: Mark["kind"] }) {
  if (kind === "private") return null;
  return <span aria-hidden="true" className={s.glyph} data-kind={kind} />;
}

/** Shape and words. `quiet` hides the words visually but keeps them for screen readers. */
export function MarkTag({
  mark,
  quiet = false,
}: {
  mark: Mark;
  quiet?: boolean;
}) {
  const text = markText(mark);
  return (
    <span className={s.markTag} data-kind={mark.kind} title={markTitle(mark)}>
      <Glyph kind={mark.kind} />
      <span className={quiet ? s.srOnly : s.markText}>{text}</span>
    </span>
  );
}
