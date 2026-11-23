"use server";

// The Join page's two writes, as server actions. Both are public HTTP endpoints: they act as
// whoever the cookies (or, for Continue, the emailed link) say, never with a service key, and
// `join.ts` checks their arguments and lets the auth server and the database decide.
//
// Continue is the only place an emailed link is spent. It always ends on `/join` with no token
// in the address: the list on success (with a notice when the
// link replaced another person's session), the expired line otherwise. `redirect` works by throwing,
// so it stays outside the try.
import { redirect } from "next/navigation";
import { createServerSupabase } from "../../lib/supabase/server";
import type { Joined } from "../../join/types";
import { acceptIn, continueIn } from "./join";

export async function continueWithLink(formData: FormData): Promise<void> {
  let to = "/join?error=expired";
  try {
    const outcome = await continueIn(
      await createServerSupabase(),
      formData.get("token_hash"),
      formData.get("type"),
    );
    // "switched": the link signed in someone other than the person the browser held.
    if (outcome === "ok") to = "/join";
    if (outcome === "switched") to = "/join?switched=1";
  } catch (e) {
    console.error("join continue failed", e instanceof Error ? e.name : "");
  }
  redirect(to);
}

export async function join(id: string): Promise<Joined> {
  try {
    return await acceptIn(await createServerSupabase(), id);
  } catch (e) {
    console.error("join action failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}
