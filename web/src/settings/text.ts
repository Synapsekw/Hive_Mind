// The sentences and labels of the settings screen, and the order of its agents. Plain functions,
// so the screen and the tests read the same words.
import type { Agent, AgentStatus, InviteReason, TrustTier } from "./types";

const TIERS: Record<TrustTier, string> = {
  vendor: "Vendor-hosted",
  self_hosted: "Self-hosted, notes held for release",
};

const TIER_HELP: Record<TrustTier, string> = {
  vendor:
    "For Claude, ChatGPT and other agents run by their vendor. Notes are saved at once.",
  self_hosted:
    "For open-source or local agents. Its notes are held until you release them.",
};

const STATUSES: Record<AgentStatus, string | null> = {
  active: null,
  revoked: "Revoked",
  expired: "Expired",
};

const INVITE_FAILURES: Record<InviteReason, string> = {
  "already-member": "That person is already a member.",
  "already-invited": "That email is already invited.",
  failed: "That didn't work. Try again.",
};

export function tierText(t: TrustTier): string {
  return TIERS[t];
}

/** What choosing the tier means for the agent's notes. */
export function tierHelp(t: TrustTier): string {
  return TIER_HELP[t];
}

/** The mark beside an agent that no longer works; nothing for an active one. */
export function statusText(s: AgentStatus): string | null {
  return STATUSES[s];
}

/** Why inviting a member did not happen. */
export function inviteFailure(r: InviteReason): string {
  return INVITE_FAILURES[r];
}

/** What the owner passes on after an invitation is saved; `address` is where the person signs in. */
export function inviteNotice(
  name: string,
  email: string,
  address: string,
): string {
  return `Invitation saved. Ask ${name} to open ${address}, enter ${email} and choose Email me a link.`;
}

/** The line under the invite form. */
export const INVITE_HELP: string =
  "If they have an account they are added now. Otherwise they join when they first sign in with this email.";

/** Active agents first, then the rest; the newest first inside each group. A new array. */
export function sortAgents(agents: Agent[]): Agent[] {
  const group = (a: Agent) => (a.status === "active" ? 0 : 1);
  const time = (a: Agent) => new Date(a.createdAt).getTime();
  return [...agents].sort((a, b) => group(a) - group(b) || time(b) - time(a));
}

/** The line that goes into the `.env` file the agent's server reads. */
export function envLine(token: string): string {
  return `HIVE_AGENT_TOKEN=${token}`;
}

export const MCP_COMMAND: string =
  "claude mcp add --scope user hive -- node --env-file=<path to Hive_Mind>/.env <path to Hive_Mind>/mcp/dist/index.js";
