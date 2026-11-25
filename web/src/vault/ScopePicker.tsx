"use client";

// In a narrow card the folder column folds into the list header: the title becomes a button that
// opens a popover holding the Folders / Topics switch and the list (its children). Client state
// only; the parent owns `open` so a choice made inside can close it. It closes like every popover
// (useDismiss).
import { useId, useRef, type ReactNode } from "react";
import { useDismiss } from "../map/useDismiss";
import s from "./vault.module.css";

export function ScopePicker({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useDismiss({
    open,
    root,
    button,
    onClose: (refocus) => {
      onOpenChange(false);
      if (refocus) button.current?.focus();
    },
  });

  return (
    <div ref={root} className={s.scopePicker}>
      <button
        ref={button}
        type="button"
        className={s.scopeButton}
        aria-label={`Choose folder or topic: ${title}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-pop` : undefined}
        onClick={() => onOpenChange(!open)}
      >
        <span className={s.scopeTitle} title={title}>
          {title}
        </span>
        <span
          aria-hidden="true"
          className={s.addCaret}
          data-open={open || undefined}
        />
      </button>
      {open && (
        <div
          id={`${id}-pop`}
          role="group"
          aria-label="Folders and topics"
          className={s.scopePop}
        >
          {children}
        </div>
      )}
    </div>
  );
}
