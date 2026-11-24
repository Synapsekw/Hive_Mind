"use client";

// What can be done with one file, and the popover that offers it for a file the viewer cannot
// show. `Actions` is the row shared with the viewer's top bar: Download, the link to the note
// the file is attached to, and Delete on the person's own files. Whether a download or a delete
// is allowed is the server's answer; a refusal is said in words and nothing is worked around.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { longDate } from "../vault/format";
import { kindLabel, PDF_VIEW_MAX } from "./kind";
import { sharingText, sizeText } from "./text";
import type { GalleryFile, LegacyActions } from "./types";
import s from "./gallery.module.css";

/** The dot beside the sharing line: hollow, filled or half, so the words never stand alone. */
export function SharingMark({ file }: { file: GalleryFile }) {
  return (
    <span aria-hidden="true" className={s.mark} data-sharing={file.sharing} />
  );
}

/**
 * Asks the server for a download link and hands it to the browser. The link carries the
 * download disposition, so the page stays where it is. Answers false when there is no link.
 */
export function useDownload(
  downloadFile: LegacyActions["downloadFile"],
  id: string,
): () => Promise<boolean> {
  const busy = useRef(false);
  return async () => {
    if (busy.current) return true;
    busy.current = true;
    let link: { url: string } | null = null;
    try {
      link = await downloadFile(id);
    } catch {
      link = null;
    }
    busy.current = false;
    if (!link) return false;
    window.location.assign(link.url);
    return true;
  };
}

export function Actions({
  file,
  actions,
  onDeleted,
  stacked = false,
}: {
  file: GalleryFile;
  actions: LegacyActions;
  /** The server removed the file: take it out of the list. */
  onDeleted: (id: string) => void;
  /** One control per line, for the narrow popover. */
  stacked?: boolean;
}) {
  const questionId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // Where the focus goes once the row has changed: the safe answer, or back to Delete.
  const [focus, setFocus] = useState<"cancel" | "remove" | null>(null);
  const download = useDownload(actions.downloadFile, file.id);

  useEffect(() => {
    if (!focus) return;
    (focus === "cancel" ? cancel : remove).current?.focus();
    setFocus(null);
  }, [focus]);

  async function confirm() {
    if (deleting.current) return;
    deleting.current = true;
    let ok = false;
    try {
      ok = (await actions.deleteFile(file.id)).ok;
    } catch {
      ok = false;
    }
    deleting.current = false;
    if (ok) return onDeleted(file.id);
    setAsking(false);
    setSaid("Couldn't delete the file.");
    setFocus("remove");
  }

  const cancelButton = (
    <button
      ref={cancel}
      type="button"
      className={s.secondary}
      onClick={() => {
        setAsking(false);
        setFocus("remove");
      }}
    >
      Cancel
    </button>
  );

  return (
    <div
      role="group"
      aria-label="File actions"
      className={s.actions}
      data-stacked={stacked || undefined}
      data-note={file.note ? "" : undefined}
    >
      {asking ? (
        <>
          <p id={questionId} className={s.ask}>
            Delete this file? This cannot be undone.
          </p>
          {/* Cancel takes the place Delete had, so a second press in the same spot is the
              safe answer: last in the viewer's row, first under the question in the popover. */}
          {stacked && cancelButton}
          <button
            type="button"
            className={s.confirm}
            aria-describedby={questionId}
            onClick={confirm}
          >
            Delete
          </button>
          {!stacked && cancelButton}
        </>
      ) : (
        <>
          <button
            type="button"
            className={s.primary}
            onClick={async () => {
              setSaid(null);
              if (!(await download())) setSaid("Couldn't download the file.");
            }}
          >
            Download
          </button>
          {file.note && (
            <Link
              href={`/vault?note=${encodeURIComponent(file.note.id)}`}
              prefetch={false}
              className={s.secondary}
              title={file.note.title}
            >
              Open note in vault
            </Link>
          )}
          {file.mine && (
            <button
              ref={remove}
              type="button"
              className={s.quiet}
              onClick={() => {
                setSaid(null);
                setAsking(true);
                setFocus("cancel");
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
      {said && (
        <p role="alert" className={s.refused}>
          {said}
        </p>
      )}
    </div>
  );
}

/** Why the viewer does not show this file, when that needs saying. */
function reason(file: GalleryFile): string | null {
  if (file.kind === "pdf" && file.size > PDF_VIEW_MAX)
    return "Too large to show here. Download it to read it.";
  return null;
}

export function Details({
  file,
  actions,
  onClose,
  onDeleted,
}: {
  file: GalleryFile;
  actions: LegacyActions;
  /** `back` says whether the focus returns to the card (Escape, the close button). */
  onClose: (back: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.querySelector<HTMLElement>('[aria-label="File actions"] button')?.focus({
      preventScroll: true,
    });
    // A press anywhere outside the card and its popover puts the popover away.
    const outside = (e: PointerEvent) => {
      const cell = el.parentElement;
      if (cell && e.target instanceof Node && !cell.contains(e.target))
        closing.current(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const size = sizeText(file.size);
  const why = reason(file);
  return (
    <div
      ref={box}
      role="group"
      aria-label={`Details for ${file.name}`}
      className={s.details}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose(true);
        }
      }}
    >
      <div className={s.detailsHead}>
        <span className={s.label}>{kindLabel(file.kind, file.name)}</span>
        <button
          type="button"
          className={s.icon}
          aria-label="Close details"
          onClick={() => onClose(true)}
        >
          <Cross />
        </button>
      </div>
      <p className={s.detailsName}>{file.name}</p>
      <dl className={s.facts}>
        {size && (
          <>
            <dt>Size</dt>
            <dd>{size}</dd>
          </>
        )}
        <dt>Saved</dt>
        <dd>{longDate(file.created_at)}</dd>
        <dt>Owner</dt>
        <dd>{file.mine ? "You" : file.owner}</dd>
      </dl>
      <p className={s.sharing} data-wrap>
        <SharingMark file={file} />
        <span>{sharingText(file)}</span>
      </p>
      {why && <p className={s.why}>{why}</p>}
      <Actions file={file} actions={actions} onDeleted={onDeleted} stacked />
    </div>
  );
}

const STROKE = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function Cross() {
  return (
    <svg aria-hidden="true" {...STROKE}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" {...STROKE}>
      <path d={back ? "M10 3.5 5.5 8l4.5 4.5" : "m6 3.5 4.5 4.5L6 12.5"} />
    </svg>
  );
}
