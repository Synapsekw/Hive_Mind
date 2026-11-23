// Shapes shared by the settings screen, its loader and its actions. The database decides who may
// create or revoke an agent and who may invite a member; these only carry what it returned. An
// agent's token is not part of any of them except `Created`, the one answer that shows it once.
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

export type Workspace = { id: string; name: string };
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

export type SettingsActions = {
  createAgent(input: NewAgent): Promise<Created>;
  revokeAgent(id: string): Promise<Result>;
  inviteMember(email: string, name: string): Promise<Invited>;
  revokeInvitation(id: string): Promise<Result>;
  resendInvitation(id: string): Promise<Sent>;
};
