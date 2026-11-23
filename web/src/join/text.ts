// The sentences and labels of the Join page, where a person who was invited by email joins a
// hive. Plain words, so the screen and the tests read the same ones.

/** The page's name for assistive technology. */
export const TITLE = "Join a hive";

/** An emailed link was opened. Nothing has happened yet. */
export const OPENED = "You opened an invitation to a hive.";
export const CONTINUE = "Continue";
export const CONTINUE_HINT =
  "Continue signs you in with the address the invitation was sent to. You choose which hive to join on the next screen.";

export const WAITING = "Invitations waiting for you";
export const JOIN = "Join";
export const NONE = "No invitations are waiting.";
export const TO_MAP = "Go to the map";
/** Names are chosen by other people; joining is the reader's own decision. */
export const CHECK =
  "A hive and the person inviting choose their own names. Join only a hive you expect.";

export const EXPIRED = "This link has expired.";
/** The way forward from a link that can no longer be used. */
export const EXPIRED_NEXT =
  "Sign in with “Email me a link instead”, using the address the invitation was sent to. If no link arrives, ask the hive's owner to send the invitation again.";
export const TO_SIGN_IN = "Sign in";

/**
 * Above Continue when somebody is already signed in: their address goes between the two, then
 * a full stop. The link signs in whoever it was sent to, in place of them.
 */
export const SIGNED_IN_NOW = "You are signed in as";
export const SWITCH_WARNING =
  "This link signs you in as the person it was sent to. If you did not expect an invitation, do not continue.";
/** On the list, after Continue replaced another person's session. */
export const SWITCHED = "You are now signed in with a different account.";

/** The signed-in person's address follows this. */
export const SIGNED_IN_AS = "Signed in as";
export const NOT_YOU = "Not you?";
export const SIGN_OUT = "Sign out";

export const COULD_NOT_LOAD = "Couldn't load your invitations.";
export const TRY_AGAIN = "Try again";
export const FAILED =
  "Couldn't join. The invitation may have been withdrawn. Try again.";
export const WORKING = "One moment…";

export function invitedBy(name: string): string {
  return `Invited by ${name}`;
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** The day an invitation lapses, the same on the server and in every browser; empty if unreadable. */
export function openUntil(expiresAt: string): string {
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? "" : `Open until ${DAY.format(at)}`;
}
