"use client";

// A small popover's open state: a press outside its wrapper puts it away, and Escape inside the
// wrapper puts it away and hands the focus back to the control that opened it. Escape stops
// there, so a popover in the viewer's bar does not close the viewer too.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<T>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const el = wrap.current;
      if (el && e.target instanceof Node && !el.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  };

  return { open, setOpen, wrap, trigger, onKeyDown };
}
