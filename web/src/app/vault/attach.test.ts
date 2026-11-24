import { afterEach, describe, expect, it, vi } from "vitest";
import { attachBatchIn } from "./attach";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const UID = "00000000-0000-4000-8000-0000000000aa";
const W1 = "00000000-0000-4000-8000-000000000b01";
const ZAIN = "00000000-0000-4000-8000-0000000000e1";
const TERRA = "00000000-0000-4000-8000-0000000000e2";

type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null; count?: unknown };
type Row = Record<string, unknown>;
type Call = { table: string; ops: [string, unknown[]][] };

const nid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const op = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];
const note = (n: number, path: string, over: Row = {}): Row => ({
  id: nid(n),
  workspace_id: W1,
  member_id: ME,
  path,
  title: "Untitled",
  body: "",
  frontmatter: {},
  ...over,
});
const TOPICS: Row[] = [
  {
    id: ZAIN,
    hive_id: HIVE,
    type: "client",
    canonical_name: "Zain",
    aliases: ["ZainTech"],
  },
  {
    id: TERRA,
    hive_id: HIVE,
    type: "vendor",
    canonical_name: "Terra Drone",
    aliases: [],
  },
];

/** A small database in memory, speaking the part of the client the step uses. */
function fake(
  opts: {
    user?: { id: string } | null;
    workspaces?: Row[];
    entities?: Row[];
    notes?: Row[];
    pairs?: Row[];
    fail?: (c: Call) => Res | undefined;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    workspaces: opts.workspaces ?? [{ id: W1, hive_id: HIVE, member_id: ME }],
    members: [{ id: ME, hive_id: HIVE, user_id: UID }],
    entities: opts.entities ?? TOPICS,
    notes: opts.notes ?? [],
    note_entities: opts.pairs ?? [],
  };
  const calls: Call[] = [];
  const run = (c: Call): Res => {
    const said = opts.fail?.(c);
    if (said) return said;
    const table = tables[c.table]!;
    const inserted = op(c, "insert")?.[0] as Row[] | undefined;
    if (inserted) {
      for (const r of inserted)
        if (
          table.some(
            (p) => p.note_id === r.note_id && p.entity_id === r.entity_id,
          )
        )
          return {
            data: null,
            error: { message: "duplicate key", code: "23505" },
          };
      table.push(...inserted.map((r) => ({ detached_at: null, ...r })));
      return { data: null, error: null };
    }
    let hit = table.filter((r) =>
      c.ops.every(([m, a]) => {
        if (m === "eq") return r[a[0] as string] === a[1];
        if (m === "gt") return String(r[a[0] as string]) > String(a[1]);
        if (m === "in") return (a[1] as unknown[]).includes(r[a[0] as string]);
        return true;
      }),
    );
    const by = c.ops
      .filter(([m]) => m === "order")
      .map(([, a]) => a[0] as string);
    if (by.length > 0)
      hit = [...hit].sort((x, y) => {
        for (const k of by) {
          if (String(x[k]) < String(y[k])) return -1;
          if (String(x[k]) > String(y[k])) return 1;
        }
        return 0;
      });
    const asked = op(c, "select")?.[1] as
      { count?: string; head?: boolean } | undefined;
    const count = asked?.count === "exact" ? hit.length : undefined;
    if (asked?.head) return { data: null, error: null, count };
    const range = op(c, "range") as [number, number] | undefined;
    if (range) hit = hit.slice(range[0], range[1] + 1);
    const limit = op(c, "limit")?.[0] as number | undefined;
    if (limit !== undefined) hit = hit.slice(0, limit);
    return { data: hit, error: null, count };
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "insert",
      "eq",
      "gt",
      "in",
      "order",
      "range",
      "limit",
    ])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
      new Promise<Res>((resolve) => resolve(run(call))).then(ok, no);
    return chain;
  });
  const user = opts.user === undefined ? { id: UID } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, auth } as never, calls, tables, from, auth };
}

const pairs = (t: { tables: Record<string, Row[]> }) =>
  t.tables
    .note_entities!.map((p) => `${p.note_id}>${p.entity_id}@${p.confidence}`)
    .sort();

afterEach(() => vi.restoreAllMocks());

describe("attachBatchIn", () => {
  it.each([
    ["a workspace id that is a word", "nope", null],
    ["a workspace id with a filter appended", `${W1},x`, null],
    ["a cursor that is a number", W1, 7],
    ["an empty cursor", W1, ""],
    ["a cursor over 4000 characters", W1, "x".repeat(4001)],
    ["a cursor with a NUL", W1, "a\u0000b"],
  ])("refuses %s before any query", async (_name, ws, after) => {
    const t = fake();
    expect(await attachBatchIn(t.db, ws, after)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("refuses without a session and for a workspace that is not the person's own", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await attachBatchIn(fake({ user: null }).db, W1, null)).toEqual({
      ok: false,
    });
    const other = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: nid(99) }],
    });
    expect(await attachBatchIn(other.db, W1, null)).toEqual({ ok: false });
    expect(other.tables.note_entities).toEqual([]);
  });

  it("with no topics in the hive, reads no note and says so", async () => {
    const t = fake({ entities: [], notes: [note(1, "a.md")] });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({
      ok: true,
      next: null,
      total: 0,
      scanned: 0,
      attached: 0,
      already: 0,
      none: 0,
      failed: 0,
      topics: 0,
    });
    expect(t.calls.some((c) => c.table === "notes")).toBe(false);
  });

  it("attaches each note to its topics with the rule's confidence, and counts", async () => {
    const t = fake({
      notes: [
        note(1, "sources/zain/a.md"),
        note(2, "b.md", {
          title: "Terra Drone brochure",
          body: "for ZainTech",
        }),
        note(3, "c.md", { body: "nothing here" }),
      ],
    });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({
      ok: true,
      next: null,
      total: 3,
      scanned: 3,
      attached: 3,
      already: 0,
      none: 1,
      failed: 0,
      topics: 2,
    });
    expect(pairs(t)).toEqual(
      [
        `${nid(1)}>${ZAIN}@0.9`,
        `${nid(2)}>${TERRA}@0.7`,
        `${nid(2)}>${ZAIN}@0.5`,
      ].sort(),
    );
  });

  it("leaves a pair that is there, counts it, and never brings back a detached one", async () => {
    const t = fake({
      notes: [note(1, "sources/zain/a.md", { title: "Terra Drone" })],
      pairs: [
        {
          note_id: nid(1),
          entity_id: ZAIN,
          confidence: 0.9,
          detached_at: null,
        },
        {
          note_id: nid(1),
          entity_id: TERRA,
          confidence: 0.7,
          detached_at: "2026-11-24T12:00:00Z",
        },
      ],
    });
    const out = await attachBatchIn(t.db, W1, null);
    expect(out).toMatchObject({ ok: true, attached: 0, already: 1, none: 0 });
    expect(t.tables.note_entities).toHaveLength(2);
    expect(t.calls.some((c) => op(c, "insert"))).toBe(false);
  });

  it("counts a note whose only topic was detached as having none", async () => {
    const t = fake({
      notes: [note(1, "sources/zain/a.md")],
      pairs: [
        {
          note_id: nid(1),
          entity_id: ZAIN,
          confidence: 0.9,
          detached_at: "2026-11-24T12:00:00Z",
        },
      ],
    });
    expect(await attachBatchIn(t.db, W1, null)).toMatchObject({
      attached: 0,
      already: 0,
      none: 1,
    });
  });

  it("reads 40 notes a step in path order and hands back the last path as the cursor", async () => {
    const notes = Array.from({ length: 45 }, (_, i) =>
      note(i + 1, `zain/${String(i).padStart(3, "0")}.md`),
    );
    const t = fake({ notes });
    const first = await attachBatchIn(t.db, W1, null);
    expect(first).toMatchObject({
      ok: true,
      scanned: 40,
      total: 45,
      attached: 40,
      next: "zain/039.md",
    });
    const second = await attachBatchIn(t.db, W1, "zain/039.md");
    expect(second).toMatchObject({
      ok: true,
      scanned: 5,
      attached: 5,
      next: null,
    });
    expect(t.tables.note_entities).toHaveLength(45);
  });

  it("when a chunk is refused, saves the pairs one by one and counts the ones that fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let inserts = 0;
    const t = fake({
      notes: [note(1, "zain/a.md"), note(2, "zain/b.md")],
      fail: (c) => {
        if (c.table !== "note_entities" || !op(c, "insert")) return undefined;
        inserts += 1;
        // The chunk, then the first of the two single inserts.
        return inserts <= 2
          ? { data: null, error: { message: "boom", code: "XX000" } }
          : undefined;
      },
    });
    expect(await attachBatchIn(t.db, W1, null)).toMatchObject({
      attached: 1,
      failed: 1,
    });
  });

  it("refuses the step when the hive is being deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fake({
      notes: [note(1, "zain/a.md")],
      fail: (c) =>
        c.table === "note_entities" && op(c, "insert")
          ? {
              data: null,
              error: { message: "this hive is being deleted", code: "P0001" },
            }
          : undefined,
    });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({ ok: false });
  });

  it("logs no path, title or text when a read fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fake({
      notes: [
        note(1, "secret/path.md", {
          title: "Secret title",
          body: "Secret body",
        }),
      ],
      fail: (c) =>
        c.table === "notes" && !op(c, "select")?.[1]
          ? {
              data: null,
              error: { message: "boom secret/path.md", code: "XX000" },
            }
          : undefined,
    });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret|Secret/);
  });
});
