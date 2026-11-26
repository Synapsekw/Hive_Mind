"use client";

// The Sync tab: one row per workspace with the state of its sync key, a ⋯ menu to make or revoke
// it, then the recent runs and the files the latest finished run left out as too big. What a press does
// lives in `Settings`, which also holds the new key until Done and draws it in `TokenDialog`;
// this file never sees a key. Making a key while one is live asks first, because it ends the
// live one. Everything shown comes from `SettingsData`: opening the tab asks the server for
// nothing.
import { useEffect, useRef, useState } from "react";
import { RowMenu } from "./RowMenu";
import { newestFinished } from "./runs";
import {
  FAILED,
  SYNC_INTRO,
  SYNC_KEEP,
  SYNC_KEYS_LIST,
  SYNC_LAST_USED,
  SYNC_MAKE,
  SYNC_MAKE_CONFIRM,
  SYNC_NEVER,
  SYNC_NEW_KEY_REVOKES,
  SYNC_NONE,
  SYNC_NO_RUNS,
  SYNC_REVOKE,
  SYNC_REVOKE_ASIDE,
  SYNC_REVOKE_CONFIRM,
  SYNC_RUNS,
  SYNC_TITLE,
  SYNC_TOO_BIG,
  runLength,
  runSummary,
  runWhen,
  syncActionsLabel,
  syncAskLabel,
  syncRevokeQuestion,
} from "./text";
import type { SyncKey, SyncRun, Workspace } from "./types";
import s from "./settings.module.css";

/** A confirming press sooner than this after the question opened is taken as a double click. */
const CONFIRM_AFTER_MS = 500;

/** What is being asked: make a new key over a live one, or revoke the live one. */
type Asking = { kind: "make" | "revoke"; workspaceId: string };

export function SyncTab({
  workspaces,
  keys,
  runs,
  busy,
  failed,
  onMake,
  onRevoke,
}: {
  workspaces: Workspace[];
  /** Newest first. */
  keys: SyncKey[];
  /** Newest first. */
  runs: SyncRun[];
  /** The workspace id a key is being made for, or the id of the key being revoked. */
  busy: string | null;
  /** Workspace ids and key ids whose last press was refused. */
  failed: ReadonlySet<string>;
  onMake: (workspaceId: string) => void;
  onRevoke: (key: SyncKey) => void;
}) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const askedAt = useRef(0);
  const list = useRef<HTMLUListElement>(null);
  // Where the focus goes after the next render: a row's button.
  const target = useRef<{ id: string; pick: "keep" | "menu" } | null>(null);
  const live = keys.filter((k) => k.status === "active");
  // The too-big list is a finished run's: a run still going has not listed its files yet.
  const latest = newestFinished(runs);
  const active = live.length;
  // The workspace a run was for, by its key (a key outlives its revoking, so it is still here).
  const nameOf = (r: SyncRun) =>
    workspaces.find(
      (w) => w.id === keys.find((k) => k.id === r.keyId)?.workspaceId,
    )?.name ?? null;

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const row = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
    ].find((el) => el.dataset.row === want.id);
    const to =
      want.pick === "keep"
        ? row?.querySelector<HTMLElement>('[data-pick="keep"]')
        : row?.querySelector<HTMLElement>("[data-menu]");
    (to ?? row ?? list.current)?.focus();
  });

  function ask(kind: Asking["kind"], workspaceId: string) {
    askedAt.current = Date.now();
    target.current = { id: workspaceId, pick: "keep" };
    setAsking({ kind, workspaceId });
  }

  function keep(workspaceId: string) {
    target.current = { id: workspaceId, pick: "menu" };
    setAsking(null);
  }

  function confirm(run: () => void) {
    // The second press of a double click lands where the question has just put this button.
    if (Date.now() - askedAt.current < CONFIRM_AFTER_MS) return;
    setAsking(null);
    run();
  }

  return (
    <section aria-labelledby="settings-sync" className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-sync">{SYNC_TITLE}</span>
            <span className={s.count}>{active}</span>
          </h2>
          <p className={s.note}>{SYNC_INTRO}</p>
        </div>
      </div>
      <ul
        ref={list}
        role="list"
        tabIndex={-1}
        aria-label={SYNC_KEYS_LIST}
        className={s.rows}
      >
        {workspaces.map((w) => {
          const key = live.find((k) => k.workspaceId === w.id) ?? null;
          const isAsking = asking?.workspaceId === w.id ? asking : null;
          const off = busy === w.id || (key !== null && busy === key.id);
          const refused = failed.has(w.id) || (key && failed.has(key.id));
          return (
            <li
              key={w.id}
              data-row={w.id}
              tabIndex={-1}
              className={s.item}
              aria-busy={off || undefined}
              onKeyDown={(e) => {
                if (e.key === "Escape" && isAsking) keep(w.id);
              }}
            >
              <div className={s.text}>
                <p className={s.what}>
                  <span className={s.name}>{w.name}</span>
                  {key === null && <span className={s.mark}>{SYNC_NONE}</span>}
                </p>
                {key !== null && (
                  <p className={s.meta}>
                    <span>
                      {key.lastUsedAt
                        ? `${SYNC_LAST_USED} ${runWhen(key.lastUsedAt)}`
                        : SYNC_NEVER}
                    </span>
                  </p>
                )}
              </div>
              <div className={s.side}>
                {isAsking ? (
                  <>
                    <div
                      role="group"
                      aria-label={syncAskLabel(isAsking.kind, w.name)}
                      className={s.actions}
                    >
                      <p className={s.ask}>
                        {isAsking.kind === "make"
                          ? SYNC_NEW_KEY_REVOKES
                          : syncRevokeQuestion(w.name)}
                      </p>
                      <button
                        type="button"
                        data-pick={isAsking.kind}
                        className={s.confirm}
                        aria-disabled={off || undefined}
                        onClick={() =>
                          confirm(() =>
                            isAsking.kind === "make"
                              ? onMake(w.id)
                              : key && onRevoke(key),
                          )
                        }
                      >
                        {isAsking.kind === "make"
                          ? SYNC_MAKE_CONFIRM
                          : SYNC_REVOKE_CONFIRM}
                      </button>
                      <button
                        type="button"
                        data-pick="keep"
                        className={s.secondary}
                        aria-disabled={off || undefined}
                        onClick={() => keep(w.id)}
                      >
                        {SYNC_KEEP}
                      </button>
                    </div>
                    {isAsking.kind === "revoke" && (
                      <p className={s.aside}>{SYNC_REVOKE_ASIDE}</p>
                    )}
                  </>
                ) : (
                  <RowMenu
                    label={syncActionsLabel(w.name)}
                    disabled={off}
                    items={
                      key === null
                        ? [
                            {
                              key: "make",
                              text: SYNC_MAKE,
                              onPick: () => onMake(w.id),
                            },
                          ]
                        : [
                            {
                              key: "make",
                              text: SYNC_MAKE,
                              onPick: () => ask("make", w.id),
                            },
                            {
                              key: "revoke",
                              text: SYNC_REVOKE,
                              danger: true,
                              onPick: () => ask("revoke", w.id),
                            },
                          ]
                    }
                  />
                )}
                {refused && <p className={s.refused}>{FAILED}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className={s.syncBlock}>
        <h3 className={s.label}>{SYNC_RUNS}</h3>
        {runs.length === 0 ? (
          <p className={s.note}>{SYNC_NO_RUNS}</p>
        ) : (
          <ul role="list" aria-label={SYNC_RUNS} className={s.rows}>
            {runs.map((r) => {
              const took = runLength(r.startedAt, r.finishedAt);
              return (
                <li key={r.id} className={s.item}>
                  <div className={s.text}>
                    <p className={s.what}>
                      <span className={s.name}>{runWhen(r.startedAt)}</span>
                      {took && <span className={s.mark}>{took}</span>}
                      {nameOf(r) && <span className={s.mark}>{nameOf(r)}</span>}
                    </p>
                    <p className={s.meta}>{runSummary(r)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {latest !== null && latest.tooBigPaths.length > 0 && (
        <div className={s.syncBlock}>
          <h3 className={s.label}>
            {SYNC_TOO_BIG}
            {nameOf(latest) && (
              <span className={s.count}>{nameOf(latest)}</span>
            )}
          </h3>
          <ul role="list" aria-label={SYNC_TOO_BIG} className={s.paths}>
            {latest.tooBigPaths.map((p) => (
              <li key={p} className={s.path}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
