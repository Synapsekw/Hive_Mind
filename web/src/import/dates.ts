// The two dates of an imported note: when it was written and when it last changed. Pure, no
// I/O, and it runs in the browser (no `node:` import). Everything here reads a file's own
// content and name, so every argument is taken as hostile: nothing throws, and a text too long
// to be a date is refused before it is looked at. The server checks what the browser sends
// again with `cleanDate`.

/** The earliest date a note may carry: 1990-01-01T00:00:00Z. */
export const EARLIEST = Date.UTC(1990, 0, 1);

/** The fields a written date is read from, in the order they are tried. */
const FIELDS = [
  "created",
  "date created",
  "date_created",
  "created_at",
  "creation_date",
  "date",
] as const;

/** The longest text that is looked at as a date, before trimming. */
const MAX_TEXT = 100;
/** The longest text a batch may carry as a date. */
const MAX_SENT = 40;
/** The longest path a date is looked for in; a note's path is at most 500 characters. */
const MAX_PATH = 4096;
/** How deep a list is followed for its first element (`[[2025-03-14]]` unquoted is two). */
const MAX_LIST_DEPTH = 2;
/** The most a `Date` can hold, in milliseconds either side of 1970. */
const MAX_TIME = 8.64e15;

// YYYY-MM-DD, YYYY/MM/DD or YYYY.MM.DD; after the dashed form, a time of day and an offset.
const DATE_TEXT =
  /^(\d{4})([-/.])(\d{2})\2(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?: ?(Z|[+-]\d{2}(?::?\d{2})?))?)?$/;

// YYYY-MM-DD, YYYY_MM_DD, YYYY.MM.DD or YYYYMMDD with no digit before or after.
const DATE_IN_NAME = /(^|\D)(\d{4})([-_.]?)(\d{2})\3(\d{2})(?!\d)/g;

/** Noon UTC of a calendar day, or null when there is no such day. */
function day(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d, 12);
  const back = new Date(t);
  return back.getUTCFullYear() === y &&
    back.getUTCMonth() === m - 1 &&
    back.getUTCDate() === d
    ? t
    : null;
}

/** A text without the quotes or `[[ ]]` around it. */
function bare(text: string): string {
  let s = text.trim();
  const quoted = () =>
    s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0];
  if (quoted()) s = s.slice(1, -1).trim();
  if (s.length >= 4 && s.startsWith("[[") && s.endsWith("]]"))
    s = s.slice(2, -2).trim();
  if (quoted()) s = s.slice(1, -1).trim();
  return s;
}

/** A time, and whether it stands for a whole day: a date that was written with no time of day. */
type Parsed = { t: number; wholeDay: boolean };

const moment = (t: number | null): Parsed | null =>
  t === null ? null : { t, wholeDay: false };

function parseText(text: string): Parsed | null {
  if (text.length > MAX_TEXT) return null;
  const m = DATE_TEXT.exec(bare(text));
  if (!m) return null;
  const noon = day(Number(m[1]), Number(m[3]), Number(m[4]));
  if (noon === null) return null;
  if (m[5] === undefined) return { t: noon, wholeDay: true };
  return moment(timeOfDay(m, noon));
}

/** The moment of a matched date-time on the day whose noon is given, or null when it is none. */
function timeOfDay(m: RegExpExecArray, noon: number): number | null {
  // A time of day is written only after the dashed form.
  if (m[2] !== "-") return null;
  const hour = Number(m[5]);
  const minute = Number(m[6]);
  const second = m[7] === undefined ? 0 : Number(m[7]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const ms = m[8] === undefined ? 0 : Number(m[8].padEnd(3, "0").slice(0, 3));
  let offset = 0;
  const zone = m[9];
  if (zone !== undefined && zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const h = Number(digits.slice(0, 2));
    const min = digits.length > 2 ? Number(digits.slice(2)) : 0;
    if (h > 23 || min > 59) return null;
    offset = (zone[0] === "-" ? -1 : 1) * (h * 60 + min) * 60_000;
  }
  const midnight = noon - 12 * 3_600_000;
  return (
    midnight + hour * 3_600_000 + minute * 60_000 + second * 1000 + ms - offset
  );
}

function parseValue(v: unknown, depth: number): Parsed | null {
  if (typeof v === "string") return parseText(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    const t = Math.round(Math.abs(v) < 1e11 ? v * 1000 : v);
    return moment(Math.abs(t) <= MAX_TIME ? t : null);
  }
  if (v instanceof Date) {
    const t = v.getTime();
    return moment(Number.isFinite(t) ? t : null);
  }
  if (Array.isArray(v) && v.length > 0 && depth < MAX_LIST_DEPTH)
    return parseValue(v[0], depth + 1);
  return null;
}

/**
 * Epoch ms of a date: a text in one of `YYYY-MM-DD`, `YYYY-MM-DD HH:MM[:SS]`, an ISO date-time,
 * `YYYY/MM/DD` or `YYYY.MM.DD`, with `[[ ]]` or quotes around it ignored; a finite number of
 * milliseconds (below 10^11: seconds); a `Date`; or a list, for its first element. Null for
 * anything else, and for a day that is not on the calendar. A date with no time of day is
 * 12:00 UTC; a date-time with no offset is UTC.
 */
export function parseDate(v: unknown): number | null {
  try {
    return parseValue(v, 0)?.t ?? null;
  } catch {
    return null;
  }
}

/** True for a time a note may carry: from 1990-01-01 up to now. */
function usable(t: number | null, now: number): t is number {
  return t !== null && t >= EARLIEST && t <= now;
}

/** How far ahead of UTC a clock on Earth can be: 14 hours. */
const FURTHEST_AHEAD = 14 * 3_600_000;
const HALF_DAY = 12 * 3_600_000;

/** What a source answers for a whole day that is today somewhere: the search ends there. */
const TODAY = Symbol("today");
type Found = number | typeof TODAY | null;

/**
 * True for a whole day, given by its noon UTC, that is still ahead of `now` at noon UTC but has
 * already begun somewhere on Earth. Such a day is neither used (it would be in the future) nor
 * skipped for an older source (it is not wrong): the note was written today.
 */
function isToday(noon: number, now: number): boolean {
  return noon > now && noon - HALF_DAY <= now + FURTHEST_AHEAD;
}

function findInPath(path: string, now: number): Found {
  if (typeof path !== "string" || path.length > MAX_PATH) return null;
  const parts = path.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    const each = new RegExp(DATE_IN_NAME);
    let m: RegExpExecArray | null;
    while ((m = each.exec(part))) {
      const t = day(Number(m[2]), Number(m[4]), Number(m[5]));
      if (usable(t, now)) return t;
      if (t !== null && isToday(t, now)) return TODAY;
      // On from the digit after this match's first, so a date that overlaps it is still found.
      each.lastIndex = m.index + m[1]!.length + 1;
    }
  }
  return null;
}

/**
 * The first usable date in a path: in the file name first, then in the folders from the deepest
 * up. A match that is not a real date, or is before 1990 or after `now`, is skipped and the
 * next is tried. A date that names today but is still ahead of `now` at 12:00 UTC ends the
 * search: nothing after it is tried. Null when there is none.
 */
export function dateInPath(path: string, now: number): number | null {
  const found = findInPath(path, now);
  return found === TODAY ? null : found;
}

/**
 * The first usable date among a note's fields, by the names above in their order; `TODAY` when
 * a field before any usable one holds a date with no time of day that names today.
 */
function dateInFields(frontmatter: unknown, now: number): Found {
  if (
    typeof frontmatter !== "object" ||
    frontmatter === null ||
    Array.isArray(frontmatter)
  )
    return null;
  const fields = frontmatter as Record<string, unknown>;
  const keys = Object.keys(fields);
  for (const name of FIELDS)
    for (const key of keys) {
      if (key.length !== name.length || key.toLowerCase() !== name) continue;
      let found: Parsed | null = null;
      try {
        found = parseValue(fields[key], 0);
      } catch {
        // A field that cannot be read is no date.
      }
      if (found === null) continue;
      if (usable(found.t, now)) return found.t;
      if (found.wholeDay && isToday(found.t, now)) return TODAY;
    }
  return null;
}

/**
 * The two dates of an imported note as ISO texts, or null where none is usable. Written: a date
 * field, then a date in the file name or its folders, then the file's last-modified time.
 * Last changed: the file's last-modified time, never before the written date.
 *
 * A date with no time of day is 12:00 UTC, which before noon UTC on that very day is still
 * ahead. Such a date (one that is today somewhere on Earth) ends the search: the written date
 * is then the file's last-modified time, or none, and never an older source's. So the day a
 * note lands on does not depend on the hour it was imported at.
 */
export function noteDates(
  frontmatter: unknown,
  path: string,
  lastModified: number | undefined,
  now: number,
): { written_at: string | null; modified_at: string | null } {
  try {
    const file =
      typeof lastModified === "number" && usable(lastModified, now)
        ? Math.round(lastModified)
        : null;
    let found: Found = null;
    try {
      found = dateInFields(frontmatter, now);
    } catch {
      // Fields that cannot be read hold no date; the other sources are still tried.
    }
    found ??= findInPath(path, now);
    const written = found === TODAY ? file : (found ?? file);
    const modified =
      file !== null && written !== null && file < written ? written : file;
    return {
      written_at: written === null ? null : new Date(written).toISOString(),
      modified_at: modified === null ? null : new Date(modified).toISOString(),
    };
  } catch {
    return { written_at: null, modified_at: null };
  }
}

/**
 * A date a batch may carry: a text of at most 40 characters that parses to a time from
 * 1990-01-01 up to `now`. The answer is an ISO text made here, never the text that was sent.
 */
export function cleanDate(v: unknown, now: number): string | null {
  if (typeof v !== "string" || v.length > MAX_SENT) return null;
  const t = parseDate(v);
  return usable(t, now) ? new Date(t).toISOString() : null;
}
