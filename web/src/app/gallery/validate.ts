// Argument checks for the gallery's server actions, which are public endpoints: every value from
// the browser passes through here before any query. Pure, no I/O. These only reject malformed
// input; which files a person may read or delete is the database's answer.
import type { Cursor, Kind, ServerFilter } from "../../gallery/types";
import { isUuid } from "../vault/validate";

export { isUuid };

/** Characters that would end the value inside the keyset filter the cursor is written into. */
const BREAKS = /[,()"]/;

/**
 * Where the next page starts, rebuilt from its two known keys. `created_at` is kept exactly as
 * the database wrote it (its microseconds decide the order), so it is only checked: a date, at
 * most 40 characters, and nothing that could close or extend the filter.
 */
export function cleanCursor(v: unknown): Cursor | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { created_at, id } = v as Record<string, unknown>;
  if (!isUuid(id)) return null;
  if (typeof created_at !== "string") return null;
  if (created_at.length < 1 || created_at.length > 40) return null;
  if (BREAKS.test(created_at) || Number.isNaN(Date.parse(created_at)))
    return null;
  return { created_at, id };
}

const KINDS: readonly Kind[] = [
  "image",
  "pdf",
  "slides",
  "sheet",
  "doc",
  "text",
  "csv",
  "other",
];

/** The most ids a filter, a folder add or a page names in one request. */
export const MAX_IDS = 200;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;
const NAME_MAX = 60;
const QUERY_MAX = 100;
const FILE_NAME_MAX = 255;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A uuid or null; `undefined` when the value is neither. */
function idOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  return isUuid(v) ? v : undefined;
}

/** 1..max distinct uuids (0..max with `empty`), or null when malformed. */
export function cleanIds(
  v: unknown,
  opts: { empty?: boolean } = {},
): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_IDS) return null;
  if (v.length === 0 && !opts.empty) return null;
  if (!v.every(isUuid)) return null;
  return [...new Set(v as string[])];
}

/** An instant written as the database compares it, or undefined when it is not one. */
function instant(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string" || v.length < 1 || v.length > 40) return undefined;
  if (BREAKS.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** The longest agent name a filter carries (the address keeps 80 characters). */
const AGENT_MAX = 80;

/**
 * An agent name, compared as stored (sessions.agent_name), so kept exactly as given: 1 to 80
 * characters, not blank. It goes to the database as a parameter, never into a filter string.
 */
function agentOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > AGENT_MAX || v.trim() === "")
    return undefined;
  return v;
}

/** The filters the server applies, rebuilt from their known keys. Null when any is malformed. */
export function cleanServerFilter(v: unknown): ServerFilter | null {
  if (!isObject(v)) return null;
  const { kinds, session, owner, agent, folder, from, to } = v;
  if (!Array.isArray(kinds) || kinds.length > KINDS.length * 2) return null;
  if (!kinds.every((k) => (KINDS as readonly unknown[]).includes(k)))
    return null;
  const s = idOrNull(session);
  const o = idOrNull(owner);
  const a = agentOrNull(agent);
  const d = idOrNull(folder);
  const f = instant(from);
  const t = instant(to);
  if (s === undefined || o === undefined) return null;
  if (a === undefined || d === undefined) return null;
  if (f === undefined || t === undefined) return null;
  if (f && t && f >= t) return null;
  return {
    kinds: [...new Set(kinds as Kind[])],
    session: s,
    owner: o,
    agent: a,
    folder: d,
    from: f,
    to: t,
  };
}

/** A gallery folder's name: 1 to 60 characters after trimming. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

/** A note search: at most 100 characters after trimming; empty is allowed. */
export function cleanQuery(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const q = v.trim();
  return q.length <= QUERY_MAX ? q : null;
}

export type UploadRequest = {
  files: { name: string; size: number }[];
  noteId: string | null;
  folderId: string | null;
};

/**
 * What the browser asks to upload: 1 to 20 files, each named (1..255 characters) and at most
 * 50 MB as declared, and the home note and folder as uuids or null. The size declared here only
 * refuses early; the stored object's own size decides when the upload finishes.
 */
export function cleanUploadRequest(v: unknown): UploadRequest | null {
  if (!isObject(v)) return null;
  const { files, noteId, folderId } = v;
  if (!Array.isArray(files)) return null;
  if (files.length < 1 || files.length > MAX_UPLOAD_FILES) return null;
  const out: UploadRequest["files"] = [];
  for (const f of files) {
    if (!isObject(f)) return null;
    const { name, size } = f;
    if (typeof name !== "string") return null;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > FILE_NAME_MAX) return null;
    if (typeof size !== "number" || !Number.isInteger(size)) return null;
    if (size < 0 || size > MAX_UPLOAD_BYTES) return null;
    out.push({ name: trimmed, size });
  }
  const n = idOrNull(noteId);
  const d = idOrNull(folderId);
  if (n === undefined || d === undefined) return null;
  return { files: out, noteId: n, folderId: d };
}
