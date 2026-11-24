"use client";

// The import panel: pick a folder, see what is in it, choose where it goes, then send the notes
// a batch at a time. Files are read and parsed in the browser, only for the batch on its way;
// each note travels with the date it was written and the date its file last changed.
// The server writes as the person and the database decides; nothing here sets sharing.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { noteDates } from "../import/dates";
import { parseNote } from "../import/parse";
import {
  BATCH_BYTES,
  BATCH_NOTES,
  batches,
  planImport,
  type ImportNote,
  type Plan,
} from "../import/plan";
import type { BatchResult, ImportActions } from "../import/types";
import {
  addBatch,
  asPicked,
  emptyTally,
  handled,
  inFolder,
  nextChunk,
  type Tally,
} from "./importFiles";
import { runConnect, type ConnectEnd, type ConnectTally } from "./connectRun";
import * as c from "./connectText";
import * as t from "./importText";
import s from "./vault.module.css";

/** Batches refused one after another before the import gives up. */
const GIVE_UP_AFTER = 3;

type Picked = { name: string; plan: Plan; files: Map<string, File> };
type Stage =
  | { kind: "pick"; problem: string | null }
  | { kind: "ready"; refused: string | null }
  | { kind: "running"; done: number; total: number; stopping: boolean }
  // The workspace's wiki links, after the last batch. `total` is null until a step has answered.
  | {
      kind: "connecting";
      done: number;
      total: number | null;
      stopping: boolean;
    }
  | {
      kind: "done";
      tally: Tally;
      warned: number;
      unsent: number;
      end: "finished" | "stopped" | "halted";
      workspace: { id: string; name: string };
      /** How connecting the wiki links went; null when the import did not get that far. */
      links: { tally: ConnectTally; end: ConnectEnd } | null;
    };

const REFUSALS = {
  name: t.NAME_PROBLEM,
  taken: t.NAME_TAKEN,
  limit: t.WORKSPACE_LIMIT,
  failed: t.WORKSPACE_FAILED,
} as const;

function Paths({ title, paths }: { title: string; paths: readonly string[] }) {
  const id = useId();
  if (paths.length === 0) return null;
  const { shown, more } = t.shownPaths(paths);
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={s.groupName}>
        {title}
      </h3>
      <ul className={s.importPaths}>
        {shown.map((p) => (
          <li key={p} className={s.path}>
            {p}
          </li>
        ))}
        {more > 0 && <li className={s.cut}>{t.andMore(more)}</li>}
      </ul>
    </section>
  );
}

export function Import({
  workspaces,
  current,
  actions,
  hrefWorkspace,
  onClose,
  onBusy,
}: {
  /** The person's workspaces in this hive. */
  workspaces: { id: string; name: string }[];
  /** The open workspace, offered first; null on "Shared with me". */
  current: string | null;
  actions: ImportActions;
  hrefWorkspace: (id: string) => string;
  onClose: () => void;
  /** Told when an import starts and when it ends: the panel cannot be closed in between. */
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [stage, setStage] = useState<Stage>({ kind: "pick", problem: null });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [dest, setDest] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(
    () =>
      workspaces.find((w) => w.id === current)?.id ?? workspaces[0]?.id ?? "",
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stop = useRef(false);
  const alive = useRef(true);
  // A workspace made here, kept so pressing Import again does not ask for it twice.
  const made = useRef<{ id: string; name: string } | null>(null);

  const running = stage.kind === "running" || stage.kind === "connecting";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Each step replaces the controls of the one before: the focus goes to the step's heading.
  useEffect(() => {
    heading.current?.focus();
  }, [stage.kind]);

  // Leaving while notes are still being sent asks first.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function choose(list: FileList | null) {
    // Copied first: the list is live, and emptying the input (so the same folder can be picked
    // again) empties it too.
    const chosen = [...(list ?? [])];
    if (input.current) input.current.value = "";
    if (chosen.length === 0) return;
    const folder = inFolder(
      chosen.map((file) => ({
        file,
        size: file.size,
        relativePath: file.webkitRelativePath ?? "",
      })),
    );
    if (!folder.supported) {
      setPicked(null);
      setStage({ kind: "pick", problem: t.UNSUPPORTED });
      return;
    }
    made.current = null;
    setPicked({
      name: folder.name,
      plan: planImport(asPicked(folder.files)),
      files: new Map(folder.files.map((f) => [f.path, f.file.file])),
    });
    setName(folder.name);
    setStage({ kind: "ready", refused: null });
  }

  async function start() {
    if (!picked || running) return;
    let workspace: { id: string; name: string } | null = null;
    if (dest === "existing") {
      workspace = workspaces.find((w) => w.id === existing) ?? null;
      if (!workspace) return;
    } else {
      const wanted = t.workspaceName(name);
      if (!wanted) {
        setStage({ kind: "ready", refused: t.NAME_PROBLEM });
        return;
      }
      workspace = made.current?.name === wanted ? made.current : null;
    }
    const paths = picked.plan.notes;
    // One "now" for the whole import: a date after it is not a note's date.
    const startedAt = Date.now();
    stop.current = false;
    onBusy(true);
    setStage({
      kind: "running",
      done: 0,
      total: paths.length,
      stopping: false,
    });

    if (!workspace) {
      const wanted = t.workspaceName(name)!;
      let answer: Awaited<ReturnType<ImportActions["createWorkspace"]>>;
      try {
        answer = await actions.createWorkspace(wanted);
      } catch {
        answer = { ok: false, reason: "failed" };
      }
      if (!answer.ok) {
        onBusy(false);
        setStage({ kind: "ready", refused: REFUSALS[answer.reason] });
        return;
      }
      workspace = made.current = { id: answer.id, name: wanted };
    }

    let tally = emptyTally();
    let warned = 0;
    let streak = 0;
    let end: "finished" | "stopped" | "halted" = "finished";
    let at = 0;
    sending: while (at < paths.length) {
      // Read and parse only the files about to be sent.
      const chunk = nextChunk(
        paths,
        at,
        (p) => picked.files.get(p)?.size ?? 0,
        BATCH_NOTES,
        BATCH_BYTES,
      );
      at += chunk.length;
      const notes: ImportNote[] = [];
      const unread: string[] = [];
      for (const path of chunk) {
        try {
          const file = picked.files.get(path)!;
          const parsed = parseNote(await file.text(), path);
          if (parsed.warning) warned += 1;
          const dates = noteDates(
            parsed.frontmatter,
            path,
            file.lastModified,
            startedAt,
          );
          notes.push({
            path,
            title: parsed.title,
            body: parsed.body,
            frontmatter: parsed.frontmatter,
            ...(dates.written_at ? { written_at: dates.written_at } : {}),
            ...(dates.modified_at ? { modified_at: dates.modified_at } : {}),
          });
        } catch {
          unread.push(path);
        }
      }
      if (unread.length > 0) tally = addBatch(tally, unread, null);
      for (const batch of batches(notes)) {
        let result: BatchResult | null = null;
        try {
          result = await actions.importBatch(workspace.id, batch);
        } catch {
          result = null;
        }
        tally = addBatch(
          tally,
          batch.map((n) => n.path),
          result,
        );
        streak = result?.ok ? 0 : streak + 1;
        const done = handled(tally);
        if (streak >= GIVE_UP_AFTER && done < paths.length) {
          end = "halted";
          break sending;
        }
        if ((stop.current || !alive.current) && done < paths.length) {
          end = "stopped";
          break sending;
        }
        setStage({
          kind: "running",
          done,
          total: paths.length,
          stopping: stop.current,
        });
      }
    }

    // Every note was answered and the workspace holds some of them: connect its wiki links,
    // over the whole workspace, so links to notes that were already there are found too. Stop
    // pressed during the last batch means stop: the notes are all in, and nothing is connected.
    let links: { tally: ConnectTally; end: ConnectEnd } | null = null;
    if (
      end === "finished" &&
      !stop.current &&
      alive.current &&
      tally.created + tally.updated + tally.unchanged > 0
    ) {
      setStage({
        kind: "connecting",
        done: 0,
        total: null,
        stopping: stop.current,
      });
      links = await runConnect(actions.connect, workspace.id, {
        progress: (done, total) =>
          setStage({
            kind: "connecting",
            done,
            total,
            stopping: stop.current,
          }),
        stop: () => stop.current || !alive.current,
      });
    }

    onBusy(false);
    setStage({
      kind: "done",
      tally,
      warned,
      unsent: paths.length - handled(tally),
      end,
      workspace,
      links,
    });
    router.refresh();
  }

  const plan = picked?.plan ?? null;
  const importable = plan !== null && !plan.tooMany && plan.notes.length > 0;

  const picker = (label: string, className: string) => (
    <button
      type="button"
      className={className}
      onClick={() => input.current?.click()}
    >
      {label}
    </button>
  );

  let title = t.IMPORT;
  if (stage.kind === "ready") title = t.READY;
  if (stage.kind === "running") title = t.RUNNING;
  if (stage.kind === "connecting") title = c.CONNECTING;
  if (stage.kind === "done")
    title = stage.end === "finished" ? t.FINISHED : t.STOPPED;

  return (
    <section
      id="vault-import"
      aria-labelledby={`${id}-title`}
      aria-busy={running || undefined}
      className={`${s.release} ${s.importPanel}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !running) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className={s.listTitleRow}>
        <h2
          ref={heading}
          id={`${id}-title`}
          tabIndex={-1}
          className={s.listTitle}
        >
          {title}
        </h2>
        <button
          type="button"
          className={s.quiet}
          aria-label={`${t.CLOSE}: ${t.IMPORT}`}
          aria-disabled={running || undefined}
          onClick={() => {
            if (!running) onClose();
          }}
        >
          {t.CLOSE}
        </button>
      </div>

      {/* The folder picker itself: never shown, opened by the buttons below. */}
      <input
        ref={input}
        type="file"
        multiple
        tabIndex={-1}
        aria-label={t.FOLDER_INPUT}
        className={s.srOnly}
        onChange={(e) => choose(e.currentTarget.files)}
        {...{ webkitdirectory: "" }}
      />

      {stage.kind === "pick" && (
        <>
          <p className={s.sentence}>{t.INTRO}</p>
          {stage.problem && (
            <p role="alert" className={s.refused}>
              {stage.problem}
            </p>
          )}
          <div className={s.actions}>{picker(t.CHOOSE, s.primary)}</div>
        </>
      )}

      {stage.kind === "ready" && picked && plan && (
        <>
          <p className={s.path}>{picked.name}</p>
          <ul
            className={`${s.facts} ${s.importPaths}`}
            aria-label={picked.name}
          >
            <li>{t.found(plan.notes.length)}</li>
            {plan.tooLarge.length > 0 && (
              <li>{t.tooLargeSkipped(plan.tooLarge.length)}</li>
            )}
            {plan.skippedOther > 0 && (
              <li>{t.otherSkipped(plan.skippedOther)}</li>
            )}
            {plan.hidden > 0 && <li>{t.hiddenSkipped(plan.hidden)}</li>}
          </ul>
          {plan.tooMany && (
            <p role="alert" className={s.refused}>
              {t.TOO_MANY}
            </p>
          )}
          {!plan.tooMany && plan.notes.length === 0 && (
            <p role="alert" className={s.refused}>
              {t.NO_NOTES}
            </p>
          )}
          {importable && (
            <>
              <div
                role="radiogroup"
                aria-label={t.DESTINATION}
                className={s.options}
              >
                <label className={s.option}>
                  <input
                    type="radio"
                    name={`${id}-dest`}
                    className={s.hiddenInput}
                    checked={dest === "new"}
                    onChange={() => {
                      setDest("new");
                      setStage({ kind: "ready", refused: null });
                    }}
                  />
                  {t.NEW_WORKSPACE}
                </label>
                {workspaces.length > 0 && (
                  <label className={s.option}>
                    <input
                      type="radio"
                      name={`${id}-dest`}
                      className={s.hiddenInput}
                      checked={dest === "existing"}
                      onChange={() => {
                        setDest("existing");
                        setStage({ kind: "ready", refused: null });
                      }}
                    />
                    {t.EXISTING_WORKSPACE}
                  </label>
                )}
              </div>
              {dest === "new" ? (
                <div className={s.importField}>
                  <label htmlFor={`${id}-name`}>{t.WORKSPACE_NAME}</label>
                  <input
                    id={`${id}-name`}
                    type="text"
                    className={s.search}
                    value={name}
                    autoComplete="off"
                    aria-invalid={stage.refused ? true : undefined}
                    aria-describedby={
                      stage.refused ? `${id}-refused` : undefined
                    }
                    onChange={(e) => {
                      setName(e.currentTarget.value);
                      if (stage.refused)
                        setStage({ kind: "ready", refused: null });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void start();
                    }}
                  />
                </div>
              ) : (
                <div className={s.importField}>
                  <label htmlFor={`${id}-existing`}>{t.WORKSPACE}</label>
                  <select
                    id={`${id}-existing`}
                    className={s.search}
                    value={existing}
                    onChange={(e) => setExisting(e.currentTarget.value)}
                  >
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {stage.refused && (
                <p id={`${id}-refused`} role="alert" className={s.refused}>
                  {stage.refused}
                </p>
              )}
            </>
          )}
          <Paths title={t.SKIPPED_PATHS} paths={plan.tooLarge} />
          <div className={s.actions}>
            {importable && (
              <button
                type="button"
                className={s.primary}
                onClick={() => void start()}
              >
                {t.START}
              </button>
            )}
            {picker(t.CHOOSE_ANOTHER, s.secondary)}
          </div>
        </>
      )}

      {(stage.kind === "running" || stage.kind === "connecting") && (
        <>
          {/* Without a total yet, the bar says only that something is under way. */}
          <progress
            className={s.importProgress}
            aria-label={title}
            value={stage.total === null ? undefined : stage.done}
            max={Math.max(1, stage.total ?? 1)}
          />
          <p role="status" className={s.sentence}>
            {stage.kind === "running"
              ? t.progress(stage.done, stage.total)
              : stage.total === null
                ? ""
                : c.connectProgress(stage.done, stage.total)}
          </p>
          <p className={s.sentence} data-quiet>
            {stage.stopping ? `${t.STOPPING}. ${t.KEEPS}` : t.KEEPS}
          </p>
          <div className={s.actions}>
            <button
              type="button"
              className={s.secondary}
              aria-disabled={stage.stopping || undefined}
              onClick={() => {
                if (stage.stopping) return;
                stop.current = true;
                setStage({ ...stage, stopping: true });
              }}
            >
              {stage.stopping ? t.STOPPING : t.STOP}
            </button>
          </div>
        </>
      )}

      {stage.kind === "done" && plan && (
        <>
          {stage.end === "halted" && (
            <p role="alert" className={s.refused}>
              {t.HALTED}
            </p>
          )}
          <p className={s.facts}>
            {t
              .resultCounts({
                created: stage.tally.created,
                updated: stage.tally.updated,
                unchanged: stage.tally.unchanged,
                skipped: plan.tooLarge.length,
                failed: stage.tally.failed.length,
              })
              .map((n) => (
                <span key={n.label}>
                  {n.label} <strong>{n.value}</strong>
                </span>
              ))}
          </p>
          {stage.links && (
            <p className={s.facts}>
              {c.connectCounts(stage.links.tally).map((n) => (
                <span key={n.label}>
                  {n.label} <strong>{n.value}</strong>
                </span>
              ))}
            </p>
          )}
          {stage.links && stage.links.end !== "finished" && (
            <p className={s.sentence}>{c.AFTER_IMPORT_UNFINISHED}</p>
          )}
          {stage.unsent > 0 && (
            <p className={s.sentence}>
              {t.notSent(stage.unsent)} {t.AGAIN}
            </p>
          )}
          {stage.warned > 0 && (
            <p className={s.sentence}>{t.unreadFrontmatter(stage.warned)}</p>
          )}
          {/* Before the lists, which can be long: what to do next stays in reach. */}
          <div className={s.actions}>
            <Link
              href={hrefWorkspace(stage.workspace.id)}
              prefetch={false}
              className={`${s.primary} ${s.importLink}`}
              onClick={onClose}
            >
              {t.openWorkspace(stage.workspace.name)}
            </Link>
            {picker(t.CHOOSE_ANOTHER, s.secondary)}
          </div>
          <Paths title={t.FAILED_PATHS} paths={stage.tally.failed} />
          <Paths title={t.SKIPPED_PATHS} paths={plan.tooLarge} />
        </>
      )}
    </section>
  );
}
