import { describe, expect, it, vi } from "vitest";
import { loadVault, toNote } from "./load-vault";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const U_ME = "11111111-1111-4111-8111-111111111101";
const W1 = "00000000-0000-4000-8000-000000000b01";
const W2 = "00000000-0000-4000-8000-000000000b02";
const MINE = "00000000-0000-4000-8000-000000010001";
const THEIRS = "00000000-0000-4000-8000-000000020001";
const LINK = "00000000-0000-4000-8000-000000000c01";

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

/** The session cookie's access token: its payload names the user. */
const tokenOf = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

/**
 * A stand-in client: every `from(table)` chain is recorded and resolves to what `answer`
 * returns for it. The session's token names the caller; `getUser` throws, as no loader asks the auth server.
 */
function stub(
  answer: (c: Call) => Res | undefined,
  user: { id: string } | null = { id: U_ME },
  links: () => Res | Promise<Res> = () => ok([]),
) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "in", "range"])
      chain[m] = (...args: unknown[]) => {
        // The read of the person's own oldest membership is filed apart from the hive's members.
        if (table === "members" && m === "eq" && args[0] === "user_id")
          call.table = "own";
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call) ?? ok([])).then(res, rej);
    return chain;
  });
  const rpc = vi.fn(async (..._args: unknown[]) => links());
  const auth = {
    getUser: vi.fn(async (): Promise<never> => {
      throw new Error("a loader must not call the auth server");
    }),
    getSession: vi.fn(async () => ({
      data: { session: user ? { access_token: tokenOf(user.id) } : null },
      error: null,
    })),
  };
  return { db: { from, rpc, auth } as never, calls, from, rpc, auth };
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
  topics?: (c: Call) => Res;
  /** The most rows the API answers per request (the hosted API's max-rows). */
  maxRows?: number;
  /** Answer the second index request with this error. */
  failPage?: number;
}) {
  let indexRequests = 0;
  return (c: Call): Res | undefined => {
    if (opts.fail === c.table)
      return {
        data: null,
        error: { message: "boom", code: "XX000", details: "Secret title" },
      };
    if (c.table === "own")
      return ok([{ id: ME, hive_id: HIVE, hive: { name: "Synapse" } }]);
    if (c.table === "members")
      return ok([
        { id: ME, display_name: "Danijel", user_id: U_ME },
        { id: AHMED, display_name: "Ahmed", user_id: "u-ahmed" },
      ]);
    if (c.table === "workspaces")
      return ok([
        { id: W1, name: "Main" },
        { id: W2, name: "Ops" },
      ]);
    if (c.table === "entities") return opts.topics ? opts.topics(c) : ok([]);
    if (c.table === "folders")
      return ok([{ path: "Decisions", visibility: "group", shared_with: [] }]);
    if (c.table === "notes") {
      if (has(c, "eq", "id", MINE) || has(c, "eq", "id", THEIRS))
        return ok(opts.open ?? []);
      if (op(c, "neq").length) return ok(opts.shared ?? []);
      const all = opts.index ?? [];
      const r = op(c, "range")[0]?.[1] as [number, number] | undefined;
      if (!r) return ok(all);
      indexRequests += 1;
      if (opts.failPage === indexRequests)
        return { data: null, error: { message: "boom", code: "XX000" } };
      const to = Math.min(r[1], r[0] + (opts.maxRows ?? Infinity) - 1);
      return ok(all.slice(r[0], to + 1));
    }
    return undefined;
  };
}

describe("loadVault", () => {
  it("reads the hive of the person's own oldest membership, its members, own workspaces, and the first workspace's index", async () => {
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

    expect(t.calls[0]!.table).toBe("own");
    expect(t.from.mock.calls[0]).toEqual(["members"]);
    expect(t.calls[0]!.ops).toEqual([
      [
        "select",
        [
          "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
        ],
      ],
      ["eq", ["user_id", U_ME]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [50]],
    ]);
    // No call to the auth server: the user id is the one the session's token names.
    expect(t.auth.getUser).not.toHaveBeenCalled();
    const index = t.calls.find((c) => c.table === "notes")!;
    expect(has(index, "eq", "workspace_id", W1)).toBe(true);
    expect(has(index, "order", "path")).toBe(true);
    expect(has(index, "range", 0, 999)).toBe(true);
    expect(selected(index)).toContain("effective:note_visibility");
    expect(selected(index)).toContain("effective_with:note_shared_with");
    expect(selected(index)).toContain("rule_folder:note_rule_folder");
    expect(selected(index)).toContain("access:note_access");
    expect(selected(index)).toContain(
      "note_entities(entity_id,confidence,detached_at)",
    );
    expect(t.calls.map((c) => c.table).sort()).toEqual(
      ["entities", "folders", "members", "notes", "own", "workspaces"].sort(),
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

  it("reads a workspace's index in ranges of 1,000: 1,641 notes in exactly two requests, none lost", async () => {
    const rows = Array.from({ length: 1641 }, (_, i) =>
      row(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const t = stub(world({ index: rows, maxRows: 1000 }));
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.notes).toHaveLength(1641);
    expect(out.data.truncated).toBe(false);
    const reads = t.calls.filter(
      (c) => c.table === "notes" && has(c, "eq", "workspace_id", W1),
    );
    expect(reads).toHaveLength(2);
    expect(has(reads[0]!, "range", 0, 999)).toBe(true);
    expect(has(reads[1]!, "range", 1000, 1999)).toBe(true);
  });

  it("cuts a 2,500-note workspace at 2,000, says so, and makes at most three requests", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) =>
      row(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const t = stub(world({ index: rows, maxRows: 1000 }));
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.notes).toHaveLength(2000);
    expect(out.data.truncated).toBe(true);
    const reads = t.calls.filter(
      (c) => c.table === "notes" && has(c, "eq", "workspace_id", W1),
    );
    expect(reads.length).toBeLessThanOrEqual(3);
  });

  it("makes exactly one index request for a workspace under 1,000 notes", async () => {
    const t = stub(world({ index: [row(MINE), row(THEIRS)], maxRows: 1000 }));
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.notes).toHaveLength(2);
    const reads = t.calls.filter(
      (c) => c.table === "notes" && has(c, "eq", "workspace_id", W1),
    );
    expect(reads).toHaveLength(1);
  });

  it("is error when the second page of the index fails, logging only code and message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = Array.from({ length: 1641 }, (_, i) =>
      row(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const t = stub(world({ index: rows, maxRows: 1000, failPage: 2 }));
    expect(await loadVault(t.db, {})).toEqual({ state: "error" });
    expect(spy).toHaveBeenCalledWith("notes query failed", "XX000", "boom");
    spy.mockRestore();
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
    expect(selected(one)).toContain(
      "note_entities(entity_id,confidence,detached_at)",
    );
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
    const t = stub((c) => (c.table === "own" ? ok([]) : undefined));
    expect(await loadVault(t.db, {})).toEqual({ state: "no-hive" });
    expect(t.calls.map((c) => c.table)).toEqual(["own"]);
  });

  it("is error when there is no session", async () => {
    const t = stub(world({}), null);
    expect(await loadVault(t.db, {})).toEqual({ state: "error" });
  });

  for (const table of ["own", "members", "workspaces", "folders", "notes"]) {
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

describe("loadVault: the open note's links", () => {
  const mine = row(MINE, { body: "Hello" });
  const link = {
    id: LINK,
    note_id: THEIRS,
    title: "Pricing options",
    owner: "Ahmed",
    mine: false,
  };

  it("asks note_links once for the open note, in the same batch as the note", async () => {
    const t = stub(world({ open: [mine], index: [mine] }), { id: U_ME }, () =>
      ok([link]),
    );
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith("note_links", { p_note: MINE });
    // Started with the first batch (own hive, members, workspaces, the note), before any of
    // it was awaited, and so before the second batch (folders, the index).
    const rpcAt = t.rpc.mock.invocationCallOrder[0]!;
    const tables = (when: (n: number) => boolean) =>
      t.from.mock.calls
        .filter((_, i) => when(t.from.mock.invocationCallOrder[i]!))
        .map(([table]) => table);
    expect(tables((n) => n < rpcAt)).toEqual([
      "members",
      "members",
      "workspaces",
      "notes",
    ]);
    // The hive's topics are read in the first batch too, after the note's links.
    expect(tables((n) => n > rpcAt)).toEqual(["entities", "folders", "notes"]);
    expect(out.data.open).toEqual({
      note: toNote(mine, ME),
      body: "Hello",
      cut: false,
      links: [link],
    });
  });

  it("does not ask when no note is open, or when the id is not a uuid", async () => {
    const t = stub(world({}));
    await loadVault(t.db, {});
    await loadVault(t.db, { tab: "shared" });
    await loadVault(t.db, { note: "x' or 1=1" });
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("keeps only the five fields, and drops malformed rows", async () => {
    const t = stub(world({ open: [mine] }), { id: U_ME }, () =>
      ok([
        { ...link, body: "secret", extra: 1 },
        { ...link, id: "nope" },
        { ...link, note_id: 7 },
        { ...link, title: null },
        { ...link, owner: undefined },
        { ...link, mine: "yes" },
        null,
        "row",
        { ...link, id: LINK.replace("c01", "c02"), mine: true },
      ]),
    );
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.open).toMatchObject({
      links: [link, { ...link, id: LINK.replace("c01", "c02"), mine: true }],
    });
  });

  it("shows at most 50 links", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...link,
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const t = stub(world({ open: [mine] }), { id: U_ME }, () => ok(many));
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    expect((out.data.open as { links: unknown[] }).links).toHaveLength(50);
  });

  it("still shows the note, with no links, when the read fails; logs only code and message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(world({ open: [mine] }), { id: U_ME }, () => ({
      data: [link],
      error: { message: "boom", code: "XX000", details: "Secret title" },
    }));
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.open).toMatchObject({ note: { id: MINE }, links: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("note_links failed", "XX000", "boom");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Pricing");
    spy.mockRestore();
  });

  it("still shows the note, with no links, when the read throws or answers nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const links of [
      () => Promise.reject(new Error("Secret title")),
      () => undefined as never,
      () => ok({ id: LINK }),
      () => ok(null),
    ]) {
      const t = stub(world({ open: [mine] }), { id: U_ME }, links);
      const out = await loadVault(t.db, { note: MINE });
      if (out.state !== "ok") throw new Error(out.state);
      expect(out.data.open).toMatchObject({ note: { id: MINE }, links: [] });
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    spy.mockRestore();
  });

  it("a missing note stays missing, whatever the links read says", async () => {
    const t = stub(world({ open: [] }), { id: U_ME }, () => ok([link]));
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.open).toEqual({ missing: true });
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
      topics: [],
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

const T = (n: number) =>
  `00000000-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`;

describe("toNote: topics", () => {
  const link = (
    n: number,
    confidence: unknown,
    detached_at: unknown = null,
  ) => ({
    entity_id: T(n),
    confidence,
    detached_at,
  });

  it("lists the attached topics strongest first, ties in the order answered", () => {
    const n = toNote(
      row(MINE, {
        note_entities: [
          link(1, 0.5),
          link(2, 0.9),
          link(3, 0.5),
          link(4, 1),
          link(5, 0.9),
        ],
      }),
      ME,
    );
    expect(n.topics).toEqual([T(4), T(2), T(5), T(1), T(3)]);
  });

  it("drops detached and malformed rows", () => {
    const n = toNote(
      row(MINE, {
        note_entities: [
          link(1, 0.8),
          link(2, 0.9, "2026-11-20T00:00:00Z"),
          link(3, "high"),
          { entity_id: 7, confidence: 1, detached_at: null },
          { confidence: 1, detached_at: null },
          null,
          "row",
          link(4, 0.7, undefined),
        ],
      }),
      ME,
    );
    expect(n.topics).toEqual([T(1), T(4)]);
  });

  it("has none when the column is absent or not a list", () => {
    expect(toNote(row(MINE), ME).topics).toEqual([]);
    expect(toNote(row(MINE, { note_entities: null }), ME).topics).toEqual([]);
    expect(
      toNote(row(MINE, { note_entities: { entity_id: T(1) } }), ME).topics,
    ).toEqual([]);
  });
});

describe("loadVault: the hive's topics", () => {
  const entity = (n: number, type: string, canonical_name: string) => ({
    id: T(n),
    type,
    canonical_name,
  });

  /** What the API answers: the rows on the first page, then nothing. */
  const firstPage = (rows: unknown[]) => (c: Call) =>
    ok((op(c, "range")[0]![1][0] as number) === 0 ? rows : []);

  it("reads the hive's entities by id, in pages of 1,000, and sorts by kind then name", async () => {
    const t = stub(
      world({
        topics: firstPage([
          entity(1, "subject", "Pricing"),
          entity(2, "client", "Zed"),
          entity(3, "client", "Acme"),
          entity(4, "partner", "Mid"),
        ]),
      }),
    );
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.topics).toEqual([
      { id: T(3), kind: "client", name: "Acme" },
      { id: T(2), kind: "client", name: "Zed" },
      { id: T(4), kind: "partner", name: "Mid" },
      { id: T(1), kind: "subject", name: "Pricing" },
    ]);
    const read = t.calls.find((c) => c.table === "entities")!;
    expect(selected(read)).toBe("id, type, canonical_name");
    expect(has(read, "eq", "hive_id", HIVE)).toBe(true);
    expect(has(read, "order", "id")).toBe(true);
    expect(has(read, "range", 0, 999)).toBe(true);
  });

  it("loses nothing when the API answers 1,000 rows and then 3", async () => {
    const t = stub(
      world({
        topics: (c) => {
          const [from] = op(c, "range")[0]![1] as [number, number];
          const n = from === 0 ? 1000 : 3;
          const base = from === 0 ? 0 : 1000;
          return {
            data: Array.from({ length: n }, (_, i) =>
              entity(
                base + i,
                "client",
                `Client ${String(base + i).padStart(5, "0")}`,
              ),
            ),
            error: null,
            ...(from === 0 ? { count: 1003 } : {}),
          } as Res;
        },
      }),
    );
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.topics).toHaveLength(1003);
    expect(out.data.topics[0]!.name).toBe("Client 00000");
    expect(out.data.topics[1002]!.name).toBe("Client 01002");
    expect(t.calls.filter((c) => c.table === "entities")).toHaveLength(2);
  });

  it("skips a row whose kind is unknown or that is malformed", async () => {
    const t = stub(
      world({
        topics: firstPage([
          entity(1, "client", "Acme"),
          entity(2, "galaxy", "Andromeda"),
          { id: T(3), type: "client" },
          { id: 4, type: "client", canonical_name: "X" },
          null,
        ]),
      }),
    );
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.topics).toEqual([
      { id: T(1), kind: "client", name: "Acme" },
    ]);
  });

  it("still loads, with no topics, when that read fails; logs only the code", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub(world({ index: [row(MINE)], fail: "entities" }));
    const out = await loadVault(t.db, {});
    expect(out.state).toBe("ok");
    if (out.state !== "ok") return;
    expect(out.data.topics).toEqual([]);
    expect(out.data.notes).toHaveLength(1);
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).toContain("XX000");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    spy.mockRestore();
  });
});

describe("loadVault: a note's topics follow the map's order", () => {
  const entity = (n: number, type: string, canonical_name: string) => ({
    id: T(n),
    type,
    canonical_name,
  });
  const link = (n: number, confidence: number) => ({
    entity_id: T(n),
    confidence,
    detached_at: null,
  });
  const hive = [
    entity(1, "vendor", "Zeta"),
    entity(2, "client", "Acme"),
    entity(3, "client", "Beta"),
    entity(4, "vendor", "Alpha"),
  ];
  const firstPage = (c: Call) =>
    ok((op(c, "range")[0]![1][0] as number) === 0 ? hive : []);

  it("orders equal confidence by kind, then name, whatever order the API answered; an unknown id is last", async () => {
    const mine = row(MINE, {
      body: "x",
      note_entities: [
        link(1, 0.9),
        link(2, 0.9),
        link(9, 0.9),
        link(4, 0.9),
        link(3, 0.9),
      ],
    });
    const t = stub(world({ index: [mine], open: [mine], topics: firstPage }));
    const out = await loadVault(t.db, { note: MINE });
    if (out.state !== "ok") throw new Error(out.state);
    // customers first (Acme, Beta), then vendors (Alpha, Zeta), then the unknown id.
    const want = [T(2), T(3), T(4), T(1), T(9)];
    expect(out.data.notes[0]!.topics).toEqual(want);
    expect(
      (out.data.open as { note: { topics: string[] } }).note.topics,
    ).toEqual(want);
  });

  it("puts the vendor the API answered first behind the customer it answered second", async () => {
    const mine = row(MINE, { note_entities: [link(1, 0.8), link(2, 0.8)] });
    const t = stub(world({ index: [mine], topics: firstPage }));
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.notes[0]!.topics).toEqual([T(2), T(1)]);
  });

  it("does not cut the list at five", async () => {
    const mine = row(MINE, {
      note_entities: [1, 2, 3, 4, 5, 6, 7].map((n) => link(n, 0.5)),
    });
    const t = stub(world({ index: [mine], topics: firstPage }));
    const out = await loadVault(t.db, {});
    if (out.state !== "ok") throw new Error(out.state);
    expect(out.data.notes[0]!.topics).toHaveLength(7);
  });
});
