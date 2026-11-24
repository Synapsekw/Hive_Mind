// What `/settings` reads, given a client signed in as the person. Row-level security decides
// what comes back: every member of the hive, only the person's own workspaces and agents, and
// the hive's open invitations for its owner alone (nobody else gets a row).
// Nothing here decides who may see a row. The answer for the browser is built from named values
// only, so a member's `user_id` and anything else the contract does not name never leave the
// server, and a row that is not what was promised refuses the whole answer.
//
// Beside the lists, for a person whose own membership says "owner", it asks the database what
// deleting the hive would erase (`hive_deletion_preview`), in the same parallel batch. The role
// only decides whether to ask: the database refuses anyone who is not an owner, and a refusal
// or a failure there leaves the counts out and never fails the page.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownHive } from "../own-hive";
import type {
  Agent,
  AgentStatus,
  Deletion,
  Invitation,
  Member,
  SettingsData,
  Workspace,
} from "../../settings/types";

export type SettingsLoad =
  | {
      state: "ok";
      hiveId: string;
      data: SettingsData;
      /** What deleting the hive would erase; null for anyone but an owner, or when unread. */
      deletion: Deletion | null;
      /** When the hive will be erased, while it is being deleted; null otherwise. */
      closing: string | null;
    }
  | { state: "no-hive" }
  | { state: "error" };

type Db = Pick<SupabaseClient, "from" | "auth" | "rpc">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The columns `authenticated` may read. `token_hash` is not granted: naming it fails the query. */
const AGENT_COLUMNS =
  "id, member_id, workspace_id, name, provider, trust_tier, expires_at, revoked_at, last_used_at, created_at";
const MAX_AGENTS = 200;
const MAX_INVITATIONS = 100;

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

const str = (v: unknown): v is string => typeof v === "string";
const row = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** The time a date string names, or null when it is not a date. */
const time = (v: unknown): number | null => {
  if (!str(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
/** Not set, or a date. */
const dateOrNull = (v: unknown): v is string | null =>
  v === null || time(v) !== null;

/**
 * Revoked when `revoked_at` is set, else expired when `expires_at` is not after `now`, else
 * active. A value that is not a date counts as not set.
 */
export function agentStatus(
  revokedAt: unknown,
  expiresAt: unknown,
  now: number,
): AgentStatus {
  if (time(revokedAt) !== null) return "revoked";
  const expires = time(expiresAt);
  if (expires !== null && expires <= now) return "expired";
  return "active";
}

type MemberRow = Omit<Member, "isMe"> & { userId: string };

function toMember(v: unknown): MemberRow | null {
  if (!row(v)) return null;
  const { id, display_name, role, user_id } = v;
  if (!str(id) || !str(display_name) || !str(user_id)) return null;
  if (role !== "owner" && role !== "member") return null;
  return { id, name: display_name, role, userId: user_id };
}

function toWorkspace(v: unknown): Workspace | null {
  if (!row(v)) return null;
  const { id, name } = v;
  if (!str(id) || !str(name)) return null;
  return { id, name };
}

function toInvitation(v: unknown): Invitation | null {
  if (!row(v)) return null;
  const { id, email, display_name, created_at, expires_at } = v;
  if (!str(id) || !str(email) || !str(display_name)) return null;
  // The screen shows both as dates.
  if (!str(created_at) || time(created_at) === null) return null;
  if (!str(expires_at) || time(expires_at) === null) return null;
  return {
    id,
    email,
    name: display_name,
    createdAt: created_at,
    expiresAt: expires_at,
  };
}

const toAgent =
  (now: number) =>
  (v: unknown): Agent | null => {
    if (!row(v)) return null;
    const { id, name, provider, trust_tier, workspace_id, created_at } = v;
    const { last_used_at, revoked_at, expires_at } = v;
    if (!str(id) || !str(name) || !str(provider) || !str(workspace_id))
      return null;
    if (trust_tier !== "vendor" && trust_tier !== "self_hosted") return null;
    if (!str(created_at)) return null;
    if (last_used_at !== null && !str(last_used_at)) return null;
    // A status worked out from a date that cannot be read would be a guess.
    if (!dateOrNull(revoked_at) || !dateOrNull(expires_at)) return null;
    return {
      id,
      name,
      provider,
      trustTier: trust_tier,
      workspaceId: workspace_id,
      createdAt: created_at,
      lastUsedAt: last_used_at,
      status: agentStatus(revoked_at, expires_at, now),
    };
  };

/** Every item of the list, or null when one of them is not what was promised. */
function all<T>(list: unknown, one: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(list)) return null;
  const out: T[] = [];
  for (const v of list) {
    const item = one(v);
    if (!item) return null;
    out.push(item);
  }
  return out;
}

const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * How many members, notes and files the hive holds, as the database answers its owner. Null
 * when it refuses, fails or answers something else; that is logged and nothing is thrown.
 */
async function preview(db: Db, hiveId: string): Promise<Deletion | null> {
  try {
    const res = (await db.rpc("hive_deletion_preview", {
      p_hive: hiveId,
    })) as Res;
    if (failed("hive deletion preview", res)) return null;
    // A function that returns a table answers a list of rows; this one has one row.
    const one: unknown = Array.isArray(res.data) ? res.data[0] : res.data;
    if (row(one)) {
      const { members, notes, files } = one;
      if (count(members) && count(notes) && count(files))
        return { members, notes, files };
    }
    console.error("hive deletion preview answer has an unexpected shape");
    return null;
  } catch (e) {
    console.error(
      "hive deletion preview failed",
      e instanceof Error ? e.name : "",
    );
    return null;
  }
}

const ERROR: SettingsLoad = { state: "error" };

/**
 * Everything `/settings` shows: the hive's name and members, the person's own workspaces and
 * newest 200 agents, each with its status at `now`, and the newest 100 invitations still open at
 * `now`. For an owner, also what deleting the hive would erase; and when the hive goes, if it
 * is being deleted.
 */
export async function loadSettings(db: Db, now: number): Promise<SettingsLoad> {
  // The same one read as before, with the person's role in the hive beside it.
  const hive = await ownHive(db, undefined, { profile: true });
  if (hive === "error") return ERROR;
  if (hive === null) return { state: "no-hive" };

  const { data: session } = await db.auth.getUser();
  const userId = session.user?.id;
  if (!userId) {
    console.error("settings load has no session");
    return ERROR;
  }

  const [membersRes, workspacesRes, agentsRes, invitationsRes, deletion] =
    (await Promise.all([
      db
        .from("members")
        .select("id, display_name, role, user_id")
        .eq("hive_id", hive.id)
        .order("created_at", { ascending: true }),
      db
        .from("workspaces")
        .select("id, name")
        .eq("hive_id", hive.id)
        .order("created_at", { ascending: true }),
      db
        .from("agents")
        .select(AGENT_COLUMNS)
        // Agents still in use first, so the cap can only ever cut off old revoked ones.
        .order("revoked_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(MAX_AGENTS),
      db
        .from("invitations")
        .select("id, email, display_name, created_at, expires_at")
        .eq("hive_id", hive.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date(now).toISOString())
        .order("created_at", { ascending: false })
        .limit(MAX_INVITATIONS),
      hive.role === "owner" ? preview(db, hive.id) : null,
    ])) as [Res, Res, Res, Res, Deletion | null];
  // Each is checked, so every failure is logged, not only the first.
  const bad = [
    failed("members query", membersRes),
    failed("workspaces query", workspacesRes),
    failed("agents query", agentsRes),
    failed("invitations query", invitationsRes),
  ];
  if (bad.some(Boolean)) return ERROR;

  const rows = all(membersRes.data, toMember);
  const workspaces = all(workspacesRes.data, toWorkspace);
  const everyAgent = all(agentsRes.data, toAgent(now));
  const invitations = all(invitationsRes.data, toInvitation);
  if (!rows || !workspaces || !everyAgent || !invitations) {
    console.error("settings answer has an unexpected shape");
    return ERROR;
  }
  // Only this hive's: an agent of the person's in another hive belongs to that hive's settings.
  const here = new Set(workspaces.map((w) => w.id));
  const agents = everyAgent.filter((a) => here.has(a.workspaceId));

  const members: Member[] = rows.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role,
    isMe: m.userId === userId,
  }));
  return {
    state: "ok",
    // Beside the data, not in it: the page binds invitations to this hive on the server.
    hiveId: hive.id,
    deletion,
    closing: hive.deleteAfter,
    data: {
      hiveName: hive.name,
      isOwner: members.some((m) => m.isMe && m.role === "owner"),
      workspaces,
      agents,
      members,
      invitations,
    },
  };
}
