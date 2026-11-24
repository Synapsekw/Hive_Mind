// Which sides of the page are folded: the left rail and the right panel, each open or shut.
// Kept per browser in one cookie, `<rail>.<panel>`, and read on the server so the first paint
// already has the right widths. Anything but the exact words reads as open.

export const FOLD_COOKIE = "hive-fold";

type Side = "open" | "shut";
export type Fold = { rail: Side; panel: Side };

export const DEFAULT_FOLD: Fold = { rail: "open", panel: "open" };

const side = (value: string | undefined): Side =>
  value === "shut" ? "shut" : "open";

/** Reads `<rail>.<panel>`; a missing or unknown part is open, a third part is ignored. */
export function parseFold(value: string | undefined): Fold {
  // A real value is nine characters; anything long is junk.
  const parts =
    typeof value === "string" && value.length <= 40 ? value.split(".") : [];
  return { rail: side(parts[0]), panel: side(parts[1]) };
}

export function formatFold(f: Fold): string {
  return `${f.rail}.${f.panel}`;
}

/**
 * Where a key belongs to what has focus, not to the page: typing in a field, a popover, a dialog
 * or a radio group (where keys already mean something). Page-wide keys stay quiet inside these.
 */
export const QUIET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-popover], [role="dialog"], [role="radiogroup"]';

/** The parts of a keydown event `foldKeyIgnored` reads, so it is tested without a browser. */
export type FoldKeyEvent = {
  key: string;
  repeat: boolean;
  defaultPrevented: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  getModifierState(key: string): boolean;
  target: unknown;
};

/** True when a key lands where it belongs to the focused control (see `QUIET`). */
export function quietTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const t = target as {
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  if (t.isContentEditable) return true;
  return typeof t.closest === "function" && t.closest(QUIET) !== null;
}

/**
 * True when a fold key must do nothing: the key is held down (repeats), Command or Shift is held,
 * or the key lands while typing in a field, inside a popover, a dialog or a radio group. Ctrl and
 * Alt count only when they are not how the layout types the bracket: AltGr (reported as Ctrl+Alt
 * on Windows) and Option on a Mac (which gives the bracket itself as the key) still fold.
 */
export function foldKeyIgnored(e: FoldKeyEvent): boolean {
  if (e.repeat || e.defaultPrevented || e.metaKey || e.shiftKey) return true;
  if ((e.ctrlKey || e.altKey) && !e.getModifierState("AltGraph")) {
    if (e.ctrlKey) return true;
    if (e.key !== "[" && e.key !== "]") return true;
  }
  return quietTarget(e.target);
}
