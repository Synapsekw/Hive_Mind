// What `/inbox` reads, and the count the rail shows on every page, given a client signed in as
// the person. The database's `inbox` and `inbox_count` functions decide what is in the answer;
// nothing here decides who may see a note. `toData` builds what the browser gets from named
// values only, and refuses the whole answer when any part of it is not what was promised.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HeldItem, InboxData, LinkItem, Tier } from "../../inbox/types";
import { ownHive } from "../own-hive";

export type InboxLoad =
  { state: "ok"; data: InboxData } | { state: "no-hive" } | { state: "error" };

type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

const str = (v: unknown): v is string => typeof v === "string";
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;
const row = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const tier = (v: unknown): v is Tier =>
  v === 1 || v === 2 || v === 3 || v === 4;

function toLink(v: unknown): LinkItem | null {
  if (!row(v)) return null;
  const { id, created_at, proposed_by, they_accepted, mine, theirs } = v;
  if (!str(id) || !tier(v.tier) || !str(created_at)) return null;
  if (proposed_by !== "mine" && proposed_by !== "theirs") return null;
  if (typeof they_accepted !== "boolean") return null;
  if (!row(mine) || !row(theirs)) return null;
  if (
    !str(mine.id) ||
    !str(mine.title) ||
    !str(mine.path) ||
    !str(mine.workspace_id)
  )
    return null;
  if (!str(theirs.member_name) || !str(theirs.topic)) return null;
  if (theirs.title !== null && !str(theirs.title)) return null;
  return {
    id,
    tier: v.tier,
    createdAt: created_at,
    proposedBy: proposed_by,
    theyAccepted: they_accepted,
    mine: {
      id: mine.id,
      title: mine.title,
      path: mine.path,
      workspaceId: mine.workspace_id,
    },
    theirs: {
      memberName: theirs.member_name,
      topic: theirs.topic,
      title: theirs.title,
    },
  };
}

function toHeld(v: unknown): HeldItem | null {
  if (!row(v)) return null;
  const { id, title, path, workspace_id, agent_name, updated_at } = v;
  if (!str(id) || !str(title) || !str(path) || !str(workspace_id)) return null;
  if (agent_name !== null && !str(agent_name)) return null;
  if (!str(updated_at)) return null;
  return {
    id,
    title,
    path,
    workspaceId: workspace_id,
    agentName: agent_name,
    updatedAt: updated_at,
  };
}

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

/** The answer of `inbox`, or null when its shape is wrong. A bad row is never dropped quietly. */
export function toData(raw: unknown): InboxData | null {
  if (!row(raw)) return null;
  const links = all(raw.links, toLink);
  const held = all(raw.held, toHeld);
  if (!links || !held) return null;
  if (!count(raw.links_total) || !count(raw.held_total)) return null;
  return {
    links,
    linksTotal: raw.links_total,
    held,
    heldTotal: raw.held_total,
  };
}

/** Everything `/inbox` shows: the newest 100 proposals and 100 held notes, with totals. */
export async function loadInbox(db: Db): Promise<InboxLoad> {
  const hive = await ownHive(db);
  if (hive === "error") return { state: "error" };
  if (hive === null) return { state: "no-hive" };
  const res = (await db.rpc("inbox", { p_hive: hive.id })) as Res;
  if (failed("inbox", res)) return { state: "error" };
  const data = toData(res.data);
  if (!data) {
    console.error("inbox answer has an unexpected shape");
    return { state: "error" };
  }
  return { state: "ok", data };
}

// A database that has not had the inbox migration applied has no `inbox_count`. Every page asks
// for the count, so that is said once per server process and not again.
const NOT_THERE = new Set(["PGRST202", "42883"]);
let saidNotThere = false;

/**
 * How much waits, for the rail. Never throws and answers 0 on any failure: the count is an
 * extra on the map, the vault and the gallery, and must not be able to break them.
 */
export async function loadInboxCount(db: Db): Promise<number> {
  try {
    const hive = await ownHive(db);
    if (hive === "error" || hive === null) return 0;
    const res = (await db.rpc("inbox_count", { p_hive: hive.id })) as Res;
    if (res.error) {
      if (NOT_THERE.has(res.error.code ?? "")) {
        if (saidNotThere) return 0;
        saidNotThere = true;
      }
      failed("inbox_count", res);
      return 0;
    }
    return count(res.data) ? res.data : 0;
  } catch (e) {
    console.error("inbox_count failed", e instanceof Error ? e.name : "");
    return 0;
  }
}
