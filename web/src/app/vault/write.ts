// What the vault's server actions do, given a client signed in as the person. Each checks its
// arguments before any query, sends only the person's decision, and reports `{ ok }` alone: the
// database decides whether the change is allowed, and the screen re-reads what it now says.
// Only an error's code and message are logged.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Choice, Result, SharePreview } from "../../vault/types";
import { cleanChoice, cleanPath, isUuid, othersIn } from "./validate";

type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;
type Res = { data: unknown; error: { code?: string; message: string } | null };

const NO: Result = { ok: false };
const YES: Result = { ok: true };

function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

const changed = (res: Res) =>
  !res.error && Array.isArray(res.data) && res.data.length > 0;

async function userId(db: Db): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/** The ids the person may name: the members of their hive except themselves, read now. */
async function others(db: Db, uid: string): Promise<string[] | null> {
  const hives = (await db
    .from("hives")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)) as Res;
  if (failed("hives query", hives)) return null;
  const hive = Array.isArray(hives.data) ? hives.data[0] : undefined;
  if (!hive) return null;
  const members = (await db
    .from("members")
    .select("id, user_id")
    .eq("hive_id", (hive as { id: string }).id)) as Res;
  if (failed("members query", members) || !Array.isArray(members.data))
    return null;
  return othersIn(members.data as { id: string; user_id: string }[], uid);
}

/** Named members whose ids are at least uuids; the list itself is checked against the hive. */
function namedIds(raw: unknown): string[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { visibility?: unknown; shared_with?: unknown };
  if (r.visibility !== "members" || !Array.isArray(r.shared_with)) return null;
  return r.shared_with.length > 0 && r.shared_with.every(isUuid)
    ? r.shared_with
    : null;
}

/** True when the choice is well formed as far as it can be told without a query. */
function shapeOk(raw: unknown): boolean {
  return namedIds(raw) !== null || cleanChoice(raw, []) !== null;
}

/** The session, then the choice checked against the hive's members, read now. */
async function decision(db: Db, raw: unknown): Promise<Choice | null> {
  const uid = await userId(db);
  if (!uid) return null;
  // Only named members need the member list.
  const allowed = namedIds(raw) ? await others(db, uid) : [];
  if (!allowed) return null;
  return cleanChoice(raw, allowed);
}

export async function saveNoteIn(
  db: Db,
  noteId: unknown,
  raw: unknown,
): Promise<Result> {
  if (!isUuid(noteId) || !shapeOk(raw)) return NO;
  const choice = await decision(db, raw);
  if (!choice) return NO;
  const res = (await db
    .from("notes")
    .update({ visibility: choice.visibility, shared_with: choice.shared_with })
    .eq("id", noteId)
    .select("id")) as Res;
  if (failed("saveNote", res)) return NO;
  return changed(res) ? YES : NO;
}

export async function saveFolderIn(
  db: Db,
  workspaceId: unknown,
  rawPath: unknown,
  raw: unknown,
): Promise<Result> {
  if (!isUuid(workspaceId)) return NO;
  const path = cleanPath(rawPath);
  if (!path || !shapeOk(raw)) return NO;
  const choice = await decision(db, raw);
  if (!choice) return NO;
  // The folder row belongs to the workspace's owner; row-level security returns only the
  // caller's own workspaces.
  const ws = (await db
    .from("workspaces")
    .select("id, member_id")
    .eq("id", workspaceId)
    .limit(1)) as Res;
  if (failed("workspaces query", ws)) return NO;
  const owner = Array.isArray(ws.data)
    ? (ws.data[0] as { member_id?: unknown } | undefined)?.member_id
    : undefined;
  if (!isUuid(owner)) return NO;
  const res = (await db
    .from("folders")
    .upsert(
      {
        workspace_id: workspaceId,
        member_id: owner,
        path,
        visibility: choice.visibility,
        shared_with: choice.shared_with,
      },
      { onConflict: "workspace_id,path" },
    )
    .select("path")) as Res;
  if (failed("saveFolder", res)) return NO;
  return changed(res) ? YES : NO;
}

export async function releaseIn(db: Db, noteId: unknown): Promise<Result> {
  if (!isUuid(noteId)) return NO;
  if (!(await userId(db))) return NO;
  const res = (await db
    .from("notes")
    .update({ quarantined: false })
    .eq("id", noteId)
    .select("id")) as Res;
  if (failed("release", res)) return NO;
  return changed(res) ? YES : NO;
}

export async function previewIn(
  db: Db,
  workspaceId: unknown,
  rawPath: unknown,
): Promise<SharePreview | null> {
  if (!isUuid(workspaceId)) return null;
  const path = cleanPath(rawPath);
  if (!path) return null;
  if (!(await userId(db))) return null;
  const res = (await db.rpc("folder_share_preview", {
    p_workspace: workspaceId,
    p_path: path,
  })) as Res;
  if (failed("folder_share_preview", res)) return null;
  return toPreview(res.data);
}

const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

/** The four counts, or null when the answer is not what the database promises. */
export function toPreview(v: unknown): SharePreview | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const { follows, own_setting, under_nested_rule, held } = r;
  if (![follows, own_setting, under_nested_rule, held].every(count))
    return null;
  return {
    follows: follows as number,
    own_setting: own_setting as number,
    under_nested_rule: under_nested_rule as number,
    held: held as number,
  };
}
