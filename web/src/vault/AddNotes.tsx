"use client";

// The bar's one menu of the rare ways notes come in: Import a folder, and on one's own workspace
// Connect wiki links and Attach topics. Each item is its name with one line under it. Client
// state only; choosing one hands its key to the caller, which opens that panel. It closes like
// every popover (useDismiss).
import { useId, useRef, useState, type RefObject } from "react";
import { useDismiss } from "../map/useDismiss";
import { ADD_NOTES } from "./importText";
import s from "./vault.module.css";

export type AddNotesKey = "import" | "connect" | "attach";

export function AddNotes({
  items,
  onChoose,
  buttonRef,
}: {
  items: { key: AddNotesKey; name: string; line: string }[];
  onChoose: (key: AddNotesKey) => void;
  /** The Add notes button, for the parent to put the focus back on. */
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useDismiss({
    open,
    root,
    button: buttonRef,
    onClose: (refocus) => {
      setOpen(false);
      if (refocus) buttonRef.current?.focus();
    },
  });

  return (
    <div ref={root} className={s.addNotes}>
      <button
        ref={buttonRef}
        type="button"
        className={`${s.secondary} ${s.addButton}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {ADD_NOTES}
        <span
          aria-hidden="true"
          className={s.addCaret}
          data-open={open || undefined}
        />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="group"
          aria-label={ADD_NOTES}
          className={s.addPop}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={s.addItem}
              // Named by its name alone; the line under it is its description.
              aria-labelledby={`${id}-${item.key}-name`}
              aria-describedby={`${id}-${item.key}-line`}
              onClick={() => {
                setOpen(false);
                onChoose(item.key);
              }}
            >
              <span id={`${id}-${item.key}-name`} className={s.addName}>
                {item.name}
              </span>
              <span id={`${id}-${item.key}-line`} className={s.addLine}>
                {item.line}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
