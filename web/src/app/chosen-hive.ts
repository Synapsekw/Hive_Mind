// Which of the person's hives the screens show: its id, kept in a cookie.
//
// The cookie grants nothing. `ownHive` reads the person's own memberships, which the database
// answers under row-level security, and the cookie only picks one of those rows. A value that
// was forged, or names a hive the person has left, matches none of them and the oldest
// membership is shown instead. Nothing here is a permission check.
import { cookies } from "next/headers";
import { isUuid } from "./vault/validate";

export const HIVE_COOKIE = "hm_hive";
/** One year, in seconds. */
const LIFE = 60 * 60 * 24 * 365;

export type CookieToSet = {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

function cookie(
  production: boolean,
  value: string,
  maxAge: number,
): CookieToSet {
  return {
    name: HIVE_COOKIE,
    value,
    // Not readable by scripts, and not sent on requests another site makes for the person.
    httpOnly: true,
    sameSite: "lax",
    secure: production,
    path: "/",
    maxAge,
  };
}

/** The cookie that makes `id` the hive the screens show. */
export const hiveCookie = (id: string, production: boolean): CookieToSet =>
  cookie(production, id, LIFE);

/** The same cookie with no life left: how the choice is taken away. */
export const noHiveCookie = (production: boolean): CookieToSet =>
  cookie(production, "", 0);

/**
 * The hive id the cookie names, in lower case. Null when there is no cookie, when its value is
 * not an id, and outside a request (tests, the build), where there are no cookies to read.
 */
export async function chosenHiveId(): Promise<string | null> {
  try {
    const value = (await cookies()).get(HIVE_COOKIE)?.value;
    return isUuid(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}
