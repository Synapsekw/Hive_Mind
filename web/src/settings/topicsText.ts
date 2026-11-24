// Every sentence of the owner's Topics section in Settings.
import type { Kind } from "../topics/types";

export const TITLE = "Topics";
export const NOTE =
  "Customers, vendors, subjects: what notes are about. Every member's notes are attached to these by their folder, tags, title and text.";
export const FIND = "Find topics in my notes";
export const FINDING = "Reading your notes";
export const FOUND = "Topics found in your notes";
export const FOUND_NOTE =
  "From notes that say what they are, folders with an index note, and tags on five or more notes. Tick the ones this hive should have.";
export const NOTHING_NEW =
  "Nothing new found. Every topic your notes name is already here.";
export const SCAN_FAILED = "Your notes could not be read. Try again.";
export const SAVE = "Save topics";
export const CANCEL = "Cancel";
export const SAVE_FAILED = "The topics could not be saved. Try again.";
export const NEXT = "Now open the vault and press Attach topics.";
export const EMPTY_TITLE = "No topics yet.";
export const EMPTY_TEXT =
  "Find them in your notes, and every note in the hive can be put under a customer or subject.";
export const DELETE = "Delete";
export const KEEP = "Keep";
export const DELETE_ASIDE = "Notes stay. They are no longer under this topic.";
export const FAILED = "That didn't work. Try again.";

export const KIND_NAMES: Record<Kind, string> = {
  client: "Customers",
  project: "Projects",
  vendor: "Vendors",
  product: "Products",
  person: "People",
  subject: "Subjects",
};

const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function topicNotes(n: number | null): string | null {
  if (n === null) return null;
  return n === 0 ? "No notes yet" : many(n, "note");
}

/** Beside a candidate that came from a tag: how widely the tag is used. */
export function candidateNotes(kind: Kind, notes: number): string | null {
  return kind === "subject" && notes >= 5
    ? `tag on ${many(notes, "note")}`
    : null;
}

export function saved(n: number): string {
  return n === 0
    ? "Those topics were already there."
    : `${many(n, "topic")} saved.`;
}

export const deleteQuestion = (name: string) => `Delete the topic ${name}?`;
export const deleted = (name: string) => `${name} deleted.`;
export const pickLabel = (kindName: string, name: string) =>
  `${kindName}: ${name}`;
