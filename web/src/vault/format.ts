// Small pure helpers for the vault's text. Dates are formatted in UTC from the note's own
// timestamp, never from the clock or the browser's locale, so server and client render alike.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "3 Nov 2026". */
export function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "3 Nov" in the year of `now`, else "3 Nov 2025". */
export function shortDate(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === new Date(now).getUTCFullYear()
    ? base
    : `${base} ${d.getUTCFullYear()}`;
}

/** The note's text without a leading YAML frontmatter block. */
export function stripFrontmatter(body: string): string {
  const m = /^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
  return m ? body.slice(m[0].length) : body;
}
