import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FolderRule,
  NoteLink,
  Tab,
  VaultData,
  VaultNote,
  VaultTopic,
  Visibility,
} from "../../vault/types";
import { KINDS, type Kind } from "../../topics/types";
import { ownHive } from "../own-hive";
import { counting, paged } from "./connect";
import { isUuid } from "./validate";

export type VaultLoad =
  { state: "ok"; data: VaultData } | { state: "no-hive" } | { state: "error" };

type Db = Pick<SupabaseClient, "from" | "rpc" | "auth">;
type Row = Record<string, unknown>;
type Res = { data: unknown; error: { code?: string; message: string } | null };

/** The note index: metadata and the database's own answer on sharing. Never the body. */
export const NOTE_COLUMNS =
  "id,workspace_id,member_id,path,title,updated_at,written_by_agent,visibility,shared_with," +
  "quarantined,effective:note_visibility,effective_with:note_shared_with," +
  "rule_folder:note_rule_folder,access:note_access," +
  "note_entities(entity_id,confidence,detached_at)";

const INDEX_CAP = 2000;
const SHARED_CAP = 500;
const BODY_CAP = 200_000;
const LINKS_CAP = 50;

const VISIBILITIES = new Set(["private", "group", "members"]);
const vis = (v: unknown): Visibility | null =>
  typeof v === "string" && VISIBILITIES.has(v) ? (v as Visibility) : null;
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The ids of a note's attached topics, strongest first: rows not detached, by confidence
 * descending (a stable sort keeps the order the database answered for ties). Anything that is
 * not a pair of an id and a number is skipped.
 */
function topicsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const kept: { id: string; confidence: number }[] = [];
  for (const r of v) {
    if (typeof r !== "object" || r === null) continue;
    const { entity_id, confidence, detached_at } = r as Row;
    if (typeof entity_id !== "string" || typeof confidence !== "number")
      continue;
    if (detached_at !== null && detached_at !== undefined) continue;
    kept.push({ id: entity_id, confidence });
  }
  return kept.sort((a, b) => b.confidence - a.confidence).map((k) => k.id);
}

/**
 * A note row as the vault shows it. The computed columns are null for a note the caller cannot
 * read; they read as private, shared with nobody, and (on a colleague's note) opened by a link.
 */
export function toNote(r: Row, me: string): VaultNote {
  const member_id = text(r.member_id);
  const access =
    r.access === "own" || r.access === "shared" || r.access === "link"
      ? r.access
      : member_id === me
        ? "own"
        : "link";
  return {
    id: text(r.id),
    workspace_id: text(r.workspace_id),
    member_id,
    path: text(r.path),
    title: text(r.title),
    updated_at: text(r.updated_at),
    by_agent: r.written_by_agent !== null && r.written_by_agent !== undefined,
    visibility: vis(r.visibility),
    shared_with: ids(r.shared_with),
    quarantined: r.quarantined === true,
    effective: vis(r.effective) ?? "private",
    effective_with: ids(r.effective_with),
    rule_folder: typeof r.rule_folder === "string" ? r.rule_folder : null,
    access,
    topics: topicsOf(r.note_entities),
  };
}

/** Only the error's code and message, never a payload. */
function failed(what: string, res: Res): boolean {
  if (!res.error) return false;
  console.error(`${what} failed`, res.error.code, res.error.message);
  return true;
}

const rows = (res: Res): Row[] => (Array.isArray(res.data) ? res.data : []);

/** The five fields of a link row, or null when the row is not what the database promises. */
function toLink(r: unknown): NoteLink | null {
  if (typeof r !== "object" || r === null) return null;
  const { id, note_id, title, owner, mine } = r as Row;
  if (!isUuid(id) || !isUuid(note_id)) return null;
  if (typeof title !== "string" || typeof owner !== "string") return null;
  if (typeof mine !== "boolean") return null;
  return { id, note_id, title, owner, mine };
}

/**
 * The open note's accepted links, as the database lists them for the caller. The note is shown
 * without them when this read fails: only the error's code and message are logged.
 */
async function noteLinks(db: Db, noteId: string): Promise<NoteLink[]> {
  let res: Res | null | undefined;
  try {
    res = (await db.rpc("note_links", { p_note: noteId })) as Res | null;
  } catch (e) {
    console.error("note_links failed", e instanceof Error ? e.name : "");
    return [];
  }
  if (!res) {
    console.error("note_links failed");
    return [];
  }
  if (failed("note_links", res)) return [];
  return rows(res)
    .map(toLink)
    .filter((l): l is NoteLink => l !== null)
    .slice(0, LINKS_CAP);
}

/** Kinds in the order the vault lists them. */
const KIND_ORDER = new Map<string, number>(KINDS.map((k, i) => [k, i]));

/**
 * The hive's topics, by kind order then name. The vault still opens without them when this read
 * fails: only the error's code is logged (by the paging), never a name.
 */
async function hiveTopics(db: Db, hiveId: string): Promise<VaultTopic[]> {
  let read: Row[] | null;
  try {
    read = await paged("topics query", "too many topics", (from, to, counted) =>
      db
        .from("entities")
        .select("id, type, canonical_name", counting(counted))
        .eq("hive_id", hiveId)
        .order("id")
        .range(from, to),
    );
  } catch (e) {
    console.error("topics query failed", e instanceof Error ? e.name : "");
    return [];
  }
  if (read === null) return [];
  const out: VaultTopic[] = [];
  for (const r of read) {
    if (typeof r.id !== "string" || typeof r.canonical_name !== "string")
      continue;
    if (typeof r.type !== "string" || !KIND_ORDER.has(r.type)) continue;
    out.push({ id: r.id, kind: r.type as Kind, name: r.canonical_name });
  }
  return out.sort(
    (a, b) =>
      KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/**
 * Everything `/vault` shows, in this order: the caller's own hive; then its members, the
 * caller's workspaces in it, the caller's user, the `?note=` body and that note's links in
 * parallel; then the open tab's folders and note index in parallel. Row-level security decides every row.
 */
export async function loadVault(
  db: Db,
  query: { ws?: string; tab?: string; note?: string },
): Promise<VaultLoad> {
  const hive = await ownHive(db);
  if (hive === "error") return { state: "error" };
  if (hive === null) return { state: "no-hive" };
  const hiveId = hive.id;

  const noteId = query.note === undefined ? null : query.note;
  const wantNote = noteId !== null && isUuid(noteId);

  const [members, workspaces, user, opened, links, topics] = await Promise.all([
    db
      .from("members")
      .select("id, display_name, user_id")
      .eq("hive_id", hiveId)
      .order("created_at", { ascending: true }) as unknown as Promise<Res>,
    db
      .from("workspaces")
      .select("id, name")
      .eq("hive_id", hiveId)
      .order("created_at", { ascending: true }) as unknown as Promise<Res>,
    db.auth.getUser(),
    wantNote
      ? (db
          .from("notes")
          .select(`${NOTE_COLUMNS},body`)
          .eq("id", noteId)
          .limit(1) as unknown as Promise<Res>)
      : Promise.resolve(null),
    wantNote ? noteLinks(db, noteId) : Promise.resolve([]),
    hiveTopics(db, hiveId),
  ]);
  if (failed("members query", members)) return { state: "error" };
  if (failed("workspaces query", workspaces)) return { state: "error" };
  if (opened && failed("note query", opened)) return { state: "error" };

  const userId = user.data.user?.id;
  if (!userId) return { state: "error" };
  const memberRows = rows(members);
  const me = memberRows.find((m) => m.user_id === userId);
  if (!me) return { state: "error" };
  const meId = text(me.id);
  const spaces = rows(workspaces).map((w) => ({
    id: text(w.id),
    name: text(w.name),
  }));

  let open: VaultData["open"] = null;
  if (noteId !== null) {
    const r = opened ? rows(opened)[0] : undefined;
    if (!r) open = { missing: true };
    else {
      const body = text(r.body);
      open = {
        note: toNote(r, meId),
        body: body.length > BODY_CAP ? body.slice(0, BODY_CAP) : body,
        cut: body.length > BODY_CAP,
        links,
      };
    }
  }

  // The open note decides the tab: a colleague's opens "Shared with me", one's own opens its
  // workspace. Otherwise `?tab=shared`, else `?ws=` when it is one of the caller's, else the first.
  let tab: Tab;
  const openNote = open && "note" in open ? open.note : null;
  const own = (id: string | undefined) => spaces.find((w) => w.id === id);
  if (openNote && openNote.member_id !== meId) tab = { kind: "shared" };
  else if (openNote && own(openNote.workspace_id))
    tab = { kind: "workspace", id: openNote.workspace_id };
  else if (query.tab === "shared") tab = { kind: "shared" };
  else {
    const ws = (isUuid(query.ws) && own(query.ws)) || spaces[0];
    tab = ws ? { kind: "workspace", id: ws.id } : { kind: "shared" };
  }

  let folders: FolderRule[] = [];
  let index: Res;
  let cap: number;
  if (tab.kind === "workspace") {
    cap = INDEX_CAP;
    const [f, n] = await Promise.all([
      db
        .from("folders")
        .select("path, visibility, shared_with")
        .eq("workspace_id", tab.id)
        .order("path") as unknown as Promise<Res>,
      db
        .from("notes")
        .select(NOTE_COLUMNS)
        .eq("workspace_id", tab.id)
        .order("path")
        .limit(INDEX_CAP + 1) as unknown as Promise<Res>,
    ]);
    if (failed("folders query", f)) return { state: "error" };
    folders = rows(f).map((r) => ({
      path: text(r.path),
      visibility: vis(r.visibility),
      shared_with: ids(r.shared_with),
    }));
    index = n;
  } else {
    cap = SHARED_CAP;
    index = (await db
      .from("notes")
      .select(NOTE_COLUMNS)
      .eq("hive_id", hiveId)
      .neq("member_id", meId)
      .order("updated_at", { ascending: false })
      .limit(SHARED_CAP + 1)) as Res;
  }
  if (failed("notes query", index)) return { state: "error" };
  const all = rows(index);

  return {
    state: "ok",
    data: {
      hive: { id: hiveId, name: hive.name },
      me: meId,
      members: memberRows.map((m) => ({
        id: text(m.id),
        display_name: text(m.display_name),
      })),
      workspaces: spaces,
      tab,
      folders,
      notes: all.slice(0, cap).map((r) => toNote(r, meId)),
      truncated: all.length > cap,
      open,
      topics,
    },
  };
}
