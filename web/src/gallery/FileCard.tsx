// One file in the grid: a single button with the thumbnail or a type tile, the name, a quiet
// line of type, size and date, the owner on a colleague's file, and who can read it. The popover
// for a file the viewer cannot show is passed in and sits right after the button, so Tab walks
// from the card into it.
import { useState, type ReactNode } from "react";
import { kindLabel } from "./kind";
import { SharingMark } from "./Details";
import { viewableV1 as viewable } from "./filters";
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
  // A thumbnail link lives ten minutes and images load lazily, so on a page left open a link
  // can be dead by the time its card scrolls into view: show the type tile instead.
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = file.thumb && file.thumb !== broken ? file.thumb : null;
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
          {thumb ? (
            // A short-lived signed link: a plain <img>, never the image optimiser.
            <img
              src={thumb}
              onError={() => setBroken(thumb)}
              // An image that failed before the page became interactive fired its error with
              // nobody listening: it is complete and has no width.
              ref={(img) => {
                if (img?.complete && img.naturalWidth === 0) setBroken(thumb);
              }}
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
