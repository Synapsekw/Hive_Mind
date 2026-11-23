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
};
export type FolderRule = {
  path: string;
  visibility: Visibility | null;
  shared_with: string[];
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
  open:
    null | { note: VaultNote; body: string; cut: boolean } | { missing: true };
};
export type SharePreview = {
  follows: number;
  own_setting: number;
  under_nested_rule: number;
  held: number;
};
export type Result = { ok: true } | { ok: false };
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
  preview(workspaceId: string, path: string): Promise<SharePreview | null>;
};
