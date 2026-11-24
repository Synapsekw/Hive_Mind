import { FOLD_COOKIE, formatFold, type Fold } from "./fold";
import { formatLook, LOOK_COOKIE, type Look } from "../theme/look";

const YEAR = 60 * 60 * 24 * 365;

function remember(name: string, value: string, secure: boolean): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${YEAR}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** The `document.cookie` string that remembers a look for a year; `Secure` only over https. */
export function lookCookie(look: Look, secure: boolean): string {
  return remember(LOOK_COOKIE, formatLook(look), secure);
}

/** The same for which sides are folded. */
export function foldCookie(fold: Fold, secure: boolean): string {
  return remember(FOLD_COOKIE, formatFold(fold), secure);
}
