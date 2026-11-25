// A choice in the top bar (Rings only): a button that opens a small menu. "Group by" lists the
// five arrangements; beside it, under Topic, "Kind" lists the kinds of topic. Choosing is client
// state, no request.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useDismiss } from "./useDismiss";
import s from "./map.module.css";

export function GroupMenu<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** What is chosen here: the button's first words and the menu's name. */
  label: string;
  /** Each choice: its value, its name, and optionally a count shown after the name. */
  options: readonly (readonly [T, string, number?])[];
  value: T;
  onChange: (v: T) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find(([a]) => a === value)?.[1] ?? "";

  useDismiss({
    open,
    root,
    button,
    onClose: (refocus) => {
      setOpen(false);
      if (refocus) button.current?.focus();
    },
  });

  const rows = (el: HTMLElement) => [
    ...el.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  ];

  // Opening moves focus to the checked row.
  const show = () => {
    setOpen(true);
    requestAnimationFrame(() => {
      const el = root.current;
      if (!el) return;
      const list = rows(el);
      (
        list.find((r) => r.getAttribute("aria-checked") === "true") ?? list[0]
      )?.focus();
    });
  };

  const choose = (a: T) => {
    setOpen(false);
    button.current?.focus();
    if (a !== value) onChange(a);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = rows(e.currentTarget);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let to: number | null = null;
    if (e.key === "ArrowDown")
      to = at < 0 ? 0 : Math.min(at + 1, list.length - 1);
    else if (e.key === "ArrowUp")
      to = at < 0 ? list.length - 1 : Math.max(at - 1, 0);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = list.length - 1;
    if (to === null || !list[to]) return;
    e.preventDefault();
    list[to]!.focus();
  };

  return (
    <div ref={root} className={s.groupMenu}>
      <button
        ref={button}
        type="button"
        className={s.groupButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className={s.groupLabel}>{label}</span>
        <span>{current}</span>
        <svg
          aria-hidden="true"
          className={s.groupChevron}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m2 3.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          data-popover=""
          className={s.groupPop}
          onKeyDown={onKey}
        >
          {options.map(([a, name, count]) => (
            <button
              key={a}
              type="button"
              role="menuitemradio"
              aria-checked={value === a}
              className={s.groupRow}
              onClick={() => choose(a)}
            >
              <span aria-hidden="true" className={s.groupTick}>
                {value === a && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m2 5.2 2 2 4-4.4" />
                  </svg>
                )}
              </span>
              {name}
              {count !== undefined && (
                <span className={s.groupCount}>{count}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
