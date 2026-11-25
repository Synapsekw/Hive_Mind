// One file in a grid: a single button with the thumbnail or a type tile, the name, and a quiet
// line of size and who can read it. Pressing it selects the file (the panel shows it); Enter on
// the selected card, or a double-click, opens the viewer when the file has one. The card can be
// dragged onto a folder in the sidebar.
import { useState } from "react";
import { SharingMark } from "./icons";
import { kindLabel } from "./kind";
import { PdfThumb } from "./preview/PdfThumb";
import { sharingText, sizeText } from "./text";
import type { GalleryFile } from "./types";
import s from "./gallery.module.css";

/** What a dragged card carries: the file's id, nothing else. */
export const DRAG_TYPE = "application/x-hive-file";

/** A sheet of paper with a folded corner, carrying the type as a mono label ("PDF", "PPTX"). */
export function Sheet({ file }: { file: GalleryFile }) {
  return (
    <span aria-hidden="true" className={s.sheet}>
      <span className={s.sheetLabel}>{kindLabel(file.kind, file.name)}</span>
    </span>
  );
}

/** The thumbnail, a PDF's first page, or the type tile; for the card and, larger, the panel. */
export function Preview({
  file,
  large = false,
}: {
  file: GalleryFile;
  large?: boolean;
}) {
  // A thumbnail link lives ten minutes and images load lazily, so on a page left open a link
  // can be dead by the time its card scrolls into view: show the type tile instead.
  const [broken, setBroken] = useState<string | null>(null);
  const thumb = file.thumb && file.thumb !== broken ? file.thumb : null;
  // A picture on the tile replaces the big sheet; the type then sits in a small corner badge.
  const [drawn, setDrawn] = useState(false);
  const isPdf = file.kind === "pdf" && !!file.thumb;
  const picture = isPdf ? drawn : !!thumb;
  const badge = (
    <span aria-hidden="true" className={s.badge}>
      {kindLabel(file.kind, file.name)}
    </span>
  );
  return (
    <span className={s.tile} data-large={large || undefined}>
      {isPdf ? (
        // A PDF's thumbnail link is the PDF itself: page 1 is drawn over the type tile.
        <>
          {!drawn && <Sheet file={file} />}
          <PdfThumb
            fileId={file.id}
            url={file.thumb!}
            onDrawn={() => setDrawn(true)}
          />
        </>
      ) : thumb ? (
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
          draggable={false}
          className={s.thumb}
        />
      ) : (
        <Sheet file={file} />
      )}
      {picture && badge}
    </span>
  );
}

export function FileCard({
  file,
  selected,
  onSelect,
  onOpen,
}: {
  file: GalleryFile;
  selected: boolean;
  onSelect: () => void;
  /** Opens the viewer; absent when the file has none. */
  onOpen?: () => void;
}) {
  const size = sizeText(file.size);
  return (
    <li className={s.cell}>
      <button
        type="button"
        className={s.card}
        data-file={file.id}
        aria-pressed={selected}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, file.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={onSelect}
        onDoubleClick={() => onOpen?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && selected && onOpen) {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <Preview file={file} />
        <span className={s.name} title={file.name}>
          {file.name}
        </span>
        <span className={s.sharing}>
          <SharingMark file={file} />
          <span className={s.sharingText}>
            {[size, sharingText(file)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}
