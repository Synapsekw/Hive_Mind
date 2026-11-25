"use client";

// The hive's name at the top of the rail, as a button, and the disclosure popover it opens
// downwards: the person's hives (name, their role there, a tick on the one on show), then New
// hive, which opens a small form in place. It follows the account menu: plain Tab order;
// Escape, an outside press and focus leaving all close it. With nobody signed in (dev pages,
// the no-hive notice) the rail shows its plain name instead. On a folded rail the button lies
// over the mark, and pressing it unfolds the rail first, then opens the list.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useAccount } from "./AccountContext";
import { foldWide, useFold } from "./FoldProvider";
import type { HiveActions } from "./HiveActions";
import {
  BRAND,
  CANCEL,
  CREATE,
  FAILED,
  HIVES,
  HIVE_NAME,
  NEW_HIVE,
  YOUR_NAME,
  checkNew,
  createFailure,
  hiveButtonLabel,
  hiveList,
  hiveMeta,
  trimName,
  type Created,
  type HiveEntry,
} from "./hiveText";
import s from "./shell.module.css";

const GLYPH = {
  "aria-hidden": true,
  width: 12,
  height: 12,
  viewBox: "0 0 12 12",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * The New hive form: the hive's name and the person's name in it. A wrong length is refused
 * here before any request; any other refusal is the action's. Once a hive is made the browser
 * loads the home page afresh, so every part of it shows the new hive.
 */
export function NewHiveForm({
  createHive,
  displayName,
  onCancel,
  onBusy,
}: {
  createHive: HiveActions["createHive"];
  /** The person's name where they are now; they may change it for the new hive. */
  displayName: string;
  onCancel: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [yours, setYours] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);

  const run = (on: boolean) => {
    setBusy(on);
    onBusy?.(on);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const wrong = checkNew(name, yours);
    if (wrong) return setSaid(createFailure(wrong));
    setSaid(null);
    run(true);
    let made: Created;
    try {
      made = await createHive(trimName(name), trimName(yours));
    } catch {
      made = { ok: false, reason: "failed" };
    }
    // Stays busy while the home page loads.
    if (made.ok) return window.location.assign("/");
    run(false);
    setSaid(createFailure(made.reason));
  };

  return (
    <form
      aria-label={NEW_HIVE}
      aria-busy={busy || undefined}
      className={s.popover}
      onSubmit={submit}
      noValidate
    >
      <label className={s.field}>
        <span className={s.fieldLabel}>{HIVE_NAME}</span>
        <input
          ref={first}
          type="text"
          name="hive-name"
          autoComplete="off"
          className={s.hiveInput}
          value={name}
          readOnly={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>{YOUR_NAME}</span>
        <input
          type="text"
          name="display-name"
          autoComplete="off"
          className={s.hiveInput}
          value={yours}
          readOnly={busy}
          onChange={(e) => setYours(e.target.value)}
        />
      </label>
      {said && (
        <p role="alert" className={s.refused}>
          {said}
        </p>
      )}
      <div className={s.formRow}>
        <button
          type="submit"
          data-primary=""
          className={s.formButton}
          aria-disabled={busy || undefined}
        >
          {CREATE}
        </button>
        <button
          type="button"
          className={s.formButton}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onCancel();
          }}
        >
          {CANCEL}
        </button>
      </div>
    </form>
  );
}

export function HiveSwitcher({ actions }: { actions?: HiveActions | null }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // True while an action runs: the popover then stays, so its answer is seen.
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const newHive = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { fold, openRail } = useFold();
  const folded = fold.rail === "shut";

  const close = (refocus: boolean) => {
    if (busy.current) return;
    setOpen(false);
    setForm(false);
    setSaid(null);
    if (refocus) button.current?.focus();
  };

  // An outside press closes the popover; focus stays wherever the press put it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  // Folding the rail closes the list: it hangs from the rail and would be a sliver.
  useEffect(() => {
    if (folded) close(false);
  }, [folded]);

  if (!account) return <span className={s.brandName}>{BRAND}</span>;

  const hives = hiveList(account);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  };

  // Focus moving to something outside the button and the popover closes it. A null target (a
  // press on a non-focusable spot inside) is left to the outside-press handler.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.current?.contains(to)) close(false);
  };

  const choose = async (hive: HiveEntry) => {
    if (busy.current) return;
    if (hive.current) return close(true);
    if (!actions) return;
    busy.current = true;
    setSwitching(true);
    setSaid(null);
    let ok = false;
    try {
      ok = (await actions.switchHive(hive.id)).ok;
    } catch {
      ok = false;
    }
    // A full load, so the rail and the page both show the hive now chosen. Stays busy until
    // the page is replaced.
    if (ok) return window.location.reload();
    busy.current = false;
    setSwitching(false);
    setSaid(FAILED);
  };

  return (
    <div ref={root} className={s.hive} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className={`${s.hiveButton} ${s.control}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-popover` : undefined}
        aria-label={hiveButtonLabel(account.hive)}
        title={folded ? account.hive : undefined}
        onClick={() => {
          // Narrow windows never fold, whatever the cookie says.
          if (folded && foldWide()) {
            openRail();
            setOpen(true);
          } else if (open) close(false);
          else setOpen(true);
        }}
      >
        <span aria-hidden="true" className={s.brandName}>
          {account.hive}
        </span>
        <svg {...GLYPH} className={s.chevron}>
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-popover`}
          role="group"
          aria-label={HIVES}
          aria-busy={switching || undefined}
          data-popover=""
          className={`${s.menu} ${s.menuDown}`}
        >
          {hives.map((hive) => (
            <button
              key={hive.id}
              type="button"
              className={`${s.menuItem} ${s.hiveItem}`}
              aria-current={hive.current ? "true" : undefined}
              aria-disabled={
                switching || (!actions && !hive.current) || undefined
              }
              onClick={() => choose(hive)}
            >
              <span className={s.accountText}>
                <span className={s.accountName}>{hive.name}</span>
                <span className={s.accountMeta}>{hiveMeta(hive)}</span>
              </span>
              <span aria-hidden="true" className={s.tick}>
                {hive.current && (
                  <svg {...GLYPH}>
                    <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
                  </svg>
                )}
              </span>
            </button>
          ))}
          {said && (
            <p role="alert" className={s.refused}>
              {said}
            </p>
          )}
          {actions && !form && (
            <button
              ref={newHive}
              type="button"
              className={s.menuItem}
              aria-disabled={switching || undefined}
              onClick={() => {
                if (busy.current) return;
                setSaid(null);
                setForm(true);
              }}
            >
              <span className={s.menuLabel}>{NEW_HIVE}</span>
              <span aria-hidden="true" className={s.tick}>
                <svg {...GLYPH}>
                  <path d="M6 2.5v7M2.5 6h7" />
                </svg>
              </span>
            </button>
          )}
          {actions && form && (
            <NewHiveForm
              createHive={actions.createHive}
              displayName={account.name}
              onBusy={(on) => {
                busy.current = on;
              }}
              onCancel={() => {
                setForm(false);
                // The form's Cancel is gone with it: focus goes back to what opened it.
                requestAnimationFrame(() => newHive.current?.focus());
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
