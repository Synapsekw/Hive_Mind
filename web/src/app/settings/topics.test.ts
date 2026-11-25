import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteTopicIn,
  saveTopicsIn,
  scanTopicsIn,
  SCAN_NOTES,
} from "./topics";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const UID = "00000000-0000-4000-8000-0000000000aa";
const W1 = "00000000-0000-4000-8000-000000000b01";
const T1 = "00000000-0000-4000-8000-0000000000e1";

type Res = { data: unknown; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Call = { table: string; ops: [string, unknown[]][] };
const op = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];

function fake(
  opts: {
    user?: { id: string } | null;
    workspaces?: Row[];
    notes?: Row[];
    answer?: (c: Call) => Res | undefined;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    workspaces: opts.workspaces ?? [{ id: W1, hive_id: HIVE, member_id: ME }],
    members: [{ id: ME, hive_id: HIVE, user_id: UID }],
    notes: opts.notes ?? [],
    entities: [],
  };
  const calls: Call[] = [];
  const run = (c: Call): Res => {
    const said = opts.answer?.(c);
    if (said) return said;
    let hit = (tables[c.table] ?? []).filter((r) =>
      c.ops.every(([m, a]) => {
        if (m === "eq") return r[a[0] as string] === a[1];
        if (m === "gt") return String(r[a[0] as string]) > String(a[1]);
        return true;
      }),
    );
    const by = op(c, "order")?.[0] as string | undefined;
    if (by)
      hit = [...hit].sort((x, y) => (String(x[by]) < String(y[by]) ? -1 : 1));
    const limit = op(c, "limit")?.[0] as number | undefined;
    if (limit !== undefined) hit = hit.slice(0, limit);
    return { data: hit, error: null };
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "upsert",
      "delete",
      "eq",
      "gt",
      "order",
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
  return { db: { from, auth } as never, calls, from, auth };
}

afterEach(() => vi.restoreAllMocks());

describe("scanTopicsIn", () => {
  it("refuses a malformed workspace id or cursor before any query", async () => {
    for (const [ws, after] of [
      ["nope", null],
      [W1, 7],
      [W1, ""],
      [W1, "x".repeat(4001)],
    ] as const) {
      const t = fake();
      expect(await scanTopicsIn(t.db, ws, after)).toEqual({ ok: false });
      expect(t.from).not.toHaveBeenCalled();
    }
  });

  it("refuses without a session and for somebody else's workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await scanTopicsIn(fake({ user: null }).db, W1, null)).toEqual({
      ok: false,
    });
    const other = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: "someone" }],
    });
    expect(await scanTopicsIn(other.db, W1, null)).toEqual({ ok: false });
  });

  it("answers each note's head, never its text, and asks for no text", async () => {
    const t = fake({
      notes: [
        {
          id: "n1",
          workspace_id: W1,
          member_id: ME,
          path: "Employers/Zain/_Index.md",
          title: "Zain Group",
          body: "SECRET",
          frontmatter: {
            type: "client-entity",
            aliases: ["ZainTech"],
            tags: ["kuwait"],
            x: 1,
          },
        },
      ],
    });
    const out = await scanTopicsIn(t.db, W1, null);
    expect(out).toEqual({
      ok: true,
      next: null,
      heads: [
        {
          path: "Employers/Zain/_Index.md",
          title: "Zain Group",
          type: "client-entity",
          aliases: ["ZainTech"],
          tags: ["kuwait"],
        },
      ],
    });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    const read = t.calls.find((c) => c.table === "notes")!;
    expect(op(read, "select")).toEqual(["path, title, frontmatter"]);
  });

  it("reads a page in path order and hands back the last path as the cursor", async () => {
    const notes = Array.from({ length: SCAN_NOTES + 1 }, (_, i) => ({
      id: `n${i}`,
      workspace_id: W1,
      member_id: ME,
      path: `p/${String(i).padStart(4, "0")}.md`,
      title: "t",
      frontmatter: {},
    }));
    const t = fake({ notes });
    const first = await scanTopicsIn(t.db, W1, null);
    if (!first.ok) throw new Error("expected ok");
    expect(first.heads).toHaveLength(SCAN_NOTES);
    expect(first.next).toBe(`p/${String(SCAN_NOTES - 1).padStart(4, "0")}.md`);
    const second = await scanTopicsIn(t.db, W1, first.next);
    expect(second).toMatchObject({ ok: true, next: null });
  });
});

describe("saveTopicsIn", () => {
  const pick = (over: Row = {}) => ({
    kind: "client",
    name: "Zain",
    aliases: ["ZainTech"],
    ...over,
  });

  it.each([
    ["a hive id that is a word", "nope", [pick()]],
    ["picks that are not a list", HIVE, { 0: pick() }],
    ["no picks", HIVE, []],
    [
      "over 200 picks",
      HIVE,
      Array.from({ length: 201 }, (_, i) => pick({ name: `n${i}` })),
    ],
    ["an unknown kind", HIVE, [pick({ kind: "enemy" })]],
    ["an empty name", HIVE, [pick({ name: "  " })]],
    ["a name over 80 characters", HIVE, [pick({ name: "x".repeat(81) })]],
    ["aliases that are not texts", HIVE, [pick({ aliases: [1] })]],
    [
      "over 20 aliases",
      HIVE,
      [pick({ aliases: Array.from({ length: 21 }, (_, i) => `a${i}`) })],
    ],
    ["a pick with a class", HIVE, [new Date()]],
  ])("refuses %s before any query", async (_name, hive, picks) => {
    const t = fake();
    expect(await saveTopicsIn(t.db, hive, picks)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("inserts known keys only, skips topics that are already there, and counts the new ones", async () => {
    const t = fake({
      answer: (c) =>
        c.table === "entities"
          ? { data: [{ id: T1 }], error: null }
          : undefined,
    });
    const out = await saveTopicsIn(t.db, HIVE.toUpperCase(), [
      { ...pick(), hive_id: "evil", id: "evil" },
      pick({ kind: "vendor", name: " Terra Drone ", aliases: [] }),
    ]);
    expect(out).toEqual({ ok: true, saved: 1 });
    const write = t.calls.find((c) => c.table === "entities")!;
    expect(op(write, "upsert")).toEqual([
      [
        {
          hive_id: HIVE,
          type: "client",
          canonical_name: "Zain",
          aliases: ["ZainTech"],
        },
        {
          hive_id: HIVE,
          type: "vendor",
          canonical_name: "Terra Drone",
          aliases: [],
        },
      ],
      { onConflict: "hive_id,type,canonical_name", ignoreDuplicates: true },
    ]);
    expect(op(write, "select")).toEqual(["id"]);
  });

  it("answers not ok when the database refuses, logging code and message only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fake({
      answer: (c) =>
        c.table === "entities"
          ? {
              data: null,
              error: {
                message: "new row violates row-level security",
                code: "42501",
              },
            }
          : undefined,
    });
    expect(await saveTopicsIn(t.db, HIVE, [pick()])).toEqual({ ok: false });
    expect(error).toHaveBeenCalledWith(
      "topics save failed",
      "42501",
      "new row violates row-level security",
    );
  });
});

describe("deleteTopicIn", () => {
  it("refuses an id that is not a uuid, and a caller with no session", async () => {
    const t = fake();
    expect(await deleteTopicIn(t.db, "nope")).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(await deleteTopicIn(fake({ user: null }).db, T1)).toEqual({
      ok: false,
    });
  });

  it("deletes that one topic, and answers not ok when no row went", async () => {
    const gone = fake({
      answer: (c) =>
        c.table === "entities"
          ? { data: [{ id: T1 }], error: null }
          : undefined,
    });
    expect(await deleteTopicIn(gone.db, T1)).toEqual({ ok: true });
    const call = gone.calls.find((c) => c.table === "entities")!;
    expect(call.ops.map(([m]) => m)).toEqual(["delete", "eq", "select"]);
    expect(op(call, "eq")).toEqual(["id", T1]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const none = fake({
      answer: (c) =>
        c.table === "entities" ? { data: [], error: null } : undefined,
    });
    expect(await deleteTopicIn(none.db, T1)).toEqual({ ok: false });
  });
});
