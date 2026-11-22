import { formatLook, LOOK_COOKIE, type Look } from "../theme/look";

const YEAR = 60 * 60 * 24 * 365;

/** The `document.cookie` string that remembers a look for a year; `Secure` only over https. */
export function lookCookie(look: Look, secure: boolean): string {
  const parts = [
    `${LOOK_COOKIE}=${formatLook(look)}`,
    "Path=/",
    `Max-Age=${YEAR}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
