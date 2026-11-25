"use client";

// The topic picker under + Topic: a search field, then the hive's topics the note does not carry,
// under their kind in the fixed kind order, filtered by the text. Client state only; choosing one
// hands its id to the caller, which adds it and closes the picker.
import { useId, useState } from "react";
import { KIND_NAMES, KINDS } from "../topics/types";
import { ADD_TOPIC, FIND_TOPIC, NO_TOPIC_MATCHES } from "./topicText";
import type { VaultTopic } from "./types";
import s from "./vault.module.css";

export function TopicPicker({
  id,
  remaining,
  busy,
  onPick,
}: {
  /** The popover's id, for its button's aria-controls. */
  id: string;
  remaining: VaultTopic[];
  busy: boolean;
  onPick: (topicId: string) => void;
}) {
  const field = useId();
  const [q, setQ] = useState("");
  const want = q.trim().toLowerCase();
  const found = remaining.filter((t) => t.name.toLowerCase().includes(want));
  const off = busy || undefined;

  return (
    <div id={id} role="group" aria-label={ADD_TOPIC} className={s.pickPop}>
      <label htmlFor={field} className={s.srOnly}>
        {FIND_TOPIC}
      </label>
      <input
        id={field}
        type="search"
        className={s.search}
        placeholder={FIND_TOPIC}
        autoComplete="off"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      {found.length === 0 ? (
        <p className={s.pickNone}>{NO_TOPIC_MATCHES}</p>
      ) : (
        KINDS.map((kind) => {
          const group = found.filter((t) => t.kind === kind);
          if (group.length === 0) return null;
          return (
            <div
              key={kind}
              role="group"
              aria-labelledby={`${field}-${kind}`}
              className={s.pickGroup}
            >
              <p id={`${field}-${kind}`} className={s.pickKind}>
                {KIND_NAMES[kind]}
              </p>
              {group.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={s.menuItem}
                  aria-disabled={off}
                  onClick={() => {
                    if (!busy) onPick(t.id);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
