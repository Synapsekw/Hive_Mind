import { afterEach, describe, expect, it, vi } from "vitest";
import { connectBatchIn } from "./connect";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const OTHER_HIVE = "00000000-0000-4000-8000-000000000a02";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const UID = "00000000-0000-4000-8000-0000000000aa";
const W1 = "00000000-0000-4000-8000-000000000b01";
const W2 = "00000000-0000-4000-8000-000000000b02";

type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null; count?: unknown };
type Row = Record<string, unknown>;
type Call = { table: string; ops: [string, unknown[]][] };

/** An answer; `count` is the exact count a first page asks for, when the server gives one. */
const ok = (data: unknown, count?: number): Res =>
  count === undefined ? { data, error: null } : { data, error: null, count };
const no = (message: string, code?: string): Res => ({
  data: null,
  error: { message, code },
});
const op = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];
const kind = (c: Call) => (op(c, "insert") ? "insert" : "select");
const shape = (t: { calls: Call[] }) =>
  t.calls.map((c) => `${c.table}.${kind(c)}`);

/** The id of the nth note. */
const nid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const pairOf = (a: unknown, b: unknown) =>
  [String(a), String(b)].sort().join("|");

/** The two lists of ids of the filter on a note's links, which must be uuids and nothing else. */
function orLists(value: unknown): [string[], string[]] {
  const m =
    /^from_note\.in\.\(([0-9a-f-]{36}(?:,[0-9a-f-]{36})*)\),to_note\.in\.\(([0-9a-f-]{36}(?:,[0-9a-f-]{36})*)\)$/.exec(
      String(value),
    );
  expect(m, String(value)).not.toBeNull();
  return [m![1]!.split(","), m![2]!.split(",")];
}

/**
 * A small database in memory, speaking the part of the client the step uses. `fail` answers for
 * a call before it touches anything; an insert of several rows is all or nothing, and a second
 * link for a pair of notes is refused with the database's own words. A select that asks for the
 * exact count gets it, unless `countless`; `cap` is the most rows the server answers at once
 * (the API's max-rows setting).
 */
function fake(
  opts: {
    user?: { id: string } | null;
    workspaces?: Row[];
    members?: Row[];
    notes?: Row[];
    links?: Row[];
    fail?: (c: Call, nth: number) => Res | undefined;
    refuseLink?: (row: Row) => string | Err | undefined;
    cap?: number;
    countless?: boolean;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    workspaces: opts.workspaces ?? [{ id: W1, hive_id: HIVE, member_id: ME }],
    members: opts.members ?? [
      { id: ME, hive_id: HIVE, user_id: UID },
      { id: AHMED, hive_id: HIVE, user_id: "someone-else" },
    ],
    notes: opts.notes ?? [],
    links: opts.links ?? [],
  };
  const calls: Call[] = [];
  let ids = 0;

  const run = (c: Call): Res => {
    const said = opts.fail?.(
      c,
      calls.filter((x) => x.table === c.table && kind(x) === kind(c)).length,
    );
    if (said) return said;
    const table = tables[c.table]!;
    const inserted = op(c, "insert")?.[0];
    if (inserted !== undefined) {
      expect(c.table).toBe("links");
      const list = inserted as Row[];
      const pairs = new Set(table.map((l) => pairOf(l.from_note, l.to_note)));
      for (const r of list) {
        const why = opts.refuseLink?.(r);
        if (why)
          return typeof why === "string"
            ? no(why, "P0001")
            : no(why.message, why.code);
        const pair = pairOf(r.from_note, r.to_note);
        if (pairs.has(pair))
          return no("these notes already have a link", "P0001");
        pairs.add(pair);
      }
      table.push(
        ...list.map((r) => ({
          ...r,
          id: `link-${String(++ids).padStart(6, "0")}`,
        })),
      );
      return ok(null);
    }
    let hit = table.filter((r) =>
      c.ops.every(([m, a]) => {
        if (m === "eq") return r[a[0] as string] === a[1];
        if (m === "gt") return String(r[a[0] as string]) > String(a[1]);
        if (m === "or") {
          const [from, to] = orLists(a[0]);
          return (
            from.includes(r.from_note as string) ||
            to.includes(r.to_note as string)
          );
        }
        return true;
      }),
    );
    const by = op(c, "order")?.[0] as string | undefined;
    if (by)
      hit = [...hit].sort((x, y) =>
        String(x[by]) < String(y[by])
          ? -1
          : String(x[by]) > String(y[by])
            ? 1
            : 0,
      );
    const asked = op(c, "select")?.[1] as { count?: string } | undefined;
    const count =
      asked?.count === "exact" && !opts.countless ? hit.length : undefined;
    const range = op(c, "range") as [number, number] | undefined;
    if (range) hit = hit.slice(range[0], range[1] + 1);
    const limit = op(c, "limit")?.[0] as number | undefined;
    if (limit !== undefined) hit = hit.slice(0, limit);
    if (opts.cap !== undefined) hit = hit.slice(0, opts.cap);
    return ok(hit, count);
  };

  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "gt",
      "or",
      "order",
      "range",
      "limit",
      "insert",
    ])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => run(call))
        .then(res, rej);
    return chain;
  });
  const user = opts.user === undefined ? { id: UID } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, auth } as never, calls, tables, from, auth };
}

let made = 0;
/** A note of the person's in W1. Its id is in the order the notes are made. */
const note = (path: string, body = "", extra: Row = {}): Row => ({
  id: nid(++made + 0x1000),
  workspace_id: W1,
  member_id: ME,
  hive_id: HIVE,
  path,
  title: `title of ${path}`,
  body,
  frontmatter: {},
  ...extra,
});
const inserts = (t: { calls: Call[] }) =>
  t.calls
    .filter((c) => c.table === "links" && kind(c) === "insert")
    .map((c) => op(c, "insert")![0] as Row[]);
const reads = (t: { calls: Call[] }, table: string) =>
  t.calls.filter((c) => c.table === table && kind(c) === "select");
const zeros = { linked: 0, already: 0, missing: 0, failed: 0 };

afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("connectBatchIn", () => {
  it("refuses hostile arguments without a query or a look at the session", async () => {
    const t = fake({ notes: [note("a.md", "[[b]]"), note("b.md")] });
    const refused: [unknown, unknown][] = [
      ["", null],
      ["1 or 1=1", null],
      [`${W1}),to_note.in.(${W2}`, null],
      [null, null],
      [undefined, null],
      [7, null],
      [[W1], null],
      [{ id: W1 }, null],
      [W1, 7],
      [W1, { path: "a.md" }],
      [W1, ["a.md"]],
      [W1, undefined],
      [W1, false],
      [W1, ""],
      [W1, "x".repeat(4001)],
      [W1, "a\u0000.md"],
    ];
    for (const [ws, after] of refused)
      expect(await connectBatchIn(t.db, ws, after), String(after)).toEqual({
        ok: false,
      });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getUser).not.toHaveBeenCalled();
    // The longest cursor there is: longer than any path the import stores, because a note
    // written through an agent can have one.
    expect(await connectBatchIn(t.db, W1, "x".repeat(4000))).toMatchObject({
      ok: true,
    });
  });

  it("needs a session", async () => {
    const t = fake({
      user: null,
      notes: [note("a.md", "[[b]]"), note("b.md")],
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses a workspace the person cannot read, and reads no note", async () => {
    const t = fake({
      workspaces: [],
      notes: [note("a.md", "[[b]]"), note("b.md")],
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(shape(t)).toEqual(["workspaces.select"]);
  });

  it("refuses a workspace whose member is not the person's own, and writes nothing", async () => {
    quiet();
    const notes = [note("a.md", "[[b]]"), note("b.md")];
    // Should the workspace read ever answer somebody else's row, the member read does not.
    const t = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: AHMED }],
      notes,
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(shape(t)).toEqual(["workspaces.select", "members.select"]);
    // A member of the person's in another hive than the workspace's row names.
    const astride = fake({
      workspaces: [{ id: W1, hive_id: OTHER_HIVE, member_id: ME }],
      notes,
    });
    expect(await connectBatchIn(astride.db, W1, null)).toEqual({ ok: false });
    expect(shape(astride)).toEqual(["workspaces.select", "members.select"]);
    expect(astride.tables.links).toEqual([]);
  });

  it("answers done and zeros for an empty workspace", async () => {
    const t = fake();
    expect(await connectBatchIn(t.db, W1, null)).toEqual({
      ok: true,
      next: null,
      total: 0,
      scanned: 0,
      ...zeros,
    });
    expect(shape(t)).toEqual([
      "workspaces.select",
      "members.select",
      "notes.select",
      "notes.select",
    ]);
  });

  it("answers done and zeros for a cursor past the end", async () => {
    const t = fake({ notes: [note("a.md", "[[b]]"), note("b.md")] });
    expect(await connectBatchIn(t.db, W1, "zzz.md")).toEqual({
      ok: true,
      next: null,
      total: 2,
      scanned: 0,
      ...zeros,
    });
    expect(t.calls.some((c) => c.table === "links")).toBe(false);
  });

  it("inserts one link for each note a note points at, from the note that points", async () => {
    const a = note(
      "a.md",
      "See [[b]] and [[Folder/c|the third]], and [[b#part]].",
    );
    const b = note("b.md");
    const c = note("Folder/c.md");
    const t = fake({ notes: [a, b, c] });
    expect(await connectBatchIn(t.db, W1.toUpperCase(), null)).toEqual({
      ok: true,
      next: null,
      total: 3,
      scanned: 3,
      linked: 2,
      already: 0,
      missing: 0,
      failed: 0,
    });
    expect(inserts(t)).toEqual([
      [
        { hive_id: HIVE, from_note: a.id, to_note: b.id, tier: 2, score: 0.8 },
        { hive_id: HIVE, from_note: a.id, to_note: c.id, tier: 2, score: 0.8 },
      ],
    ]);
    // The insert asks for nothing back.
    expect(
      op(
        t.calls.find((x) => kind(x) === "insert")!,
        "select",
      ),
    ).toBeUndefined();
    expect(shape(t)).toEqual([
      "workspaces.select",
      "members.select",
      "notes.select",
      "notes.select",
      "links.select",
      "links.insert",
    ]);
  });

  it("reads references in a note's fields too", async () => {
    const a = note("a.md", "", {
      frontmatter: { related: ["[[b]]"], deep: { up: "[[nobody]]" } },
    });
    const b = note("b.md");
    const t = fake({ notes: [a, b] });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      linked: 1,
      missing: 1,
    });
    expect(inserts(t)).toEqual([
      [{ hive_id: HIVE, from_note: a.id, to_note: b.id, tier: 2, score: 0.8 }],
    ]);
  });

  it("makes one link when two notes point at each other in one step", async () => {
    const a = note("a.md", "[[b]] and again [[b]]");
    const b = note("b.md", "[[a]]");
    const t = fake({ notes: [a, b] });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      linked: 1,
      already: 0,
    });
    // In the direction first seen.
    expect(inserts(t)).toEqual([
      [{ hive_id: HIVE, from_note: a.id, to_note: b.id, tier: 2, score: 0.8 }],
    ]);
  });

  it("counts a pair that has a link the other way as already linked, and inserts nothing", async () => {
    const a = note("a.md", "[[b]] [[c]]");
    const b = note("b.md");
    const c = note("c.md");
    const t = fake({
      notes: [a, b, c],
      links: [
        { id: "link-b-a", from_note: b.id, to_note: a.id },
        { id: "link-a-c", from_note: a.id, to_note: c.id },
      ],
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      linked: 0,
      already: 2,
      failed: 0,
    });
    expect(inserts(t)).toEqual([]);
    expect(t.tables.links).toHaveLength(2);
  });

  it("counts a target with no note as missing, and neither counts nor inserts a self link", async () => {
    const a = note(
      "a.md",
      "[[nowhere]] [[a]] [[A.md]] [[gone/too]] ![[image.png]]",
    );
    const t = fake({ notes: [a, note("b.md")] });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({
      ok: true,
      next: null,
      total: 2,
      scanned: 2,
      linked: 0,
      already: 0,
      missing: 2,
      failed: 0,
    });
    // Nothing is wanted, so the links are not even read.
    expect(t.calls.some((c) => c.table === "links")).toBe(false);
  });

  it("never links to a note of another workspace or another member", async () => {
    const a = note("a.md", "[[elsewhere]] [[theirs]]");
    const t = fake({
      notes: [
        a,
        note("elsewhere.md", "", { workspace_id: W2 }),
        note("theirs.md", "", { member_id: AHMED }),
      ],
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      total: 1,
      scanned: 1,
      linked: 0,
      missing: 2,
    });
    expect(inserts(t)).toEqual([]);
  });

  it("reads the index in two pages when the count says there is more, and resolves a target on the second", async () => {
    const notes = Array.from({ length: 1300 }, (_, i) =>
      note(`n/${String(i).padStart(4, "0")}.md`, i === 0 ? "[[1250]]" : ""),
    );
    const t = fake({ notes });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      total: 1300,
      scanned: 40,
      linked: 1,
      missing: 0,
    });
    const index = reads(t, "notes").filter((c) => op(c, "range"));
    expect(index.map((c) => op(c, "range"))).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(index[0]!.ops).toEqual([
      ["select", ["id, path", { count: "exact" }]],
      ["eq", ["workspace_id", W1]],
      ["eq", ["member_id", ME]],
      ["order", ["path"]],
      ["range", [0, 999]],
    ]);
    // The count is asked for once.
    expect(op(index[1]!, "select")).toEqual(["id, path", undefined]);
    expect(inserts(t)).toEqual([
      [
        {
          hive_id: HIVE,
          from_note: notes[0]!.id,
          to_note: notes[1250]!.id,
          tier: 2,
          score: 0.8,
        },
      ],
    ]);
  });

  const ranges = (t: { calls: Call[] }, table: string) =>
    reads(t, table)
      .filter((c) => op(c, "range"))
      .map((c) => op(c, "range"));
  const numbered = (n: number, body: (i: number) => string = () => "") =>
    Array.from({ length: n }, (_, i) =>
      note(`n/${String(i).padStart(4, "0")}.md`, body(i)),
    );

  it("reads the index in one request when the count says the page holds it all", async () => {
    // Exactly a full page: the count saves the request that would find nothing.
    const t = fake({ notes: numbered(1000) });
    expect(await connectBatchIn(t.db, W1, "n/0990.md")).toMatchObject({
      ok: true,
      total: 1000,
      scanned: 9,
      next: null,
    });
    expect(ranges(t, "notes")).toEqual([[0, 999]]);
  });

  it("loses no note when the server answers fewer rows than a page asks for", async () => {
    // A server that caps every answer at 300 rows: each page starts where the rows end.
    const notes = numbered(700, (i) => (i === 0 ? "[[0650]]" : ""));
    const t = fake({ notes, cap: 300 });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      total: 700,
      scanned: 40,
      linked: 1,
      missing: 0,
    });
    expect(ranges(t, "notes")).toEqual([
      [0, 999],
      [300, 1299],
      [600, 1599],
    ]);
    expect(inserts(t).flat()).toMatchObject([
      { from_note: notes[0]!.id, to_note: notes[650]!.id },
    ]);
  });

  it("reads the index until an empty page when the server gives no count", async () => {
    const notes = numbered(700, (i) => (i === 0 ? "[[0650]]" : ""));
    const t = fake({ notes, cap: 300, countless: true });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      total: 700,
      linked: 1,
      missing: 0,
    });
    expect(ranges(t, "notes")).toEqual([
      [0, 999],
      [300, 1299],
      [600, 1599],
      [700, 1699],
    ]);
    // A count that is no count is no count.
    for (const count of [null, "700", -1, 1.5, Number.NaN]) {
      const odd = fake({
        notes,
        fail: (c) =>
          c.table === "notes" && op(c, "range")?.[0] === 0
            ? ({ data: notes.slice(0, 300), error: null, count } as Res)
            : undefined,
      });
      expect(await connectBatchIn(odd.db, W1, null)).toMatchObject({
        ok: true,
        total: 700,
        linked: 1,
      });
      expect(ranges(odd, "notes")).toEqual([
        [0, 999],
        [300, 1299],
        [700, 1699],
      ]);
    }
  });

  const page = Array.from({ length: 1000 }, (_, i) => ({
    id: nid(i + 1),
    path: `p/${i}.md`,
  }));

  it("takes a workspace of exactly 20,000 notes", async () => {
    const t = fake({
      notes: [note("a.md", "[[b]]"), note("b.md")],
      fail: (c) =>
        c.table === "notes" && op(c, "range") ? ok(page, 20_000) : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      total: 20_000,
    });
    expect(ranges(t, "notes")).toHaveLength(20);
  });

  it("refuses a workspace of more than 20,000 notes at once when the count says so, and writes nothing", async () => {
    const log = quiet();
    const t = fake({
      notes: [note("a.md", "[[b]]"), note("b.md")],
      fail: (c) =>
        c.table === "notes" && op(c, "range") ? ok(page, 20_001) : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(reads(t, "notes")).toHaveLength(1);
    expect(t.calls.some((c) => c.table === "links")).toBe(false);
    expect(log).toHaveBeenCalledWith("connect refused: workspace too large");
  });

  it("refuses a workspace of more than 20,000 notes when there is no count, and writes nothing", async () => {
    const log = quiet();
    const t = fake({
      notes: [note("a.md", "[[b]]"), note("b.md")],
      fail: (c) =>
        c.table === "notes" && op(c, "range") ? ok(page) : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    // The 21st page is the one too many.
    expect(reads(t, "notes")).toHaveLength(21);
    expect(t.calls.some((c) => c.table === "links")).toBe(false);
    expect(log).toHaveBeenCalledWith("connect refused: workspace too large");
  });

  it("refuses after 40 requests, however small the pages come back", async () => {
    const log = quiet();
    const t = fake({
      notes: [note("a.md", "[[b]]"), note("b.md")],
      fail: (c) =>
        c.table === "notes" && op(c, "range")
          ? ok(page.slice(0, 1), 5000)
          : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(reads(t, "notes")).toHaveLength(40);
    expect(ranges(t, "notes")[39]).toEqual([39, 1038]);
    expect(log).toHaveBeenCalledWith("connect refused: workspace too large");
  });

  it("reads the links the notes already have in pages, with the count asked once", async () => {
    const a = note("a.md", "[[b]]");
    const b = note("b.md");
    // 1,500 links of the first note to notes elsewhere; the one that matters sorts last.
    const others: Row[] = Array.from({ length: 1499 }, (_, i) => ({
      id: `link-${String(i).padStart(6, "0")}`,
      from_note: a.id,
      to_note: nid(0x900000 + i),
    }));
    const t = fake({
      notes: [a, b],
      links: [...others, { id: "link-zzz", from_note: b.id, to_note: a.id }],
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      linked: 0,
      already: 1,
    });
    const link = reads(t, "links");
    expect(link.map((c) => op(c, "range"))).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    const ids = [a.id, b.id].join(",");
    expect(link[0]!.ops).toEqual([
      ["select", ["from_note, to_note", { count: "exact" }]],
      ["or", [`from_note.in.(${ids}),to_note.in.(${ids})`]],
      ["order", ["id"]],
      ["range", [0, 999]],
    ]);
    expect(op(link[1]!, "select")).toEqual(["from_note, to_note", undefined]);
    expect(inserts(t)).toEqual([]);
  });

  it("loses no link when the server answers fewer rows than a page asks for, with a count or without", async () => {
    const a = note("a.md", "[[b]]");
    const b = note("b.md");
    // 700 links; the one that matters sorts last.
    const links: Row[] = [
      ...Array.from({ length: 699 }, (_, i) => ({
        id: `link-${String(i).padStart(6, "0")}`,
        from_note: a.id,
        to_note: nid(0x900000 + i),
      })),
      { id: "link-zzz", from_note: b.id, to_note: a.id },
    ];
    const counted = fake({ notes: [a, b], links, cap: 300 });
    expect(await connectBatchIn(counted.db, W1, null)).toMatchObject({
      ok: true,
      linked: 0,
      already: 1,
    });
    expect(ranges(counted, "links")).toEqual([
      [0, 999],
      [300, 1299],
      [600, 1599],
    ]);
    expect(inserts(counted)).toEqual([]);
    const blind = fake({ notes: [a, b], links, cap: 300, countless: true });
    expect(await connectBatchIn(blind.db, W1, null)).toMatchObject({
      ok: true,
      linked: 0,
      already: 1,
    });
    expect(ranges(blind, "links")).toEqual([
      [0, 999],
      [300, 1299],
      [600, 1599],
      [700, 1699],
    ]);
    expect(inserts(blind)).toEqual([]);
  });

  it("reads the links in one request when the count says the page holds them all", async () => {
    const a = note("a.md", "[[b]]");
    const t = fake({ notes: [a, note("b.md")] });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({ linked: 1 });
    expect(ranges(t, "links")).toEqual([[0, 999]]);
  });

  it("refuses when the notes have more than 20,000 links, and writes nothing", async () => {
    const log = quiet();
    const full = Array.from({ length: 1000 }, (_, i) => ({
      from_note: nid(0x800000 + i),
      to_note: nid(0x900000 + i),
    }));
    for (const [count, requests] of [
      [20_001, 1],
      [undefined, 21],
    ] as const) {
      const t = fake({
        notes: [note("a.md", "[[b]]"), note("b.md")],
        fail: (c) =>
          c.table === "links" && kind(c) === "select"
            ? ok(full, count)
            : undefined,
      });
      expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
      expect(reads(t, "links")).toHaveLength(requests);
      expect(inserts(t)).toEqual([]);
    }
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("connect refused: too many links");
  });

  it("inserts 450 pairs in three chunks of 200, 200 and 50", async () => {
    const targets = Array.from({ length: 450 }, (_, i) =>
      note(`t/${String(i).padStart(3, "0")}.md`),
    );
    const hub = note(
      "a.md",
      targets.map((_, i) => `[[${String(i).padStart(3, "0")}]]`).join(" "),
    );
    const t = fake({ notes: [...targets, hub] });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      total: 451,
      scanned: 40,
      next: "t/038.md",
      linked: 450,
      already: 0,
      failed: 0,
    });
    expect(inserts(t).map((rows) => rows.length)).toEqual([200, 200, 50]);
    expect(t.tables.links).toHaveLength(450);
    expect(
      t.tables.links!.every(
        (l) => l.from_note === hub.id && l.tier === 2 && l.score === 0.8,
      ),
    ).toBe(true);
  });

  it("goes one by one when a chunk is refused: a pair that got its link meanwhile is already linked, another refusal is failed", async () => {
    const log = quiet();
    const a = note("a.md", "[[b]] [[c]] [[d]] [[e]]");
    const [b, c, d, e] = ["b.md", "c.md", "d.md", "e.md"].map((p) => note(p));
    let raced = false;
    const t = fake({
      notes: [a, b!, c!, d!, e!],
      // Another run links a and c after the links were read.
      fail: (call) => {
        if (call.table === "links" && kind(call) === "insert" && !raced) {
          raced = true;
          t.tables.links!.push({
            id: "raced",
            from_note: c!.id,
            to_note: a.id,
          });
        }
        return undefined;
      },
      refuseLink: (r) =>
        r.to_note === d!.id
          ? "this link was declined"
          : r.to_note === e!.id
            ? "new row violates row-level security policy"
            : undefined,
    });
    const r = await connectBatchIn(t.db, W1, null);
    expect(r).toEqual({
      ok: true,
      next: null,
      total: 5,
      scanned: 5,
      linked: 1,
      already: 1,
      missing: 0,
      failed: 2,
    });
    expect(inserts(t).map((rows) => rows.length)).toEqual([4, 1, 1, 1, 1]);
    expect(t.tables.links!.map((l) => [l.from_note, l.to_note])).toEqual([
      [c!.id, a.id],
      [a.id, b!.id],
    ]);
    // What the database said is in neither the answer nor the log.
    expect(JSON.stringify(r)).not.toMatch(/declined|policy|already have/);
    for (const line of log.mock.calls)
      expect(line.join(" ")).not.toMatch(/declined|policy|already have/);
  });

  it("stops at once in a hive that is being deleted, without trying the pairs one by one", async () => {
    const log = quiet();
    const t = fake({
      notes: [note("a.md", "[[b]] [[c]]"), note("b.md"), note("c.md")],
      fail: (c) =>
        kind(c) === "insert"
          ? no("this hive is being deleted", "P0001")
          : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(inserts(t).map((rows) => rows.length)).toEqual([2]);
    expect(t.tables.links).toEqual([]);
    expect(log.mock.calls).toEqual([["connect links insert failed", "P0001"]]);
  });

  it("stops at once when the hive starts being deleted between two single inserts", async () => {
    const log = quiet();
    const a = note("a.md", "[[b]] [[c]] [[d]]");
    const [b, c, d] = ["b.md", "c.md", "d.md"].map((p) => note(p));
    const t = fake({
      notes: [a, b!, c!, d!],
      refuseLink: (r) =>
        r.to_note === b!.id
          ? "new row violates row-level security policy"
          : undefined,
      fail: (call, nth) =>
        kind(call) === "insert" && nth >= 3
          ? no("this hive is being deleted", "P0001")
          : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
    // The chunk, the pair it was refused for, and the one that met the deletion; not the last.
    expect(inserts(t).map((rows) => rows.length)).toEqual([3, 1, 1]);
    for (const line of log.mock.calls)
      expect(line.join(" ")).not.toMatch(/being deleted|policy/);
  });

  it("counts a pair the pair index refuses, when two runs race, as already linked", async () => {
    const log = quiet();
    const a = note("a.md", "[[b]] [[c]]");
    const [b, c] = ["b.md", "c.md"].map((p) => note(p));
    const t = fake({
      notes: [a, b!, c!],
      refuseLink: (r) =>
        r.to_note === b!.id
          ? {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "links_pair_idx"',
            }
          : undefined,
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      linked: 1,
      already: 1,
      failed: 0,
    });
    expect(inserts(t).map((rows) => rows.length)).toEqual([2, 1, 1]);
    // The refused chunk is logged by its code; the pair that is already linked is no failure.
    expect(log.mock.calls).toEqual([["connect links insert failed", "23505"]]);
  });

  it("links a note whose name has a dot in it", async () => {
    const a = note("a.md", "[[Node.js]] [[claude.ai]] [[Report 2026.Q4]]");
    const named = ["Node.js.md", "tools/claude.ai.md", "Report 2026.Q4.md"].map(
      (p) => note(p),
    );
    const t = fake({ notes: [a, ...named] });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      linked: 3,
      missing: 0,
    });
    expect(
      inserts(t)
        .flat()
        .map((l) => l.to_note),
    ).toEqual(named.map((n) => n.id));
  });

  it("neither links nor counts a file that is not a note, and counts a missing note", async () => {
    const a = note(
      "a.md",
      "![[pic.png]] [[files/Doc.PDF#page=2]] [[Node.js]] [[Meeting 2026.11.24]] [[gone.md]]",
    );
    const t = fake({ notes: [a, note("b.md")] });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      linked: 0,
      // The meeting and `gone.md`; the three that look like files say nothing.
      missing: 2,
    });
    expect(inserts(t)).toEqual([]);
  });

  it("answers the 40th path as the cursor when 40 notes came back, and null for fewer", async () => {
    const paths = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        note(`n/${String(i).padStart(3, "0")}.md`),
      );
    const full = fake({ notes: paths(40) });
    expect(await connectBatchIn(full.db, W1, null)).toMatchObject({
      ok: true,
      next: "n/039.md",
      scanned: 40,
      total: 40,
    });
    const short = fake({ notes: paths(39) });
    expect(await connectBatchIn(short.db, W1, null)).toMatchObject({
      ok: true,
      next: null,
      scanned: 39,
    });
    const more = fake({ notes: paths(100) });
    expect(await connectBatchIn(more.db, W1, "n/039.md")).toMatchObject({
      next: "n/079.md",
      scanned: 40,
      total: 100,
    });
    expect(await connectBatchIn(more.db, W1, "n/079.md")).toMatchObject({
      next: null,
      scanned: 20,
    });
  });

  it("reads the notes after the cursor with gt, 40 at a time, in path order", async () => {
    const t = fake({
      notes: [note("a.md"), note("b.md", "[[a]]"), note("c.md")],
    });
    const cursor = 'a.md"),(x,y)';
    expect(await connectBatchIn(t.db, W1, cursor)).toMatchObject({
      ok: true,
      scanned: 2,
      linked: 1,
    });
    const batch = reads(t, "notes").filter((c) => op(c, "limit"));
    expect(batch).toHaveLength(1);
    expect(batch[0]!.ops).toEqual([
      ["select", ["id, path, body, frontmatter"]],
      ["eq", ["workspace_id", W1]],
      ["eq", ["member_id", ME]],
      ["gt", ["path", cursor]],
      ["order", ["path"]],
      ["limit", [40]],
    ]);
    const first = fake({ notes: [note("a.md")] });
    await connectBatchIn(first.db, W1, null);
    expect(reads(first, "notes").filter((c) => op(c, "limit"))[0]!.ops).toEqual(
      [
        ["select", ["id, path, body, frontmatter"]],
        ["eq", ["workspace_id", W1]],
        ["eq", ["member_id", ME]],
        ["order", ["path"]],
        ["limit", [40]],
      ],
    );
  });

  it("filters every read of notes on the workspace and on the member of its row", async () => {
    const notes = Array.from({ length: 1100 }, (_, i) =>
      note(`n/${String(i).padStart(4, "0")}.md`, i === 3 ? "[[0007]]" : ""),
    );
    const t = fake({ notes });
    await connectBatchIn(t.db, W1, "n/0001.md");
    const all = reads(t, "notes");
    expect(all).toHaveLength(3);
    for (const c of all)
      expect(c.ops.filter(([m]) => m === "eq")).toEqual([
        ["eq", ["workspace_id", W1]],
        ["eq", ["member_id", ME]],
      ]);
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("builds the links filter from uuids only, and sends nothing but the five columns", async () => {
    const a = note("a.md", "[[b]]");
    const b = note("b.md");
    const t = fake({ notes: [a, b] });
    await connectBatchIn(t.db, W1, null);
    // `orLists` in the fake refuses any other text.
    expect(orLists(op(reads(t, "links")[0]!, "or")![0])).toEqual([
      [a.id, b.id],
      [a.id, b.id],
    ]);
    const sent = inserts(t).flat();
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]!).sort()).toEqual([
      "from_note",
      "hive_id",
      "score",
      "tier",
      "to_note",
    ]);
    // Nothing is updated or deleted: the fake has neither, and a call to one would throw.
  });

  it("refuses when a read answers a note whose id is not a uuid, and writes nothing", async () => {
    const evil = "x),to_note.not.in.(y";
    for (const bad of [
      { id: evil, path: "a.md", body: "[[b]]", frontmatter: {} },
      { id: nid(1), path: 7, body: "[[b]]", frontmatter: {} },
      null,
      "row",
    ]) {
      const t = fake({
        notes: [note("a.md", "[[b]]"), note("b.md")],
        fail: (c) =>
          c.table === "notes" && op(c, "limit") ? ok([bad]) : undefined,
      });
      expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
      expect(t.calls.some((c) => c.table === "links")).toBe(false);
    }
  });

  it("ignores rows of the index and of the links that are malformed", async () => {
    const a = note("a.md", "[[b]] [[c]]");
    const b = note("b.md");
    const t = fake({
      notes: [a, b],
      fail: (c) => {
        if (c.table === "notes" && op(c, "range"))
          return ok(
            [
              null,
              "row",
              { id: "nope", path: "c.md" },
              { id: nid(5), path: 7 },
              { id: a.id, path: "a.md" },
              { id: b.id, path: "b.md" },
            ],
            6,
          );
        if (c.table === "links" && kind(c) === "select")
          return ok(
            [null, { from_note: 7, to_note: b.id }, { from_note: a.id }],
            3,
          );
        return undefined;
      },
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      total: 2,
      linked: 1,
      missing: 1,
    });
  });

  it("takes a note whose text is not text as empty, and survives fields of any shape", async () => {
    const t = fake({
      notes: [
        note("a.md", "", { body: null, frontmatter: "[[b]]" }),
        note("b.md", "", { body: 7, frontmatter: null }),
        note("c.md", "", { body: undefined, frontmatter: [["[[a]]"]] }),
      ],
    });
    expect(await connectBatchIn(t.db, W1, null)).toMatchObject({
      ok: true,
      scanned: 3,
      linked: 2,
      missing: 0,
    });
  });

  it("refuses when a read fails or answers no list, and writes nothing", async () => {
    quiet();
    const notes = [note("a.md", "[[b]]"), note("b.md")];
    const which: ((c: Call) => boolean)[] = [
      (c) => c.table === "workspaces",
      (c) => c.table === "members",
      (c) => c.table === "notes" && !!op(c, "range"),
      (c) => c.table === "notes" && !!op(c, "limit") && !op(c, "range"),
      (c) => c.table === "links" && kind(c) === "select",
    ];
    for (const hits of which)
      for (const said of [no("boom", "XX000"), ok(null), ok("rows"), ok({})]) {
        const t = fake({ notes, fail: (c) => (hits(c) ? said : undefined) });
        expect(await connectBatchIn(t.db, W1, null)).toEqual({ ok: false });
        expect(inserts(t)).toEqual([]);
      }
  });

  it("never logs or answers a path, a title or a text, whatever the database says", async () => {
    const log = quiet();
    const notes = [
      note("Secret plans/a.md", "the body says [[b]] [[c]] and a secret"),
      note("Secret plans/b.md"),
      note("Secret plans/c.md"),
    ];
    const loud = no(
      'failed to parse filter (Secret plans/a.md) "title of Secret plans/a.md": the body says a secret',
      "PGRST100",
    );
    const which: ((c: Call) => boolean)[] = [
      (c) => c.table === "notes" && !!op(c, "range"),
      (c) => c.table === "notes" && !op(c, "range"),
      (c) => c.table === "links" && kind(c) === "select",
      (c) => c.table === "links" && kind(c) === "insert",
    ];
    for (const hits of which) {
      const t = fake({ notes, fail: (c) => (hits(c) ? loud : undefined) });
      const r = await connectBatchIn(t.db, W1, "Secret plans/0.md");
      expect(JSON.stringify(r)).not.toMatch(/Secret|title of|body says/);
    }
    // One line a failed read; the refused chunk and its two notes one each.
    expect(log).toHaveBeenCalledTimes(6);
    for (const line of log.mock.calls) {
      expect(line.join(" ")).not.toMatch(/Secret|title of|body says|\.md/);
      expect(line).toContain("PGRST100");
    }
    // A run that goes well logs nothing, and answers numbers and its cursor only.
    log.mockClear();
    const fine = fake({ notes });
    const r = await connectBatchIn(fine.db, W1, null);
    expect(log).not.toHaveBeenCalled();
    expect(r).toEqual({
      ok: true,
      next: null,
      total: 3,
      scanned: 3,
      linked: 2,
      already: 0,
      missing: 0,
      failed: 0,
    });
  });
});
