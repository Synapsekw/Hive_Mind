"use client";

// Uploading from the browser. The bytes go straight to storage through one signed link per file
// (`startUpload`); the server decides each file's stored name, path and declared type, and
// `finishUpload` records the file. The PUT must declare the same type the server will (`mimeFor`
// of the stored name), or the server removes the object. A file over 50 MB is refused here
// before anything is asked. When every file is done the batch is ended (`endUpload`); a batch
// with a failed file stays open for Retry and is ended when the dialog is closed.
import { useEffect, useRef, useState } from "react";
import { NotePicker } from "./NotePicker";
import { mimeFor } from "./mime";
import { folderPath, sizeText } from "./text";
import type {
  GalleryActions,
  GalleryFile,
  GalleryFolder,
  NoteChoice,
  NoteRef,
} from "./types";
import s from "./gallery.module.css";

export const UPLOAD_MAX = 50 * 1024 * 1024;
const FILES_MAX = 20;

type Status = "pending" | "uploading" | "done" | "failed" | "refused";
type Row = {
  file: File;
  status: Status;
  /** The stored name and signed link, once the batch has started. */
  slot: { name: string; url: string } | null;
};

const STATUS: Record<Status, string> = {
  pending: "Waiting",
  uploading: "Uploading…",
  done: "Uploaded",
  failed: "Failed",
  refused: "Too large: 50 MB at most.",
};

const rowsOf = (files: File[]): Row[] =>
  files.map((file) => ({
    file,
    status: file.size > UPLOAD_MAX ? "refused" : "pending",
    slot: null,
  }));

export function UploadDialog({
  files,
  folders,
  actions,
  onAdded,
  onEnded,
  onClose,
}: {
  files: File[];
  /** In tree order. */
  folders: GalleryFolder[];
  actions: Pick<
    GalleryActions,
    "startUpload" | "finishUpload" | "endUpload" | "findMyNotes"
  >;
  /** A file has landed: show it in the gallery. */
  onAdded(file: GalleryFile, batch: string, note: NoteRef): void;
  onEnded(batch: string): void;
  onClose(): void;
}) {
  const [rows, setRowsState] = useState<Row[]>(() => rowsOf(files));
  // The rows as of now, for the upload's own steps, which run across renders.
  const live = useRef(rows);
  const setRows = (change: (list: Row[]) => Row[]) => {
    live.current = change(live.current);
    setRowsState(live.current);
  };
  const [note, setNote] = useState<NoteChoice | null>(null);
  const [picking, setPicking] = useState(false);
  const [folderId, setFolderId] = useState<string>("");
  const [said, setSaid] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  // The batch once it has started: its id and the home note the server resolved.
  const batch = useRef<{ id: string; noteId: string; ended: boolean } | null>(
    null,
  );
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, []);

  const busy = rows.some((r) => r.status === "uploading");
  const waiting = rows.filter((r) => r.status === "pending");
  const tooMany = rows.filter((r) => r.status !== "refused").length > FILES_MAX;
  const canStart = !started && waiting.length > 0 && !tooMany;
  const folder = folderId || null;
  const noteTitle = note?.title ?? "Uploads";

  const setStatus = (i: number, status: Status) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, status } : r)));

  async function end() {
    const b = batch.current;
    if (!b || b.ended) return;
    b.ended = true;
    try {
      await actions.endUpload(b.id, b.noteId);
    } catch {
      // The batch stays open on the server; nothing on screen depends on it.
    }
    onEnded(b.id);
  }

  /** Sends one file and records it; answers whether it landed. */
  async function send(i: number, slot: { name: string; url: string } | null) {
    const b = batch.current;
    const row = live.current[i];
    if (!b || !row || !slot) {
      setStatus(i, "failed");
      return false;
    }
    setStatus(i, "uploading");
    try {
      const put = await fetch(slot.url, {
        method: "PUT",
        body: row.file,
        headers: { "content-type": mimeFor(slot.name), "x-upsert": "false" },
      });
      if (!put.ok) throw new Error(String(put.status));
      const landed = await actions.finishUpload(
        b.id,
        slot.name,
        b.noteId,
        folder,
      );
      if (!landed) throw new Error("not recorded");
      onAdded(landed, b.id, { id: b.noteId, title: noteTitle });
      setStatus(i, "done");
      return true;
    } catch {
      setStatus(i, "failed");
      return false;
    }
  }

  async function settle() {
    // Every file done: the batch is over. A failed one keeps it open for Retry.
    if (
      live.current.every((r) => r.status === "done" || r.status === "refused")
    )
      await end();
  }

  async function start() {
    if (!canStart) return;
    setStarted(true);
    setSaid(null);
    const sending = live.current
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === "pending");
    let answer: Awaited<ReturnType<GalleryActions["startUpload"]>> = null;
    try {
      answer = await actions.startUpload({
        files: sending.map(({ r }) => ({
          name: r.file.name,
          size: r.file.size,
        })),
        noteId: note?.id ?? null,
        folderId: folder,
      });
    } catch {
      answer = null;
    }
    if (!answer) {
      setStarted(false);
      setSaid("Couldn't start the upload.");
      return;
    }
    batch.current = { id: answer.batch, noteId: answer.noteId, ended: false };
    const slots = answer.slots;
    setRows((list) =>
      list.map((r, i) => {
        const at = sending.findIndex((x) => x.i === i);
        return at === -1 ? r : { ...r, slot: slots[at] ?? null };
      }),
    );
    await Promise.all(sending.map(({ i }, at) => send(i, slots[at] ?? null)));
    await settle();
  }

  async function retry(i: number) {
    if (await send(i, live.current[i]?.slot ?? null)) await settle();
  }

  async function close() {
    if (busy) return;
    await end();
    onClose();
  }

  const finished = started && !busy;
  return (
    <div className={s.scrim}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
        className={s.dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void close();
          }
        }}
      >
        <h2 id="upload-title" className={s.dialogTitle}>
          Upload files
        </h2>
        {!started && (
          <label className={s.choose}>
            <input
              type="file"
              multiple
              aria-label="Choose files"
              className={s.srOnly}
              onChange={(e) => {
                const chosen = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = "";
                setRows((list) => [...list, ...rowsOf(chosen)]);
              }}
            />
            <span aria-hidden="true">Choose files…</span>
          </label>
        )}
        {rows.length > 0 && (
          <ul role="list" aria-label="Files to upload" className={s.uploads}>
            {rows.map((r, i) => (
              <li key={i} className={s.upload} data-status={r.status}>
                <span className={s.uploadName} title={r.file.name}>
                  {r.slot?.name ?? r.file.name}
                </span>
                <span className={s.factQuiet}>{sizeText(r.file.size)}</span>
                <span className={s.uploadStatus} role="status">
                  {STATUS[r.status]}
                </span>
                {r.status === "failed" && r.slot && (
                  <button
                    type="button"
                    className={s.textButton}
                    onClick={() => retry(i)}
                  >
                    Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {tooMany && (
          <p role="alert" className={s.refused}>
            At most {FILES_MAX} files at a time.
          </p>
        )}
        <div className={s.dialogField}>
          <span className={s.label}>Home note</span>
          {picking ? (
            <NotePicker
              findMyNotes={actions.findMyNotes}
              allowNone={false}
              onPick={(n) => {
                setNote(n);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : (
            <p className={s.factText}>
              {note ? note.title : "Uploads (private)"}{" "}
              {!started && (
                <button
                  type="button"
                  className={s.textButton}
                  onClick={() => setPicking(true)}
                >
                  Change home note
                </button>
              )}
            </p>
          )}
        </div>
        <label className={s.dialogField}>
          <span className={s.label}>Folder</span>
          <select
            className={s.select}
            value={folderId}
            disabled={started}
            onChange={(e) => setFolderId(e.currentTarget.value)}
          >
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(f.id, folders)}
              </option>
            ))}
          </select>
        </label>
        {said && (
          <p role="alert" className={s.refused}>
            {said}
          </p>
        )}
        <div className={s.dialogButtons}>
          {finished ? (
            <button type="button" className={s.primary} onClick={close}>
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className={s.primary}
                aria-disabled={!canStart}
                aria-busy={busy || undefined}
                onClick={start}
              >
                {waiting.length === 1
                  ? "Upload 1 file"
                  : `Upload ${waiting.length} files`}
              </button>
              <button
                type="button"
                className={s.secondary}
                aria-disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
