// The sentences and labels of the approval window, where a person lets an app (Claude, ChatGPT)
// work in their hive. Plain words, so the screen and the tests read the same ones.

/** The page's name for assistive technology. */
export const TITLE = "Connect an app";

/** The app's name is shown in bold just before this. */
export const ASKS = "wants to connect to your hive.";

/** Where the browser goes after the decision; the host is the one the app registered. */
export function returnsTo(host: string): string {
  return host
    ? `After you decide, you go back to ${host}.`
    : "After you decide, you go back to an address this page could not read.";
}

/** The name is chosen by the app itself; the address is the part to check. */
export const CHECK =
  "An app chooses its own name. Check that the address is the one you expect.";

export const WORKSPACE = "Workspace it writes into";
export const APPROVE = "Approve";
export const DENY = "Deny";

/** What approving allows, and what it never does. */
export const WHAT_IT_MAY_DO =
  "The app will read what you can read, and write only into the workspace you choose. Sharing stays your decision: the app cannot share a note, accept a link or delete anything.";

export const FAILED =
  "That didn't work. Try again, or start again from the app.";
export const WORKING = "One moment…";

export const NOTHING_TO_APPROVE =
  "There's nothing to approve here. Start from the app you want to connect.";
export const EXPIRED =
  "This request has expired or was already answered. Go back to the app and connect again.";
export const NO_HIVE = "You're not in a hive yet. Ask its owner to invite you.";
export const COULD_NOT_LOAD =
  "Couldn't load this request. Go back to the app and try again.";
