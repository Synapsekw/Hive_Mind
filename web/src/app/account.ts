// The signed-in member as the rail shows them: name, role and hive. One bounded read through
// ownHive (members by user_id, limit 1). Null when there is no session or no hive; the rail then
// shows no account button.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownHive, sessionUserId } from "./own-hive";

export type Account = {
  name: string;
  role: string;
  hive: string;
  initials: string;
};

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export async function loadAccount(
  db: Pick<SupabaseClient, "from" | "auth">,
): Promise<Account | null> {
  const uid = await sessionUserId(db);
  if (!uid) return null;
  const own = await ownHive(db, uid, { profile: true });
  if (own === null || own === "error") return null;
  return {
    name: own.displayName,
    role: own.role,
    hive: own.name,
    initials: initials(own.displayName),
  };
}
