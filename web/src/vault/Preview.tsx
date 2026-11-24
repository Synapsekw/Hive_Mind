"use client";

// The open note: title, path, last change, who wrote it, the sharing control and Delete for the
// person's own notes (a colleague's note says how it reached you instead), release for a held
// note, then the rendered text.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { longDate } from "./format";
import { folderMark, noteMark } from "./marks";
import { Markdown } from "./Markdown";
import { DELETE_QUESTION, releaseSentence } from "./sentences";
import { ShareControl } from "./ShareControl";
import type { Choice, Result, VaultData, VaultNote } from "./types";
import s from "./vault.module.css";

/**
 * A confirming Delete sooner than this after the question opened, or after the press before it,
 * is taken as part of a double click or a burst, not as an answer.
 */
const CONFIRM_AFTER_MS = 500;

function Release({
  note,
  members,
  onRelease,
}: {
  note: VaultNote;
  members: VaultData["members"];
  onRelease: () => Promise<Result>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  async function release() {
    setBusy(true);
    setRefused(false);
    let ok = false;
    try {
      ok = (await onRelease()).ok;
    } catch {
      ok = false;
    }
    setBusy(false);
    if (ok) router.refresh();
    else setRefused(true);
  }
  return (
    <div data-scope="reset" className={s.release}>
      <p className={s.sentence}>{releaseSentence(noteMark(note, members))}</p>
      {refused && (
        <p role="alert" className={s.refused}>
          That change was refused.
        </p>
      )}
      <div className={s.actions}>
        <button
          type="button"
          className={s.primary}
          disabled={busy}
          onClick={release}
        >
          Release
        </button>
      </div>
    </div>
  );
}

/**
 * Delete, in two steps: the quiet button asks, and only a later, separate press on the
 * question's own Delete removes the note. Mounted per note, so opening another note or tab
 * drops a waiting question. What happens after the answer (the list, the line that says how it
 * went, the re-read) is the screen's; this only goes back to the quiet button when it failed.
 */
function DeleteNote({ onDelete }: { onDelete: () => Promise<boolean> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(false);
  // When the question was opened, or when the last press that came too soon landed.
  const askedAt = useRef(0);
  // Where the focus goes after the next render.
  const target = useRef<"keep" | "opener" | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const keeper = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    (want === "keep" ? keeper : opener).current?.focus();
  });

  function ask() {
    askedAt.current = Date.now();
    target.current = "keep";
    setAsking(true);
  }

  function keep() {
    if (running.current) return;
    target.current = "opener";
    setAsking(false);
  }

  async function confirm() {
    if (running.current) return;
    // The second press of a double click lands just after the question opened: too soon to be
    // an answer to it. It starts the wait again, so a burst of presses never answers.
    const now = Date.now();
    if (now - askedAt.current < CONFIRM_AFTER_MS) {
      askedAt.current = now;
      return;
    }
    running.current = true;
    setBusy(true);
    let ok = false;
    try {
      ok = await onDelete();
    } catch {
      ok = false;
    }
    running.current = false;
    if (ok) return; // The note, and this control with it, leaves the page.
    // Back to the quiet button, with the focus if it was still here (or nowhere).
    const at = document.activeElement;
    if (!at || at === document.body || question.current?.contains(at))
      target.current = "opener";
    setBusy(false);
    setAsking(false);
  }

  const off = busy || undefined;
  return asking ? (
    <div
      ref={question}
      role="group"
      aria-label="Delete this note"
      aria-busy={off}
      data-scope="reset"
      className={`${s.release} ${s.wide}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          keep();
        }
      }}
    >
      <p className={s.sentence}>{DELETE_QUESTION}</p>
      <div className={s.actions}>
        <button
          type="button"
          className={s.confirm}
          aria-label="Delete note"
          aria-disabled={off}
          onClick={confirm}
        >
          Delete
        </button>
        <button
          ref={keeper}
          type="button"
          className={s.secondary}
          aria-label="Keep note"
          aria-disabled={off}
          onClick={keep}
        >
          Keep
        </button>
      </div>
    </div>
  ) : (
    <button
      ref={opener}
      type="button"
      className={s.quiet}
      aria-label="Delete note"
      onClick={ask}
    >
      Delete
    </button>
  );
}

export function Preview({
  data,
  onSave,
  onRelease,
  onDelete,
}: {
  data: VaultData;
  onSave: (noteId: string, choice: Choice) => Promise<Result>;
  onRelease: (noteId: string) => Promise<Result>;
  /** Deletes the note and says whether it worked. */
  onDelete: (noteId: string) => Promise<boolean>;
}) {
  const open = data.open;
  let body;
  if (open === null) {
    body = <p className={s.empty}>Choose a note to read it.</p>;
  } else if ("missing" in open) {
    body = <p className={s.empty}>That note isn&apos;t available.</p>;
  } else {
    const n = open.note;
    const mine = n.member_id === data.me && n.access === "own";
    const owner =
      data.members.find((m) => m.id === n.member_id)?.display_name ?? "Someone";
    const rule = n.rule_folder
      ? (data.folders.find((f) => f.path === n.rule_folder) ?? null)
      : null;
    body = (
      <article
        key={n.id}
        className={`${s.article} rise`}
        style={{ "--rise-delay": "0s" } as CSSProperties}
      >
        <header className={s.head}>
          <h2 className={s.noteTitle}>{n.title}</h2>
          <p className={s.path}>{n.path}</p>
          <p className={s.facts}>
            <span>Changed {longDate(n.updated_at)}</span>
            {mine ? (
              <span>
                {n.by_agent ? "Written by your agent" : "Written by you"}
              </span>
            ) : (
              <span>
                {n.access === "link"
                  ? "Opened by a link"
                  : `Shared by ${owner}`}
              </span>
            )}
          </p>
          {mine && (
            <div className={s.tools}>
              <ShareControl
                key={n.id}
                subject="note"
                mark={noteMark(n, data.members)}
                current={{
                  visibility: n.visibility,
                  shared_with: n.shared_with,
                }}
                effective={n.effective}
                ruleFolder={n.rule_folder}
                folderRule={
                  // The rule's own record when this tab has it; else, for a note that follows
                  // the rule, what the database says the note gets from it.
                  folderMark(rule, data.members) ??
                  (n.rule_folder && n.visibility === null
                    ? { ...noteMark(n, data.members), from: null }
                    : null)
                }
                hive={data.hive}
                members={data.members}
                me={data.me}
                onSave={(c) => onSave(n.id, c)}
              />
              <DeleteNote
                key={`delete-${n.id}`}
                onDelete={() => onDelete(n.id)}
              />
            </div>
          )}
          {mine && n.quarantined && (
            <Release
              key={`release-${n.id}`}
              note={n}
              members={data.members}
              onRelease={() => onRelease(n.id)}
            />
          )}
        </header>
        {open.cut && (
          <p className={s.cut}>Showing the first 200,000 characters.</p>
        )}
        <Markdown body={open.body} />
      </article>
    );
  }
  return (
    <section
      aria-label="Note"
      className={s.preview}
      data-idle={open === null || undefined}
    >
      {body}
    </section>
  );
}
