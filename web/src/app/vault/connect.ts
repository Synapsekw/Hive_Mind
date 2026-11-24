// One step of turning a workspace's wiki links into links, given a client signed in as the
// person. The step is a public endpoint, so both arguments are taken as hostile and checked
// before any query; the hive and the member come from the workspace's own row (the import's
// check, shared), never from the browser. Whether a link may be made is the database's answer:
// `links_insert` lets a person link from their own note, `links_before_insert` accepts a link
// between two notes of one owner at once and refuses a second link for a pair. Nothing here
// decides it, and nothing here updates or deletes.
//
// Every request of this step names ids or a path, and what the API says about such a request
// may quote it: only an error's code is logged, never its message, and never a note's path,
// title or text. The answer is numbers and the next cursor, which is a path of the person's own.
import {
  buildIndex,
  looksLikeFile,
  resolveTarget,
  wikiTargets,
  type Indexed,
} from "../../import/wikilinks";
import type { ConnectResult } from "../../import/types";
import {
  failed,
  ownWorkspace,
  rows,
  userId,
  type Db,
  type Res,
} from "./import";
import { isUuid } from "./validate";

/** The notes one step reads. */
export const STEP_NOTES = 40;
/**
 * The longest cursor, in characters. The cursor is a note's path, and a note written through an
 * agent can have a longer one than the 500 characters the import stores: a cap of 500 would halt
 * every run at that note.
 */
export const MAX_CURSOR_CHARS = 4000;
/**
 * The rows asked for in one page of the index of paths, and of the links the notes already
 * have. The API may answer fewer than asked (its max-rows setting), so a short page is not
 * taken as the last one.
 */
const PAGE = 1000;
/** The most rows of either that one step takes: 20 full pages. */
const MAX_ROWS = 20_000;
/** The most requests one such read makes, however small the pages come back. */
const MAX_REQUESTS = 40;
/** The most links in one insert. */
const CHUNK = 200;
/** An explicit reference, scored as an agent's proposal of that tier is. */
const TIER = 2;
const SCORE = 0.8;
/** What `links_before_insert` says of a pair that got its link since the links were read. */
const SAYS_LINKED = "these notes already have a link";
/** The pair index (`links_pair_idx`), which is what refuses when two runs race. */
const UNIQUE_VIOLATION = "23505";
/** What `zz_hive_frozen` says: no insert of this run will go in, so the run stops. */
const SAYS_FROZEN = "this hive is being deleted";

const says = (res: Res, words: string): boolean =>
  String(res.error?.message ?? "").includes(words);

const REFUSED: ConnectResult = { ok: false };

type Rows = Record<string, unknown>[];

/**
 * Every row of a read that is asked for page by page. `page` asks for the rows `from` to `to`,
 * and for the exact count of all of them when `counted` is set, which is on the first page
 * only. The read ends when the rows received reach that count, or on an empty page; with no
 * usable count it goes on until an empty page. Each page starts where the rows received end,
 * so an API that answers fewer rows than asked loses none.
 *
 * Null when a page cannot be read or is not a list, when there are more than `MAX_ROWS` rows,
 * or after `MAX_REQUESTS` requests.
 */
export async function paged(
  what: string,
  tooMany: string,
  page: (from: number, to: number, counted: boolean) => PromiseLike<unknown>,
): Promise<Rows | null> {
  const out: Rows = [];
  let got = 0;
  let count: number | null = null;
  for (let n = 0; n < MAX_REQUESTS; n++) {
    const res = (await page(got, got + PAGE - 1, n === 0)) as Res & {
      count?: unknown;
    };
    if (failed(what, res, true) || !Array.isArray(res.data)) return null;
    if (n === 0) {
      const said = res.count;
      if (typeof said === "number" && Number.isInteger(said) && said >= 0)
        count = said;
      if (count !== null && count > MAX_ROWS) break;
    }
    if (res.data.length === 0) return out;
    got += res.data.length;
    if (got > MAX_ROWS) break;
    out.push(...rows(res));
    if (count !== null && got >= count) return out;
  }
  console.error(`connect refused: ${tooMany}`);
  return null;
}

/** What a page's `select` takes besides its columns: the exact count, on the first page. */
export const counting = (counted: boolean): { count: "exact" } | undefined =>
  counted ? { count: "exact" } : undefined;

/** The two notes of a link as one key, whichever way the link points. */
const pairKey = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * One step over a workspace of the person's own: the 40 notes after the cursor `after` (null
 * for the first step), in path order. It answers what was counted and the cursor for the next
 * step, or `{ ok: false }` when an argument is malformed, there is no session, the workspace is
 * not the person's own, or something cannot be read; then nothing was written.
 */
export async function connectBatchIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<ConnectResult> {
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

  // Every note of the workspace by path: what a reference can mean.
  const listed = await paged(
    "connect index query",
    "workspace too large",
    (from, to, counted) =>
      db
        .from("notes")
        .select("id, path", counting(counted))
        .eq("workspace_id", wsId)
        .eq("member_id", memberId)
        .order("path")
        .range(from, to),
  );
  if (listed === null) return REFUSED;
  const index = buildIndex(
    listed.flatMap((r): Indexed[] =>
      isUuid(r.id) && typeof r.path === "string"
        ? [{ id: r.id.toLowerCase(), path: r.path }]
        : [],
    ),
  );

  // This step's notes.
  const all = db
    .from("notes")
    .select("id, path, body, frontmatter")
    .eq("workspace_id", wsId)
    .eq("member_id", memberId);
  const read = (await (after === null ? all : all.gt("path", after))
    .order("path")
    .limit(STEP_NOTES)) as Res;
  if (failed("connect notes query", read, true) || !Array.isArray(read.data))
    return REFUSED;
  const notes: { id: string; path: string; row: Record<string, unknown> }[] =
    [];
  for (const row of rows(read))
    if (isUuid(row.id) && typeof row.path === "string")
      notes.push({ id: row.id.toLowerCase(), path: row.path, row });
  // A row that is not a note with an id and a path: nothing is built on it.
  if (notes.length !== read.data.length) {
    console.error("connect notes answer has an unexpected shape");
    return REFUSED;
  }

  const counts = { linked: 0, already: 0, missing: 0, failed: 0 };
  const answer = (): ConnectResult => ({
    ok: true,
    next: notes.length >= STEP_NOTES ? notes[notes.length - 1]!.path : null,
    total: index.size,
    scanned: notes.length,
    ...counts,
  });
  if (notes.length === 0) return answer();

  // One link per pair of notes, in the direction first seen.
  const wanted = new Map<string, { from_note: string; to_note: string }>();
  for (const note of notes) {
    const body = typeof note.row.body === "string" ? note.row.body : "";
    for (const target of wikiTargets(body, note.row.frontmatter)) {
      const to = resolveTarget(index, note.path, target);
      if (to === null) {
        // An image or a PDF that is no note says nothing; a note that is not there is counted.
        if (!looksLikeFile(target)) counts.missing += 1;
        continue;
      }
      if (to === note.id) continue;
      const key = pairKey(note.id, to);
      if (!wanted.has(key))
        wanted.set(key, { from_note: note.id, to_note: to });
    }
  }
  if (wanted.size === 0) return answer();

  // The links these notes already have, either way. The ids were checked as uuids above, so
  // the filter holds nothing but hexadecimal digits and dashes.
  const ids = notes.map((n) => n.id).join(",");
  const linked = await paged(
    "connect links query",
    "too many links",
    (from, to, counted) =>
      db
        .from("links")
        .select("from_note, to_note", counting(counted))
        .or(`from_note.in.(${ids}),to_note.in.(${ids})`)
        .order("id")
        .range(from, to),
  );
  if (linked === null) return REFUSED;
  for (const l of linked) {
    if (typeof l.from_note !== "string" || typeof l.to_note !== "string")
      continue;
    const key = pairKey(l.from_note.toLowerCase(), l.to_note.toLowerCase());
    if (wanted.delete(key)) counts.already += 1;
  }

  const missing = [...wanted.values()].map((pair) => ({
    hive_id: hiveId,
    ...pair,
    tier: TIER,
    score: SCORE,
  }));
  for (let at = 0; at < missing.length; at += CHUNK) {
    const chunk = missing.slice(at, at + CHUNK);
    const res = (await db.from("links").insert(chunk)) as Res;
    if (!failed("connect links insert", res, true)) {
      counts.linked += chunk.length;
      continue;
    }
    // A hive that is being deleted takes no link at all: the step is refused, so the browser
    // ends the run after three such steps and not after a request for every pair.
    if (says(res, SAYS_FROZEN)) return REFUSED;
    // Find the pairs the database refused; the others still go in.
    for (const link of chunk) {
      const one = (await db.from("links").insert([link])) as Res;
      if (!one.error) counts.linked += 1;
      else if (says(one, SAYS_LINKED) || one.error.code === UNIQUE_VIOLATION)
        // The pair got its link since the links were read: by the trigger's word, or by the
        // pair index when another run made it at the same moment.
        counts.already += 1;
      else {
        failed("connect link insert", one, true);
        if (says(one, SAYS_FROZEN)) return REFUSED;
        counts.failed += 1;
      }
    }
  }
  return answer();
}
