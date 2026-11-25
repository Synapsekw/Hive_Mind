"use client";

// The Import, Connect and Attach panels, over the vault: one at a time, focus kept inside.
// Escape and a press on the dimmed card close it only when the panel is not at work. The panels
// keep their own Escape and Close: an Escape a panel has already answered is left alone here.
import { useEffect, useRef, type ReactNode } from "react";
import s from "./vault.module.css";

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

/** What Tab stops on inside `box`, in order. */
const stops = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );

export function PanelDialog({
  label,
  busy,
  onClose,
  children,
}: {
  /** The panel's heading, the dialog's name. */
  label: string;
  /** A panel at work cannot be closed. */
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The panel moves the focus to its own heading as it opens; only when it has not, the
    // focus goes to the first thing that takes it.
    const el = box.current;
    if (!el || el.contains(document.activeElement)) return;
    (stops(el)[0] ?? el).focus();
  }, []);

  return (
    <div
      className={s.dim}
      // A press on the dimmed card keeps the focus in the dialog; it closes on the click, once
      // the press is over, so the focus can go back to Add notes.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={s.dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (e.defaultPrevented) return;
            e.preventDefault();
            if (!busy) onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const f = stops(box.current!);
          if (f.length === 0) {
            e.preventDefault();
            return;
          }
          const first = f[0]!;
          const last = f[f.length - 1]!;
          const at = document.activeElement as HTMLElement | null;
          // The heading the panel focuses and the box itself come before every stop.
          const before = !at || !f.includes(at);
          if (e.shiftKey && (at === first || before)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && at === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
