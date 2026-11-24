// The signed-in member as the rail shows them: name, role and hive, and the list of every hive
// they are in for the switcher. One bounded read through myHives (members by user_id, oldest
// first, 50 at most); the current hive is the one the cookie names when it is in that list, else
// the oldest. Null when there is no session or no hive; the rail then shows a plain "Account"
// button.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chosenHiveId } from "./chosen-hive";
import { currentOf, myHives, sessionUserId } from "./own-hive";

export type Account = {
  name: string;
  role: string;
  hive: string;
  initials: string;
  /** The current hive's id. */
  hiveId: string;
  /** Every hive the person is in, oldest membership first; exactly one is current. */
  hives: {
    id: string;
    name: string;
    role: string;
    current: boolean;
    /** True while that hive is being deleted. */
    closing: boolean;
  }[];
  /** When the current hive will be erased, while it is being deleted; null otherwise. */
  closing: string | null;
};

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1)
    return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
  return (Array.from(words[0]!)[0]! + Array.from(words[1]!)[0]!).toUpperCase();
}

/** `opts.chosen`, when the key is there, is used in place of the cookie (tests). */
export async function loadAccount(
  db: Pick<SupabaseClient, "from" | "auth">,
  opts?: { chosen?: string | null },
): Promise<Account | null> {
  const uid = await sessionUserId(db);
  if (!uid) return null;
  const hives = await myHives(db, uid);
  if (hives === "error") return null;
  const chosen =
    opts && "chosen" in opts ? (opts.chosen ?? null) : await chosenHiveId();
  const own = currentOf(hives, chosen);
  if (!own) return null;
  return {
    name: own.displayName,
    role: own.role,
    hive: own.name,
    initials: initials(own.displayName),
    hiveId: own.id,
    hives: hives.map((h) => ({
      id: h.id,
      name: h.name,
      role: h.role,
      current: h === own,
      closing: h.deleteAfter !== null,
    })),
    closing: own.deleteAfter,
  };
}
