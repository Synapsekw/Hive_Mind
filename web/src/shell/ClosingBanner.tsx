"use client";

// The banner of a hive that is being deleted: one line above the rail and the page, on every
// screen, saying when the hive goes and that nothing new can be saved. For an owner it also
// offers Cancel deletion, which asks once in place (the way the vault's Delete does) and then
// reloads the page. It draws nothing for a hive that is not being deleted, and with nobody
// signed in. Whether the person may cancel is the database's decision; the role only decides
// whether the button is shown.
//
// It is part of the flow, so it covers nothing. The pages that are exactly one window tall take
// its height off their own through `--closing-banner`, which is measured here.
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./AccountContext";
import { useHiveActions, type HiveActions } from "./HiveActions";
import {
  CANCEL_DELETION,
  DELETED_ON,
  FAILED,
  KEEP_DELETING,
  NOTHING_SAVED,
  cancelQuestion,
  localDate,
  stableDate,
} from "./hiveText";
import s from "./shell.module.css";

/**
 * A confirming press sooner than this after the question opened is taken as the second press
 * of a double click, not as an answer.
 */
const CONFIRM_AFTER_MS = 500;
const HEIGHT = "--closing-banner";

/**
 * The day the hive goes. The server and the first draw in the browser write it the same way
 * (UTC, fixed words), so the two agree; after that it is the person's own locale and time zone.
 */
export function DeletionDate({ iso }: { iso: string }) {
  const [text, setText] = useState(() => stableDate(iso));
  useEffect(() => setText(localDate(iso) || stableDate(iso)), [iso]);
  return <time dateTime={iso}>{text}</time>;
}

export function ClosingBanner({ actions }: { actions?: HiveActions | null }) {
  const account = useAccount();
  const provided = useHiveActions();
  const cancel = (actions ?? provided)?.cancelHiveDeletion;
  const closing = account?.closing ?? null;

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(false);
  const askedAt = useRef(0);
  // Where the focus goes after the next render.
  const target = useRef<"keep" | "opener" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const keeper = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    (want === "keep" ? keeper : opener).current?.focus();
  });

  // The banner's height, for the pages that are one window tall. It changes when the line
  // wraps or the question opens.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const style = document.documentElement.style;
    const measure = () =>
      style.setProperty(HEIGHT, `${el.getBoundingClientRect().height}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => {
      watch.disconnect();
      style.removeProperty(HEIGHT);
    };
  }, [closing]);

  if (!account || !closing) return null;

  const ask = () => {
    askedAt.current = Date.now();
    target.current = "keep";
    setSaid(null);
    setAsking(true);
  };

  const keep = () => {
    if (running.current) return;
    target.current = "opener";
    setAsking(false);
  };

  const confirm = async () => {
    if (running.current || !cancel) return;
    const now = Date.now();
    if (now - askedAt.current < CONFIRM_AFTER_MS) {
      askedAt.current = now;
      return;
    }
    running.current = true;
    setBusy(true);
    let ok = false;
    try {
      ok = (await cancel(account.hiveId)).ok;
    } catch {
      ok = false;
    }
    // A full load, so every part of the page shows the hive as it now is. Stays busy until the
    // page is replaced.
    if (ok) return window.location.reload();
    running.current = false;
    target.current = "opener";
    setBusy(false);
    setAsking(false);
    setSaid(FAILED);
  };

  const question = cancelQuestion(account.hive);
  const off = busy || undefined;
  return (
    <div ref={root} data-scope="chrome" data-closing="" className={s.closing}>
      <p role="status" className={s.closingText}>
        {DELETED_ON} <DeletionDate iso={closing} />. {NOTHING_SAVED}
      </p>
      {account.role === "owner" &&
        cancel &&
        (asking ? (
          <div
            role="group"
            aria-label={question}
            aria-busy={off}
            className={s.closingAsk}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                keep();
              }
            }}
          >
            <p>{question}</p>
            <button
              type="button"
              className={s.formButton}
              aria-disabled={off}
              onClick={() => void confirm()}
            >
              {CANCEL_DELETION}
            </button>
            <button
              ref={keeper}
              type="button"
              className={s.formButton}
              aria-disabled={off}
              onClick={keep}
            >
              {KEEP_DELETING}
            </button>
          </div>
        ) : (
          <button
            ref={opener}
            type="button"
            className={s.formButton}
            onClick={ask}
          >
            {CANCEL_DELETION}
          </button>
        ))}
      {said && (
        <p role="alert" className={s.refused}>
          {said}
        </p>
      )}
    </div>
  );
}
