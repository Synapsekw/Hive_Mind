import { describe, expect, it, vi } from "vitest";
import { openNoteIn, readOpenNote, toNote, toOpen } from "./load-vault";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const U_ME = "11111111-1111-4111-8111-111111111101";
const W1 = "00000000-0000-4000-8000-000000000b01";
const MINE = "00000000-0000-4000-8000-000000010001";
const OTHER = "00000000-0000-4000-8000-000000020001";
const LINK = "00000000-0000-4000-8000-000000000c01";
const T1 = "00000000-0000-4000-8000-000000000e01";
const T2 = "00000000-0000-4000-8000-000000000e02";

type Res = { data: unknown; error: { message: string; code?: string } | null };
type Call = { table: string; ops: [string, unknown[]][] };
const ok = (data: unknown): Res => ({ data, error: null });
const boom: Res = { data: null, error: { message: "boom", code: "XX000" } };

const tokenOf = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: W1,
    member_id: ME,
    path: `notes/${id}.md`,
    title: `Note ${id}`,
    updated_at: "2026-11-22T10:00:00Z",
    written_by_agent: null,
    visibility: null,
    shared_with: [],
    quarantined: false,
    effective: "private",
    effective_with: [],
    rule_folder: null,
    access: "own",
    body: "Hello",
    note_entities: [],
    ...over,
  };
}

const link = (n: number) => ({
  id: LINK.replace("c01", String(100 + n)),
  note_id: OTHER,
  title: `Link ${n}`,
  owner: "Ahmed",
  mine: false,
});

/** A stand-in client: every chain is recorded and settles to what `answer` returns for it. */
function stub(answer: (c: Call) => Res | undefined) {
  const calls: Call[] = [];
  const chain = (call: Call) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "in", "range"])
      c[m] = (...args: unknown[]) => {
        if (call.table === "members" && m === "eq" && args[0] === "user_id")
          call.table = "own";
        call.ops.push([m, args]);
        return c;
      };
    c.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call) ?? ok([])).then(res, rej);
    return c;
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    return chain(call);
  });
  const rpc = vi.fn((name: string, args?: unknown) => {
    const call: Call = { table: `rpc:${name}`, ops: [["args", [args]]] };
    calls.push(call);
    return chain(call);
  });
  const auth = {
    getUser: vi.fn(async (): Promise<never> => {
      throw new Error("must not call the auth server");
    }),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: tokenOf(U_ME) } },
      error: null,
    })),
  };
  return { db: { from, rpc, auth } as never, calls };
}

function world(opts: {
  note?: unknown[];
  links?: Res;
  entities?: Res;
  fail?: string;
}) {
  return (c: Call): Res | undefined => {
    if (opts.fail === c.table) return boom;
    if (c.table === "own")
      return ok([{ id: ME, hive_id: HIVE, hive: { name: "Synapse" } }]);
    if (c.table === "notes") return ok(opts.note ?? []);
    if (c.table === "rpc:note_links") return opts.links ?? ok([]);
    if (c.table === "entities") return opts.entities ?? ok([]);
    return undefined;
  };
}

describe("readOpenNote and toOpen", () => {
  it("answers missing when no row comes back", async () => {
    const t = stub(world({ note: [] }));
    const read = await readOpenNote(t.db, MINE);
    if (read === "error") throw new Error("error");
    expect(toOpen(read, ME)).toEqual({ missing: true });
  });

  it("reads the note with its body and the per-row columns, and its links", async () => {
    const t = stub(world({ note: [row(MINE)], links: ok([link(1)]) }));
    const read = await readOpenNote(t.db, MINE);
    if (read === "error") throw new Error("error");
    expect(toOpen(read, ME)).toEqual({
      note: toNote(row(MINE), ME),
      body: "Hello",
      cut: false,
      links: [link(1)],
    });
    const notes = t.calls.find((c) => c.table === "notes")!;
    expect(String(notes.ops[0]![1][0])).toMatch(/note_access.*,body$/);
    expect(notes.ops).toContainEqual(["eq", ["id", MINE]]);
    expect(notes.ops).toContainEqual(["limit", [1]]);
  });

  it("cuts a body over 200,000 characters", async () => {
    const t = stub(world({ note: [row(MINE, { body: "a".repeat(200_001) })] }));
    const read = await readOpenNote(t.db, MINE);
    if (read === "error") throw new Error("error");
    const open = toOpen(read, ME) as { body: string; cut: boolean };
    expect(open.body).toHaveLength(200_000);
    expect(open.cut).toBe(true);
  });

  it("shows at most 50 links", async () => {
    const many = Array.from({ length: 60 }, (_, i) => link(i));
    const t = stub(world({ note: [row(MINE)], links: ok(many) }));
    const read = await readOpenNote(t.db, MINE);
    if (read === "error") throw new Error("error");
    expect((toOpen(read, ME) as { links: unknown[] }).links).toHaveLength(50);
  });

  it("is error when the note's read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(world({ fail: "notes" }));
    expect(await readOpenNote(t.db, MINE)).toBe("error");
    expect(spy).toHaveBeenCalledWith("note query failed", "XX000", "boom");
    spy.mockRestore();
  });
});

describe("openNoteIn", () => {
  it("answers missing for an id that is not a uuid, and reads nothing", async () => {
    const t = stub(world({}));
    expect(await openNoteIn(t.db, "x' or 1=1")).toEqual({
      ok: true,
      open: { missing: true },
    });
    expect(await openNoteIn(t.db, 42)).toEqual({
      ok: true,
      open: { missing: true },
    });
    expect(t.calls).toEqual([]);
  });

  it("answers the note, read under the session, without re-reading the index", async () => {
    const t = stub(world({ note: [row(MINE)], links: ok([link(1)]) }));
    expect(await openNoteIn(t.db, MINE)).toEqual({
      ok: true,
      open: {
        note: toNote(row(MINE), ME),
        body: "Hello",
        cut: false,
        links: [link(1)],
      },
    });
    const tables = t.calls.map((c) => c.table);
    expect(tables).not.toContain("rpc:vault_index");
    expect(tables).not.toContain("workspaces");
    expect(tables).not.toContain("folders");
    expect(tables.filter((x) => x === "members")).toEqual([]);
    // A note without topics reads no topics.
    expect(tables).not.toContain("entities");
  });

  it("reads only the note's own topics, and ranks them as the vault does", async () => {
    const note = row(MINE, {
      note_entities: [
        { entity_id: T1, confidence: 0.5, detached_at: null },
        { entity_id: T2, confidence: 0.9, detached_at: null },
      ],
    });
    const t = stub(
      world({
        note: [note],
        entities: ok([
          { id: T1, type: "person", canonical_name: "Ana" },
          { id: T2, type: "project", canonical_name: "Bee" },
        ]),
      }),
    );
    const out = await openNoteIn(t.db, MINE);
    if (!out.ok) throw new Error("failed");
    const known = new Map([
      [T1, { id: T1, kind: "person" as const, name: "Ana" }],
      [T2, { id: T2, kind: "project" as const, name: "Bee" }],
    ]);
    expect(out.open).toMatchObject({
      note: { topics: toNote(note, ME, known).topics },
    });
    const ents = t.calls.find((c) => c.table === "entities")!;
    const asked = ents.ops.find(([m]) => m === "in")![1] as [string, string[]];
    expect(asked[0]).toBe("id");
    expect([...asked[1]].sort()).toEqual([T1, T2]);
  });

  it("still answers the note when its topics cannot be read", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const note = row(MINE, {
      note_entities: [{ entity_id: T1, confidence: 0.5, detached_at: null }],
    });
    const t = stub(world({ note: [note], fail: "entities" }));
    const out = await openNoteIn(t.db, MINE);
    expect(out).toMatchObject({ ok: true, open: { note: { topics: [T1] } } });
    spy.mockRestore();
  });

  it("answers missing when the note cannot be seen", async () => {
    const t = stub(world({ note: [] }));
    expect(await openNoteIn(t.db, MINE)).toEqual({
      ok: true,
      open: { missing: true },
    });
  });

  for (const table of ["notes", "own"]) {
    it(`answers not ok when the ${table} read fails, logging only code and message`, async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub(
        world({ note: [row(MINE, { title: "Secret" })], fail: table }),
      );
      expect(await openNoteIn(t.db, MINE)).toEqual({ ok: false });
      expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
      spy.mockRestore();
    });
  }

  it("answers not ok when the person is in no hive", async () => {
    const base = world({ note: [row(MINE)] });
    const t = stub((c) => (c.table === "own" ? ok([]) : base(c)));
    expect(await openNoteIn(t.db, MINE)).toEqual({ ok: false });
  });
});
