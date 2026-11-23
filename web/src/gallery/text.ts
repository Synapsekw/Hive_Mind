// Small pure helpers for the gallery's text. Dates are formatted in UTC from the file's own
// timestamp (see `vault/format.ts`), so server and client render alike.
import { shortDate } from "../vault/format";
import { kindLabel } from "./kind";
import type { GalleryFile } from "./types";

const UNITS = ["KB", "MB", "GB", "TB"];

/** "512 B", "340 KB", "1.2 MB"; "" when the size is unknown (0) or not a size. */
export function sizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = -1;
  let text = "";
  do {
    value /= 1024;
    unit += 1;
    // Whole kilobytes; one decimal from megabytes up, without a trailing ".0".
    text = unit === 0 ? String(Math.round(value)) : String(+value.toFixed(1));
  } while (Number(text) >= 1024 && unit < UNITS.length - 1);
  return `${text} ${UNITS[unit]}`;
}

/** One line on who can read the file. */
export function sharingText(f: GalleryFile): string {
  switch (f.sharing) {
    case "private":
      return "Private";
    case "through-note":
      return f.note
        ? `Shared through ${f.note.title}`
        : "Shared through a note";
    case "shared-with-me":
      return `Shared with you by ${f.owner}`;
  }
}

/** "PDF · 1.2 MB · 3 Nov": type, size and date, leaving out a part that is unknown. */
export function metaLine(f: GalleryFile, now: number): string {
  return [
    kindLabel(f.kind, f.name),
    sizeText(f.size),
    shortDate(f.created_at, now),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}
