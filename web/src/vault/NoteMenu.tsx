"use client";

// The open note's ⋯ menu, at the end of its action row: Copy link, and on the person's own note
// Delete note…, which only asks (the question is the pane's). Client state only: copying the
// link writes nothing to the server. It closes like every popover (useDismiss).
import { useId, useRef, useState, type RefObject } from "react";
import { useDismiss } from "../map/useDismiss";
import { COPY_LINK, DELETE_ITEM, MORE_ACTIONS } from "./sentences";
import s from "./vault.module.css";

export function NoteMenu({
  own,
  href,
  onCopied,
  onDelete,
  buttonRef,
}: {
  own: boolean;
  /** The note's in-app href. */
  href: string;
  onCopied: (ok: boolean) => void;
  /** Asks: the parent shows the delete question. */
  onDelete: () => void;
  /** The ⋯ button, for the parent to put the focus back on. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const own_ = useRef<HTMLButtonElement>(null);
  const button = buttonRef ?? own_;
  const [open, setOpen] = useState(false);

  useDismiss({
    open,
    root,
    button,
    onClose: (refocus) => {
      setOpen(false);
      if (refocus) button.current?.focus();
    },
  });

  async function copy() {
    setOpen(false);
    button.current?.focus();
    let ok = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(
          new URL(href, location.origin).toString(),
        );
        ok = true;
      }
    } catch {
      ok = false;
    }
    onCopied(ok);
  }

  function ask() {
    setOpen(false);
    onDelete();
  }

  return (
    <div ref={root} className={s.noteMenu}>
      <button
        ref={button}
        type="button"
        className={s.moreButton}
        aria-label={MORE_ACTIONS}
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="group"
          aria-label={MORE_ACTIONS}
          className={s.menuPop}
        >
          <button
            type="button"
            className={s.menuItem}
            onClick={() => void copy()}
          >
            {COPY_LINK}
          </button>
          {own && (
            <button
              type="button"
              className={s.menuItem}
              aria-label="Delete note"
              onClick={ask}
            >
              {DELETE_ITEM}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
