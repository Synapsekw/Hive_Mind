// Where a person goes once signed in, when they were sent to sign in from another page of this
// site (the approval window for a connecting app). Only a path on this site is ever followed;
// anything else means home.
import { safeNext } from "../../lib/safe-next";

/** The `next` of the page's query as a safe same-site path; "/" when there is none. */
export function afterSignIn(
  next: string | string[] | null | undefined,
): string {
  const one = Array.isArray(next) ? next[0] : next;
  return safeNext(one ?? null);
}

/** The address the emailed link lands on, carrying `next` when it is not simply home. */
export function confirmAddress(origin: string, next: string): string {
  const to = safeNext(next);
  const base = `${origin}/auth/confirm`;
  return to === "/" ? base : `${base}?next=${encodeURIComponent(to)}`;
}
