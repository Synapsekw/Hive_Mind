"use client";

// The right column: the selected file, larger, with what can be done with it and what is known
// about it. Every write goes through the screen's callbacks, which ask the server; a refusal is
// said in words and nothing is worked around. Delete and "Change home note" are offered on the
// person's own files only (the database would refuse them on anyone else's).
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AddToFolder } from "./AddToFolder";
import { Preview } from "./FileCard";
import { Cross, SharingMark } from "./icons";
import { NotePicker } from "./NotePicker";
import {
  folderPath,
  HOME_FROM_VAULT,
  metaLine,
  spanText,
  whoCanRead,
} from "./text";
import type {
  GalleryActions,
  GalleryFile,
  GalleryFolder,
  GallerySession,
  NoteChoice,
} from "./types";
import { useDownload } from "./useDownload";
import s from "./gallery.module.css";

const noteHref = (id: string) => `/vault?note=${encodeURIComponent(id)}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={s.fact}>
      <h3 id={id} className={s.factHead}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** What is known about a file: in the panel, and beside the viewer's stage. */
export function Facts({
  file,
  session,
  folders,
  holding,
  now,
  who,
  home,
}: {
  file: GalleryFile;
  session: GallerySession | null;
  folders: GalleryFolder[];
  holding: Set<string>;
  now: number;
  /** In place of the sentence on who can read it, e.g. after a change. */
  who?: string | null;
  /** The control to change the home note, on the person's own files. */
  home?: ReactNode;
}) {
  const mine = folders.filter((f) => holding.has(f.id));
  return (
    <>
      <Section title="Who can read it">
        <p className={s.sharing} data-wrap>
          <SharingMark file={file} />
          <span>{who ?? whoCanRead(file)}</span>
        </p>
        {file.note && (
          <Link
            href={noteHref(file.note.id)}
            prefetch={false}
            className={s.link}
          >
            Home note: {file.note.title}
          </Link>
        )}
        {home}
      </Section>
      {file.refs.length > 0 && (
        <Section title="Referenced in">
          <ul role="list" className={s.links}>
            {file.refs.map((r) => (
              <li key={r.id}>
                <Link href={noteHref(r.id)} prefetch={false} className={s.link}>
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {session && (
        <Section title="Session">
          <p className={s.factText}>
            {session.note ? (
              <Link
                href={noteHref(session.note.id)}
                prefetch={false}
                className={s.link}
              >
                {session.title}
              </Link>
            ) : (
              session.title
            )}
          </p>
          <p className={s.factQuiet}>
            {session.agent} · {spanText(session, now)}
          </p>
        </Section>
      )}
      <Section title="In my folders">
        <p className={s.factText}>
          {mine.length
            ? mine.map((f) => folderPath(f.id, folders)).join(", ")
            : "None"}
        </p>
      </Section>
    </>
  );
}

export type FilePanelProps = {
  file: GalleryFile;
  session: GallerySession | null;
  /** In tree order. */
  folders: GalleryFolder[];
  holding: Set<string>;
  now: number;
  actions: Pick<GalleryActions, "downloadFile" | "findMyNotes">;
  onOpen?: () => void;
  onClose(): void;
  onDelete(): Promise<boolean>;
  onToggleFolder(folderId: string, on: boolean): Promise<boolean>;
  onSetHome(note: NoteChoice | null): Promise<boolean>;
};

export function FilePanel({
  file,
  session,
  folders,
  holding,
  now,
  actions,
  onOpen,
  onClose,
  onDelete,
  onToggleFolder,
  onSetHome,
}: FilePanelProps) {
  const download = useDownload(actions.downloadFile, file.id);
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const questionId = useId();
  const removeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const homeButton = useRef<HTMLButtonElement>(null);
  const [focus, setFocus] = useState<"cancel" | "remove" | "home" | null>(null);

  useEffect(() => {
    if (!focus) return;
    ({ cancel: cancelButton, remove: removeButton, home: homeButton })[
      focus
    ].current?.focus();
    setFocus(null);
  }, [focus]);

  async function remove() {
    if (!(await onDelete())) {
      setAsking(false);
      setSaid("Couldn't delete the file.");
      setFocus("remove");
    }
  }

  async function pick(note: NoteChoice | null) {
    setPicking(false);
    setFocus("home");
    if (!(await onSetHome(note))) {
      setSaid("Couldn't change the home note.");
      return;
    }
    setSaid(null);
    setChanged(
      note
        ? `Changed. Sharing now follows “${note.title}”.`
        : "Changed. It has no home note now.",
    );
  }

  return (
    <aside aria-label="File details" className={s.filePanel}>
      <div className={s.panelHead}>
        <span className={s.label}>Selected</span>
        <button
          type="button"
          className={s.icon}
          aria-label="Close details"
          onClick={onClose}
        >
          <Cross />
        </button>
      </div>
      <Preview file={file} large />
      <div>
        <h2 className={s.panelName}>{file.name}</h2>
        <p className={s.factQuiet}>
          {metaLine(file, now)}
          {!file.mine && ` · ${file.owner}`}
        </p>
      </div>
      <div role="group" aria-label="File actions" className={s.actions}>
        {asking ? (
          <>
            <p id={questionId} className={s.askText}>
              Delete this file? This cannot be undone.
            </p>
            <button
              type="button"
              className={s.confirm}
              aria-describedby={questionId}
              onClick={remove}
            >
              Delete
            </button>
            <button
              ref={cancelButton}
              type="button"
              className={s.secondary}
              onClick={() => {
                setAsking(false);
                setFocus("remove");
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {onOpen && (
              <button type="button" className={s.primary} onClick={onOpen}>
                Open
              </button>
            )}
            <button
              type="button"
              className={onOpen ? s.secondary : s.primary}
              onClick={async () => {
                setSaid(null);
                if (!(await download())) setSaid("Couldn't download the file.");
              }}
            >
              Download
            </button>
            <AddToFolder
              folders={folders}
              holding={holding}
              onToggle={onToggleFolder}
            />
            {file.mine && (
              <button
                ref={removeButton}
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
      </div>
      {said && (
        <p role="alert" className={s.refused}>
          {said}
        </p>
      )}
      <Facts
        file={file}
        session={session}
        folders={folders}
        holding={holding}
        now={now}
        who={changed}
        home={
          file.fromVault ? (
            <p className={s.factQuiet}>{HOME_FROM_VAULT}</p>
          ) : (
            file.mine &&
            (picking ? (
              <NotePicker
                findMyNotes={actions.findMyNotes}
                allowNone
                onPick={pick}
                onCancel={() => {
                  setPicking(false);
                  setFocus("home");
                }}
              />
            ) : (
              <button
                ref={homeButton}
                type="button"
                className={s.textButton}
                onClick={() => {
                  setChanged(null);
                  setPicking(true);
                }}
              >
                Change home note
              </button>
            ))
          )
        }
      />
    </aside>
  );
}
