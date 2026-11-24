// One step of attaching a workspace's notes to the hive's topics, given a client signed in as
// the person. The step is a public endpoint, so both arguments are taken as hostile and checked
// before any query; the hive and the member come from the workspace's own row (the import's
// check, shared), never from the browser. Whether a note may be attached is the database's
// answer: `note_entities_insert` lets a person attach their own note, and the pair's primary key
// refuses one that is already there, attached or detached. Nothing here updates or deletes.
//
// A note's text is compared with topic names and nothing else is done with it. Only an error's
// code is logged, never its message, and never a note's path, title or text. The answer is
// numbers and the next cursor, which is a path of the person's own.
import { prepare, topicsFor } from "../../topics/match";
import {
  KINDS,
  MAX_TOPICS_PER_NOTE,
  type AttachResult,
  type Kind,
  type Topic,
} from "../../topics/types";
import { counting, MAX_CURSOR_CHARS, paged, STEP_NOTES } from "./connect";
import {
  failed,
  ownWorkspace,
  rows,
  userId,
  type Db,
  type Res,
} from "./import";
import { isUuid } from "./validate";

/** The most pairs in one insert. */
const CHUNK = 200;
const UNIQUE_VIOLATION = "23505";
/** What `zz_hive_frozen` says: no insert of this run will go in, so the run stops. */
const SAYS_FROZEN = "this hive is being deleted";

const REFUSED: AttachResult = { ok: false };
const isKind = (v: unknown): v is Kind =>
  (KINDS as readonly unknown[]).includes(v);
const says = (res: Res, words: string): boolean =>
  String(res.error?.message ?? "").includes(words);

export async function attachBatchIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<AttachResult> {
  if (!isUuid(workspaceId)) return REFUSED;
  if (
    after !== null &&
    (typeof after !== "string" ||
      after.length < 1 ||
      after.length > MAX_CURSOR_CHARS ||
      after.includes("\u0000"))
  )
    return REFUSED;
  const uid = await userId(db);
  if (!uid) return REFUSED;
  const wsId = workspaceId.toLowerCase();
  const own = await ownWorkspace(db, wsId, uid);
  if (own === null) return REFUSED;
  const { hiveId, memberId } = own;

  // The hive's topics: at most 2,000, by the database's own cap.
  const listed = await paged(
    "attach topics query",
    "too many topics",
    (from, to, counted) =>
      db
        .from("entities")
        .select("id, type, canonical_name, aliases", counting(counted))
        .eq("hive_id", hiveId)
        .order("id")
        .range(from, to),
  );
  if (listed === null) return REFUSED;
  const topics: Topic[] = listed.flatMap((r): Topic[] =>
    isUuid(r.id) && isKind(r.type) && typeof r.canonical_name === "string"
      ? [
          {
            id: r.id.toLowerCase(),
            kind: r.type,
            name: r.canonical_name,
            aliases: Array.isArray(r.aliases)
              ? r.aliases.filter((a): a is string => typeof a === "string")
              : [],
          },
        ]
      : [],
  );
  const counts = { attached: 0, already: 0, none: 0, failed: 0 };
  if (topics.length === 0)
    return { ok: true, next: null, total: 0, scanned: 0, ...counts, topics: 0 };

  const sized = (await db
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", wsId)
    .eq("member_id", memberId)) as Res & { count?: unknown };
  if (failed("attach count query", sized, true)) return REFUSED;
  const total =
    typeof sized.count === "number" && sized.count >= 0 ? sized.count : 0;

  // This step's notes.
  const all = db
    .from("notes")
    .select("id, path, title, body, frontmatter")
    .eq("workspace_id", wsId)
    .eq("member_id", memberId);
  const read = (await (after === null ? all : all.gt("path", after))
    .order("path")
    .limit(STEP_NOTES)) as Res;
  if (failed("attach notes query", read, true) || !Array.isArray(read.data))
    return REFUSED;
  const notes: { id: string; path: string; row: Record<string, unknown> }[] =
    [];
  for (const row of rows(read))
    if (isUuid(row.id) && typeof row.path === "string")
      notes.push({ id: row.id.toLowerCase(), path: row.path, row });
  if (notes.length !== read.data.length) {
    console.error("attach notes answer has an unexpected shape");
    return REFUSED;
  }
  const answer = (): AttachResult => ({
    ok: true,
    next: notes.length >= STEP_NOTES ? notes[notes.length - 1]!.path : null,
    total,
    scanned: notes.length,
    ...counts,
    topics: topics.length,
  });
  if (notes.length === 0) return answer();

  // The pairs these notes already have, attached or detached. The ids were checked as uuids.
  const ids = notes.map((n) => n.id);
  const had = await paged(
    "attach pairs query",
    "too many pairs",
    (from, to, counted) =>
      db
        .from("note_entities")
        .select("note_id, entity_id, detached_at", counting(counted))
        .in("note_id", ids)
        .order("note_id")
        .order("entity_id")
        .range(from, to),
  );
  if (had === null) return REFUSED;
  const seen = new Map<string, Map<string, boolean>>();
  for (const p of had) {
    if (typeof p.note_id !== "string" || typeof p.entity_id !== "string")
      continue;
    const of = seen.get(p.note_id.toLowerCase()) ?? new Map<string, boolean>();
    of.set(
      p.entity_id.toLowerCase(),
      p.detached_at === null || p.detached_at === undefined,
    );
    seen.set(p.note_id.toLowerCase(), of);
  }

  const ready = prepare(topics);
  // Notes that already have an attached pair, and notes that gained one in this step.
  const has = new Set<string>();
  const gained = new Set<string>();
  const missing: { note_id: string; entity_id: string; confidence: number }[] =
    [];
  for (const note of notes) {
    const of = seen.get(note.id) ?? new Map<string, boolean>();
    const attached = [...of.values()].filter(Boolean).length;
    let room = MAX_TOPICS_PER_NOTE - attached;
    if (attached > 0) has.add(note.id);
    const hits = topicsFor(
      {
        path: note.path,
        title: typeof note.row.title === "string" ? note.row.title : "",
        body: typeof note.row.body === "string" ? note.row.body : "",
        frontmatter: note.row.frontmatter,
      },
      ready,
    );
    for (const hit of hits) {
      if (of.has(hit.id) || room <= 0) continue;
      missing.push({
        note_id: note.id,
        entity_id: hit.id,
        confidence: hit.confidence,
      });
      room -= 1;
    }
  }

  for (let at = 0; at < missing.length; at += CHUNK) {
    const chunk = missing.slice(at, at + CHUNK);
    const res = (await db.from("note_entities").insert(chunk)) as Res;
    if (!failed("attach pairs insert", res, true)) {
      for (const pair of chunk) gained.add(pair.note_id);
      continue;
    }
    if (says(res, SAYS_FROZEN)) return REFUSED;
    // Find the pairs the database refused; the others still go in.
    for (const pair of chunk) {
      const one = (await db.from("note_entities").insert([pair])) as Res;
      if (!one.error) gained.add(pair.note_id);
      else if (one.error.code === UNIQUE_VIOLATION) has.add(pair.note_id);
      else {
        failed("attach pair insert", one, true);
        if (says(one, SAYS_FROZEN)) return REFUSED;
        counts.failed += 1;
      }
    }
  }
  // Each note of the step is counted once: it gained a pair, or it already has one, or it has none.
  for (const note of notes) {
    if (gained.has(note.id)) counts.attached += 1;
    else if (has.has(note.id)) counts.already += 1;
    else counts.none += 1;
  }
  return answer();
}
