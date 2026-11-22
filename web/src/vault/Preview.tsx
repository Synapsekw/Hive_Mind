"use client";

// The open note: title, path, last change, who wrote it, the sharing control for the person's
// own notes (a colleague's note says how it reached you instead), release for a held note, then
// the rendered text.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { longDate } from "./format";
import { folderMark, noteMark } from "./marks";
import { Markdown } from "./Markdown";
import { releaseSentence } from "./sentences";
import { ShareControl } from "./ShareControl";
import type { Choice, Result, VaultData, VaultNote } from "./types";
import s from "./vault.module.css";

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
    <div className={s.release}>
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

export function Preview({
  data,
  onSave,
  onRelease,
}: {
  data: VaultData;
  onSave: (noteId: string, choice: Choice) => Promise<Result>;
  onRelease: (noteId: string) => Promise<Result>;
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
      <article className={s.article}>
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
            <ShareControl
              key={n.id}
              subject="note"
              mark={noteMark(n, data.members)}
              current={{ visibility: n.visibility, shared_with: n.shared_with }}
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
