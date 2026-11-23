// Argument checks for the vault's server actions, which are public endpoints: every value from
// the browser passes through here before any query. Pure, no I/O. These only reject malformed
// input; whether a change is allowed is the database's answer.
import type { Choice, Visibility } from "../../vault/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** A folder path: 1..500 characters, no leading or trailing slash, no empty, "." or ".." segment. */
export function cleanPath(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > 500) return null;
  if (v.includes("\u0000")) return null;
  const parts = v.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return v;
}

const VISIBILITIES: readonly Visibility[] = ["private", "group", "members"];

/**
 * The person's decision, rebuilt from known keys only. `visibility: null` means "no own
 * setting". Named members must be non-empty and all in `allowed`; every other choice sends an
 * empty list.
 */
export function cleanChoice(v: unknown, allowed: string[]): Choice | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { visibility, shared_with } = v as Record<string, unknown>;
  if (visibility !== null && !VISIBILITIES.includes(visibility as Visibility))
    return null;
  if (visibility !== "members")
    return { visibility: visibility as Visibility | null, shared_with: [] };
  if (!Array.isArray(shared_with) || shared_with.length === 0) return null;
  const ok = new Set(allowed);
  if (!shared_with.every((id) => typeof id === "string" && ok.has(id)))
    return null;
  return {
    visibility: "members",
    shared_with: [...new Set(shared_with as string[])],
  };
}

/** The member ids a person may name: everyone in the hive except themselves. */
export function othersIn(
  members: { id: string; user_id: string }[],
  userId: string,
): string[] {
  return members.filter((m) => m.user_id !== userId).map((m) => m.id);
}
