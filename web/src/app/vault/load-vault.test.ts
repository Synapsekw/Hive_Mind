import { describe, expect, it, vi } from "vitest";
import { loadVault, toNote } from "./load-vault";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const W1 = "00000000-0000-4000-8000-000000000b01";
const W2 = "00000000-0000-4000-8000-000000000b02";
const MINE = "00000000-0000-4000-8000-000000010001";
const THEIRS = "00000000-0000-4000-8000-000000020001";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

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
    ...over,
  };
}

const ok = (data: unknown): Res => ({ data, error: null });

/**
 * A stand-in client: every `from(table)` chain is recorded and resolves to what `answer`
 * returns for it. `getUser` answers with the caller's user id.
 */
function stub(
  answer: (c: Call) => Res | undefined,
  user: { id: string } | null = { id: "u-me" },
) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "in"])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call) ?? ok([])).then(res, rej);
    return chain;
  });
  const rpc = vi.fn();
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, rpc, auth } as never, calls, from, rpc };
}

const op = (c: Call, name: string) => c.ops.filter(([m]) => m === name);
const selected = (c: Call) => String(op(c, "select")[0]?.[1][0] ?? "");
const has = (c: Call, name: string, ...args: unknown[]) =>
  c.ops.some(
    ([m, a]) => m === name && JSON.stringify(a) === JSON.stringify(args),
  );

/** A hive with me and Ahmed, two workspaces, and `notes` for the index reads. */
function world(opts: {
  index?: unknown[];
  shared?: unknown[];
  open?: unknown[];
  fail?: string;
}) {
  return (c: Call): Res | undefined => {
    if (opts.fail === c.table)
      return {
        data: null,
        error: { message: "boom", code: "XX000", details: "Secret title" },
      };
    if (c.table === "hives") return ok([{ id: HIVE, name: "Synapse" }]);
    if (c.table === "members")
      return ok([
        { id: ME, display_name: "Danijel", user_id: "u-me" },
        { id: AHMED, display_name: "Ahmed", user_id: "u-ahmed" },
      ]);
    if (c.table === "workspaces")
      return ok([
        { id: W1, name: "Main" },
        { id: W2, name: "Ops" },
      ]);
    if (c.table === "folders")
      return ok([{ path: "Decisions", visibility: "group", shared_with: [] }]);
    if (c.table === "notes") {
      if (has(c, "eq", "id", MINE) || has(c, "eq", "id", THEIRS))
        return ok(opts.open ?? []);
      if (op(c, "neq").length) return ok(opts.shared ?? []);
      return ok(opts.index ?? []);
    }
    return undefined;
  };
}

describe("loadVault", () => {
  it("reads the first hive, its members, own workspaces, and the first workspace's index", async () => {
    const t = stub(world({ index: [row(MINE)] }));
    const out = await loadVault(t.db, {});
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    expect(out.data.hive).toEqual({ id: HIVE, name: "Synapse" });
    expect(out.data.me).toBe(ME);
    expect(out.data.members).toEqual([
      { id: ME, display_name: "Danijel" },
      { id: AHMED, display_name: "Ahmed" },
    ]);
    expect(out.data.workspaces).toEqual([
      { id: W1, name: "Main" },
      { id: W2, name: "Ops" },
    ]);
    expect(out.data.tab).toEqual({ kind: "workspace", id: W1 });
    expect(out.data.folders).toEqual([
      { path: "Decisions", visibility: "group", shared_with: [] },
    ]);
    expect(out.data.notes.map((n) => n.id)).toEqual([MINE]);
    expect(out.data.open).toBeNull();
    expect(out.data.truncated).toBe(false);

    const hives = t.calls.find((c) => c.table === "hives")!;
    expect(has(hives, "order", "created_at", { ascending: true })).toBe(true);
    expect(has(hives, "limit", 1)).toBe(true);
    const index = t.calls.find((c) => c.table === "notes")!;
    expect(has(index, "eq", "workspace_id", W1)).toBe(true);
    expect(has(index, "order", "path")).toBe(true);
    expect(has(index, "limit", 2001)).toBe(true);
    expect(selected(index)).toContain("effective:note_visibility");
    expect(selected(index)).toContain("effective_with:note_shared_with");
    expect(selected(index)).toContain("rule_folder:note_rule_folder");
    expect(selected(index)).toContain("access:note_access");
    expect(t.calls.map((c) => c.table).sort()).toEqual(
      ["folders", "hives", "members", "notes", "workspaces"].sort(),
    );
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("never selects a body in an index read", async () => {
    const t = stub(world({ index: [row(MINE)], shared: [] }));
    await loadVault(t.db, {});
    await loadVault(t.db, { tab: "shared" });
    const reads = t.calls.filter((c) => c.table === "notes");
    expect(reads).toHaveLength(2);
    for (const c of reads) expect(selected(c)).not.toMatch(/\bbody\b/);
  });

  it("caps the index at 2,000 notes and says it was cut", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) =>
      row(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const t = stub(world({ index: rows }));
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.notes).toHaveLength(2000);
    expect(out.data.truncated).toBe(true);
  });

  it("opens the workspace named in ?ws=, and falls back to the first for an unknown one", async () => {
    const t = stub(world({}));
    const a = await loadVault(t.db, { ws: W2 });
    if (a.state !== "ok") throw new Error(a.state);
    expect(a.data.tab).toEqual({ kind: "workspace", id: W2 });
    const b = await loadVault(t.db, { ws: "1 or 1=1" });
    if (b.state !== "ok") throw new Error(b.state);
    expect(b.data.tab).toEqual({ kind: "workspace", id: W1 });
  });

  it("reads colleagues' notes on the shared tab, newest first, with no folders", async () => {
    const t = stub(
      world({ shared: [row(THEIRS, { member_id: AHMED, access: null })] }),
    );
    const out = await loadVault(t.db, { tab: "shared" });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.tab).toEqual({ kind: "shared" });
    expect(out.data.folders).toEqual([]);
    expect(out.data.notes[0]!.access).toBe("link");
    const read = t.calls.find((c) => c.table === "notes")!;
    expect(has(read, "neq", "member_id", ME)).toBe(true);
    expect(has(read, "order", "updated_at", { ascending: false })).toBe(true);
    expect(t.calls.some((c) => c.table === "folders")).toBe(false);
  });

  it("opens a colleague's note on the shared tab", async () => {
    const theirs = row(THEIRS, {
      member_id: AHMED,
      workspace_id: "00000000-0000-4000-8000-000000000b03",
      effective: "group",
      access: "shared",
      body: "# Theirs",
    });
    const t = stub(world({ open: [theirs], shared: [theirs] }));
    const out = await loadVault(t.db, { note: THEIRS });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.tab.kind).toBe("shared");
    expect(out.data.open).toMatchObject({
      note: { id: THEIRS, access: "shared" },
      body: "# Theirs",
      cut: false,
    });
    const one = t.calls.find(
      (c) => c.table === "notes" && has(c, "eq", "id", THEIRS),
    )!;
    expect(selected(one)).toMatch(/\bbody\b/);
  });

  it("opens my own note in its own workspace", async () => {
    const mine = row(MINE, { workspace_id: W2, body: "Hello" });
    const t = stub(world({ open: [mine], index: [mine] }));
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.tab).toEqual({ kind: "workspace", id: W2 });
    expect(out.data.open).toMatchObject({ note: { id: MINE }, body: "Hello" });
  });

  it("says a note is missing when no row comes back, or when the id is not a uuid", async () => {
    const t = stub(world({ open: [] }));
    const a = await loadVault(t.db, { note: MINE });
    if (a.state !== "ok") throw new Error(a.state);
    expect(a.data.open).toEqual({ missing: true });

    const u = stub(world({}));
    const b = await loadVault(u.db, { note: "x' or 1=1" });
    if (b.state !== "ok") throw new Error(b.state);
    expect(b.data.open).toEqual({ missing: true });
    expect(u.calls.filter((c) => c.table === "notes")).toHaveLength(1);
  });

  it("cuts a body over 200,000 characters", async () => {
    const mine = row(MINE, { body: "a".repeat(200_001) });
    const t = stub(world({ open: [mine] }));
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    const open = out.data.open as { body: string; cut: boolean };
    expect(open.body).toHaveLength(200_000);
    expect(open.cut).toBe(true);
  });

  it("is no-hive when the caller has no hive, and reads nothing else", async () => {
    const t = stub((c) => (c.table === "hives" ? ok([]) : undefined));
    expect(await loadVault(t.db, {})).toEqual({ state: "no-hive" });
    expect(t.calls.map((c) => c.table)).toEqual(["hives"]);
  });

  it("is error when there is no session", async () => {
    const t = stub(world({}), null);
    expect(await loadVault(t.db, {})).toEqual({ state: "error" });
  });

  for (const table of ["hives", "members", "workspaces", "folders", "notes"]) {
    it(`is error when the ${table} read fails, logging only code and message`, async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub(world({ fail: table }));
      expect(await loadVault(t.db, {})).toEqual({ state: "error" });
      expect(spy).toHaveBeenCalled();
      for (const args of spy.mock.calls) {
        expect(args).toContain("XX000");
        expect(args).toContain("boom");
      }
      expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
      spy.mockRestore();
    });
  }

  it("is error when the open note's read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const base = world({});
    const t = stub((c) =>
      c.table === "notes" && has(c, "eq", "id", MINE)
        ? { data: null, error: { message: "boom", code: "XX000" } }
        : base(c),
    );
    expect(await loadVault(t.db, { note: MINE })).toEqual({ state: "error" });
    spy.mockRestore();
  });
});

describe("toNote", () => {
  it("maps a row, reading null computed columns as private, nobody and a link", () => {
    expect(
      toNote(
        row(THEIRS, {
          member_id: AHMED,
          written_by_agent: "00000000-0000-4000-8000-0000000000a1",
          shared_with: null,
          effective: null,
          effective_with: null,
          access: null,
        }),
        ME,
      ),
    ).toEqual({
      id: THEIRS,
      workspace_id: W1,
      member_id: AHMED,
      path: `notes/${THEIRS}.md`,
      title: `Note ${THEIRS}`,
      updated_at: "2026-11-22T10:00:00Z",
      by_agent: true,
      visibility: null,
      shared_with: [],
      quarantined: false,
      effective: "private",
      effective_with: [],
      rule_folder: null,
      access: "link",
    });
  });

  it("keeps the database's values when present", () => {
    const n = toNote(
      row(MINE, {
        visibility: "members",
        shared_with: [AHMED],
        effective: "members",
        effective_with: [AHMED],
        rule_folder: "Decisions",
        quarantined: true,
      }),
      ME,
    );
    expect(n).toMatchObject({
      visibility: "members",
      shared_with: [AHMED],
      effective: "members",
      effective_with: [AHMED],
      rule_folder: "Decisions",
      quarantined: true,
      access: "own",
      by_agent: false,
    });
  });
});
