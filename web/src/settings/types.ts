// Shapes shared by the settings screen, its loader and its actions. The database decides who may
// create or revoke an agent and who may invite a member; these only carry what it returned. An
// agent's token is not part of any of them except `Created`, the one answer that shows it once.
import type {
  NoteHead,
  Proposal,
  ScanResult,
  TopicRow,
  TopicsSaved,
} from "../topics/types";

export type { NoteHead, Proposal, ScanResult, TopicRow, TopicsSaved };

export const PROVIDERS = [
  "Claude",
  "ChatGPT",
  "Claude Code",
  "Codex CLI",
  "Other",
] as const;
export type Provider = (typeof PROVIDERS)[number];
export type TrustTier = "vendor" | "self_hosted";
export type AgentStatus = "active" | "revoked" | "expired";

export type Agent = {
  id: string;
  name: string;
  /** Free text in the database; older agents may carry a value outside PROVIDERS. */
  provider: string;
  trustTier: TrustTier;
  workspaceId: string;
  /** ISO timestamps. */
  createdAt: string;
  lastUsedAt: string | null;
  status: AgentStatus;
};

/** A sync key: which workspace it keeps in a vault folder, and when it was last used. */
export type SyncKey = {
  id: string;
  workspaceId: string;
  /** ISO timestamps. */
  createdAt: string;
  lastUsedAt: string | null;
  status: "active" | "revoked";
};

/** One run of the Mac sync: counts only, never a note's text. `heldBack`: deletions refused. */
export type SyncRun = {
  id: string;
  keyId: string;
  startedAt: string;
  finishedAt: string | null;
  added: number;
  changed: number;
  moved: number;
  deleted: number;
  skipped: number;
  tooBig: number;
  tooBigPaths: string[];
  heldBack: number;
  error: string | null;
};

/** `notes`: how many notes it holds; null when that could not be read. */
export type Workspace = { id: string; name: string; notes: number | null };
export type Member = {
  id: string;
  name: string;
  role: "owner" | "member";
  isMe: boolean;
};

/** An invitation that is still open: not accepted, not revoked, not expired. */
export type Invitation = {
  id: string;
  email: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string;
};

export type SettingsData = {
  hiveName: string;
  isOwner: boolean;
  workspaces: Workspace[];
  agents: Agent[];
  members: Member[];
  /** Only the owner can read these; empty for everyone else. */
  invitations: Invitation[];
  /** The hive's topics, for its owner; empty for everyone else. */
  topics: TopicRow[];
  /** The person's own sync keys, newest first, and the newest runs of those keys. */
  syncKeys: SyncKey[];
  syncRuns: SyncRun[];
};

export type NewAgent = {
  name: string;
  workspaceId: string;
  provider: Provider;
  trustTier: TrustTier;
};

export type Result = { ok: boolean };
export type Created = { ok: true; token: string } | { ok: false };
export type InviteReason =
  "already-member" | "already-invited" | "too-many" | "failed";
/**
 * Inviting never makes anyone a member: the person joins by pressing Join. `id` is the saved
 * invitation; `sent` is false when it was saved but its email could not be sent.
 */
export type Invited =
  { ok: true; id: string; sent: boolean } | { ok: false; reason: InviteReason };
/**
 * Sending an invitation's email again. `wait`: one went out under two minutes ago. `limit`:
 * this invitation has had all the emails it may have.
 */
export type Sent =
  { ok: true } | { ok: false; reason: "wait" | "limit" | "failed" };

/** What deleting the hive would erase: how many members, notes and files it holds. */
export type Deletion = { members: number; notes: number; files: number };
/** `name`: what was typed is not the hive's name. */
export type Requested = { ok: true } | { ok: false; reason: "name" | "failed" };

/**
 * Deleting a workspace. `last`: it is the person's only one. `agents`: an agent of it is still
 * in use. `files`: it still holds files.
 */
export type WorkspaceDeleted =
  { ok: true } | { ok: false; reason: "last" | "agents" | "files" | "failed" };

export type SettingsActions = {
  createAgent(input: NewAgent): Promise<Created>;
  revokeAgent(id: string): Promise<Result>;
  /** Makes a sync key for one of the person's workspaces; `token` is shown once. */
  createSyncKey(workspaceId: string): Promise<Created>;
  revokeSyncKey(keyId: string): Promise<Result>;
  inviteMember(email: string, name: string): Promise<Invited>;
  revokeInvitation(id: string): Promise<Result>;
  resendInvitation(id: string): Promise<Sent>;
  /** Marks this hive for deletion; `typedName` is what the person typed as its name. */
  requestHiveDeletion(typedName: string): Promise<Requested>;
  /** Takes this hive's deletion back. */
  cancelHiveDeletion(): Promise<Result>;
  /** Deletes one of the person's own workspaces, with every note in it. */
  deleteWorkspace(id: string): Promise<WorkspaceDeleted>;
  /** One page of the heads of the person's own notes in a workspace of theirs. */
  scanTopics(workspaceId: string, after: string | null): Promise<ScanResult>;
  /** Saves up to 200 picked candidates as topics of this hive. */
  saveTopics(picks: Proposal[]): Promise<TopicsSaved>;
  deleteTopic(id: string): Promise<Result>;
};
