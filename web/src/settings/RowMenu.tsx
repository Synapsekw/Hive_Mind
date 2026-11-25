"use client";

// A row's ⋯ menu on the settings screen, modelled on the Vault's note menu: the button, named
// for its row, and a popover of what can be done to that row. Choosing an item closes the menu
// and then does it; what it does (often only opening a question or a dialog) is the parent's.
// Client state only. It closes like every popover (useDismiss).
import { useId, useRef, useState } from "react";
import { useDismiss } from "../map/useDismiss";
import s from "./settings.module.css";

export type RowMenuItem = {
  key: string;
  text: string;
  /** Cannot be undone: drawn as such. */
  danger?: boolean;
  onPick: () => void;
};

export function RowMenu({
  label,
  items,
  disabled = false,
}: {
  /** The button's name, e.g. "Actions for Claude Code". */
  label: string;
  items: RowMenuItem[];
  /** The button stays in place and in the keyboard's path, and opens nothing. */
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const shown = open && !disabled;

  useDismiss({
    open: shown,
    root,
    button,
    onClose: (refocus) => {
      setOpen(false);
      if (refocus) button.current?.focus();
    },
  });

  function pick(item: RowMenuItem) {
    setOpen(false);
    button.current?.focus();
    item.onPick();
  }

  return (
    <div ref={root} className={s.rowMenu}>
      <button
        ref={button}
        type="button"
        data-menu=""
        className={s.moreButton}
        aria-label={label}
        aria-expanded={shown}
        aria-controls={shown ? `${id}-menu` : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
      >
        ⋯
      </button>
      {shown && (
        <div
          id={`${id}-menu`}
          role="group"
          aria-label={label}
          className={s.menuPop}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              data-item={item.key}
              data-danger={item.danger || undefined}
              className={s.menuItem}
              onClick={() => pick(item)}
            >
              {item.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
