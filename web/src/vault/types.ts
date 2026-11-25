import type { Kind } from "../topics/types";
// Shapes shared by the vault screen. The database decides who can read what; these only carry
// what it returned (`effective`, `effective_with`, `rule_folder`, `access`) and the person's choice.
export type Visibility = "private" | "group" | "members";
export type Choice = { visibility: Visibility | null; shared_with: string[] }; // null = no own setting
export type VaultNote = {
  id: string;
  workspace_id: string;
  member_id: string;
  path: string;
  title: string;
  updated_at: string;
  by_agent: boolean;
  visibility: Visibility | null;
  shared_with: string[];
  quarantined: boolean;
  effective: Visibility;
  effective_with: string[];
  rule_folder: string | null;
  access: "own" | "shared" | "link";
  topics: string[]; // ids of the attached topics, strongest first
};
/** A topic of the hive, as the vault lists it. */
export type VaultTopic = { id: string; kind: Kind; name: string };
export type FolderRule = {
  path: string;
  visibility: Visibility | null;
  shared_with: string[];
};
/** An accepted link of the open note: the note on its other side, as the database described it. */
export type NoteLink = {
  id: string;
  note_id: string;
  title: string;
  owner: string;
  mine: boolean; // the caller owns that other note
};
export type Tab = { kind: "workspace"; id: string } | { kind: "shared" };
export type VaultData = {
  hive: { id: string; name: string };
  me: string; // the caller's member id
  members: { id: string; display_name: string }[]; // everyone in the hive, including me
  workspaces: { id: string; name: string }[];
  tab: Tab;
  folders: FolderRule[]; // folder records of the open workspace; empty on the shared tab
  notes: VaultNote[];
  truncated: boolean;
  topics: VaultTopic[]; // the hive's topics, by kind order then name
  open:
    | null
    | { note: VaultNote; body: string; cut: boolean; links: NoteLink[] }
    | { missing: true };
};
/** What opening one note answers: the note, or that it could not be read. */
export type OpenAnswer = { ok: true; open: VaultData["open"] } | { ok: false };
export type SharePreview = {
  follows: number;
  own_setting: number;
  under_nested_rule: number;
  held: number;
};
export type Result = { ok: true } | { ok: false };
export type TopicChange =
  { ok: true } | { ok: false; reason: "full" | "failed" };
export type VaultActions = {
  saveNote(noteId: string, choice: Choice): Promise<Result>;
  saveFolder(
    workspaceId: string,
    path: string,
    choice: Choice,
  ): Promise<Result>;
  release(noteId: string): Promise<Result>;
  /** Removes the note for good. Only its owner, as a person, is allowed to. */
  deleteNote(noteId: string): Promise<Result>;
  /** Ends an accepted link. The database decides whether the caller may. */
  unlink(linkId: string): Promise<Result>;
  /** Takes a topic off a note. The database decides whether the caller may. */
  detachTopic(noteId: string, topicId: string): Promise<Result>;
  /** Puts a topic on a note: at most five. The database decides whether the caller may. */
  addTopic(noteId: string, topicId: string): Promise<TopicChange>;
  preview(workspaceId: string, path: string): Promise<SharePreview | null>;
  /** One note for the preview, read under the session; the list is not read again. */
  openNote(noteId: string): Promise<OpenAnswer>;
};
