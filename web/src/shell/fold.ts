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
