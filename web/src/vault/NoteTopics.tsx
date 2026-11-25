"use client";

// The open note's topics, inline in its action row: a chip for each (its name and kind), and, on
// the person's own note, × on each chip and + Topic, which opens the topic picker for the topics
// it does not carry yet. A change acts at once; the database decides whether it is allowed. The
// chips are the note's topics as last served, changed here as soon as a change worked.
import { useEffect, useId, useRef, useState } from "react";
import { useDismiss } from "../map/useDismiss";
import { KIND_NAMES, MAX_TOPICS_PER_NOTE } from "../topics/types";
import { TopicPicker } from "./TopicPicker";
import {
  ADD_TOPIC_BUTTON,
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
  const [picking, setPicking] = useState(false);
  // Where the focus goes after the next render: a chip's × by topic id, or + Topic.
  const target = useRef<string | "add" | null>(null);
  const section = useRef<HTMLElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useDismiss({
    open: picking,
    root: picker,
    button: addButton,
    onClose: (refocus) => {
      setPicking(false);
      if (refocus) addButton.current?.focus();
    },
  });

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const el =
      want === "add"
        ? addButton.current
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
    // The next chip's ×, else the previous one's, else + Topic.
    if (inside()) {
      const left = drawn.filter((t) => t.id !== topic.id);
      const at = drawn.findIndex((t) => t.id === topic.id);
      target.current = (left[at] ?? left[at - 1])?.id ?? "add";
    }
    setIds((now) => now.filter((t) => t !== topic.id));
  }

  async function add(chosen: string) {
    if (running.current) return;
    // The picker closes at once; the focus goes back to + Topic.
    setPicking(false);
    target.current = "add";
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
    // With the fifth topic + Topic leaves: the focus goes to the new chip's ×.
    if (inside() && ids.length + 1 >= MAX_TOPICS_PER_NOTE)
      target.current = chosen;
    setIds((now) => (now.includes(chosen) ? now : [...now, chosen]));
  }

  const off = busy || undefined;
  return (
    <section ref={section} aria-label={TOPICS_HEADING} className={s.noteTopics}>
      {drawn.length > 0 && (
        <ul className={s.chips}>
          {drawn.map((t) => (
            <li key={t.id} className={s.chip}>
              <span className={s.chipName}>{t.name}</span>
              <span className={s.chipKind}>{KIND_NAMES[t.kind]}</span>
              {own && (
                <button
                  type="button"
                  className={s.chipRemove}
                  data-remove={t.id}
                  aria-label={removeName(t.name)}
                  aria-disabled={off}
                  onClick={() => void remove(t)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div ref={picker} className={s.pickRoot}>
          <button
            ref={addButton}
            type="button"
            className={s.addTopic}
            aria-expanded={picking}
            aria-controls={picking ? `${id}-pick` : undefined}
            onClick={() => setPicking((p) => !p)}
          >
            {ADD_TOPIC_BUTTON}
          </button>
          {picking && (
            <TopicPicker
              id={`${id}-pick`}
              remaining={remaining}
              busy={busy}
              onPick={(t) => void add(t)}
            />
          )}
        </div>
      )}
      {refused && (
        <p role="alert" className={s.refused}>
          {refused}
        </p>
      )}
    </section>
  );
}
