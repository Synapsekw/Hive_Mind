// Shapes shared by the settings screen, its loader and its actions. The database decides who may
// create or revoke an agent and who may add a member; these only carry what it returned. An
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

export type SettingsData = {
  hiveName: string;
  isOwner: boolean;
  workspaces: Workspace[];
  agents: Agent[];
  members: Member[];
};

export type NewAgent = {
  name: string;
  workspaceId: string;
  provider: Provider;
  trustTier: TrustTier;
};

export type Result = { ok: boolean };
export type Created = { ok: true; token: string } | { ok: false };
export type AddReason = "no-account" | "already-member" | "failed";
export type Added = { ok: true } | { ok: false; reason: AddReason };

export type SettingsActions = {
  createAgent(input: NewAgent): Promise<Created>;
  revokeAgent(id: string): Promise<Result>;
  addMember(email: string, name: string): Promise<Added>;
};
