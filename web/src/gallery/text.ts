// Small pure helpers for the gallery's text. Dates are formatted in UTC from the file's own
// timestamp (see `vault/format.ts`), so server and client render alike.
import { shortDate } from "../vault/format";
import { kindLabel } from "./kind";
import type { GalleryFile, GalleryFolder, GallerySession } from "./types";

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

export const HOME_FROM_VAULT = "Home note set by your vault";
export const VAULT_GROUP = "From your vault";

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

/** The panel's sentence on who can read a file. */
export function whoCanRead(f: GalleryFile): string {
  if (!f.mine) return `Shared with you by ${f.owner}.`;
  if (!f.note) return "Only you. It has no home note.";
  return f.sharing === "through-note"
    ? `Whoever can read “${f.note.title}”.`
    : `Only you, for now: it follows “${f.note.title}”, which is private.`;
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);

/** A session's time span: "22 Nov, 09:00–10:20", across days with both dates, or
 * "22 Nov, from 09:00" while it is open. UTC, like every date on the screen. */
export function spanText(s: GallerySession, now: number): string {
  const start = new Date(s.started_at);
  if (Number.isNaN(start.getTime())) return "";
  const day = shortDate(s.started_at, now);
  const end = s.ended_at ? new Date(s.ended_at) : null;
  if (!end || Number.isNaN(end.getTime())) return `${day}, from ${hhmm(start)}`;
  if (s.started_at.slice(0, 10) === end.toISOString().slice(0, 10))
    return `${day}, ${hhmm(start)}–${hhmm(end)}`;
  return `${day} ${hhmm(start)} – ${shortDate(end.toISOString(), now)} ${hhmm(end)}`;
}

/** The title an upload batch carries until the server names it: "Upload · 2026-11-22". */
export function uploadTitle(iso: string): string {
  return `Upload · ${iso.slice(0, 10)}`;
}

/** "Harbour / Proposals" for a sub-folder, "Harbour" for a top-level one. */
export function folderPath(id: string, folders: GalleryFolder[]): string {
  const folder = folders.find((f) => f.id === id);
  if (!folder) return "";
  const parent = folder.parent_id
    ? folders.find((f) => f.id === folder.parent_id)
    : undefined;
  return parent ? `${parent.name} / ${folder.name}` : folder.name;
}
