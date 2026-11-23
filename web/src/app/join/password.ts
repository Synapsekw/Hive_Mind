// The optional step after a new person joins: choosing a password, so they are not left with
// emailed links as their only way in.
//
// It is offered only right after a first invitation link. Continue sets a short-lived cookie
// when the link it spent was of type `invite` (the kind mailed to an address with no confirmed
// account); Join reads it to decide where to go next; the password page and its action require
// it. The cookie carries no secret and decides nothing about what a person may do: it only
// says "offer the step". The password is set with the person's own session, never a service
// key, and the auth server decides whether it is acceptable.
//
// The password is never logged, stored or answered back. A log line here is one fixed phrase
// and, for a refusal, the error's code and status. Never its message, which can quote input.
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPassword, type PasswordFault } from "../../join/rules";
import type { PasswordSaved } from "../../join/types";

export const NEW_COOKIE = "hm_new";
const VALUE = "1";
/** One hour: long enough to press Join and type a password, short enough to mean "just now". */
const LIFE = 60 * 60;

type CookieJar = { get(name: string): { value: string } | undefined };

function cookie(production: boolean, value: string, maxAge: number) {
  return {
    name: NEW_COOKIE,
    value,
    // Not readable by scripts, not sent on requests another site makes for the person, and
    // sent to the Join pages only.
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/join",
    maxAge,
  };
}

/** The cookie Continue sets after a first invitation link. */
export const newCookie = (production: boolean) =>
  cookie(production, VALUE, LIFE);

/** The same cookie with no life left: how it is taken away (the path has to match). */
export const noNewCookie = (production: boolean) => cookie(production, "", 0);

/** True when the browser carries the cookie as it was set. */
export function isNew(jar: CookieJar): boolean {
  return jar.get(NEW_COOKIE)?.value === VALUE;
}

const no = (reason: PasswordFault | "refused" | "failed"): PasswordSaved => ({
  ok: false,
  reason,
});

/**
 * Sets the signed-in person's own password. The rules are checked first, and nothing is asked
 * of the auth server for a password that breaks them. Then the auth server is asked who is
 * signed in (not the cookie), and only then to change the password.
 */
export async function setPasswordIn(
  db: Pick<SupabaseClient, "auth">,
  password: unknown,
  repeat: unknown,
): Promise<PasswordSaved> {
  const fault = checkPassword(password, repeat);
  if (fault) return no(fault);
  try {
    const { data } = await db.auth.getUser();
    const id: unknown = data?.user?.id;
    if (typeof id !== "string" || !id) return no("failed");
    const { error } = await db.auth.updateUser({
      password: password as string,
    });
    if (error) {
      console.error("password change refused", error.code, error.status);
      return no("refused");
    }
    return { ok: true };
  } catch (e) {
    console.error("password change failed", e instanceof Error ? e.name : "");
    return no("failed");
  }
}
