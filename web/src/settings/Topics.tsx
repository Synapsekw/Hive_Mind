"use client";

// The owner's Topics tab. "Find topics in my notes" reads the heads of the owner's own notes a
// page at a time, works out the candidates in the browser, and shows the ones the hive does not
// have yet in a dialog, ticked by kind; Save sends the ticked ones. Below, a search and a chip
// per kind (client state only) over a grid of the hive's topics, each with a ⋯ menu whose
// Delete topic… asks once. The database decides whether the person may; this only asks.
// Nothing here reads a note's text.
import { useEffect, useRef, useState } from "react";
import { PanelDialog } from "../vault/PanelDialog";
import { RowMenu } from "./RowMenu";
import { candidates } from "../topics/candidates";
import { normal } from "../topics/normal";
import {
  KINDS,
  SAVE_CHUNK,
  type Candidate,
  type Kind,
  type NoteHead,
} from "../topics/types";
import * as t from "./topicsText";
import type { SettingsActions, TopicRow, Workspace } from "./types";
import s from "./settings.module.css";

/** Scan steps refused one after another before the reading gives up. */
const GIVE_UP_AFTER = 3;

type Stage =
  | { kind: "idle" }
  | { kind: "finding"; read: number }
  | {
      kind: "picking";
      found: Candidate[];
      /** Per candidate: the words for the other kinds its name is already saved under. */
      under: ReadonlyMap<number, string>;
      ticked: ReadonlySet<number>;
      saving: boolean;
    };

const keyOf = (kind: Kind, name: string) => `${kind}|${normal(name)}`;

/** A kind with more entries than this starts folded: the page stays one screen long. */
const OPEN_UP_TO = 12;

export function Topics({
  topics,
  workspaces,
  actions,
  closing,
  onSay,
  onChanged,
}: {
  topics: TopicRow[];
  /** The owner's own workspaces: where their notes are read from. */
  workspaces: Workspace[];
  actions: Pick<SettingsActions, "scanTopics" | "saveTopics" | "deleteTopic">;
  /** The hive is being deleted: nothing can be saved, so nothing is offered. */
  closing: boolean;
  onSay: (text: string) => void;
  /** Topics were saved or deleted: the page is read again. */
  onChanged: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  // The last message that is not a refusal, shown beside the announcement.
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // The search and the chosen kind chip: client state, no request.
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  // Which kinds the person folded or unfolded by hand; the rest follow their size.
  const [folds, setFolds] = useState<Readonly<Record<string, boolean>>>({});
  const isOpen = (id: string, size: number) => folds[id] ?? size <= OPEN_UP_TO;
  const toggle = (id: string, size: number) =>
    setFolds((f) => ({ ...f, [id]: !(f[id] ?? size <= OPEN_UP_TO) }));
  const running = useRef(false);
  const alive = useRef(true);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  // Where the focus goes after the next render: a topic's Keep, its ⋯ button, or the grid.
  const target = useRef<{ id: string; pick: "keep" | "menu" } | null>(null);
  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const cell = [
      ...(grid.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
    ].find((el) => el.dataset.row === want.id);
    const to =
      want.pick === "keep"
        ? cell?.querySelector<HTMLElement>('[data-pick="keep"]')
        : cell?.querySelector<HTMLElement>("[data-menu]");
    (to ?? cell ?? grid.current)?.focus();
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The candidates open in a dialog: the focus goes to their heading.
  const picking = stage.kind === "picking";
  useEffect(() => {
    if (picking) heading.current?.focus();
  }, [picking]);
  // Leaving the candidates (Save or Cancel) closes the dialog: Find takes the focus.
  const wasPicking = useRef(false);
  useEffect(() => {
    if (wasPicking.current && !picking) opener.current?.focus();
    wasPicking.current = picking;
  }, [picking]);

  const shown = topics.filter((x) => !gone.has(x.id));
  const counts = t.kindCounts(shown);
  // A chosen kind whose last topic went is no longer offered: every kind shows again.
  const chosen = kind !== null && counts[kind] ? kind : null;
  const listed = t.filterTopics(shown, chosen, q);

  function ask(id: string) {
    if (running.current) return;
    target.current = { id, pick: "keep" };
    setAsking(id);
  }

  function keep(id: string) {
    if (running.current) return;
    target.current = { id, pick: "menu" };
    setAsking(null);
  }

  function cancel() {
    if (stage.kind !== "picking" || stage.saving) return;
    setStage({ kind: "idle" });
    setProblem(null);
    setMessage(null);
  }

  function say(text: string, failed = false) {
    setProblem(failed ? text : null);
    setMessage(!failed && text ? text : null);
    onSay(text);
  }

  async function find() {
    if (running.current) return;
    running.current = true;
    say("");
    setStage({ kind: "finding", read: 0 });
    const heads: NoteHead[] = [];
    let ok = true;
    reading: for (const w of workspaces) {
      let after: string | null = null;
      let streak = 0;
      for (;;) {
        let step: Awaited<ReturnType<typeof actions.scanTopics>>;
        try {
          step = await actions.scanTopics(w.id, after);
        } catch {
          step = { ok: false };
        }
        if (!alive.current) return;
        if (!step.ok || !Array.isArray(step.heads)) {
          streak += 1;
          if (streak >= GIVE_UP_AFTER) {
            ok = false;
            break reading;
          }
          continue;
        }
        streak = 0;
        heads.push(...step.heads);
        setStage({ kind: "finding", read: heads.length });
        if (
          step.next === null ||
          step.next === after ||
          step.heads.length === 0
        )
          break;
        after = step.next;
      }
    }
    running.current = false;
    if (!ok) {
      setStage({ kind: "idle" });
      return say(t.SCAN_FAILED, true);
    }
    const have = new Set(shown.map((x) => keyOf(x.kind, x.name)));
    const found = candidates(heads).filter(
      (c) => !have.has(keyOf(c.kind, c.name)),
    );
    if (found.length === 0) {
      setStage({ kind: "idle" });
      return say(t.NOTHING_NEW);
    }
    // A name the hive already has under another kind is still offered, but is not ticked.
    const kindsOf = new Map<string, Set<Kind>>();
    for (const x of shown) {
      const set = kindsOf.get(normal(x.name));
      if (set) set.add(x.kind);
      else kindsOf.set(normal(x.name), new Set([x.kind]));
    }
    const under = new Map<number, string>();
    const ticked = new Set<number>();
    found.forEach((c, i) => {
      const other = KINDS.filter((k) => kindsOf.get(normal(c.name))?.has(k));
      if (other.length > 0)
        under.set(i, t.alreadyUnder(other.map((k) => t.KIND_NAMES[k])));
      else if (c.kind !== "subject") ticked.add(i);
    });
    setStage({ kind: "picking", found, under, ticked, saving: false });
  }

  async function save() {
    if (stage.kind !== "picking" || running.current || stage.ticked.size === 0)
      return;
    running.current = true;
    say("");
    setStage({ ...stage, saving: true });
    const picks = stage.found
      .filter((_, i) => stage.ticked.has(i))
      .map(({ kind, name, aliases }) => ({ kind, name, aliases }));
    let total = 0;
    let ok = true;
    for (let at = 0; at < picks.length && ok; at += SAVE_CHUNK) {
      let answer: Awaited<ReturnType<typeof actions.saveTopics>>;
      try {
        answer = await actions.saveTopics(picks.slice(at, at + SAVE_CHUNK));
      } catch {
        answer = { ok: false };
      }
      if (answer.ok) total += answer.saved;
      else ok = false;
    }
    running.current = false;
    if (!ok) {
      setStage({ ...stage, saving: false });
      // What went in before the refusal stays: the list is read again either way.
      if (total > 0) onChanged();
      return say(t.SAVE_FAILED, true);
    }
    setStage({ kind: "idle" });
    say(`${t.saved(total)} ${t.NEXT}`);
    onChanged();
  }

  async function remove(topic: TopicRow) {
    if (running.current) return;
    running.current = true;
    setBusy(topic.id);
    say("");
    let ok = false;
    try {
      ok = (await actions.deleteTopic(topic.id)).ok;
    } catch {
      ok = false;
    }
    running.current = false;
    setBusy(null);
    setAsking(null);
    if (!ok) {
      target.current = { id: topic.id, pick: "menu" };
      return say(t.FAILED, true);
    }
    setGone((set) => new Set(set).add(topic.id));
    say(t.deleted(topic.name));
    onChanged();
  }

  return (
    <section
      aria-labelledby="settings-topics"
      className={`${s.section} ${s.topicsSection}`}
    >
      <div className={s.sectionHead}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-topics">{t.TITLE}</span>
            <span className={s.count}>{shown.length}</span>
          </h2>
          <p className={s.note}>{t.NOTE}</p>
        </div>
        <div className={s.topicTools}>
          <input
            type="search"
            aria-label={t.SEARCH}
            placeholder={t.SEARCH}
            className={`${s.input} ${s.search}`}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          {!closing && (
            <button
              ref={opener}
              type="button"
              className={s.secondary}
              aria-disabled={stage.kind !== "idle" || undefined}
              onClick={() => void find()}
            >
              {t.FIND_LONG}
            </button>
          )}
        </div>
      </div>

      {stage.kind === "finding" && (
        <p role="status" className={s.note}>
          {t.FINDING}: {stage.read}
        </p>
      )}
      {message && stage.kind !== "picking" && (
        <p className={s.note}>{message}</p>
      )}
      {problem && stage.kind !== "picking" && (
        <p className={s.refused}>{problem}</p>
      )}

      {stage.kind === "picking" && (
        <PanelDialog label={t.FOUND} busy={stage.saving} onClose={cancel}>
          <form
            aria-labelledby="settings-topics-found"
            className={`${s.form} ${s.dialogForm}`}
            aria-busy={stage.saving || undefined}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className={s.foundHead}>
              <h3
                ref={heading}
                id="settings-topics-found"
                tabIndex={-1}
                className={s.dialogTitle}
              >
                {t.FOUND}
              </h3>
              <span className={s.count}>
                {t.ticked(stage.ticked.size, stage.found.length)}
              </span>
            </div>
            <p className={s.hint}>{t.FOUND_NOTE}</p>
            {KINDS.map((kind) => {
              const of = stage.found
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c.kind === kind);
              if (of.length === 0) return null;
              const fold = `found-${kind}`;
              const open = isOpen(fold, of.length);
              const on = of.filter(({ i }) => stage.ticked.has(i)).length;
              const setAll = (to: boolean) => {
                if (stage.saving) return;
                const ticked = new Set(stage.ticked);
                for (const { i } of of) {
                  if (to) ticked.add(i);
                  else ticked.delete(i);
                }
                setStage({ ...stage, ticked });
              };
              return (
                <div
                  key={kind}
                  role="group"
                  aria-labelledby={`${fold}-title`}
                  className={s.fold}
                >
                  <div className={s.foldHead}>
                    <h4 id={`${fold}-title`} className={s.foldTitle}>
                      <button
                        type="button"
                        className={s.foldToggle}
                        aria-expanded={open}
                        aria-controls={`${fold}-list`}
                        onClick={() => toggle(fold, of.length)}
                      >
                        {t.KIND_NAMES[kind]}{" "}
                        <span className={s.count}>{of.length}</span>
                      </button>
                    </h4>
                    <span className={s.count}>{t.ticked(on, of.length)}</span>
                    <button
                      type="button"
                      className={s.small}
                      aria-label={t.tickAll(t.KIND_NAMES[kind])}
                      aria-disabled={
                        stage.saving || on === of.length || undefined
                      }
                      onClick={() => setAll(true)}
                    >
                      {t.ALL}
                    </button>
                    <button
                      type="button"
                      className={s.small}
                      aria-label={t.tickNone(t.KIND_NAMES[kind])}
                      aria-disabled={stage.saving || on === 0 || undefined}
                      onClick={() => setAll(false)}
                    >
                      {t.NONE}
                    </button>
                  </div>
                  {open && (
                    <ul id={`${fold}-list`} role="list" className={s.picks}>
                      {of.map(({ c, i }) => {
                        const extra = t.candidateNotes(c.kind, c.notes);
                        const also = t.alsoKnown(c.aliases);
                        const elsewhere = stage.under.get(i) ?? null;
                        return (
                          <li key={i}>
                            <label className={s.pick}>
                              <input
                                type="checkbox"
                                checked={stage.ticked.has(i)}
                                disabled={stage.saving}
                                aria-label={t.pickLabel(
                                  t.KIND_NAMES[kind],
                                  c.name,
                                  c.aliases,
                                  elsewhere,
                                )}
                                onChange={(e) => {
                                  const ticked = new Set(stage.ticked);
                                  if (e.currentTarget.checked) ticked.add(i);
                                  else ticked.delete(i);
                                  setStage({ ...stage, ticked });
                                }}
                              />
                              <span className={s.pickText}>
                                <span className={s.pickName}>{c.name}</span>
                                {extra && (
                                  <span className={s.pickMore}>{extra}</span>
                                )}
                                {also && (
                                  <span className={s.pickMore}>{also}</span>
                                )}
                                {elsewhere && (
                                  <span className={s.pickMore}>
                                    {elsewhere}
                                  </span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
            <div className={`${s.formFoot} ${s.dialogFoot} ${s.saveBar}`}>
              {problem && <p className={s.refused}>{problem}</p>}
              <button
                type="submit"
                className={s.primary}
                aria-disabled={
                  stage.saving || stage.ticked.size === 0 || undefined
                }
              >
                {t.saveN(stage.ticked.size)}
              </button>
              <button
                type="button"
                className={s.secondary}
                aria-disabled={stage.saving || undefined}
                onClick={cancel}
              >
                {t.CANCEL}
              </button>
            </div>
          </form>
        </PanelDialog>
      )}

      {shown.length === 0 ? (
        stage.kind === "idle" && (
          <div className={s.empty}>
            <p className={s.emptyTitle}>{t.EMPTY_TITLE}</p>
            <p className={s.emptyText}>{t.EMPTY_TEXT}</p>
          </div>
        )
      ) : (
        <>
          <div role="group" aria-label="Kinds" className={s.chips}>
            <button
              type="button"
              className={s.chip}
              aria-pressed={chosen === null}
              onClick={() => setKind(null)}
            >
              {t.ALL} <span className={s.count}>{shown.length}</span>
            </button>
            {KINDS.filter((k) => counts[k]).map((k) => (
              <button
                key={k}
                type="button"
                className={s.chip}
                aria-pressed={chosen === k}
                onClick={() => setKind(k)}
              >
                {t.KIND_NAMES[k]} <span className={s.count}>{counts[k]}</span>
              </button>
            ))}
          </div>
          {listed.length === 0 ? (
            <p className={s.note}>{t.NO_MATCH}</p>
          ) : (
            <ul
              ref={grid}
              role="list"
              aria-label="Topics"
              className={s.topicGrid}
            >
              {listed.map((topic) => {
                const notes = t.topicNotes(topic.notes);
                const isAsking = asking === topic.id && !closing;
                const off = busy === topic.id || undefined;
                return (
                  <li
                    key={topic.id}
                    data-row={topic.id}
                    tabIndex={-1}
                    className={s.topicCell}
                    data-asking={isAsking || undefined}
                    aria-busy={off}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && isAsking) keep(topic.id);
                    }}
                  >
                    <div className={s.text}>
                      <p className={s.what}>
                        <span className={s.topicName}>{topic.name}</span>
                        {chosen === null && (
                          <span className={s.mark}>
                            {t.KIND_NAMES[topic.kind]}
                          </span>
                        )}
                      </p>
                      {notes && <p className={s.meta}>{notes}</p>}
                    </div>
                    {isAsking ? (
                      <div className={s.topicAsk}>
                        <div
                          role="group"
                          aria-label={`${t.DELETE} ${topic.name}`}
                          className={s.actions}
                        >
                          <p className={s.ask}>
                            {t.deleteQuestion(topic.name)}
                          </p>
                          <button
                            type="button"
                            data-pick="delete"
                            className={s.confirm}
                            aria-disabled={off}
                            onClick={() => void remove(topic)}
                          >
                            {t.DELETE}
                          </button>
                          <button
                            type="button"
                            data-pick="keep"
                            className={s.secondary}
                            aria-disabled={off}
                            onClick={() => keep(topic.id)}
                          >
                            {t.KEEP}
                          </button>
                        </div>
                        <p className={s.aside}>{t.DELETE_ASIDE}</p>
                      </div>
                    ) : (
                      !closing && (
                        <RowMenu
                          label={`Actions for ${topic.name}`}
                          items={[
                            {
                              key: "delete",
                              text: t.DELETE_TOPIC_ITEM,
                              danger: true,
                              onPick: () => ask(topic.id),
                            },
                          ]}
                        />
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
