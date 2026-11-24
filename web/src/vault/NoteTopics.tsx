"use client";

// The open note's topics, under "Linked with": a chip for each (its name and kind), and, on the
// person's own note, Remove on each chip and an Add control for the topics it does not carry yet.
// Remove acts at once; the database decides whether a change is allowed. The chips are the note's
// topics as last served, changed here as soon as a change worked.
import { useEffect, useId, useRef, useState } from "react";
import { KIND_NAMES, KINDS, MAX_TOPICS_PER_NOTE } from "../topics/types";
import {
  ADD,
  ADD_TOPIC,
  NO_TOPICS_YET,
  REFUSED,
  REFUSED_FULL,
  removeName,
  TOPICS_HEADING,
} from "./topicText";
import type { TopicChange, VaultTopic } from "./types";
import s from "./vault.module.css";

export function NoteTopics({
  noteId,
  served,
  topics,
  own,
  onRemove,
  onAdd,
}: {
  noteId: string;
  /** The note's topic ids as last served, strongest first. */
  served: string[];
  /** The hive's topics. */
  topics: VaultTopic[];
  /** The open note is the person's own. */
  own: boolean;
  onRemove: (noteId: string, topicId: string) => Promise<boolean>;
  onAdd: (noteId: string, topicId: string) => Promise<TopicChange>;
}) {
  const id = useId();
  // The note's topics as shown: what was served, until a change here has worked.
  const key = served.join(",");
  const [seen, setSeen] = useState(key);
  const [ids, setIds] = useState(served);
  if (seen !== key) {
    setSeen(key);
    setIds(served);
  }
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  // Where the focus goes after the next render: a chip's Remove by topic id, or the Add control.
  const target = useRef<string | "add" | null>(null);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const el =
      want === "add"
        ? section.current?.querySelector<HTMLElement>("select")
        : section.current?.querySelector<HTMLElement>(
            `[data-remove="${CSS.escape(want)}"]`,
          );
    el?.focus();
  });

  const byId = new Map(topics.map((t) => [t.id, t]));
  const drawn = ids.flatMap((t) => (byId.has(t) ? [byId.get(t)!] : []));
  if (!own && drawn.length === 0) return null;

  const remaining = topics.filter((t) => !ids.includes(t.id));
  const canAdd =
    own && ids.length < MAX_TOPICS_PER_NOTE && remaining.length > 0;
  const chosen = remaining.some((t) => t.id === pick)
    ? pick
    : (remaining[0]?.id ?? "");

  const inside = () => {
    const at = document.activeElement;
    return !at || at === document.body || !!section.current?.contains(at);
  };

  async function remove(topic: VaultTopic) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setRefused(null);
    let ok = false;
    try {
      ok = await onRemove(noteId, topic.id);
    } catch {
      ok = false;
    }
    running.current = false;
    setBusy(false);
    if (!ok) {
      setRefused(REFUSED);
      return;
    }
    // The next chip's Remove, else the previous one's, else the Add control.
    if (inside()) {
      const left = drawn.filter((t) => t.id !== topic.id);
      const at = drawn.findIndex((t) => t.id === topic.id);
      target.current = (left[at] ?? left[at - 1])?.id ?? "add";
    }
    setIds((now) => now.filter((t) => t !== topic.id));
  }

  async function add() {
    if (running.current || chosen === "") return;
    running.current = true;
    setBusy(true);
    setRefused(null);
    let change: TopicChange = { ok: false, reason: "failed" };
    try {
      change = await onAdd(noteId, chosen);
    } catch {
      change = { ok: false, reason: "failed" };
    }
    running.current = false;
    setBusy(false);
    if (!change.ok) {
      setRefused(change.reason === "full" ? REFUSED_FULL : REFUSED);
      return;
    }
    // With the fifth topic the Add control leaves: the focus goes to the new chip's Remove.
    if (inside() && ids.length + 1 >= MAX_TOPICS_PER_NOTE)
      target.current = chosen;
    setIds((now) => (now.includes(chosen) ? now : [...now, chosen]));
  }

  const off = busy || undefined;
  return (
    <section ref={section} aria-label={TOPICS_HEADING} className={s.tools}>
      <h3 className={`${s.groupName} ${s.wide}`}>{TOPICS_HEADING}</h3>
      {drawn.length === 0 ? (
        <p className={`${s.sentence} ${s.wide}`} data-quiet>
          {NO_TOPICS_YET}
        </p>
      ) : (
        <ul className={`${s.chips} ${s.wide}`}>
          {drawn.map((t) => (
            <li key={t.id} className={s.chip}>
              <span className={s.chipName}>{t.name}</span>
              <span className={s.chipKind}>{KIND_NAMES[t.kind]}</span>
              {own && (
                <button
                  type="button"
                  className={s.quiet}
                  data-remove={t.id}
                  aria-label={removeName(t.name)}
                  aria-disabled={off}
                  onClick={() => void remove(t)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className={`${s.addRow} ${s.wide}`}>
          <label htmlFor={`${id}-add`} className={s.srOnly}>
            {ADD_TOPIC}
          </label>
          <select
            id={`${id}-add`}
            className={`${s.search} ${s.addSelect}`}
            value={chosen}
            onChange={(e) => setPick(e.currentTarget.value)}
          >
            {KINDS.map((kind) => {
              const group = remaining.filter((t) => t.kind === kind);
              return group.length === 0 ? null : (
                <optgroup key={kind} label={KIND_NAMES[kind]}>
                  {group.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <button
            type="button"
            className={s.secondary}
            aria-disabled={off}
            onClick={() => void add()}
          >
            {ADD}
          </button>
        </div>
      )}
      {refused && (
        <p role="alert" className={`${s.refused} ${s.wide}`}>
          {refused}
        </p>
      )}
    </section>
  );
}
