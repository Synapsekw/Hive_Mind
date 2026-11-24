// The hive switcher's words and its small rules: what the button and the form say, why a new
// hive was refused, and the same length check the database makes, so an obviously wrong name is
// refused before any request.

/** The rail's name when nobody is signed in (dev pages, the no-hive notice). */
export const BRAND = "Hive";
export const HIVES = "Hives";
export const NEW_HIVE = "New hive";
export const HIVE_NAME = "Hive name";
export const YOUR_NAME = "Your name in this hive";
export const CREATE = "Create";
export const CANCEL = "Cancel";
export const FAILED = "That didn't work. Try again.";
export const NO_HIVE = "You're not in a hive yet. Ask its owner to invite you.";
export const NO_HIVE_OR_START =
  "You're not in a hive yet. Ask its owner to invite you, or start one.";

/** The longest hive name and the longest name in a hive, as the database counts them. */
export const MAX_NAME = 60;

export type HiveEntry = {
  id: string;
  name: string;
  role: string;
  current: boolean;
};

export type CreateReason = "name" | "display-name" | "limit" | "failed";
export type Created = { ok: true } | { ok: false; reason: CreateReason };

const REFUSALS: Record<CreateReason, string> = {
  name: `A hive name is 1 to ${MAX_NAME} characters.`,
  "display-name": `Your name is 1 to ${MAX_NAME} characters.`,
  limit: "You already own 5 hives.",
  failed: FAILED,
};

/** The one line shown under the form when a new hive is refused. */
export function createFailure(reason: CreateReason): string {
  return REFUSALS[reason] ?? FAILED;
}

/** What the switcher's button is called: it names the hive on show. */
export const hiveButtonLabel = (name: string): string => `Hive: ${name}`;

/** Trims what the database trims: space, tab, newline, return, form feed, vertical tab. */
export function trimName(text: string): string {
  return text.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
}

const fits = (text: string): boolean => {
  const n = Array.from(trimName(text)).length;
  return n >= 1 && n <= MAX_NAME;
};

/** Which text is wrong, hive name first as the database checks them; null when both fit. */
export function checkNew(
  name: string,
  displayName: string,
): "name" | "display-name" | null {
  if (!fits(name)) return "name";
  if (!fits(displayName)) return "display-name";
  return null;
}

/**
 * The person's hives for the list. An account that carries no list (or an empty one) still has
 * the hive it shows: one entry, the current one.
 */
export function hiveList(account: {
  hive: string;
  role: string;
  hiveId?: string;
  hives?: HiveEntry[];
}): HiveEntry[] {
  const hives = Array.isArray(account.hives) ? account.hives : [];
  if (hives.length > 0) return hives;
  return [
    {
      id: account.hiveId ?? "",
      name: account.hive,
      role: account.role,
      current: true,
    },
  ];
}
