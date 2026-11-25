"use client";

// The full-window viewer. It shows one file of the current view and moves through that view
// with the arrows. Opening a file asks the server for a fresh link every time, and an answer
// for a file that is no longer on screen is dropped. What the link holds is never run as a page
// of ours:
//   - an image is only ever the source of an <img>, which draws pixels and runs nothing;
//   - a PDF, text or CSV file is fetched through `fetchChecked`, which refuses bytes that are not
//     what they claim; a PDF is drawn by pdf.js into canvases (no scripts, no annotation layer)
//     and text and CSV cells are text nodes, never HTML.
// Anything else, and anything that fails those checks, shows its type tile and Download.
import { useEffect, useRef, useState } from "react";
import { Chevron, Cross } from "./icons";
import { Sheet } from "./FileCard";
import { kindLabel, PDF_VIEW_MAX, TEXT_VIEW_MAX } from "./kind";
import { CsvView } from "./preview/CsvView";
import { fetchChecked } from "./preview/fetchChecked";
import { PdfView } from "./preview/PdfView";
import { TextView } from "./preview/TextView";
import { sizeText } from "./text";
import type { GalleryFile, ViewerProps } from "./types";
import { useDownload } from "./useDownload";
import s from "./gallery.module.css";
import p from "./preview/preview.module.css";

const CSV_VIEW_MAX = 2 * 1024 * 1024;

type Shown =
  | { phase: "opening" }
  | { phase: "image"; url: string }
  | { phase: "pdf"; blob: Blob }
  | { phase: "text"; blob: Blob }
  | { phase: "csv"; blob: Blob }
  /** The server gave no link. */
  | { phase: "refused" }
  /** No preview for this kind, or the bytes failed the checks. */
  | { phase: "tile" };

/** Whether the viewer draws this file at all; anything else goes straight to its tile. */
function previewable(f: GalleryFile): boolean {
  return (
    f.kind === "image" ||
    f.kind === "text" ||
    f.kind === "csv" ||
    (f.kind === "pdf" && f.size <= PDF_VIEW_MAX)
  );
}

function Tile({
  file,
  text,
  download,
}: {
  file: GalleryFile;
  text: string;
  download: () => Promise<boolean>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={s.instead}>
      <Sheet file={file} />
      <p role="status" className={s.insteadText}>
        {text}
      </p>
      <button
        type="button"
        className={s.secondary}
        onClick={async () => setFailed(!(await download()))}
      >
        Download
      </button>
      {failed && (
        <p role="alert" className={s.refused}>
          Couldn&apos;t download the file.
        </p>
      )}
    </div>
  );
}

/** One file on the stage. Keyed by the file, so each file starts from "opening". */
function Stage({
  file,
  actions,
}: {
  file: GalleryFile;
  actions: ViewerProps["actions"];
}) {
  const shows = previewable(file);
  const [shown, setShown] = useState<Shown>(
    shows ? { phase: "opening" } : { phase: "tile" },
  );
  const openFile = useRef(actions.openFile);
  useEffect(() => {
    openFile.current = actions.openFile;
  });
  const download = useDownload(actions.downloadFile, file.id);

  useEffect(() => {
    if (!shows) return;
    let live = true;
    const abort = new AbortController();
    (async () => {
      let link: Awaited<ReturnType<ViewerProps["actions"]["openFile"]>> = null;
      try {
        link = await openFile.current(file.id);
      } catch {
        link = null;
      }
      if (!live) return;
      if (!link) return setShown({ phase: "refused" });
      // The link must be for the kind the file is listed as; anything else is not drawn.
      if (link.kind !== file.kind) return setShown({ phase: "tile" });
      if (link.kind === "image")
        return setShown({ phase: "image", url: link.url });
      const max =
        link.kind === "pdf"
          ? PDF_VIEW_MAX
          : link.kind === "csv"
            ? CSV_VIEW_MAX
            : TEXT_VIEW_MAX;
      if (link.kind !== "pdf" && link.kind !== "text" && link.kind !== "csv")
        return setShown({ phase: "tile" });
      const got = await fetchChecked(link.url, link.kind, max, abort.signal);
      if (!live) return;
      if (!got.ok) return setShown({ phase: "tile" });
      setShown({ phase: link.kind, blob: got.blob });
    })();
    return () => {
      live = false;
      abort.abort();
    };
  }, [file.id, file.kind, shows]);

  switch (shown.phase) {
    case "opening":
      return (
        <p role="status" className={s.stageNote}>
          Opening…
        </p>
      );
    case "refused":
      return (
        <Tile file={file} text="Couldn't open the file." download={download} />
      );
    case "tile":
      return (
        <Tile
          file={file}
          text="No preview yet for this kind of file. Download to open it."
          download={download}
        />
      );
    case "image":
      return (
        <img
          src={shown.url}
          alt={file.name}
          referrerPolicy="no-referrer"
          className={s.shot}
          onError={() => setShown({ phase: "tile" })}
        />
      );
    case "pdf":
      return <PdfView blob={shown.blob} name={file.name} />;
    case "text":
      return (
        <TextView
          blob={shown.blob}
          name={file.name}
          truncated={file.size > TEXT_VIEW_MAX}
        />
      );
    case "csv":
      return <CsvView blob={shown.blob} name={file.name} />;
  }
}

/** Where a key press should be left alone: typing in a field of the info strip or toolbar. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.isContentEditable ||
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT")
  );
}

export function Viewer({
  files,
  index,
  actions,
  onMove,
  onClose,
  aside,
  toolbar,
}: ViewerProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const file = files[index];
  const first = index <= 0;
  const last = index >= files.length - 1;
  const download = useDownload(actions.downloadFile, file?.id ?? "");
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    close.current?.focus();
  }, []);

  // Keys are heard on the document, so they work wherever the focus is; the rest of the page is
  // inert while the viewer is open, and Tab turns round at either end of the dialog.
  const move = useRef<(to: number) => void>(() => {});
  useEffect(() => {
    move.current = (to: number) => {
      if (to >= 0 && to < files.length && to !== index) onMove(to);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const box = dialog.current;
      if (!box) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !typing(e.target)
      ) {
        e.preventDefault();
        move.current(index + (e.key === "ArrowLeft" ? -1 : 1));
      } else if (e.key === "Tab") {
        const stops = [
          ...box.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex="0"]',
          ),
        ].filter((el) => el.offsetParent !== null || el === close.current);
        if (stops.length === 0) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const edge = e.shiftKey ? 0 : stops.length - 1;
        if (at === -1 || at === edge) {
          e.preventDefault();
          stops[e.shiftKey ? stops.length - 1 : 0]!.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, index]);

  if (!file) return null;
  const meta = [
    kindLabel(file.kind, file.name),
    sizeText(file.size),
    `${index + 1} of ${files.length} in view`,
  ].filter((part) => part !== "");

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className={s.viewer}
    >
      <header className={s.viewerBar}>
        <div className={s.viewerTitle}>
          <h2 className={s.viewerName} title={file.name}>
            {file.name}
          </h2>
          <p className={s.viewerMeta}>
            <span>{meta.join(" · ")}</span>
          </p>
        </div>
        <div className={s.pager}>
          {/* aria-disabled, not disabled: the button keeps the focus at either end. */}
          <button
            type="button"
            className={s.icon}
            aria-label="Previous file"
            aria-disabled={first}
            onClick={() => move.current(index - 1)}
          >
            <Chevron back />
          </button>
          <span className={s.pagerCount} aria-hidden="true">
            {index + 1} / {files.length}
          </span>
          <button
            type="button"
            className={s.icon}
            aria-label="Next file"
            aria-disabled={last}
            onClick={() => move.current(index + 1)}
          >
            <Chevron />
          </button>
        </div>
        {toolbar}
        <button
          type="button"
          className={s.secondary}
          onClick={async () => setFailed((await download()) ? null : file.id)}
        >
          Download
        </button>
        <button
          ref={close}
          type="button"
          className={s.icon}
          aria-label="Close"
          onClick={() => onClose()}
        >
          <Cross />
        </button>
      </header>
      {failed === file.id && (
        <p role="alert" className={`${s.refused} ${p.barAlert}`}>
          Couldn&apos;t download the file.
        </p>
      )}
      <div className={p.body} data-aside={aside ? "" : undefined}>
        <div className={s.stage}>
          <Stage key={file.id} file={file} actions={actions} />
        </div>
        {aside && <aside className={p.aside}>{aside}</aside>}
      </div>
    </div>
  );
}
