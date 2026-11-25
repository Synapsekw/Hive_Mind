// What the owner's topic actions do, given a client signed in as the person. Each is a public
// endpoint: its arguments are taken as hostile and checked before any query, and the database
// decides. Only the hive's owner may make or delete a topic (`entities_insert`,
// `entities_delete`); a scan reads the caller's own notes in one of their own workspaces.
//
// A scan answers each note's path, title and three of its fields (type, aliases, tags), to the
// note's own owner, and never its text. Only an error's code and message are logged.
import { headOf } from "../../topics/candidates";
import {
  KINDS,
  MAX_ALIASES,
  MAX_NAME,
  SAVE_CHUNK,
  type Kind,
  type NoteHead,
  type ScanResult,
  type TopicsSaved,
} from "../../topics/types";
import type { Result } from "../../settings/types";
import { MAX_CURSOR_CHARS } from "../vault/connect";
import {
  failed,
  ownWorkspace,
  rows,
  userId,
  type Db,
  type Res,
} from "../vault/import";
import { isUuid } from "../vault/validate";

/** The notes one scan step reads. */
export const SCAN_NOTES = 500;

/** Fits every answer here: each of them has `{ ok: false }` as its refusal. */
const NO = { ok: false } as const;
const isKind = (v: unknown): v is Kind =>
  (KINDS as readonly unknown[]).includes(v);
const plain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export async function scanTopicsIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<ScanResult> {
  if (!isUuid(workspaceId)) return NO;
  if (
    after !== null &&
    (typeof after !== "string" ||
      after.length < 1 ||
      after.length > MAX_CURSOR_CHARS ||
      after.includes("\u0000"))
  )
    return NO;
  const uid = await userId(db);
  if (!uid) return NO;
  const wsId = workspaceId.toLowerCase();
  const own = await ownWorkspace(db, wsId, uid);
  if (own === null) return NO;

  const all = db
    .from("notes")
    .select("path, title, frontmatter")
    .eq("workspace_id", wsId)
    .eq("member_id", own.memberId);
  const read = (await (after === null ? all : all.gt("path", after))
    .order("path")
    .limit(SCAN_NOTES)) as Res;
  if (failed("topics scan query", read, true) || !Array.isArray(read.data))
    return NO;
  const heads: NoteHead[] = [];
  for (const r of rows(read))
    if (typeof r.path === "string")
      heads.push(
        headOf(
          r.path,
          typeof r.title === "string" ? r.title : "",
          r.frontmatter,
        ),
      );
  if (heads.length !== read.data.length) {
    console.error("topics scan answer has an unexpected shape");
    return NO;
  }
  return {
    ok: true,
    heads,
    next: heads.length >= SCAN_NOTES ? heads[heads.length - 1]!.path : null,
  };
}

type Clean = {
  hive_id: string;
  type: Kind;
  canonical_name: string;
  aliases: string[];
};

/** The picks rebuilt from known keys only, or null when anything about them is malformed. */
function cleanPicks(hiveId: string, raw: unknown): Clean[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > SAVE_CHUNK)
    return null;
  const out: Clean[] = [];
  for (const item of raw as unknown[]) {
    if (!plain(item)) return null;
    const { kind, name, aliases } = item;
    if (!isKind(kind) || typeof name !== "string") return null;
    const canonical = name.trim();
    if (canonical.length < 1 || canonical.length > MAX_NAME) return null;
    if (!Array.isArray(aliases) || aliases.length > MAX_ALIASES) return null;
    const cleaned: string[] = [];
    for (const a of aliases as unknown[]) {
      if (typeof a !== "string" || a.length > MAX_NAME) return null;
      cleaned.push(a);
    }
    out.push({
      hive_id: hiveId,
      type: kind,
      canonical_name: canonical,
      aliases: cleaned,
    });
  }
  return out;
}

/** Saves up to 200 picked candidates as topics of the hive; one that is there already is skipped. */
export async function saveTopicsIn(
  db: Db,
  hiveId: unknown,
  raw: unknown,
): Promise<TopicsSaved> {
  if (!isUuid(hiveId)) return NO;
  const picks = cleanPicks(hiveId.toLowerCase(), raw);
  if (picks === null) return NO;
  if (!(await userId(db))) return NO;
  const res = (await db
    .from("entities")
    .upsert(picks, {
      onConflict: "hive_id,type,canonical_name",
      ignoreDuplicates: true,
    })
    .select("id")) as Res;
  if (res.error) {
    console.error("topics save failed", res.error.code, res.error.message);
    return NO;
  }
  return { ok: true, saved: Array.isArray(res.data) ? res.data.length : 0 };
}

export async function deleteTopicIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  if (!(await userId(db))) return NO;
  const wanted = id.toLowerCase();
  const res = (await db
    .from("entities")
    .delete()
    .eq("id", wanted)
    .select("id")) as Res;
  if (res.error) {
    console.error("topic delete failed", res.error.code, res.error.message);
    return NO;
  }
  if (!Array.isArray(res.data) || res.data.length !== 1) {
    console.error("topic delete removed no row");
    return NO;
  }
  return { ok: true };
}
