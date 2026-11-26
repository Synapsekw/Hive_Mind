// The sentences that tell a person what a sharing choice will change. Copy is fixed; the numbers
// come from the database's preview and the names from the member list.
import type { Mark } from "./marks";
import type { Choice, SharePreview } from "./types";

/** "Ahmed", "Ahmed and Sara", "Ahmed, Sara and Lina". */
export function people(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const ONLY_MEMBER = "You are the only member so far.";

export function noteSentence(a: {
  choice: Choice;
  hive: string;
  hiveSize: number;
  names: string[];
  folderRule: Mark | null;
}): string {
  const { choice } = a;
  if (choice.visibility === null) {
    return `This note will follow its folder: ${a.folderRule?.label ?? "Private"}.`;
  }
  if (choice.visibility === "group") {
    return a.hiveSize <= 1
      ? `Everyone in ${a.hive} will be able to read this note. ${ONLY_MEMBER}`
      : `Everyone in ${a.hive} (${a.hiveSize} people) will be able to read this note.`;
  }
  if (choice.visibility === "members" && a.names.length > 0) {
    return `${people(a.names)} will be able to read this note.`;
  }
  return "Only you will be able to read this note, and anyone whose link to it you accepted.";
}

function tails(p: SharePreview): string {
  let s = "";
  if (p.own_setting === 1) {
    s += " 1 note with its own setting is not affected.";
  } else if (p.own_setting > 1) {
    s += ` ${p.own_setting} notes with their own setting are not affected.`;
  }
  if (p.under_nested_rule === 1) {
    s += " 1 note in a folder with its own rule is not affected.";
  } else if (p.under_nested_rule > 1) {
    s += ` ${p.under_nested_rule} notes in folders with their own rule are not affected.`;
  }
  if (p.held === 1) {
    s += " 1 held note stays hidden until you release it.";
  } else if (p.held > 1) {
    s += ` ${p.held} held notes stay hidden until you release them.`;
  }
  return s;
}

export function folderSentence(a: {
  folder: string;
  choice: Choice;
  hive: string;
  hiveSize: number;
  names: string[];
  preview: SharePreview;
}): string {
  const { folder, preview: p } = a;
  const noun = p.follows === 1 ? "note" : "notes";
  const readers = (subject: string) =>
    `${subject} will be able to read the ${p.follows} ${noun} in ${folder}, and any note added there later, including by your agent.`;
  switch (a.choice.visibility) {
    case null:
      return p.follows === 1
        ? `${folder} will have no rule of its own. Its 1 note follows the folder above, or your default setting.`
        : `${folder} will have no rule of its own. Its ${p.follows} notes follow the folder above, or your default setting.`;
    case "private":
      return `The ${p.follows} ${noun} in ${folder} will be readable only by you, and so will any note added there later. A note linked with a colleague's note stays readable to that colleague.${tails(p)}`;
    case "members":
      return `${readers(people(a.names))}${tails(p)}`;
    case "group":
      return a.hiveSize <= 1
        ? `${readers(`Everyone in ${a.hive}`)} ${ONLY_MEMBER}${tails(p)}`
        : `${readers(`Everyone in ${a.hive} (${a.hiveSize} people)`)}${tails(p)}`;
  }
}

export function releaseSentence(mark: Mark): string {
  return `This note was written by a self-hosted agent. Releasing it makes it follow its sharing setting: ${mark.label}.`;
}

// The summary shown when no note is open.
export const STAT_LABELS = {
  notes: ["note", "notes"],
  folders: ["folder", "folders"],
  topics: ["topic", "topics"],
  today: ["changed today", "changed today"],
} as const;
export const RECENTLY_CHANGED = "Recently changed";
export const NEWEST = "Newest";
export const REVIEW = "Review";
export const SHARED_HEADING = "Shared with me";

export const heldSentence = (n: number) =>
  n === 1
    ? "1 note is held. Your agents wrote it; nobody else sees it until you release it."
    : `${n} notes are held. Your agents wrote them; nobody else sees them until you release them.`;

export const sharedLine = (notes: number, people: number) =>
  `${notes} ${notes === 1 ? "note" : "notes"} from ${people} ${people === 1 ? "colleague" : "colleagues"}`;

// The left column and a folder's sharing control.
export const HELD_ROW = "Held, waiting for you";
export const FOLDER_SHARING = "Folder sharing";
export const NO_FOLDER_RULE = "none";
export const NONE_OPTION = "None (each note decides)";
export const folderSharing = (text: string) => `${FOLDER_SHARING}: ${text}`;

// The open note: who it is from, on its meta line.
export const WRITTEN_BY_YOU = "written by you";
export const WRITTEN_BY_AGENT = "written by your agent";
export const FROM_VAULT = "from your vault on your Mac · edit it in your vault";
export const sharedBy = (owner: string) => `shared by ${owner}`;
export const OPENED_BY_LINK = "opened by a link";

// The open note's menu, and what Copy link says.
export const MORE_ACTIONS = "More actions for this note";
export const COPY_LINK = "Copy link";
export const DELETE_ITEM = "Delete note…";
export const LINK_COPIED = "Link copied.";
export const LINK_NOT_COPIED = "The link could not be copied.";

// Deleting a note: the question before it, and what is said after.
export const DELETE_QUESTION =
  "Delete this note? It is gone for good, with its history and its links. Files attached to it stay in the gallery.";
export const DELETED = "Note deleted.";
export const DELETE_FAILED = "That didn't work. Try again.";

// Opening a note: said while it is on its way (to screen readers only; the note shown fades),
// and when it could not be opened (the note shown stays).
export const OPENING = "Opening the note.";
export const OPEN_FAILED = "Couldn't open that note. Try again.";

// Linked notes: the list on the open note, the question before a link is ended, and what is
// said when ending it did not work.
export const LINKED_WITH = "Linked with";
export const YOU = "You";
export const UNLINK = "Unlink";
export const UNLINK_GROUP = "Unlink these notes";
export const UNLINK_FAILED = "That didn't work. Try again.";

/** `own`: both notes are the person's. Else `owner` is the colleague on the other side. */
export function unlinkQuestion(a: { own: boolean; owner: string }): string {
  return a.own
    ? "Unlink these two notes of yours?"
    : `Unlink these notes? You and ${a.owner} will no longer read each other's note through this link. The two notes cannot be linked again.`;
}

/** What the two answers are called, by the other note's title. */
export const unlinkName = (title: string) => `Unlink ${title}`;
export const keepLinkName = (title: string) => `Keep the link with ${title}`;
