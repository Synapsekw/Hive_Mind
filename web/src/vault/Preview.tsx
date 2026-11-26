"use client";

// The open note: its title, one meta line (path, last change, who it is from), one action row
// (the sharing control on the person's own notes, the topic chips and + Topic, and ⋯ with Copy
// link and, on one's own note, Delete note…), release for a held note, the notes it is linked
// with and Unlink for each, then the text without a first heading that repeats the title.
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { longDate } from "./format";
import { folderMark, noteMark } from "./marks";
import { Markdown } from "./Markdown";
import { NoteMenu } from "./NoteMenu";
import { NoteTopics } from "./NoteTopics";
import {
  DELETE_QUESTION,
  keepLinkName,
  LINKED_WITH,
  OPENED_BY_LINK,
  OPEN_FAILED,
  OPENING,
  releaseSentence,
  sharedBy,
  UNLINK,
  UNLINK_GROUP,
  unlinkName,
  unlinkQuestion,
  FROM_VAULT,
  WRITTEN_BY_AGENT,
  WRITTEN_BY_YOU,
  YOU,
} from "./sentences";
import { ShareControl } from "./ShareControl";
import type {
  Choice,
  NoteLink,
  Result,
  TopicChange,
  VaultData,
  VaultNote,
} from "./types";
import s from "./vault.module.css";
import { withoutTitle } from "./withoutTitle";

/**
 * A confirming press sooner than this after the question opened, or after the press before it,
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

/**
 * Something that cannot be taken back (Delete, Unlink), in two steps: the quiet button asks, and
 * only a later, separate press on the question's own button does it. Mounted per note or per
 * link, so opening another note or tab drops a waiting question. What happens after the answer
 * (the list, the line that says how it went, the re-read) is the screen's; this only goes back
 * to the quiet button when it failed. With `onDone` (Delete, opened from the note menu) there is
 * no quiet button: it mounts asking and hands Keep and a failure back to its parent.
 */
function Ask({
  word,
  question: sentence,
  group,
  yes,
  no,
  onConfirm,
  onDone,
}: {
  /** The word on the quiet button and on the question's own. */
  word: string;
  question: string;
  /** The names of the question, of both buttons that do it, and of Keep. */
  group: string;
  yes: string;
  no: string;
  /** Does it, and says whether it worked. */
  onConfirm: () => Promise<boolean>;
  /**
   * Opened from elsewhere (a menu): there is no quiet button. Mounted already asking; Keep, or a
   * failure, calls this instead of going back to a quiet button, `refocus` saying whether the
   * focus should go back to whatever opened it.
   */
  onDone?: (refocus: boolean) => void;
}) {
  const [asking, setAsking] = useState(!!onDone);
  const [busy, setBusy] = useState(false);
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(false);
  // When the question was opened, or when the last press that came too soon landed.
  const askedAt = useRef(0);
  // Where the focus goes after the next render.
  const target = useRef<"keep" | "opener" | null>(onDone ? "keep" : null);
  const opener = useRef<HTMLButtonElement>(null);
  const keeper = useRef<HTMLButtonElement>(null);
  const question = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    (want === "keep" ? keeper : opener).current?.focus();
  });

  // Opened from elsewhere: the question opened as this mounted.
  useEffect(() => {
    if (onDone) askedAt.current = Date.now();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ask() {
    askedAt.current = Date.now();
    target.current = "keep";
    setAsking(true);
  }

  function keep() {
    if (running.current) return;
    if (onDone) {
      setAsking(false);
      onDone(true);
      return;
    }
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
      ok = await onConfirm();
    } catch {
      ok = false;
    }
    running.current = false;
    if (ok) return; // The note or the link, and this control with it, leaves the page.
    // Back to the quiet button, with the focus if it was still here (or nowhere).
    const at = document.activeElement;
    const refocus =
      !at || at === document.body || !!question.current?.contains(at);
    setBusy(false);
    setAsking(false);
    if (onDone) onDone(refocus);
    else if (refocus) target.current = "opener";
  }

  const off = busy || undefined;
  return asking ? (
    <div
      ref={question}
      role="group"
      aria-label={group}
      aria-busy={off}
      className={`${s.release} ${s.wide}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          keep();
        }
      }}
    >
      <p className={s.sentence}>{sentence}</p>
      <div className={s.actions}>
        <button
          type="button"
          className={s.confirm}
          aria-label={yes}
          aria-disabled={off}
          onClick={confirm}
        >
          {word}
        </button>
        <button
          ref={keeper}
          type="button"
          className={s.secondary}
          aria-label={no}
          aria-disabled={off}
          onClick={keep}
        >
          Keep
        </button>
      </div>
    </div>
  ) : onDone ? null : (
    <button
      ref={opener}
      type="button"
      className={s.quiet}
      aria-label={yes}
      onClick={ask}
    >
      {word}
    </button>
  );
}

/** The delete question, opened from the note menu's Delete note…. */
function DeleteNote({
  onDelete,
  onDone,
}: {
  onDelete: () => Promise<boolean>;
  onDone: (refocus: boolean) => void;
}) {
  return (
    <Ask
      word="Delete"
      question={DELETE_QUESTION}
      group="Delete this note"
      yes="Delete note"
      no="Keep note"
      onConfirm={onDelete}
      onDone={onDone}
    />
  );
}

/**
 * The notes the open note is linked with, as the database listed them: each a row of the note
 * list (title, then whose it is) with Unlink at its end. Nothing at all when there is none.
 * The row and its Unlink share one line.
 */
function Linked({
  links,
  own,
  owner,
  hrefNote,
  onUnlink,
}: {
  links: NoteLink[];
  /** The open note is the person's own. */
  own: boolean;
  /** Who the open note belongs to, by name. */
  owner: string;
  hrefNote: (noteId: string) => string;
  onUnlink: (linkId: string) => Promise<boolean>;
}) {
  if (links.length === 0) return null;
  return (
    <section aria-label={LINKED_WITH} className={s.tools}>
      <h3 className={`${s.groupName} ${s.wide}`}>{LINKED_WITH}</h3>
      <ul className={`${s.rows} ${s.wide}`}>
        {links.map((l) => (
          <li key={l.id} className={s.tools}>
            <Link href={hrefNote(l.note_id)} prefetch={false} className={s.row}>
              <span className={s.rowTitle}>{l.title}</span>
              <span className={s.rowMeta}>{l.mine ? YOU : l.owner}</span>
            </Link>
            <Ask
              word={UNLINK}
              question={unlinkQuestion({
                own: own && l.mine,
                // The colleague on the other side: of that note, or of this one.
                owner: l.mine ? owner : l.owner,
              })}
              group={UNLINK_GROUP}
              yes={unlinkName(l.title)}
              no={keepLinkName(l.title)}
              onConfirm={() => onUnlink(l.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The open note's head: title, the meta line, the action row (sharing, topics, ⋯) or the delete
 * question in its place, the release box, and Linked with. Mounted per note, so opening another
 * note drops a waiting question.
 */
function Head({
  data,
  note: n,
  links,
  onSave,
  onRelease,
  onDelete,
  onUnlink,
  onRemoveTopic,
  onAddTopic,
  hrefNote,
  onCopied,
}: {
  data: VaultData;
  note: VaultNote;
  links: NoteLink[];
  onSave: (noteId: string, choice: Choice) => Promise<Result>;
  onRelease: (noteId: string) => Promise<Result>;
  onDelete: (noteId: string) => Promise<boolean>;
  onUnlink: (linkId: string) => Promise<boolean>;
  onRemoveTopic: (noteId: string, topicId: string) => Promise<boolean>;
  onAddTopic: (noteId: string, topicId: string) => Promise<TopicChange>;
  hrefNote: (noteId: string) => string;
  onCopied: (ok: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  // Whether ⋯ takes the focus back once the row is shown again.
  const refocus = useRef(false);
  useEffect(() => {
    if (asking || !refocus.current) return;
    refocus.current = false;
    more.current?.focus();
  }, [asking]);

  const mine = n.member_id === data.me && n.access === "own";
  const owner =
    data.members.find((m) => m.id === n.member_id)?.display_name ?? "Someone";
  const rule = n.rule_folder
    ? (data.folders.find((f) => f.path === n.rule_folder) ?? null)
    : null;
  const who =
    mine && n.fromVault
      ? FROM_VAULT
      : mine
        ? n.by_agent
          ? WRITTEN_BY_AGENT
          : WRITTEN_BY_YOU
        : n.access === "link"
          ? OPENED_BY_LINK
          : sharedBy(owner);

  return (
    <header className={s.head}>
      <h2 className={s.noteTitle}>{n.title}</h2>
      <p className={s.meta}>
        {n.path} · changed {longDate(n.updated_at)} · {who}
      </p>
      <div className={s.actionRow} hidden={asking}>
        {mine && (
          <ShareControl
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
        )}
        <NoteTopics
          noteId={n.id}
          served={n.topics}
          topics={data.topics}
          own={mine}
          onRemove={onRemoveTopic}
          onAdd={onAddTopic}
        />
        <NoteMenu
          own={mine}
          href={hrefNote(n.id)}
          onCopied={onCopied}
          onDelete={() => setAsking(true)}
          buttonRef={more}
        />
      </div>
      {asking && (
        <DeleteNote
          onDelete={() => onDelete(n.id)}
          onDone={(back) => {
            refocus.current = back;
            setAsking(false);
          }}
        />
      )}
      {mine && n.quarantined && (
        <Release
          note={n}
          members={data.members}
          onRelease={() => onRelease(n.id)}
        />
      )}
      <Linked
        links={links}
        own={n.member_id === data.me}
        owner={owner}
        hrefNote={hrefNote}
        onUnlink={onUnlink}
      />
    </header>
  );
}

export function Preview({
  data,
  pending = false,
  failed = false,
  onSave,
  onRelease,
  onDelete,
  onUnlink,
  onRemoveTopic,
  onAddTopic,
  hrefNote,
  onCopied,
  idle,
}: {
  data: VaultData;
  /** Another note is on its way; this one stays until it arrives. */
  pending?: boolean;
  /** The note last asked for could not be opened; this one stays. */
  failed?: boolean;
  onSave: (noteId: string, choice: Choice) => Promise<Result>;
  onRelease: (noteId: string) => Promise<Result>;
  /** Deletes the note and says whether it worked. */
  onDelete: (noteId: string) => Promise<boolean>;
  /** Ends a link of the open note and says whether it worked. */
  onUnlink: (linkId: string) => Promise<boolean>;
  /** Takes a topic off the open note and says whether it worked. */
  onRemoveTopic: (noteId: string, topicId: string) => Promise<boolean>;
  /** Puts a topic on the open note and says what came of it. */
  onAddTopic: (noteId: string, topicId: string) => Promise<TopicChange>;
  /** The address of another note in the vault. */
  hrefNote: (noteId: string) => string;
  /** Copy link was pressed: whether the link reached the clipboard. */
  onCopied: (ok: boolean) => void;
  /** Shown when no note is open, in place of the line that asks to choose one. */
  idle?: ReactNode;
}) {
  const open = data.open;
  const shownId = open && "note" in open ? open.note.id : null;
  // A newly opened note is read from its top.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
  }, [shownId]);
  let body;
  if (open === null) {
    body = idle ?? <p className={s.empty}>Choose a note to read it.</p>;
  } else if ("missing" in open) {
    body = <p className={s.empty}>That note isn&apos;t available.</p>;
  } else {
    const n = open.note;
    body = (
      <article
        key={n.id}
        className={`${s.article} rise`}
        style={{ "--rise-delay": "0s" } as CSSProperties}
      >
        <Head
          key={n.id}
          data={data}
          note={n}
          links={open.links}
          onSave={onSave}
          onRelease={onRelease}
          onDelete={onDelete}
          onUnlink={onUnlink}
          onRemoveTopic={onRemoveTopic}
          onAddTopic={onAddTopic}
          hrefNote={hrefNote}
          onCopied={onCopied}
        />
        {open.cut && (
          <p className={s.cut}>Showing the first 200,000 characters.</p>
        )}
        <Markdown body={withoutTitle(open.body, n.title)} />
      </article>
    );
  }
  return (
    <section
      ref={box}
      aria-label="Note"
      aria-busy={pending || undefined}
      className={s.preview}
      data-idle={(open === null && !failed) || undefined}
      data-pending={pending || undefined}
    >
      {/* Announced as it changes; not a status of its own, the screen has one. */}
      <p aria-live="polite" data-opening className={failed ? s.cut : s.srOnly}>
        {failed ? OPEN_FAILED : pending ? OPENING : ""}
      </p>
      {body}
    </section>
  );
}
