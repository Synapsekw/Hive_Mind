// The sentences and labels of the settings screen, and the order of its agents. Plain functions,
// so the screen and the tests read the same words.
import { shortDate } from "../vault/format";
import type {
  Agent,
  AgentStatus,
  Deletion,
  Invitation,
  InviteReason,
  Requested,
  Sent,
  TrustTier,
  Workspace,
  WorkspaceDeleted,
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

/** What a refused or failed action says when there is nothing more particular to say. */
export const FAILED: string = "That didn't work. Try again.";

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

// ---- People ----

/** The invite dialog's heading and name, and the button that opens it. */
export const INVITE_TITLE: string = "Invite someone";
/** The mark beside an invitation's name in the People list. */
export const INVITED: string = "Invited";
/** The items of an invitation's ⋯ menu. */
export const SEND_AGAIN: string = "Send again";
export const REVOKE_INVITATION: string = "Revoke invitation";

/** An invitation's one grey line, in parts: the email, when it was sent, when it expires. */
export function invitationLine(i: Invitation, now: number): string[] {
  return [
    i.email,
    `Invited ${shortDate(i.createdAt, now)}`,
    `Expires ${shortDate(i.expiresAt, now)}`,
  ];
}

/** Active agents first, then the rest; the newest first inside each group. A new array. */
export function sortAgents(agents: Agent[]): Agent[] {
  const group = (a: Agent) => (a.status === "active" ? 0 : 1);
  const time = (a: Agent) => new Date(a.createdAt).getTime();
  return [...agents].sort((a, b) => group(a) - group(b) || time(b) - time(a));
}

// ---- Agents ----

/** The connect dialog's heading and name. */
export const CONNECT_TITLE: string = "Connect an agent";
/** The item in an active agent's ⋯ menu that opens the revoke question. */
export const REVOKE_ITEM: string = "Revoke…";
/** The longest name an agent or an invitation may carry. */
export const NAME_MAX = 60;

/** The fold that holds the agents that no longer work. */
export function foldedAgents(n: number): string {
  return `${n} revoked or expired agent${n === 1 ? "" : "s"}`;
}

/** An agent's one grey line, in parts: provider, tier, workspace (when known), last used. */
export function agentLine(
  a: Agent,
  workspace: string | null,
  now: number,
): string[] {
  const used = a.lastUsedAt
    ? `Last used ${shortDate(a.lastUsedAt, now)}`
    : "Never used";
  return [
    a.provider,
    tierText(a.trustTier),
    ...(workspace ? [workspace] : []),
    used,
  ];
}

/** The line that goes into the `.env` file the agent's server reads. */
export function envLine(token: string): string {
  return `HIVE_AGENT_TOKEN=${token}`;
}

export const MCP_COMMAND: string =
  "claude mcp add --scope user hive -- node --env-file=<path to Hive_Mind>/.env <path to Hive_Mind>/mcp/dist/index.js";

// ---- Workspaces ----

export const WORKSPACES_TITLE: string = "Workspaces";
export const WORKSPACES_NOTE: string =
  "Where your notes live. Deleting a workspace erases its notes here for good; files on your computer are not touched.";
export const DELETE_WORKSPACE: string = "Delete";
export const DELETE_WORKSPACE_ITEM: string = "Delete workspace…";
export const KEEP_WORKSPACE: string = "Keep";
export const WORKSPACE_ASIDE: string = "This cannot be undone.";
/** Under the only workspace a person has, in place of Delete. */
export const ONLY_WORKSPACE: string = "Your only workspace";

/** How many notes a workspace holds; nothing when that is not known. */
export function workspaceNotes(w: Workspace): string | null {
  if (w.notes === null) return null;
  return w.notes === 0 ? "No notes" : many(w.notes, "note");
}

/** The question before a workspace is deleted. */
export function workspaceQuestion(w: Workspace): string {
  if (w.notes === null || w.notes === 0) return `Delete ${w.name}?`;
  return `Delete ${w.name} and its ${many(w.notes, "note")}?`;
}

/** What is announced once a workspace is gone. */
export function workspaceDeleted(name: string): string {
  return `${name} deleted.`;
}

const WORKSPACE_FAILURES: Record<
  (WorkspaceDeleted & { ok: false })["reason"],
  string
> = {
  last: "You need at least one workspace.",
  agents: "Revoke this workspace's agents first.",
  files: "Delete this workspace's files in the Gallery first.",
  failed: "That didn't work. Try again.",
};

/** A workspace with a live sync key cannot go: its sync agent is hidden from the Agents tab. */
export const WORKSPACE_SYNC_KEY: string =
  "Revoke this workspace's sync key first (Settings → Sync).";

/** Why the workspace was not deleted; `syncKey`: it has a live sync key, which is what blocks. */
export function workspaceFailure(
  r: (WorkspaceDeleted & { ok: false })["reason"],
  syncKey = false,
): string {
  if (r === "agents" && syncKey) return WORKSPACE_SYNC_KEY;
  return WORKSPACE_FAILURES[r] ?? WORKSPACE_FAILURES.failed;
}

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
/** The button in the Hive tab's danger box that opens the delete dialog. */
export const DELETE_HIVE_ITEM: string = "Delete hive…";
/** The delete dialog's way out. */
export const KEEP_HIVE: string = "Keep the hive";

function many(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

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

// ---- Sync ----

export const SYNC_TITLE: string = "Sync";
export const SYNC_INTRO: string =
  "Keep one workspace equal to a vault folder on your Mac. The folder is the source: notes from it are read-only here.";
export const SYNC_MAKE: string = "Make a sync key";
export const SYNC_REVOKE: string = "Revoke sync key";
export const SYNC_NONE: string = "No sync key";
export const SYNC_LAST_USED: string = "Last used";
export const SYNC_NEVER: string = "Not used yet";
export const SYNC_RUNS: string = "Recent runs";
export const SYNC_TOO_BIG: string =
  "Too big to sync (over 50 MB, or a note over 1 MB)";
export const SYNC_NEW_KEY_REVOKES: string =
  "Making a key revokes this workspace's current one. The Mac then needs the new key.";
export const SYNC_KEY_TITLE: string = "Your sync key";
export const SYNC_KEY_STEP: string =
  "Run this in the Hive Mind folder on your Mac, then paste the key when asked:";
export const SYNC_KEY_WARNING: string =
  "This key is shown once. Copy it now; it cannot be shown again.";
export const SYNC_NO_RUNS: string = "No runs yet.";
export const SYNC_MADE_SAID: string = "Sync key made.";
export const SYNC_REVOKED_SAID: string = "Sync key revoked.";
export const SYNC_KEY_LABEL: string = "Key";
export const SYNC_KEY_COPIED: string = "Key copied.";
export const SYNC_KEYS_LIST: string = "Sync keys";

/** A sync row's ⋯ button. */
export function syncActionsLabel(workspace: string): string {
  return `Actions for ${workspace}`;
}

/** The name of a sync row's question group, e.g. "Make a sync key for Main". */
export function syncAskLabel(kind: "make" | "revoke", workspace: string) {
  return `${kind === "make" ? SYNC_MAKE : SYNC_REVOKE} for ${workspace}`;
}

/** The question before a live key is revoked. */
export function syncRevokeQuestion(workspace: string): string {
  return `${SYNC_REVOKE} for ${workspace}?`;
}
export const SYNC_KEY_BY_HAND: string = "Select the key and copy it by hand.";
export const SYNC_URL_PLACEHOLDER: string = "<project address>";
export const SYNC_PUBLISHABLE_PLACEHOLDER: string = "<publishable key>";
export const SYNC_MAKE_CONFIRM: string = "Make key";
export const SYNC_KEEP: string = "Keep";
export const SYNC_REVOKE_CONFIRM: string = "Revoke";
export const SYNC_REVOKE_ASIDE: string = "The Mac then needs a new key.";

/** The command that sets the Mac up. The key itself is typed at its prompt, never here. */
export function setupCommand(url: string, publishableKey: string): string {
  return `node sync/src/cli.ts setup --url ${url} --publishable-key ${publishableKey} --folder "<your vault folder>"`;
}

/** What one run did, in counts only. */
export function runSummary(r: {
  added: number;
  changed: number;
  moved: number;
  deleted: number;
  tooBig: number;
  heldBack: number;
  error: string | null;
}): string {
  const parts = [
    r.added && `${r.added} added`,
    r.changed && `${r.changed} changed`,
    r.moved && `${r.moved} moved`,
    r.deleted && `${r.deleted} deleted`,
    r.tooBig && `${r.tooBig} too big`,
  ].filter(Boolean) as string[];
  const head = parts.length ? parts.join(" · ") : "No changes";
  const held = r.heldBack ? ` · ${r.heldBack} deletions held back` : "";
  const err = r.error ? ` · stopped: ${r.error}` : "";
  return `${head}${held}${err}`;
}

/** "23 Nov, 11:00" in UTC, as every date on this screen. */
export function runWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${shortDate(iso, Date.UTC(d.getUTCFullYear(), 0, 1))}, ${hh}:${mm}`;
}

/** How long a run took: "5 s", "2 min 5 s"; null while unfinished or unreadable. */
export function runLength(start: string, end: string | null): string | null {
  if (end === null) return null;
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  return sec < 60
    ? `${sec} s`
    : `${Math.floor(sec / 60)} min ${String(sec % 60)} s`;
}
