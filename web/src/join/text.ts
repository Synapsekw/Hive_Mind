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
 * Above the button when somebody is already signed in. Three facts, in this order: who is
 * signed in (their address goes between the first two), that this browser will be signed out
 * of that account, and that the invited address is signed in instead.
 */
export const SIGNED_IN_NOW = "You are signed in as";
export const IN_THIS_BROWSER = "in this browser.";
export const SWITCH_WARNING =
  "Continuing signs this browser out of that account and signs in the address this invitation was sent to. If you did not expect an invitation, do not continue.";
/** The button's label in that case, in place of Continue: it says what pressing it does. */
export const SIGN_OUT_AND_CONTINUE = "Sign out and continue";
/** The way to leave the link unused; the signed-in address follows. */
export const STAY_AS = "Stay signed in as";
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

// The optional step after a new person joins: choosing a password.

/** The page's name for assistive technology, and its heading. */
export const PASSWORD_TITLE = "Choose a password";
export const PASSWORD_OPTIONAL =
  "Optional. You can always sign in with a link sent to your email instead.";
export const PASSWORD = "Password";
export const REPEAT_PASSWORD = "Repeat password";
export const SAVE_PASSWORD = "Save password";
export const SKIP = "Skip for now";

export const PASSWORD_SHORT = "Use at least 10 characters.";
export const PASSWORD_LONG = "That password is too long.";
export const PASSWORD_DIFFERENT = "The two passwords are not the same.";
/** The auth server said no (too weak, or known from a leak). Its own words are never shown. */
export const PASSWORD_REFUSED =
  "That password was not accepted. Try a different one.";
export const PASSWORD_FAILED =
  "Couldn't save the password. Try again, or skip for now.";

/** The sentence for each reason a password was not saved. */
export function passwordMessage(
  reason: "short" | "long" | "different" | "refused" | "failed",
): string {
  return {
    short: PASSWORD_SHORT,
    long: PASSWORD_LONG,
    different: PASSWORD_DIFFERENT,
    refused: PASSWORD_REFUSED,
    failed: PASSWORD_FAILED,
  }[reason];
}
