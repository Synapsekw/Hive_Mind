// The way every popover on the map closes: a press outside, Escape, focus moving away, or
// another popover opening (only one is open at a time). Client state only.
import { useEffect, useId, useRef, type RefObject } from "react";

const OPENED = "hv-popover-open";

/** Tells every open popover that the one called `id` opened, so the others close. */
export function announceOpen(id: string) {
  document.dispatchEvent(new CustomEvent(OPENED, { detail: id }));
}

/** Calls `onClose` when another popover announces it opened (without taking focus). */
export function useCloseOnOtherOpen(
  open: boolean,
  id: string,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) close.current();
    };
    document.addEventListener(OPENED, other);
    announceOpen(id);
    return () => document.removeEventListener(OPENED, other);
  }, [open, id]);
}

export function useDismiss({
  open,
  root,
  button,
  onClose,
}: {
  open: boolean;
  root: RefObject<HTMLElement | null>;
  button: RefObject<HTMLElement | null>;
  /** `refocus`: focus should go back to the button. */
  onClose: (refocus: boolean) => void;
}) {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useCloseOnOtherOpen(open, id, () => close.current(false));

  useEffect(() => {
    if (!open) return;
    // A press outside closes it; focus goes back to the button unless the press landed on
    // something that takes focus itself.
    const down = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || root.current?.contains(t)) return;
      const takesFocus = !!t.closest(
        "button, a, input, textarea, select, [tabindex]",
      );
      close.current(false);
      const btn = button.current;
      // After the press's own focus change, which would otherwise blur the button again.
      if (!takesFocus) setTimeout(() => btn?.focus({ preventScroll: true }), 0);
    };
    // Escape closes wherever focus is, <body> included. Caught first, so the map's own Escape
    // does not also clear the selection.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current(true);
    };
    // Focus moving out of the popover's root closes it and stays where it went. A null target
    // (a press on a non-focusable spot) is left to the press handler.
    const out = (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (to instanceof Node && !root.current?.contains(to))
        close.current(false);
    };
    const el = root.current;
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", esc, true);
    el?.addEventListener("focusout", out);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", esc, true);
      el?.removeEventListener("focusout", out);
    };
  }, [open, root, button]);
}
