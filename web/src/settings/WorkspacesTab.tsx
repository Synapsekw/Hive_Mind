"use client";

// The Workspaces tab.
import { useEffect, useRef, useState } from "react";
import {
  DELETE_WORKSPACE,
  DELETE_WORKSPACE_ITEM,
  KEEP_WORKSPACE,
  ONLY_WORKSPACE,
  WORKSPACES_NOTE,
  WORKSPACES_TITLE,
  WORKSPACE_ASIDE,
  workspaceDeleted,
  workspaceFailure,
  workspaceNotes,
  workspaceQuestion,
} from "./text";
import { RowMenu } from "./RowMenu";
import type { SettingsActions, Workspace } from "./types";
import s from "./settings.module.css";

/**
 * The person's own workspaces, each with the number of its notes and Delete, asked once before
 * it happens. The only workspace a person has cannot go, and nothing can while the hive is
 * being deleted, so neither shows Delete. A deleted workspace leaves the list at once and the
 * page is read again, so the agents that went with it leave too. The database decides whether
 * the person may; this only asks.
 */
export function WorkspacesTab({
  workspaces,
  closing,
  deleteWorkspace,
  onSay,
  onDeleted,
}: {
  workspaces: Workspace[];
  closing: boolean;
  deleteWorkspace: SettingsActions["deleteWorkspace"];
  onSay: (text: string) => void;
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // The workspace whose delete was refused, with the sentence that says why.
  const [refused, setRefused] = useState<{ id: string; text: string } | null>(
    null,
  );
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  // Where the focus goes after the next render: a row's button, or the row itself.
  const target = useRef<{ id: string; pick?: string } | null>(null);
  const shown = workspaces.filter((w) => !gone.has(w.id));
  const only = shown.length === 1;

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const row = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
    ].find((el) => el.dataset.row === want.id);
    const to = want.pick
      ? (row?.querySelector<HTMLElement>(`[data-pick="${want.pick}"]`) ??
        // Once the question has closed, "delete" means the row's ⋯ button, which opens it.
        (want.pick === "delete"
          ? row?.querySelector<HTMLElement>("[data-menu]")
          : null) ??
        row)
      : row;
    (to ?? list.current)?.focus();
  });

  function ask(id: string) {
    if (running.current) return;
    target.current = { id, pick: "keep" };
    setRefused(null);
    setAsking(id);
  }

  function keep(id: string) {
    if (running.current) return;
    target.current = { id, pick: "delete" };
    setAsking(null);
  }

  async function remove(w: Workspace) {
    if (running.current) return;
    running.current = true;
    setBusy(w.id);
    setRefused(null);
    onSay("");
    let answer: Awaited<ReturnType<typeof deleteWorkspace>>;
    try {
      answer = await deleteWorkspace(w.id);
    } catch {
      answer = { ok: false, reason: "failed" };
    }
    running.current = false;
    setBusy(null);
    setAsking(null);
    if (answer.ok === true) {
      setGone((set) => new Set(set).add(w.id));
      onSay(workspaceDeleted(w.name));
      onDeleted();
      return;
    }
    const text = workspaceFailure(answer.reason);
    target.current = { id: w.id, pick: "delete" };
    setRefused({ id: w.id, text });
    onSay(text);
  }

  return (
    <section aria-labelledby="settings-workspaces" className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-workspaces">{WORKSPACES_TITLE}</span>
            <span className={s.count}>{workspaces.length}</span>
          </h2>
          <p className={s.note}>{WORKSPACES_NOTE}</p>
        </div>
      </div>
      <ul
        ref={list}
        role="list"
        tabIndex={-1}
        aria-label={WORKSPACES_TITLE}
        className={s.rows}
      >
        {shown.map((w) => {
          const notes = workspaceNotes(w);
          const isAsking = asking === w.id;
          const off = busy === w.id || undefined;
          return (
            <li
              key={w.id}
              data-row={w.id}
              tabIndex={-1}
              className={s.item}
              aria-busy={off}
              onKeyDown={(e) => {
                if (e.key === "Escape" && isAsking) keep(w.id);
              }}
            >
              <div className={s.text}>
                <p className={s.what}>
                  <span className={s.name}>{w.name}</span>
                </p>
                <p className={s.meta}>{notes && <span>{notes}</span>}</p>
              </div>
              {(only || !closing) && (
                <div className={s.side}>
                  {only ? (
                    <p className={s.onlyLine}>{ONLY_WORKSPACE}</p>
                  ) : isAsking ? (
                    <>
                      <div
                        role="group"
                        aria-label={`${DELETE_WORKSPACE} ${w.name}`}
                        className={s.actions}
                      >
                        <p className={s.ask}>{workspaceQuestion(w)}</p>
                        <button
                          type="button"
                          data-pick="delete"
                          className={s.confirm}
                          aria-disabled={off}
                          onClick={() => void remove(w)}
                        >
                          {DELETE_WORKSPACE}
                        </button>
                        <button
                          type="button"
                          data-pick="keep"
                          className={s.secondary}
                          aria-disabled={off}
                          onClick={() => keep(w.id)}
                        >
                          {KEEP_WORKSPACE}
                        </button>
                      </div>
                      <p className={s.aside}>{WORKSPACE_ASIDE}</p>
                    </>
                  ) : (
                    <RowMenu
                      label={`Actions for ${w.name}`}
                      items={[
                        {
                          key: "delete",
                          text: DELETE_WORKSPACE_ITEM,
                          danger: true,
                          onPick: () => ask(w.id),
                        },
                      ]}
                    />
                  )}
                  {refused?.id === w.id && (
                    <p className={s.refused}>{refused.text}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
