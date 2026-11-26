"use client";

// Picks one of the person's own notes: typing asks `findMyNotes` once the typing pauses (250 ms)
// and only from two characters; an answer to an earlier query is dropped. The arrows move
// through the list, Enter or a press picks, Escape gives up. With `allowNone`, the last option is
// "No home note (only you)".
import { useEffect, useId, useRef, useState } from "react";
import type { GalleryActions, NoteChoice } from "./types";
import s from "./gallery.module.css";

const PAUSE = 250;
const NONE = "No home note (only you)";

export function NotePicker({
  findMyNotes,
  allowNone,
  onPick,
  onCancel,
}: {
  findMyNotes: GalleryActions["findMyNotes"];
  allowNone: boolean;
  /** A note, or null for "no home note". */
  onPick(note: NoteChoice | null): void;
  onCancel(): void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<NoteChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(-1);
  const asked = useRef(0);
  const finder = useRef(findMyNotes);
  useEffect(() => {
    finder.current = findMyNotes;
  });

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    const turn = ++asked.current;
    if (q.length < 2) {
      setFound([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      let answer: NoteChoice[] = [];
      try {
        answer = await finder.current(q);
      } catch {
        answer = [];
      }
      if (turn !== asked.current) return;
      setFound(answer);
      setSearching(false);
      setActive(-1);
    }, PAUSE);
    return () => clearTimeout(timer);
  }, [query]);

  const options: (NoteChoice | null)[] = allowNone ? [...found, null] : found;
  const pick = (i: number) => {
    const o = options[i];
    if (o !== undefined) onPick(o);
  };
  const short = query.trim().length < 2;

  return (
    <div className={s.picker}>
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-label="Find a note"
        aria-expanded={options.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        placeholder="Find one of your notes"
        className={s.search}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (options.length === 0) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((a) => (a + step + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (active >= 0) pick(active);
            else if (found.length === 1) pick(0);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <ul
        role="listbox"
        id={`${id}-list`}
        aria-label="Notes"
        className={s.options}
      >
        {options.map((o, i) => (
          <li
            key={o ? o.id : "none"}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            className={s.option}
            data-none={o ? undefined : ""}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
          >
            {o ? (
              <>
                <span className={s.optionTitle}>{o.title}</span>
                <span className={s.optionPath}>{o.path}</span>
              </>
            ) : (
              NONE
            )}
          </li>
        ))}
      </ul>
      <p role="status" className={s.popNote}>
        {searching
          ? "Looking…"
          : short
            ? "Type two letters or more."
            : found.length === 0
              ? "None of your notes is called that."
              : ""}
      </p>
      <button type="button" className={s.quiet} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
