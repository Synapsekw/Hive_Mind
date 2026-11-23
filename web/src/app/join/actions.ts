"use server";

// The Join pages' writes, as server actions. All are public HTTP endpoints: they act as
// whoever the cookies (or, for Continue, the emailed link) say, never with a service key, and
// `join.ts` and `password.ts` check their arguments and let the auth server and the database
// decide.
//
// Continue is the only place an emailed link is spent. It always ends on `/join` with no token
// in the address: the list on success (with a notice when the link replaced another person's
// session), the expired line otherwise. `redirect` works by throwing, so it stays outside the
// try.
//
// A first invitation link (type `invite`) also leaves a short-lived cookie, which makes Join
// lead on to the optional password page; `password.ts` says what the cookie is and is not.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "../../lib/supabase/server";
import type { Joined, PasswordSaved } from "../../join/types";
import { acceptIn, continueIn } from "./join";
import { isNew, newCookie, noNewCookie, setPasswordIn } from "./password";

const production = () => process.env.NODE_ENV === "production";

export async function continueWithLink(formData: FormData): Promise<void> {
  let to = "/join?error=expired";
  try {
    const type = formData.get("type");
    const outcome = await continueIn(
      await createServerSupabase(),
      formData.get("token_hash"),
      type,
    );
    // "switched": the link signed in someone other than the person the browser held.
    if (outcome === "ok") to = "/join";
    if (outcome === "switched") to = "/join?switched=1";
    if (outcome !== "expired") {
      // A new account is offered a password after Join. Any other link takes the offer away,
      // so one left by an earlier person in this browser is not made to someone else.
      const jar = await cookies();
      jar.set(
        type === "invite" ? newCookie(production()) : noNewCookie(production()),
      );
    }
  } catch (e) {
    console.error("join continue failed", e instanceof Error ? e.name : "");
  }
  redirect(to);
}

/** Joins one hive and answers where to go: the map, or first the optional password page. */
export async function join(id: string): Promise<Joined> {
  try {
    const { ok } = await acceptIn(await createServerSupabase(), id);
    if (!ok) return { ok: false };
    return { ok: true, next: isNew(await cookies()) ? "/join/password" : "/" };
  } catch (e) {
    console.error("join action failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}

/**
 * Sets the password the person typed on `/join/password`. Only for a browser that carries the
 * new-person cookie and a session. The answer is whether it worked and, if not, which fixed
 * reason: never the password, the form or the auth server's words. Nothing of them is logged.
 */
export async function setPassword(formData: FormData): Promise<PasswordSaved> {
  try {
    const jar = await cookies();
    if (!isNew(jar)) return { ok: false, reason: "failed" };
    const saved = await setPasswordIn(
      await createServerSupabase(),
      formData.get("password"),
      formData.get("repeat"),
    );
    if (saved.ok) jar.set(noNewCookie(production()));
    return saved;
  } catch (e) {
    console.error("set password failed", e instanceof Error ? e.name : "");
    return { ok: false, reason: "failed" };
  }
}

/** Skip for now: the offer is not made again. Changes nothing else. */
export async function skipPassword(): Promise<void> {
  try {
    (await cookies()).set(noNewCookie(production()));
  } catch (e) {
    console.error("skip password failed", e instanceof Error ? e.name : "");
  }
}
