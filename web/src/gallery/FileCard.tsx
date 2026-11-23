// One file in the grid: a single button with the thumbnail or a type tile, the name, a quiet
// line of type, size and date, the owner on a colleague's file, and who can read it. The popover
// for a file the viewer cannot show is passed in and sits right after the button, so Tab walks
// from the card into it.
import type { ReactNode } from "react";
import { kindLabel } from "./kind";
import { SharingMark } from "./Details";
import { viewable } from "./select";
import { metaLine, sharingText } from "./text";
import type { GalleryFile } from "./types";
import s from "./gallery.module.css";

/** A sheet of paper with a folded corner, carrying the type as a mono label ("PDF", "PPTX"). */
export function Sheet({ file }: { file: GalleryFile }) {
  return (
    <span aria-hidden="true" className={s.sheet}>
      <span className={s.sheetLabel}>{kindLabel(file.kind, file.name)}</span>
    </span>
  );
}

export function FileCard({
  file,
  now,
  expanded,
  onSelect,
  children,
}: {
  file: GalleryFile;
  now: number;
  /** Whether this card's popover is open. */
  expanded: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const shows = viewable(file);
  const sharing = sharingText(file);
  return (
    <li className={s.cell} data-open={expanded || undefined}>
      <button
        type="button"
        className={s.card}
        data-file={file.id}
        aria-haspopup={shows ? "dialog" : undefined}
        aria-expanded={shows ? undefined : expanded}
        onClick={onSelect}
      >
        <span className={s.tile}>
          {file.thumb ? (
            // A short-lived signed link: a plain <img>, never the image optimiser.
            <img
              src={file.thumb}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className={s.thumb}
            />
          ) : (
            <Sheet file={file} />
          )}
        </span>
        <span className={s.name} title={file.name}>
          {file.name}
        </span>
        <span className={s.meta}>{metaLine(file, now)}</span>
        {!file.mine && <span className={s.owner}>{file.owner}</span>}
        <span className={s.sharing}>
          <SharingMark file={file} />
          <span className={s.sharingText}>{sharing}</span>
        </span>
      </button>
      {children}
    </li>
  );
}
