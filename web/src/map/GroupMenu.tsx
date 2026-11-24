// "Group by" in the top bar (Rings only): a button that opens a small menu of the three
// arrangements. Choosing one is client state, no request.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ARRANGES, type Arrange } from "./arrange";
import { useDismiss } from "./useDismiss";
import s from "./map.module.css";

export function GroupMenu({
  arrange,
  onArrange,
}: {
  arrange: Arrange;
  onArrange: (a: Arrange) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = ARRANGES.find(([a]) => a === arrange)?.[1] ?? "";

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

  const choose = (a: Arrange) => {
    setOpen(false);
    button.current?.focus();
    if (a !== arrange) onArrange(a);
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
        <span className={s.groupLabel}>Group by</span>
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
          aria-label="Group by"
          data-popover=""
          className={s.groupPop}
          onKeyDown={onKey}
        >
          {ARRANGES.map(([a, name]) => (
            <button
              key={a}
              type="button"
              role="menuitemradio"
              aria-checked={arrange === a}
              className={s.groupRow}
              onClick={() => choose(a)}
            >
              <span aria-hidden="true" className={s.groupTick}>
                {arrange === a && (
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
