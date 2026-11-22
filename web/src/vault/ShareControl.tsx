"use client";

// The sharing control for one note or one folder: a pill with the current state; opened, the
// choices, the people checklist, the sentence that says what the choice will do, and Save /
// Cancel. Nothing is written before Save, and whether a change is allowed is the database's
// answer: a refusal is shown, never worked around.
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Mark } from "./marks";
import { Glyph, markText } from "./MarkTag";
import { folderSentence, noteSentence } from "./sentences";
import type {
  Choice,
  Result,
  SharePreview,
  VaultData,
  Visibility,
} from "./types";
import s from "./vault.module.css";

type Key = Visibility | "folder" | "none";

type Counted =
  { state: "counting" } | { state: "done"; value: SharePreview | null };

type Common = {
  /** What the pill shows now; null for a folder with no rule. */
  mark: Mark | null;
  current: Choice;
  hive: VaultData["hive"];
  members: VaultData["members"];
  me: string;
  onSave: (choice: Choice) => Promise<Result>;
};

type Props =
  | (Common & {
      subject: "note";
      /** The effective state, preselected when the note has no setting and no rule above it. */
      effective: Visibility;
      /** The rule above the note, when there is one: offers "Same as folder". */
      ruleFolder: string | null;
      folderRule: Mark | null;
    })
  | (Common & {
      subject: "folder";
      path: string;
      loadPreview: () => Promise<SharePreview | null>;
    });

function choiceOf(key: Key, ticked: string[]): Choice {
  if (key === "folder" || key === "none")
    return { visibility: null, shared_with: [] };
  return { visibility: key, shared_with: key === "members" ? ticked : [] };
}

export function ShareControl(props: Props) {
  const router = useRouter();
  const groupId = useId();
  const pill = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<{ key: Key; ticked: string[] }>({
    key: "private",
    ticked: [],
  });
  const [key, setKey] = useState<Key>("private");
  const [ticked, setTicked] = useState<string[]>([]);
  const [counted, setCounted] = useState<Counted>({ state: "counting" });
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);

  const others = props.members.filter((m) => m.id !== props.me);
  const options: { key: Key; label: string }[] = [
    { key: "private", label: "Private" },
    { key: "group", label: `Everyone in ${props.hive.name}` },
    { key: "members", label: "Specific people" },
  ];
  if (props.subject === "note" && props.ruleFolder)
    options.push({ key: "folder", label: "Same as folder" });
  if (props.subject === "folder")
    options.push({ key: "none", label: "No rule" });

  useEffect(() => {
    if (!open) return;
    group.current
      ?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      ?.focus();
  }, [open]);

  function start() {
    const { current } = props;
    let k: Key;
    if (current.visibility !== null) k = current.visibility;
    else if (props.subject === "folder") k = "none";
    else k = props.ruleFolder ? "folder" : props.effective;
    const t =
      current.visibility === "members"
        ? current.shared_with.filter((id) => id !== props.me)
        : [];
    setInitial({ key: k, ticked: t });
    setKey(k);
    setTicked(t);
    setRefused(false);
    setSaving(false);
    setOpen(true);
    if (props.subject === "folder") {
      const n = ++request.current;
      setCounted({ state: "counting" });
      props.loadPreview().then(
        (value) => {
          if (n === request.current) setCounted({ state: "done", value });
        },
        () => {
          if (n === request.current) setCounted({ state: "done", value: null });
        },
      );
    }
  }

  function close() {
    request.current++;
    setOpen(false);
    pill.current?.focus();
  }

  const choice = choiceOf(key, ticked);
  const names = others
    .filter((m) => ticked.includes(m.id))
    .map((m) => m.display_name);
  const nobody = key === "members" && ticked.length === 0;
  const same =
    key === initial.key &&
    (key !== "members" ||
      [...ticked].sort().join() === [...initial.ticked].sort().join());

  let sentence: string | null = null;
  let uncounted = false;
  if (!nobody) {
    if (props.subject === "note") {
      sentence = noteSentence({
        choice,
        hive: props.hive.name,
        hiveSize: props.members.length,
        names,
        folderRule: props.folderRule,
      });
    } else if (counted.state === "counting") {
      sentence = "Counting…";
      uncounted = true;
    } else if (counted.value === null) {
      sentence = "Couldn't count the notes in this folder.";
      uncounted = true;
    } else {
      sentence = folderSentence({
        folder: props.path,
        choice,
        hive: props.hive.name,
        hiveSize: props.members.length,
        names,
        preview: counted.value,
      });
    }
  } else if (
    props.subject === "folder" &&
    counted.state === "done" &&
    !counted.value
  ) {
    sentence = "Couldn't count the notes in this folder.";
    uncounted = true;
  }
  const blocked =
    same || nobody || saving || (props.subject === "folder" && uncounted);

  async function save() {
    setSaving(true);
    setRefused(false);
    let ok = false;
    try {
      ok = (await props.onSave(choice)).ok;
    } catch {
      ok = false;
    }
    setSaving(false);
    if (ok) {
      close();
      router.refresh();
    } else {
      setRefused(true);
    }
  }

  const label =
    props.subject === "note"
      ? "Who can read this note"
      : `Who can read ${props.path}`;
  const shown = props.mark ? markText(props.mark) : "No rule";

  return (
    <div className={s.share}>
      <button
        ref={pill}
        type="button"
        className={s.pill}
        aria-expanded={open}
        aria-controls={open ? groupId : undefined}
        aria-label={`${props.subject === "note" ? "Sharing" : "Folder sharing"}: ${shown}`}
        onClick={() => (open ? close() : start())}
      >
        {props.mark && <Glyph kind={props.mark.kind} />}
        <span>{shown}</span>
        <span
          aria-hidden="true"
          className={s.caret}
          data-open={open || undefined}
        />
      </button>
      {open && (
        <div
          ref={group}
          id={groupId}
          role="group"
          aria-label={label}
          data-scope="reset"
          className={s.control}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        >
          <div className={s.options}>
            {options.map((o) => (
              <label key={o.key} className={s.option}>
                <input
                  type="radio"
                  name={`${groupId}-choice`}
                  className={s.hiddenInput}
                  checked={key === o.key}
                  onChange={() => {
                    setKey(o.key);
                    setRefused(false);
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
          {key === "members" && (
            <div className={s.people}>
              {others.map((m) => (
                <label key={m.id} className={s.person}>
                  <input
                    type="checkbox"
                    className={s.hiddenInput}
                    checked={ticked.includes(m.id)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setTicked((t) =>
                        on ? [...t, m.id] : t.filter((id) => id !== m.id),
                      );
                      setRefused(false);
                    }}
                  />
                  <span aria-hidden="true" className={s.tick} />
                  {m.display_name}
                </label>
              ))}
            </div>
          )}
          {sentence && (
            <p
              className={s.sentence}
              data-quiet={uncounted || undefined}
              aria-live="polite"
            >
              {sentence}
            </p>
          )}
          {refused && (
            <p role="alert" className={s.refused}>
              That change was refused.
            </p>
          )}
          <div className={s.actions}>
            <button
              type="button"
              className={s.primary}
              disabled={blocked}
              onClick={save}
            >
              Save
            </button>
            <button type="button" className={s.secondary} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
