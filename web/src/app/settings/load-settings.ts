// What `/settings` reads, given a client signed in as the person. Row-level security decides
// what comes back: every member of the hive, and only the person's own workspaces and agents.
// Nothing here decides who may see a row. The answer for the browser is built from named values
// only, so a member's `user_id` and anything else the contract does not name never leave the
// server, and a row that is not what was promised refuses the whole answer.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Agent,
  AgentStatus,
  Member,
  SettingsData,
  Workspace,
} from "../../settings/types";

export type SettingsLoad =
  | { state: "ok"; data: SettingsData }
  | { state: "no-hive" }
  | { state: "error" };

type Db = Pick<SupabaseClient, "from" | "auth">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The columns `authenticated` may read. `token_hash` is not granted: naming it fails the query. */
const AGENT_COLUMNS =
  "id, member_id, workspace_id, name, provider, trust_tier, expires_at, revoked_at, last_used_at, created_at";
const MAX_AGENTS = 200;

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

const ERROR: SettingsLoad = { state: "error" };

/**
 * Everything `/settings` shows: the hive's name and members, and the person's own workspaces
 * and newest 200 agents, each with its status at `now`.
 */
export async function loadSettings(db: Db, now: number): Promise<SettingsLoad> {
  const hives = (await db
    .from("hives")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)) as Res;
  if (failed("hives query", hives)) return ERROR;
  const hive = Array.isArray(hives.data)
    ? (hives.data[0] as unknown)
    : undefined;
  if (hive === undefined) return { state: "no-hive" };
  if (!row(hive) || !str(hive.id) || !str(hive.name)) {
    console.error("hives answer has an unexpected shape");
    return ERROR;
  }

  const { data: session } = await db.auth.getUser();
  const userId = session.user?.id;
  if (!userId) {
    console.error("settings load has no session");
    return ERROR;
  }

  const [membersRes, workspacesRes, agentsRes] = (await Promise.all([
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
  ])) as [Res, Res, Res];
  // Each is checked, so every failure is logged, not only the first.
  const bad = [
    failed("members query", membersRes),
    failed("workspaces query", workspacesRes),
    failed("agents query", agentsRes),
  ];
  if (bad.some(Boolean)) return ERROR;

  const rows = all(membersRes.data, toMember);
  const workspaces = all(workspacesRes.data, toWorkspace);
  const everyAgent = all(agentsRes.data, toAgent(now));
  if (!rows || !workspaces || !everyAgent) {
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
    data: {
      hiveName: hive.name,
      isOwner: members.some((m) => m.isMe && m.role === "owner"),
      workspaces,
      agents,
      members,
    },
  };
}
