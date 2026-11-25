"use client";

// The Hive tab, the owner's only: deleting the hive, or cancelling that while it is under way.
import { useEffect, useId, useRef, useState } from "react";
import { DeletionDate } from "../shell/ClosingBanner";
import { PanelDialog } from "../vault/PanelDialog";
import {
  CANCEL_DELETION,
  CLOSING_HELP,
  DELETED_ON,
  DELETE_FIELD,
  DELETE_HELP,
  DELETE_HIVE,
  DELETE_HIVE_ITEM,
  DELETE_TITLE,
  DELETE_UNCOUNTED,
  FAILED,
  KEEP_HIVE,
  deleteFailure,
  deleteHint,
  deletionCounts,
} from "./text";
import type { Deletion, SettingsActions } from "./types";
import s from "./settings.module.css";

/**
 * The owner's last section. Not being deleted: what deleting erases, and a danger box whose
 * Delete hive… opens a dialog with a field for the hive's name and Delete hive, which works
 * only once the name is typed exactly. Being deleted: the box says when the hive goes and
 * offers Cancel deletion. Either way a success loads the page afresh, so the
 * banner, the rail and this section all show the hive as it now is. The database decides
 * whether the person may; this only asks.
 */
export function HiveTab({
  hiveName,
  deletion,
  closing,
  actions,
  onSay,
  onModal,
}: {
  hiveName: string;
  deletion: Deletion | null;
  closing: string | null;
  actions: Pick<SettingsActions, "requestHiveDeletion" | "cancelHiveDeletion">;
  onSay: (text: string) => void;
  /** Whether the delete dialog is open, so the screen can hold its tabs meanwhile. */
  onModal?: (open: boolean) => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // Whether the delete dialog is open.
  const [asking, setAsking] = useState(false);
  const matches = typed === hiveName;

  // Leaving the dialog (Keep the hive, Escape, the dim) puts the focus back on Delete hive….
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && !asking) opener.current?.focus();
    wasAsking.current = asking;
  }, [asking]);
  useEffect(() => {
    onModal?.(asking);
  }, [asking, onModal]);

  function ask() {
    if (running.current || asking) return;
    setTyped("");
    setProblem(null);
    setAsking(true);
  }

  function keep() {
    if (running.current) return;
    setAsking(false);
    setTyped("");
    setProblem(null);
  }

  function refuse(text: string) {
    running.current = false;
    setBusy(false);
    setProblem(text);
    onSay(text);
  }

  function begin() {
    running.current = true;
    setBusy(true);
    setProblem(null);
    onSay("");
  }

  async function remove() {
    if (running.current || !matches) return;
    begin();
    let answer: Awaited<ReturnType<typeof actions.requestHiveDeletion>>;
    try {
      answer = await actions.requestHiveDeletion(typed);
    } catch {
      answer = { ok: false, reason: "failed" };
    }
    // Stays busy while the page loads afresh.
    if (answer.ok) return window.location.reload();
    refuse(deleteFailure(answer.reason));
    field.current?.focus();
  }

  async function cancel() {
    if (running.current) return;
    begin();
    let ok = false;
    try {
      ok = (await actions.cancelHiveDeletion()).ok;
    } catch {
      ok = false;
    }
    if (ok) return window.location.reload();
    refuse(FAILED);
  }

  const off = busy || undefined;
  return (
    <section aria-labelledby="settings-delete" className={s.section}>
      {/* While the dialog is open, what is behind its dim takes no focus and no press. */}
      <div className={s.sectionHead} inert={asking || undefined}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-delete">{DELETE_TITLE}</span>
          </h2>
          {!closing && (
            <p className={s.note}>
              {deletion ? deletionCounts(deletion) : DELETE_UNCOUNTED}
            </p>
          )}
        </div>
      </div>
      <div className={s.danger} inert={asking || undefined}>
        {closing ? (
          <>
            <p className={s.dangerText}>
              {DELETED_ON} <DeletionDate iso={closing} />. {CLOSING_HELP}
            </p>
            <div className={s.formFoot} aria-busy={off}>
              <button
                type="button"
                className={s.secondary}
                aria-disabled={off}
                onClick={() => void cancel()}
              >
                {CANCEL_DELETION}
              </button>
              {problem && <p className={s.refused}>{problem}</p>}
            </div>
          </>
        ) : (
          <button
            ref={opener}
            type="button"
            data-open="delete-hive"
            className={s.secondary}
            onClick={ask}
          >
            {DELETE_HIVE_ITEM}
          </button>
        )}
      </div>
      {!closing && asking && (
        <PanelDialog label={DELETE_TITLE} busy={busy} onClose={keep}>
          <form
            aria-label={DELETE_TITLE}
            className={`${s.form} ${s.dialogForm}`}
            noValidate
            aria-busy={off}
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            <h3 className={s.dialogTitle}>{DELETE_TITLE}</h3>
            <p className={s.hint}>{DELETE_HELP}</p>
            <div className={s.field}>
              <label htmlFor={`${id}-name`} className={s.fieldLabel}>
                {DELETE_FIELD}
              </label>
              <input
                ref={field}
                id={`${id}-name`}
                name="hive-name"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className={s.input}
                value={typed}
                readOnly={busy}
                aria-describedby={`${id}-hint`}
                onChange={(e) => {
                  setTyped(e.currentTarget.value);
                  setProblem(null);
                }}
              />
            </div>
            <p id={`${id}-hint`} className={s.hint}>
              {deleteHint(hiveName)}
            </p>
            <div className={`${s.formFoot} ${s.dialogFoot}`}>
              {problem && <p className={s.refused}>{problem}</p>}
              <button
                type="button"
                className={s.secondary}
                aria-disabled={off}
                onClick={keep}
              >
                {KEEP_HIVE}
              </button>
              <button
                type="submit"
                className={s.confirm}
                aria-disabled={!matches || busy || undefined}
                aria-describedby={matches ? undefined : `${id}-hint`}
              >
                {DELETE_HIVE}
              </button>
            </div>
          </form>
        </PanelDialog>
      )}
    </section>
  );
}
