// The hive switcher's words and its small rules: what the button and the form say, why a new
// hive was refused, and the same length check the database makes, so an obviously wrong name is
// refused before any request.

/** The rail's name when nobody is signed in (dev pages, the no-hive notice). */
export const BRAND = "Hive Mind";
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
  /** True while the hive is being deleted. */
  closing?: boolean;
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
  closing?: string | null;
}): HiveEntry[] {
  const hives = Array.isArray(account.hives) ? account.hives : [];
  if (hives.length > 0) return hives;
  return [
    {
      id: account.hiveId ?? "",
      name: account.hive,
      role: account.role,
      current: true,
      ...(account.closing ? { closing: true } : {}),
    },
  ];
}

// ---- A hive that is being deleted: the banner and the mark in the list ----

/** Beside the role of a hive that is being deleted, in the list. */
export const BEING_DELETED = "being deleted";
/** The banner's sentence, before and after the date. */
export const DELETED_ON = "This hive will be deleted on";
export const NOTHING_SAVED = "Nothing new can be saved.";
export const CANCEL_DELETION = "Cancel deletion";
export const KEEP_DELETING = "Keep deleting";

/** What the banner asks before it cancels. */
export const cancelQuestion = (hive: string): string =>
  `Cancel the deletion of ${hive}?`;

/** What a hive's line in the list says under its name. */
export const hiveMeta = (hive: { role: string; closing?: boolean }): string =>
  hive.closing ? `${hive.role}, ${BEING_DELETED}` : hive.role;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The day a timestamp names, in UTC and always in the same words ("1 December 2026"): what the
 * server draws, and the browser too until it has drawn once. Empty for a value that is no date.
 */
export function stableDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The same day as the person's own browser writes it, in their time zone. */
export function localDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return stableDate(iso);
  }
}
