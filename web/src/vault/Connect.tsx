"use client";

// The panel behind "Connect wiki links": one sentence and a Start button, the progress, then the
// counts. Each step is one request; the server reads the person's own notes and the database
// decides what may be linked. Nothing here reads a note or sets sharing.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { ImportActions } from "../import/types";
import { runConnect, type ConnectEnd, type ConnectTally } from "./connectRun";
import * as c from "./connectText";
import * as t from "./importText";
import s from "./vault.module.css";

type Stage =
  | { kind: "ready" }
  // `total` is null until a step has answered.
  | { kind: "running"; done: number; total: number | null; stopping: boolean }
  | { kind: "done"; tally: ConnectTally; end: ConnectEnd };

export function Connect({
  workspace,
  connect,
  onClose,
  onBusy,
}: {
  /** The person's own workspace whose notes are connected. */
  workspace: { id: string; name: string };
  connect: ImportActions["connect"];
  onClose: () => void;
  /** Told when a run starts and when it ends: the panel cannot be closed in between. */
  onBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [stage, setStage] = useState<Stage>({ kind: "ready" });
  const heading = useRef<HTMLHeadingElement>(null);
  const stop = useRef(false);
  const alive = useRef(true);
  // Set at once, before the stage is drawn again: a second press starts nothing.
  const busy = useRef(false);

  const running = stage.kind === "running";

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

  // Leaving while links are still being made asks first.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function start() {
    if (busy.current) return;
    busy.current = true;
    stop.current = false;
    onBusy(true);
    setStage({ kind: "running", done: 0, total: null, stopping: false });
    const { tally, end } = await runConnect(connect, workspace.id, {
      progress: (done, total) =>
        setStage({ kind: "running", done, total, stopping: stop.current }),
      stop: () => stop.current || !alive.current,
    });
    busy.current = false;
    onBusy(false);
    setStage({ kind: "done", tally, end });
    // Links were made on the server: read the page again, once.
    router.refresh();
  }

  let title = c.CONNECT;
  if (stage.kind === "running") title = c.CONNECTING;
  if (stage.kind === "done")
    title = stage.end === "finished" ? c.CONNECTED : c.CONNECT_STOPPED;

  return (
    <section
      id="vault-connect"
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
          aria-label={`${t.CLOSE}: ${c.CONNECT}`}
          aria-disabled={running || undefined}
          onClick={() => {
            if (!running) onClose();
          }}
        >
          {t.CLOSE}
        </button>
      </div>

      <p className={s.path}>{workspace.name}</p>

      {stage.kind === "ready" && (
        <>
          <p className={s.sentence}>{c.CONNECT_INTRO}</p>
          <div className={s.actions}>
            <button
              type="button"
              className={s.primary}
              onClick={() => void start()}
            >
              {c.START}
            </button>
          </div>
        </>
      )}

      {stage.kind === "running" && (
        <>
          {/* Without a total yet, the bar says only that something is under way. */}
          <progress
            className={s.importProgress}
            aria-label={c.CONNECTING}
            value={stage.total === null ? undefined : stage.done}
            max={Math.max(1, stage.total ?? 1)}
          />
          <p role="status" className={s.sentence}>
            {stage.total === null
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

      {stage.kind === "done" && (
        <>
          {stage.end === "halted" && (
            <p role="alert" className={s.refused}>
              {c.CONNECT_HALTED}
            </p>
          )}
          <p className={s.facts}>
            {c.connectCounts(stage.tally).map((n) => (
              <span key={n.label}>
                {n.label} <strong>{n.value}</strong>
              </span>
            ))}
          </p>
          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={onClose}>
              {t.CLOSE}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
