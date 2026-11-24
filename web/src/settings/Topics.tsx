"use client";

// The owner's Topics section. "Find topics in my notes" reads the heads of the owner's own
// notes a page at a time, works out the candidates in the browser, and shows the ones the hive
// does not have yet, ticked by kind; Save sends the ticked ones. Below, the hive's topics by
// kind, each with Delete, asked once. The database decides whether the person may; this only
// asks. Nothing here reads a note's text.
import { useEffect, useRef, useState } from "react";
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
      ticked: ReadonlySet<number>;
      saving: boolean;
    };

const keyOf = (kind: Kind, name: string) => `${kind}|${normal(name)}`;

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
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const running = useRef(false);
  const alive = useRef(true);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The candidates replace the button: the focus goes to their heading.
  const picking = stage.kind === "picking";
  useEffect(() => {
    if (picking) heading.current?.focus();
  }, [picking]);

  const shown = topics.filter((x) => !gone.has(x.id));

  function say(text: string, failed = false) {
    setProblem(failed ? text : null);
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
    const ticked = new Set<number>();
    found.forEach((c, i) => {
      if (c.kind !== "subject") ticked.add(i);
    });
    setStage({ kind: "picking", found, ticked, saving: false });
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
    opener.current?.focus();
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
    if (!ok) return say(t.FAILED, true);
    setGone((set) => new Set(set).add(topic.id));
    say(t.deleted(topic.name));
    onChanged();
  }

  return (
    <section aria-labelledby="settings-topics" className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-topics">{t.TITLE}</span>
            <span className={s.count}>{shown.length}</span>
          </h2>
          <p className={s.note}>{t.NOTE}</p>
        </div>
        {stage.kind !== "picking" && !closing && (
          <button
            ref={opener}
            type="button"
            className={s.primary}
            aria-disabled={stage.kind === "finding" || undefined}
            onClick={() => void find()}
          >
            {t.FIND}
          </button>
        )}
      </div>

      {stage.kind === "finding" && (
        <p role="status" className={s.note}>
          {t.FINDING}: {stage.read}
        </p>
      )}
      {problem && stage.kind !== "picking" && (
        <p className={s.refused}>{problem}</p>
      )}

      {stage.kind === "picking" && (
        <form
          aria-labelledby="settings-topics-found"
          className={s.form}
          aria-busy={stage.saving || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3
            ref={heading}
            id="settings-topics-found"
            tabIndex={-1}
            className={s.fieldLabel}
          >
            {t.FOUND}
          </h3>
          <p className={s.hint}>{t.FOUND_NOTE}</p>
          {KINDS.map((kind) => {
            const of = stage.found
              .map((c, i) => ({ c, i }))
              .filter(({ c }) => c.kind === kind);
            if (of.length === 0) return null;
            return (
              <fieldset key={kind} className={s.field}>
                <legend className={s.fieldLabel}>
                  {t.KIND_NAMES[kind]}{" "}
                  <span className={s.count}>{of.length}</span>
                </legend>
                <ul role="list" className={s.rows}>
                  {of.map(({ c, i }) => {
                    const extra = t.candidateNotes(c.kind, c.notes);
                    return (
                      <li key={i} className={s.item}>
                        <label className={s.text}>
                          <input
                            type="checkbox"
                            checked={stage.ticked.has(i)}
                            disabled={stage.saving}
                            aria-label={t.pickLabel(t.KIND_NAMES[kind], c.name)}
                            onChange={(e) => {
                              const ticked = new Set(stage.ticked);
                              if (e.currentTarget.checked) ticked.add(i);
                              else ticked.delete(i);
                              setStage({ ...stage, ticked });
                            }}
                          />{" "}
                          <span className={s.name}>{c.name}</span>
                          {extra && <span className={s.mark}>{extra}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
          <div className={s.formFoot}>
            <button
              type="submit"
              className={s.primary}
              aria-disabled={
                stage.saving || stage.ticked.size === 0 || undefined
              }
            >
              {t.SAVE}
            </button>
            <button
              type="button"
              className={s.secondary}
              aria-disabled={stage.saving || undefined}
              onClick={() => {
                if (stage.saving) return;
                setStage({ kind: "idle" });
                setProblem(null);
              }}
            >
              {t.CANCEL}
            </button>
            {problem && <p className={s.refused}>{problem}</p>}
          </div>
        </form>
      )}

      {shown.length === 0 && stage.kind === "idle" ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>{t.EMPTY_TITLE}</p>
          <p className={s.emptyText}>{t.EMPTY_TEXT}</p>
        </div>
      ) : (
        KINDS.map((kind) => {
          const of = shown.filter((x) => x.kind === kind);
          if (of.length === 0) return null;
          return (
            <ul
              key={kind}
              role="list"
              aria-label={t.KIND_NAMES[kind]}
              className={s.rows}
            >
              {of.map((topic) => {
                const notes = t.topicNotes(topic.notes);
                const isAsking = asking === topic.id;
                const off = busy === topic.id || undefined;
                return (
                  <li key={topic.id} className={s.item} aria-busy={off}>
                    <div className={s.text}>
                      <p className={s.what}>
                        <span className={s.name}>{topic.name}</span>
                      </p>
                      <p className={s.meta}>
                        <span>{t.KIND_NAMES[kind]}</span>
                        {notes && <span>{notes}</span>}
                      </p>
                    </div>
                    {!closing && (
                      <div className={s.side}>
                        <div
                          role="group"
                          aria-label={`${t.DELETE} ${topic.name}`}
                          className={s.actions}
                        >
                          {isAsking ? (
                            <>
                              <p className={s.ask}>
                                {t.deleteQuestion(topic.name)}
                              </p>
                              <button
                                type="button"
                                className={s.confirm}
                                aria-disabled={off}
                                onClick={() => void remove(topic)}
                              >
                                {t.DELETE}
                              </button>
                              <button
                                type="button"
                                className={s.secondary}
                                aria-disabled={off}
                                onClick={() => setAsking(null)}
                              >
                                {t.KEEP}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={s.secondary}
                              aria-label={`${t.DELETE} ${topic.name}`}
                              onClick={() => setAsking(topic.id)}
                            >
                              {t.DELETE}
                            </button>
                          )}
                        </div>
                        {isAsking && (
                          <p className={s.aside}>{t.DELETE_ASIDE}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })
      )}
    </section>
  );
}
