"use server";

// The hive switcher's writes, as server actions. Both are public HTTP endpoints: each acts as
// the person behind the session cookie (never a service key), checks its arguments in
// `write.ts` before any query, and lets the database decide. No session, no Supabase
// configuration or an unexpected failure answers `{ ok: false }`.
//
// Switching changes nothing in the database: it remembers, in a cookie, which of the person's
// own hives the screens show. The page reloads afterwards.
import { cookies } from "next/headers";
import { createServerSupabase } from "../../lib/supabase/server";
import { createHiveIn, switchHiveIn, type Created } from "./write";

export type { Created } from "./write";

export async function switchHive(hiveId: string): Promise<{ ok: boolean }> {
  try {
    return await switchHiveIn(
      await createServerSupabase(),
      await cookies(),
      hiveId,
    );
  } catch (e) {
    console.error(
      "switch hive action failed",
      e instanceof Error ? e.name : "",
    );
    return { ok: false };
  }
}

export async function createHive(
  name: string,
  displayName: string,
): Promise<Created> {
  try {
    return await createHiveIn(
      await createServerSupabase(),
      await cookies(),
      name,
      displayName,
    );
  } catch (e) {
    console.error(
      "create hive action failed",
      e instanceof Error ? e.name : "",
    );
    return { ok: false, reason: "failed" };
  }
}
