"use client";

// The full-window viewer for images and PDFs. Opening a file asks the server for a fresh link
// every time. What the link holds is never run as a page of ours:
//   - an image is only ever the source of an <img>, which draws pixels and runs nothing;
//   - a PDF is fetched, its response must say application/pdf and start like a PDF, and it is
//     shown from an object URL of a Blob typed application/pdf, so the browser can only hand it
//     to its PDF reader. The file's own link is never the source of the frame.
// Anything else, and anything that fails those checks, is offered for download instead.
import { useEffect, useRef, useState } from "react";
import { Actions, Chevron, Cross, SharingMark, useDownload } from "./Details";
import { Sheet } from "./FileCard";
import { PDF_VIEW_MAX } from "./kind";
import { metaLine, sharingText } from "./text";
import type { GalleryFile, LegacyActions } from "./types";
import s from "./gallery.module.css";

const PDF = "application/pdf";

/** A PDF starts with "%PDF-"; readers allow it anywhere in the first 1024 bytes. */
function startsLikePdf(buf: ArrayBuffer): boolean {
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024));
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let i = 0; i + magic.length <= head.length; i++)
    if (magic.every((byte, j) => head[i + j] === byte)) return true;
  return false;
}

/** The link's bytes as a PDF Blob, or null when they are not a PDF the viewer may show. */
async function pdfBlob(url: string, signal: AbortSignal): Promise<Blob | null> {
  try {
    const res = await fetch(url, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").trim().toLowerCase();
    if (!type.startsWith(PDF)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > PDF_VIEW_MAX || !startsLikePdf(buf)) return null;
    return new Blob([buf], { type: PDF });
  } catch {
    return null;
  }
}

type View =
  | { phase: "opening" }
  | { phase: "image"; url: string }
  | { phase: "pdf"; src: string }
  /** The server gave no link. */
  | { phase: "refused" }
  /** There is a link, but not to something that may be drawn here. */
  | { phase: "download-only" };

/** One file on the stage. Keyed by the file, so each file starts from "opening". */
function Stage({
  file,
  actions,
}: {
  file: GalleryFile;
  actions: LegacyActions;
}) {
  const [view, setView] = useState<View>({ phase: "opening" });
  const [failed, setFailed] = useState(false);
  const openFile = useRef(actions.openFile);
  useEffect(() => {
    openFile.current = actions.openFile;
  });
  const download = useDownload(actions.downloadFile, file.id);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    const abort = new AbortController();
    (async () => {
      let link: Awaited<ReturnType<LegacyActions["openFile"]>> = null;
      try {
        link = await openFile.current(file.id);
      } catch {
        link = null;
      }
      if (!live) return;
      if (!link) return setView({ phase: "refused" });
      if (link.kind === "image")
        return setView({ phase: "image", url: link.url });
      if (link.kind !== "pdf") return setView({ phase: "download-only" });
      const blob = await pdfBlob(link.url, abort.signal);
      if (!live) return;
      if (!blob) return setView({ phase: "download-only" });
      made = URL.createObjectURL(blob);
      setView({ phase: "pdf", src: made });
    })();
    return () => {
      live = false;
      abort.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.id]);

  switch (view.phase) {
    case "opening":
      return (
        <p role="status" className={s.stageNote}>
          Opening…
        </p>
      );
    case "refused":
      return (
        <p role="alert" className={s.stageNote}>
          Couldn&apos;t open the file.
        </p>
      );
    case "image":
      return (
        <img
          src={view.url}
          alt={file.name}
          referrerPolicy="no-referrer"
          className={s.shot}
          onError={() => setView({ phase: "download-only" })}
        />
      );
    case "pdf":
      return <iframe src={view.src} title={file.name} className={s.frame} />;
    case "download-only":
      return (
        <div className={s.instead}>
          <Sheet file={file} />
          <p role="status" className={s.insteadText}>
            This file can&apos;t be shown here.
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
}

export function Viewer({
  file,
  position,
  total,
  now,
  actions,
  onMove,
  onClose,
  onDeleted,
}: {
  file: GalleryFile;
  /** Where the file stands among the files the viewer can show, from 1. */
  position: number;
  total: number;
  now: number;
  actions: LegacyActions;
  onMove: (by: -1 | 1) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const first = position <= 1;
  const last = position >= total;

  useEffect(() => {
    close.current?.focus();
  }, []);

  // Keys are heard on the document, so they work wherever the focus is; the rest of the page is
  // inert while the viewer is open, and Tab turns round at either end of the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const box = dialog.current;
      if (!box) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        onMove(e.key === "ArrowLeft" ? -1 : 1);
      } else if (e.key === "Tab") {
        const stops = [
          ...box.querySelectorAll<HTMLElement>("button, a[href], iframe"),
        ];
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
  }, [onClose, onMove]);

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
            <span>{metaLine(file, now)}</span>
            <span className={s.sharing}>
              <SharingMark file={file} />
              <span className={s.sharingText}>{sharingText(file)}</span>
            </span>
          </p>
        </div>
        <div className={s.pager}>
          {/* aria-disabled, not disabled: the button keeps the focus at either end. */}
          <button
            type="button"
            className={s.icon}
            aria-label="Previous file"
            aria-disabled={first}
            onClick={() => onMove(-1)}
          >
            <Chevron back />
          </button>
          <span className={s.pagerCount}>
            <span aria-hidden="true">
              {position} / {total}
            </span>
            <span className={s.srOnly}>
              File {position} of {total}
            </span>
          </span>
          <button
            type="button"
            className={s.icon}
            aria-label="Next file"
            aria-disabled={last}
            onClick={() => onMove(1)}
          >
            <Chevron />
          </button>
        </div>
        <Actions
          key={file.id}
          file={file}
          actions={actions}
          onDeleted={onDeleted}
        />
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
      <div className={s.stage}>
        <Stage key={file.id} file={file} actions={actions} />
      </div>
    </div>
  );
}
