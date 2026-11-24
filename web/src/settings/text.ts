// The sentences and labels of the settings screen, and the order of its agents. Plain functions,
// so the screen and the tests read the same words.
import type {
  Agent,
  AgentStatus,
  Deletion,
  InviteReason,
  Requested,
  Sent,
  TrustTier,
} from "./types";

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
  "too-many": "Too many invitations today. Try again tomorrow.",
  failed: "That didn't work. Try again.",
};

const SEND_FAILURES: Record<(Sent & { ok: false })["reason"], string> = {
  wait: "Sent a moment ago. Wait two minutes and try again.",
  limit:
    "This address has had as many invitation emails as allowed. Try again tomorrow.",
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

/** Why sending an invitation's email again did not happen. */
export function sendFailure(r: (Sent & { ok: false })["reason"]): string {
  return SEND_FAILURES[r];
}

/** What the owner reads after an invitation is saved: whether its email went out. */
export function inviteNotice(email: string, sent: boolean): string {
  return sent
    ? `Invitation sent to ${email}.`
    : "Invitation saved, but the email could not be sent. Wait two minutes, then use Send again.";
}

/** What is announced when an invitation's email went out again. */
export function sentAgain(name: string): string {
  return `Invitation for ${name} sent again.`;
}

/** The line under the invite form. */
export const INVITE_HELP: string =
  "They get an email with a link to the invitation and become a member when they press Join.";

/** The line under the heading of the open invitations. */
export const INVITATIONS_NOTE: string =
  "Not members yet. Each has an email with a link and joins by pressing Join.";

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

// ---- Delete this hive (owners only) ----

export const DELETE_TITLE: string = "Delete this hive";
export const DELETE_HIVE: string = "Delete hive";
export const DELETE_FIELD: string = "Type the hive's name to confirm";
/** What happens after Delete hive, said before it is pressed. */
export const DELETE_HELP: string =
  "For 7 days the hive can only be read, and you can cancel. Then it is erased for good.";
/** In place of the counts when they could not be read. */
export const DELETE_UNCOUNTED: string =
  "Deleting this hive erases every member's notes and files.";
/** The section's sentence while the hive is being deleted, before and after the date. */
export const DELETED_ON: string = "This hive will be deleted on";
export const CLOSING_HELP: string =
  "Until then it can only be read. Cancelling brings it back as it was.";
export const CANCEL_DELETION: string = "Cancel deletion";

const many = (n: number, one: string): string =>
  `${n} ${n === 1 ? one : `${one}s`}`;

/** What deleting the hive erases, in one sentence. */
export function deletionCounts(d: Deletion): string {
  return `Deleting this hive erases ${many(d.notes, "note")} and ${many(d.files, "file")} of ${many(d.members, "member")}.`;
}

/** Why Delete hive cannot be pressed yet. */
export function deleteHint(hiveName: string): string {
  return `Delete hive can be pressed once you have typed "${hiveName}" exactly.`;
}

const DELETE_FAILURES: Record<(Requested & { ok: false })["reason"], string> = {
  name: "That is not this hive's name.",
  failed: "That didn't work. Try again.",
};

/** Why the hive was not marked for deletion. */
export function deleteFailure(
  r: (Requested & { ok: false })["reason"],
): string {
  return DELETE_FAILURES[r] ?? DELETE_FAILURES.failed;
}
