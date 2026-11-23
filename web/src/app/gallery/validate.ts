// Argument checks for the gallery's server actions, which are public endpoints: every value from
// the browser passes through here before any query. Pure, no I/O. These only reject malformed
// input; which files a person may read or delete is the database's answer.
import type { Cursor } from "../../gallery/types";
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
