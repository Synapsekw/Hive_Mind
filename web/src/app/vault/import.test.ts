import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_BYTES, noteBytes, type ImportNote } from "../../import/plan";
import {
  MAX_FRONTMATTER_BYTES,
  MAX_TITLE_CHARS,
  cleanBatch,
  cleanWorkspaceName,
  createImportWorkspaceIn,
  importBatchIn,
} from "./import";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const OTHER_HIVE = "00000000-0000-4000-8000-000000000a02";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const UID = "00000000-0000-4000-8000-0000000000aa";
/** A "now" for the checks that take one; the tests that do not pass it use dates long past. */
const NOW = Date.UTC(2026, 10, 24, 9, 30);
const WRITTEN = "2025-03-14T12:00:00.000Z";
const MODIFIED = "2025-06-01T08:15:30.250Z";
const W1 = "00000000-0000-4000-8000-000000000b01";
const NEW_WS = "00000000-0000-4000-8000-000000000b09";

type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null };
type Row = Record<string, unknown>;
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });
const no = (message: string, code?: string): Res => ({
  data: null,
  error: { message, code },
});
const op = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];
const kind = (c: Call) =>
  op(c, "insert") ? "insert" : op(c, "update") ? "update" : "select";

/** The texts of an `in.("a","b")` filter, unescaped as the API reads them. */
function listed(value: unknown): string[] {
  const text = String(value);
  expect(text.startsWith("(") && text.endsWith(")")).toBe(true);
  const out: string[] = [];
  const each = /"((?:[^"\\]|\\.)*)"(?:,|$)/y;
  const inner = text.slice(1, -1);
  let m: RegExpExecArray | null;
  let end = 0;
  while ((m = each.exec(inner))) {
    out.push(m[1]!.replace(/\\(.)/g, "$1"));
    end = each.lastIndex;
  }
  expect(end).toBe(inner.length);
  return out;
}

/**
 * A small database in memory, speaking the part of the client the import uses. `fail` answers
 * for a call before it touches anything; an insert of several rows is all or nothing.
 */
function fake(
  opts: {
    user?: { id: string } | null;
    workspaces?: Row[];
    members?: Row[];
    folders?: Row[];
    notes?: Row[];
    fail?: (c: Call, nth: number) => Res | undefined;
    refuseNote?: (row: Row) => boolean;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    workspaces: opts.workspaces ?? [{ id: W1, hive_id: HIVE, member_id: ME }],
    members: opts.members ?? [
      { id: ME, hive_id: HIVE, user_id: UID },
      { id: AHMED, hive_id: HIVE, user_id: "someone-else" },
    ],
    folders: opts.folders ?? [],
    notes: opts.notes ?? [],
  };
  const calls: Call[] = [];
  let ids = 0;
  const newId = () =>
    `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

  const run = (c: Call): Res => {
    const said = opts.fail?.(
      c,
      calls.filter((x) => x.table === c.table).length,
    );
    if (said) return said;
    const table = tables[c.table]!;
    const matches = (r: Row) =>
      c.ops.every(([m, a]) => {
        if (m === "eq") return r[a[0] as string] === a[1];
        if (m === "filter")
          return (
            a[1] === "in" && listed(a[2]).includes(r[a[0] as string] as string)
          );
        return true;
      });
    const inserted = op(c, "insert")?.[0];
    if (inserted !== undefined) {
      const list = (Array.isArray(inserted) ? inserted : [inserted]) as Row[];
      for (const r of list) {
        if (c.table === "notes" && opts.refuseNote?.(r))
          return no("refused by the database", "P0001");
        const key = c.table === "workspaces" ? "name" : "path";
        const scope = c.table === "workspaces" ? "member_id" : "workspace_id";
        if (table.some((x) => x[key] === r[key] && x[scope] === r[scope]))
          return no("duplicate key value violates unique constraint", "23505");
      }
      const made = list.map((r) => ({
        ...(c.table === "notes" ? { folder_id: null, version: 1 } : {}),
        ...r,
        id: c.table === "workspaces" ? NEW_WS : newId(),
      }));
      table.push(...made);
      return ok(op(c, "select") ? made : null);
    }
    const patch = op(c, "update")?.[0] as Row | undefined;
    if (patch) {
      const hit = table.filter(matches);
      for (const r of hit)
        Object.assign(r, patch, { version: (r.version as number) + 1 });
      return ok(op(c, "select") ? hit.map((r) => ({ id: r.id })) : null);
    }
    const limit = op(c, "limit")?.[0] as number | undefined;
    const hit = table.filter(matches);
    return ok(limit === undefined ? hit : hit.slice(0, limit));
  };

  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "filter", "limit", "insert", "update"])
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

const note = (path: string, extra: Partial<ImportNote> = {}): ImportNote => ({
  path,
  title: path.replace(/^.*\//, "").replace(/\.md$/i, ""),
  body: `text of ${path}\n`,
  frontmatter: {},
  ...extra,
});
const outcomes = (r: Awaited<ReturnType<typeof importBatchIn>>) =>
  r.ok ? r.outcomes.map((o) => [o.path, o.outcome]) : r;
const shape = (t: { calls: Call[] }) =>
  t.calls.map((c) => `${c.table}.${kind(c)}`);

afterEach(() => vi.restoreAllMocks());
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("cleanWorkspaceName", () => {
  it("trims what the database trims and takes 1 to 60 characters", () => {
    expect(cleanWorkspaceName("  My vault \t\n\r\f\u000B")).toBe("My vault");
    expect(cleanWorkspaceName("x".repeat(60))).toBe("x".repeat(60));
    // Counted in characters, as the database counts them.
    expect(cleanWorkspaceName("😀".repeat(60))).toBe("😀".repeat(60));
    expect(cleanWorkspaceName("vault  v")).toBe("vault  v");
  });

  it("refuses the rest", () => {
    for (const v of [
      "",
      "   ",
      " \t\n\r\f\u000B",
      "x".repeat(61),
      "😀".repeat(61),
      "a\u0000b",
      "x".repeat(5000),
      null,
      undefined,
      42,
      ["Vault"],
      { name: "Vault" },
    ])
      expect(cleanWorkspaceName(v), String(v)).toBeNull();
  });
});

describe("createImportWorkspaceIn", () => {
  it("inserts the workspace under the person's own member in that hive", async () => {
    const t = fake();
    expect(await createImportWorkspaceIn(t.db, HIVE, "  My vault ")).toEqual({
      ok: true,
      id: NEW_WS,
    });
    expect(shape(t)).toEqual(["members.select", "workspaces.insert"]);
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["id"]],
      ["eq", ["hive_id", HIVE]],
      ["eq", ["user_id", UID]],
      ["limit", [1]],
    ]);
    expect(t.calls[1]!.ops).toEqual([
      ["insert", [{ hive_id: HIVE, member_id: ME, name: "My vault" }]],
      ["select", ["id"]],
    ]);
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("checks the hive id and the name before any query", async () => {
    const t = fake();
    for (const hive of ["", "1 or 1=1", null, undefined, 7, [HIVE], {}])
      expect(await createImportWorkspaceIn(t.db, hive, "Vault")).toEqual({
        ok: false,
        reason: "failed",
      });
    for (const name of ["", "  ", "x".repeat(61), null, 7, ["Vault"]])
      expect(await createImportWorkspaceIn(t.db, HIVE, name)).toEqual({
        ok: false,
        reason: "name",
      });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    const t = fake({ user: null });
    expect(await createImportWorkspaceIn(t.db, HIVE, "Vault")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("makes nothing in a hive the person is not a member of", async () => {
    const t = fake();
    expect(await createImportWorkspaceIn(t.db, OTHER_HIVE, "Vault")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(shape(t)).toEqual(["members.select"]);
  });

  it("never takes somebody else's member, whatever the read answers", async () => {
    // The read is filtered by the session's own user id.
    const t = fake({ members: [{ id: AHMED, hive_id: HIVE, user_id: "x" }] });
    expect(await createImportWorkspaceIn(t.db, HIVE, "Vault")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(t.tables.workspaces).toHaveLength(1);
  });

  it("answers taken, limit and name from what the database refuses, and never its words", async () => {
    const log = quiet();
    const refusals: [Res, string][] = [
      [no("duplicate key value violates unique constraint", "23505"), "taken"],
      [no("you already have 20 workspaces", "P0001"), "limit"],
      [no("a workspace needs a name", "P0001"), "name"],
      [no("that workspace name is too long", "P0001"), "name"],
      [no("this hive is being deleted", "P0001"), "failed"],
      [no("new row violates row-level security policy", "42501"), "failed"],
      [no("anything else"), "failed"],
    ];
    for (const [res, reason] of refusals) {
      const t = fake({
        fail: (c) => (c.table === "workspaces" ? res : undefined),
      });
      const made = await createImportWorkspaceIn(t.db, HIVE, "Vault");
      expect(made).toEqual({ ok: false, reason });
      expect(JSON.stringify(made)).not.toContain(res.error!.message);
    }
    expect(log).toHaveBeenCalledTimes(refusals.length);
  });

  it("says taken for a name the person already uses", async () => {
    quiet();
    const t = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: ME, name: "Vault" }],
    });
    expect(await createImportWorkspaceIn(t.db, HIVE, " Vault ")).toEqual({
      ok: false,
      reason: "taken",
    });
  });

  it("fails when the member read fails or the answer is not an id", async () => {
    quiet();
    const broken = fake({
      fail: (c) => (c.table === "members" ? no("boom", "XX000") : undefined),
    });
    expect(await createImportWorkspaceIn(broken.db, HIVE, "Vault")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(shape(broken)).toEqual(["members.select"]);
    const odd = fake({
      fail: (c) =>
        c.table === "workspaces" ? ok([{ id: "nope" }]) : undefined,
    });
    expect(await createImportWorkspaceIn(odd.db, HIVE, "Vault")).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

describe("cleanBatch", () => {
  it("rebuilds each note from the four known keys", () => {
    const [c] = cleanBatch([
      {
        ...note("a/b.md", {
          frontmatter: { tags: ["x"], n: 1, deep: { k: null } },
        }),
        visibility: "group",
        shared_with: [AHMED],
        member_id: AHMED,
        hive_id: OTHER_HIVE,
        id: W1,
      },
    ])!;
    expect(c).toEqual({
      note: {
        path: "a/b.md",
        title: "b",
        body: "text of a/b.md\n",
        frontmatter: { tags: ["x"], n: 1, deep: { k: null } },
      },
      dir: "a",
      storable: true,
    });
  });

  it("refuses a batch that is not a list of 1 to 25 notes", () => {
    for (const v of [
      null,
      undefined,
      "notes",
      7,
      {},
      [],
      { length: 1, 0: note("a.md") },
    ])
      expect(cleanBatch(v), String(v)).toBeNull();
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => note(`n/${i}.md`));
    expect(cleanBatch(many(25))).toHaveLength(25);
    expect(cleanBatch(many(26))).toBeNull();
  });

  it("refuses a path that is not clean or is not markdown", () => {
    for (const path of [
      "",
      "a.txt",
      "/a.md",
      "a//b.md",
      "a/b.md/",
      "./a.md",
      "../a.md",
      "a/../b.md",
      "a\\b.md",
      ".obsidian/a.md",
      "a/.b.md",
      "a\u0000.md",
      "x".repeat(498) + ".md",
      7,
      null,
      ["a.md"],
    ])
      expect(
        cleanBatch([note("ok.md"), { ...note("x.md"), path }]),
        String(path),
      ).toBeNull();
    expect(cleanBatch([note("LOUD.MD"), note('a "b", (c).md')])).toHaveLength(
      2,
    );
  });

  it("refuses a path given twice", () => {
    expect(cleanBatch([note("a.md"), note("b.md"), note("a.md")])).toBeNull();
    // Another case is another path, as it is for the database.
    expect(cleanBatch([note("a.md"), note("A.md")])).toHaveLength(2);
  });

  it("refuses a title, a text or fields of the wrong shape", () => {
    const bad: Record<string, unknown>[] = [
      { title: "" },
      { title: 7 },
      { title: null },
      { title: ["a"] },
      { title: undefined },
      { body: null },
      { body: 7 },
      { body: ["text"] },
      { body: undefined },
      { frontmatter: null },
      { frontmatter: undefined },
      { frontmatter: [] },
      { frontmatter: ["a"] },
      { frontmatter: "title: x" },
      { frontmatter: 7 },
      { frontmatter: new Map([["a", 1]]) },
      { frontmatter: new Date(0) },
      { frontmatter: { when: new Date(0) } },
      { frontmatter: { n: Number.NaN } },
      { frontmatter: { n: Number.POSITIVE_INFINITY } },
      { frontmatter: { n: 10n } },
      { frontmatter: { n: undefined } },
      { frontmatter: { f: () => 1 } },
      { frontmatter: { s: Symbol("s") } },
      { frontmatter: { list: [new Set([1])] } },
      { frontmatter: new (class Fields {})() },
    ];
    for (const extra of bad)
      expect(
        cleanBatch([{ ...note("a.md"), ...extra }]),
        Object.keys(extra)[0] + ": " + String(Object.values(extra)[0]),
      ).toBeNull();
    for (const item of [null, "a.md", 7, [note("a.md")], new Map()])
      expect(cleanBatch([item])).toBeNull();
    // An empty text and empty fields are a note.
    expect(cleanBatch([note("a.md", { body: "" })])).toHaveLength(1);
  });

  it("refuses fields nested deeper than anything a note holds, without falling over", () => {
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) deep = { deep };
    expect(cleanBatch([note("a.md", { frontmatter: deep })])).toBeNull();
    let far: unknown[] = [];
    for (let i = 0; i < 50_000; i++) far = [far];
    expect(cleanBatch([note("a.md", { frontmatter: { far } })])).toBeNull();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(cleanBatch([note("a.md", { frontmatter: loop })])).toBeNull();
  });

  it("refuses a note over 1 MB and a batch over 3 MB", () => {
    expect(
      cleanBatch([note("a.md", { body: "x".repeat(1_000_000) })]),
    ).toHaveLength(1);
    expect(
      cleanBatch([note("a.md", { body: "x".repeat(1_000_001) })]),
    ).toBeNull();
    // Bytes, not characters.
    expect(
      cleanBatch([note("a.md", { body: "é".repeat(500_001) })]),
    ).toBeNull();
    const big = "x".repeat(990_000);
    const three = [1, 2, 3].map((i) => note(`${i}.md`, { body: big }));
    expect(cleanBatch(three)).toHaveLength(3);
    expect(
      cleanBatch([...three, note("4.md", { body: "x".repeat(40_000) })]),
    ).toBeNull();
    // What counts is what travels: a text of control characters is six times its size.
    const heavy = note("h.md", { body: "\u0001".repeat(600_000) });
    expect(noteBytes(heavy)).toBeGreaterThan(BATCH_BYTES);
    expect(cleanBatch([heavy])).toBeNull();
    expect(
      cleanBatch([note("t.md", { title: "t".repeat(BATCH_BYTES) })]),
    ).toBeNull();
  });

  it("marks a title or fields too big to store, and refuses nothing for them", () => {
    const long = note("long.md", { title: "t".repeat(MAX_TITLE_CHARS + 1) });
    const edge = note("edge.md", { title: "t".repeat(MAX_TITLE_CHARS) });
    const fat = note("fat.md", {
      frontmatter: { blob: "x".repeat(MAX_FRONTMATTER_BYTES) },
    });
    const fits = note("fits.md", {
      frontmatter: { blob: "x".repeat(MAX_FRONTMATTER_BYTES - 11) },
    });
    expect(
      cleanBatch([long, edge, fat, fits])!.map((c) => [
        c.note.path,
        c.storable,
      ]),
    ).toEqual([
      ["long.md", false],
      ["edge.md", true],
      ["fat.md", false],
      ["fits.md", true],
    ]);
  });

  it("takes the two dates as ISO texts of its own making", () => {
    const [a, b, c] = cleanBatch(
      [
        note("a.md", {
          written_at: "2025-03-14T12:00:00.000Z",
          modified_at: "2025-06-01T08:15:30.250Z",
        }),
        note("b.md", { written_at: "2025-03-14" }),
        note("c.md", { modified_at: "2025-06-01T10:15:30+02:00" }),
      ],
      NOW,
    )!;
    expect(a!.note).toEqual({
      ...note("a.md"),
      written_at: "2025-03-14T12:00:00.000Z",
      modified_at: "2025-06-01T08:15:30.250Z",
    });
    expect(b!.note).toEqual({
      ...note("b.md"),
      written_at: "2025-03-14T12:00:00.000Z",
    });
    expect(Object.keys(b!.note)).not.toContain("modified_at");
    expect(c!.note).toEqual({
      ...note("c.md"),
      modified_at: "2025-06-01T08:15:30.000Z",
    });
    // A note without dates has neither key.
    expect(
      Object.keys(cleanBatch([note("d.md")], NOW)![0]!.note).sort(),
    ).toEqual(["body", "frontmatter", "path", "title"]);
    expect(
      Object.keys(
        cleanBatch(
          [{ ...note("d.md"), written_at: undefined, modified_at: undefined }],
          NOW,
        )![0]!.note,
      ).sort(),
    ).toEqual(["body", "frontmatter", "path", "title"]);
  });

  it("refuses a batch whose date is not a text", () => {
    for (const key of ["written_at", "modified_at"])
      for (const v of [
        1_741_953_600_000,
        null,
        true,
        ["2025-03-14"],
        { at: "2025-03-14" },
        new Date(0),
      ])
        expect(
          cleanBatch([note("ok.md"), { ...note("a.md"), [key]: v }], NOW),
          `${key}: ${String(v)}`,
        ).toBeNull();
  });

  it("drops a date it cannot use and keeps the note", () => {
    for (const v of [
      "soon",
      "",
      "2025-02-30",
      "1989-12-31",
      new Date(NOW + 1).toISOString(),
      "2031-01-01",
      "2025-03-14T12:00:00.000Z' or '1'='1",
      "2025-03-14".padEnd(41, " "),
      "x".repeat(100_000),
    ]) {
      const [c] = cleanBatch(
        [note("a.md", { written_at: v, modified_at: v })],
        NOW,
      )!;
      expect(c, v.slice(0, 50)).toEqual({
        note: note("a.md"),
        dir: null,
        storable: true,
      });
      expect(Object.keys(c!.note).sort()).toEqual([
        "body",
        "frontmatter",
        "path",
        "title",
      ]);
    }
    // One of the two can be dropped by itself.
    expect(
      cleanBatch(
        [note("a.md", { written_at: "2025-03-14", modified_at: "2031-01-01" })],
        NOW,
      )![0]!.note,
    ).toEqual({ ...note("a.md"), written_at: "2025-03-14T12:00:00.000Z" });
  });

  it("never keeps a last change before the written date", () => {
    expect(
      cleanBatch(
        [note("a.md", { written_at: "2025-03-14", modified_at: "2020-01-01" })],
        NOW,
      )![0]!.note,
    ).toEqual({
      ...note("a.md"),
      written_at: "2025-03-14T12:00:00.000Z",
      modified_at: "2025-03-14T12:00:00.000Z",
    });
  });
});

describe("importBatchIn", () => {
  it("refuses a malformed batch without a query or a look at the session", async () => {
    const t = fake();
    const refused: [unknown, unknown][] = [
      ["", [note("a.md")]],
      ["1 or 1=1", [note("a.md")]],
      [null, [note("a.md")]],
      [[W1], [note("a.md")]],
      [W1, null],
      [W1, []],
      [W1, "notes"],
      [W1, Array.from({ length: 26 }, (_, i) => note(`${i}.md`))],
      [W1, [note("a.md"), note("a.md")]],
      [W1, [note("../a.md")]],
      [W1, [note(".git/a.md")]],
      [W1, [note("a.txt")]],
      [W1, [note("a.md", { body: "x".repeat(1_000_001) })]],
      [
        W1,
        [1, 2, 3, 4].map((i) => note(`${i}.md`, { body: "x".repeat(990_000) })),
      ],
      [W1, [{ ...note("a.md"), title: 7 }]],
      [W1, [{ ...note("a.md"), frontmatter: ["a"] }]],
      [W1, [{ ...note("a.md"), frontmatter: null }]],
      [W1, [{ ...note("a.md"), frontmatter: { when: new Date(0) } }]],
    ];
    for (const [ws, notes] of refused)
      expect(await importBatchIn(t.db, ws, notes)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    const t = fake({ user: null });
    expect(await importBatchIn(t.db, W1, [note("a.md")])).toEqual({
      ok: false,
    });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("creates the notes at their paths, with a folder row for the folder each sits in", async () => {
    const t = fake();
    const batch = [
      note("Home.md", { title: "Home page", frontmatter: { tags: ["a"] } }),
      note("Decisions/one.md"),
      note("Decisions/deep/two.md"),
      note("Decisions/broken.md"),
    ];
    expect(outcomes(await importBatchIn(t.db, W1, batch))).toEqual([
      ["Home.md", "created"],
      ["Decisions/one.md", "created"],
      ["Decisions/deep/two.md", "created"],
      ["Decisions/broken.md", "created"],
    ]);
    // One read of the workspace, one of the member, one of the notes, one of the folders, one
    // folder insert and one note insert.
    expect(shape(t)).toEqual([
      "workspaces.select",
      "members.select",
      "notes.select",
      "folders.select",
      "folders.insert",
      "notes.insert",
    ]);
    // As the script: "Decisions/deep" and "Decisions", because a note sits in each; no row
    // for a folder that only holds folders.
    expect(t.tables.folders!.map((f) => f.path)).toEqual([
      "Decisions",
      "Decisions/deep",
    ]);
    expect(op(t.calls[4]!, "insert")).toEqual([
      [
        { workspace_id: W1, member_id: ME, path: "Decisions" },
        { workspace_id: W1, member_id: ME, path: "Decisions/deep" },
      ],
    ]);
    const folder = (path: string) =>
      t.tables.folders!.find((f) => f.path === path)!.id;
    expect(op(t.calls[5]!, "insert")).toEqual([
      [
        {
          hive_id: HIVE,
          member_id: ME,
          workspace_id: W1,
          path: "Home.md",
          title: "Home page",
          body: "text of Home.md\n",
          frontmatter: { tags: ["a"] },
          folder_id: null,
        },
        {
          hive_id: HIVE,
          member_id: ME,
          workspace_id: W1,
          path: "Decisions/one.md",
          title: "one",
          body: "text of Decisions/one.md\n",
          frontmatter: {},
          folder_id: folder("Decisions"),
        },
        {
          hive_id: HIVE,
          member_id: ME,
          workspace_id: W1,
          path: "Decisions/deep/two.md",
          title: "two",
          body: "text of Decisions/deep/two.md\n",
          frontmatter: {},
          folder_id: folder("Decisions/deep"),
        },
        {
          hive_id: HIVE,
          member_id: ME,
          workspace_id: W1,
          path: "Decisions/broken.md",
          title: "broken",
          body: "text of Decisions/broken.md\n",
          frontmatter: {},
          folder_id: folder("Decisions"),
        },
      ],
    ]);
    // The insert asks for nothing back.
    expect(op(t.calls[5]!, "select")).toBeUndefined();
  });

  it("reads the workspace, then that its member is the person's own, then the notes at those paths", async () => {
    const t = fake();
    await importBatchIn(t.db, W1.toUpperCase(), [
      note("a.md"),
      note("quo\"te, (x)/b's.md"),
    ]);
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["id, hive_id, member_id"]],
      ["eq", ["id", W1]],
      ["limit", [1]],
    ]);
    expect(t.calls[1]!.ops).toEqual([
      ["select", ["id, hive_id"]],
      ["eq", ["id", ME]],
      ["eq", ["user_id", UID]],
      ["limit", [1]],
    ]);
    expect(t.calls[2]!.ops).toEqual([
      [
        "select",
        [
          "id, path, title, body, frontmatter, folder_id, created_at, updated_at",
        ],
      ],
      ["eq", ["workspace_id", W1]],
      // Every path quoted, and a quote inside one escaped.
      ["filter", ["path", "in", '("a.md","quo\\"te, (x)/b\'s.md")']],
    ]);
    expect(op(t.calls[3]!, "filter")).toEqual([
      "path",
      "in",
      '("quo\\"te, (x)")',
    ]);
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("never sends sharing, an id, a version or who wrote it", async () => {
    const t = fake({
      notes: [
        {
          id: "00000000-0000-4000-8000-00000000e001",
          workspace_id: W1,
          path: "old.md",
          title: "old",
          body: "before",
          frontmatter: {},
          folder_id: null,
          version: 1,
        },
      ],
    });
    const hostile = (path: string) => ({
      ...note(path),
      visibility: "group",
      shared_with: [AHMED],
      quarantined: false,
      member_id: AHMED,
      hive_id: OTHER_HIVE,
      workspace_id: NEW_WS,
      written_by_agent: AHMED,
      version: 99,
      id: NEW_WS,
    });
    await importBatchIn(t.db, W1, [hostile("old.md"), hostile("new.md")]);
    const sent = t.calls.flatMap((c) => [
      ...((op(c, "insert")?.[0] as Row[] | undefined) ?? []),
      ...(op(c, "update") ? [op(c, "update")![0] as Row] : []),
    ]);
    expect(sent).toHaveLength(2);
    expect(Object.keys(sent[0]!).sort()).toEqual([
      "body",
      "folder_id",
      "frontmatter",
      "title",
    ]);
    expect(Object.keys(sent[1]!).sort()).toEqual([
      "body",
      "folder_id",
      "frontmatter",
      "hive_id",
      "member_id",
      "path",
      "title",
      "workspace_id",
    ]);
    expect(sent[1]).toMatchObject({
      hive_id: HIVE,
      member_id: ME,
      workspace_id: W1,
    });
    // Nothing is ever deleted: the fake has no delete, and a call to one would throw.
  });

  it("refuses a workspace the person cannot read, and writes nothing", async () => {
    const t = fake({ workspaces: [] });
    expect(await importBatchIn(t.db, W1, [note("a.md")])).toEqual({
      ok: false,
    });
    expect(shape(t)).toEqual(["workspaces.select"]);
  });

  it("refuses a workspace whose member is not the person's own, and writes nothing", async () => {
    const log = quiet();
    // Should the workspace read ever answer somebody else's row, the member read does not.
    const t = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: AHMED }],
    });
    expect(await importBatchIn(t.db, W1, [note("a.md")])).toEqual({
      ok: false,
    });
    expect(shape(t)).toEqual(["workspaces.select", "members.select"]);
    // A member of the person's in another hive than the workspace's row names.
    const astride = fake({
      workspaces: [{ id: W1, hive_id: OTHER_HIVE, member_id: ME }],
    });
    expect(await importBatchIn(astride.db, W1, [note("a.md")])).toEqual({
      ok: false,
    });
    expect(shape(astride)).toEqual(["workspaces.select", "members.select"]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("refuses when the workspace, the member or the notes cannot be read", async () => {
    quiet();
    for (const table of ["workspaces", "members", "notes", "folders"]) {
      const t = fake({
        fail: (c) =>
          c.table === table && kind(c) === "select"
            ? no("boom", "XX000")
            : undefined,
      });
      expect(await importBatchIn(t.db, W1, [note("d/a.md")])).toEqual({
        ok: false,
      });
      expect(t.calls.some((c) => kind(c) !== "select")).toBe(false);
    }
    for (const data of [null, "rows", { id: W1 }]) {
      const t = fake({
        fail: (c) => (c.table === "notes" ? ok(data) : undefined),
      });
      expect(await importBatchIn(t.db, W1, [note("a.md")])).toEqual({
        ok: false,
      });
    }
    const odd = fake({
      workspaces: [{ id: W1, hive_id: "nope", member_id: ME }],
    });
    expect(await importBatchIn(odd.db, W1, [note("a.md")])).toEqual({
      ok: false,
    });
  });

  it("leaves a note alone when nothing about it changed, whatever the order of its fields", async () => {
    const t = fake();
    const batch = [
      note("a.md", { frontmatter: { b: 1, a: { y: [1, 2], x: null } } }),
      note("d/b.md"),
    ];
    await importBatchIn(t.db, W1, batch);
    t.calls.length = 0;
    const again = [
      note("a.md", { frontmatter: { a: { x: null, y: [1, 2] }, b: 1 } }),
      note("d/b.md"),
    ];
    expect(outcomes(await importBatchIn(t.db, W1, again))).toEqual([
      ["a.md", "unchanged"],
      ["d/b.md", "unchanged"],
    ]);
    expect(shape(t)).toEqual([
      "workspaces.select",
      "members.select",
      "notes.select",
      "folders.select",
    ]);
    expect(t.tables.notes!.every((n) => n.version === 1)).toBe(true);
  });

  it("updates a note whose title, text, fields or folder changed, and only those", async () => {
    const t = fake();
    const first = ["title", "text", "fields", "list", "same"].map((n) =>
      note(`d/${n}.md`, { frontmatter: { list: [1, 2] } }),
    );
    await importBatchIn(t.db, W1, first);
    // A note whose folder row is gone ("on delete set null").
    await importBatchIn(t.db, W1, [note("e/folder.md")]);
    t.tables.notes!.find((n) => n.path === "e/folder.md")!.folder_id = null;
    t.calls.length = 0;

    const second = [
      { ...first[0]!, title: "A new title" },
      { ...first[1]!, body: "new text\n" },
      { ...first[2]!, frontmatter: { list: [1, 2], more: true } },
      // The order of a list is its content.
      { ...first[3]!, frontmatter: { list: [2, 1] } },
      first[4]!,
      note("e/folder.md"),
      note("d/new.md"),
    ];
    expect(outcomes(await importBatchIn(t.db, W1, second))).toEqual([
      ["d/title.md", "updated"],
      ["d/text.md", "updated"],
      ["d/fields.md", "updated"],
      ["d/list.md", "updated"],
      ["d/same.md", "unchanged"],
      ["e/folder.md", "updated"],
      ["d/new.md", "created"],
    ]);
    const updates = t.calls.filter((c) => kind(c) === "update");
    expect(updates).toHaveLength(5);
    const byId = (path: string) =>
      t.tables.notes!.find((n) => n.path === path)!;
    expect(updates[0]!.ops).toEqual([
      [
        "update",
        [
          {
            title: "A new title",
            body: "text of d/title.md\n",
            frontmatter: { list: [1, 2] },
            folder_id: byId("d/title.md").folder_id,
          },
        ],
      ],
      ["eq", ["id", byId("d/title.md").id]],
      ["select", ["id"]],
    ]);
    expect(byId("e/folder.md").folder_id).toBe(
      t.tables.folders!.find((f) => f.path === "e")!.id,
    );
    expect(t.tables.notes!.map((n) => [n.path, n.version])).toEqual([
      ["d/title.md", 2],
      ["d/text.md", 2],
      ["d/fields.md", 2],
      ["d/list.md", 2],
      ["d/same.md", 1],
      ["e/folder.md", 2],
      ["d/new.md", 1],
    ]);
    // No folder row is made twice.
    expect(
      t.calls.filter((c) => c.table === "folders" && kind(c) === "insert"),
    ).toEqual([]);
  });

  it("says failed for an update the database refuses or that changes no row", async () => {
    quiet();
    for (const said of [no("this hive is being deleted", "P0001"), ok([])]) {
      const t = fake();
      await importBatchIn(t.db, W1, [note("a.md"), note("b.md")]);
      const refusing = fake({
        notes: t.tables.notes,
        fail: (c) => (kind(c) === "update" ? said : undefined),
      });
      const r = await importBatchIn(refusing.db, W1, [
        note("a.md", { body: "changed" }),
        note("b.md"),
        note("c.md"),
      ]);
      expect(outcomes(r)).toEqual([
        ["a.md", "failed"],
        ["b.md", "unchanged"],
        ["c.md", "created"],
      ]);
      expect(JSON.stringify(r)).not.toContain("being deleted");
    }
  });

  it("goes one by one when the database refuses the batch, so one bad note does not sink the rest", async () => {
    const log = quiet();
    const t = fake({ refuseNote: (r) => r.path === "New/bad.md" });
    const r = await importBatchIn(t.db, W1, [
      note("New/good.md"),
      note("New/bad.md"),
      note("New/also good.md"),
    ]);
    expect(outcomes(r)).toEqual([
      ["New/good.md", "created"],
      ["New/bad.md", "failed"],
      ["New/also good.md", "created"],
    ]);
    const inserts = t.calls.filter(
      (c) => c.table === "notes" && kind(c) === "insert",
    );
    expect(inserts.map((c) => (op(c, "insert")![0] as Row[]).length)).toEqual([
      3, 1, 1, 1,
    ]);
    expect(t.tables.notes!.map((n) => n.path)).toEqual([
      "New/good.md",
      "New/also good.md",
    ]);
    // What the database said is logged by code and message, and is not in the answer.
    expect(JSON.stringify(r)).not.toContain("refused by the database");
    for (const line of log.mock.calls)
      expect(line.join(" ")).not.toMatch(/New\/|text of/);
  });

  it("says failed for every note of a hive that takes no writes", async () => {
    quiet();
    const t = fake({
      fail: (c) =>
        kind(c) === "select" ? undefined : no("this hive is being deleted"),
    });
    const r = await importBatchIn(t.db, W1, [note("a.md"), note("d/b.md")]);
    expect(outcomes(r)).toEqual([
      ["a.md", "failed"],
      ["d/b.md", "failed"],
    ]);
    expect(t.tables.notes).toEqual([]);
  });

  it("uses a folder row another import made meanwhile, and fails only the notes with none", async () => {
    quiet();
    let raced = false;
    const t = fake({
      fail: (c) => {
        if (c.table !== "folders" || kind(c) !== "insert" || raced)
          return undefined;
        raced = true;
        t.tables.folders!.push({
          id: "00000000-0000-4000-8000-00000000f001",
          workspace_id: W1,
          member_id: ME,
          path: "there",
        });
        return no("duplicate key value violates unique constraint", "23505");
      },
    });
    const r = await importBatchIn(t.db, W1, [
      note("there/a.md"),
      note("missing/b.md"),
      note("top.md"),
    ]);
    expect(outcomes(r)).toEqual([
      ["there/a.md", "created"],
      ["missing/b.md", "failed"],
      ["top.md", "created"],
    ]);
    expect(t.tables.notes!.map((n) => [n.path, n.folder_id])).toEqual([
      ["there/a.md", "00000000-0000-4000-8000-00000000f001"],
      ["top.md", null],
    ]);
  });

  it("uses the folder rows that are there, and reads no folders for notes at the top", async () => {
    const t = fake({
      folders: [
        {
          id: "00000000-0000-4000-8000-00000000f001",
          workspace_id: W1,
          member_id: ME,
          path: "Decisions",
          visibility: "group",
        },
      ],
    });
    await importBatchIn(t.db, W1, [note("Decisions/a.md"), note("New/b.md")]);
    expect(
      op(
        t.calls.find((c) => kind(c) === "insert")!,
        "insert",
      ),
    ).toEqual([[{ workspace_id: W1, member_id: ME, path: "New" }]]);
    // The rule on the folder that was there is not touched.
    expect(t.tables.folders![0]!.visibility).toBe("group");
    expect(
      t.calls.some((c) => c.table === "folders" && kind(c) === "update"),
    ).toBe(false);

    const top = fake();
    await importBatchIn(top.db, W1, [note("a.md"), note("b.md")]);
    expect(shape(top)).toEqual([
      "workspaces.select",
      "members.select",
      "notes.select",
      "notes.insert",
    ]);
  });

  it("fails a note too big to store by itself and imports the others", async () => {
    const t = fake();
    const r = await importBatchIn(t.db, W1, [
      note("long.md", { title: "t".repeat(MAX_TITLE_CHARS + 1) }),
      note("ok.md"),
      note("fat.md", {
        frontmatter: { blob: "x".repeat(MAX_FRONTMATTER_BYTES) },
      }),
    ]);
    expect(outcomes(r)).toEqual([
      ["long.md", "failed"],
      ["ok.md", "created"],
      ["fat.md", "failed"],
    ]);
    expect(t.tables.notes!.map((n) => n.path)).toEqual(["ok.md"]);
    expect(op(t.calls[2]!, "filter")).toEqual(["path", "in", '("ok.md")']);

    // Nothing to store: the workspace is still checked, and nothing else is asked.
    const none = fake();
    expect(
      outcomes(
        await importBatchIn(none.db, W1, [
          note("long.md", { title: "t".repeat(MAX_TITLE_CHARS + 1) }),
        ]),
      ),
    ).toEqual([["long.md", "failed"]]);
    expect(shape(none)).toEqual(["workspaces.select", "members.select"]);
  });

  describe("the two dates", () => {
    const dated = (path: string, extra: Partial<ImportNote> = {}) =>
      note(path, { written_at: WRITTEN, modified_at: MODIFIED, ...extra });
    /** A note as the database answers it, its dates in the database's own way of writing. */
    const stored = (path: string, extra: Row = {}): Row => ({
      id: "00000000-0000-4000-8000-00000000e001",
      workspace_id: W1,
      path,
      title: note(path).title,
      body: note(path).body,
      frontmatter: {},
      folder_id: null,
      version: 3,
      created_at: "2025-03-14T12:00:00+00:00",
      updated_at: "2025-06-01T08:15:30.25+00:00",
      ...extra,
    });
    const writes = (t: { calls: Call[] }) =>
      t.calls.filter((c) => kind(c) !== "select");

    it("refuses a batch whose date is not a text, without a query", async () => {
      const t = fake();
      for (const extra of [
        { written_at: 1_741_953_600_000 },
        { modified_at: 1_741_953_600_000 },
        { written_at: null },
        { modified_at: ["2025-03-14"] },
      ])
        expect(
          await importBatchIn(t.db, W1, [
            note("ok.md"),
            { ...note("a.md"), ...extra },
          ]),
        ).toEqual({ ok: false });
      expect(t.from).not.toHaveBeenCalled();
      expect(t.auth.getUser).not.toHaveBeenCalled();
    });

    it("imports a note whose date is unparseable or in the future, without the date", async () => {
      const t = fake();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      const r = await importBatchIn(t.db, W1, [
        note("soon.md", { written_at: "soon", modified_at: "later" }),
        note("future.md", { written_at: tomorrow, modified_at: tomorrow }),
        note("half.md", { written_at: WRITTEN, modified_at: tomorrow }),
      ]);
      expect(outcomes(r)).toEqual([
        ["soon.md", "created"],
        ["future.md", "created"],
        ["half.md", "created"],
      ]);
      const sent = op(writes(t)[0]!, "insert")![0] as Row[];
      expect(sent.map((n) => Object.keys(n).sort())).toEqual([
        [
          "body",
          "folder_id",
          "frontmatter",
          "hive_id",
          "member_id",
          "path",
          "title",
          "workspace_id",
        ],
        [
          "body",
          "folder_id",
          "frontmatter",
          "hive_id",
          "member_id",
          "path",
          "title",
          "workspace_id",
        ],
        [
          "body",
          "created_at",
          "folder_id",
          "frontmatter",
          "hive_id",
          "member_id",
          "path",
          "title",
          "updated_at",
          "workspace_id",
        ],
      ]);
      // With no last change, the written date stands for it.
      expect(sent[2]).toMatchObject({
        created_at: WRITTEN,
        updated_at: WRITTEN,
      });
    });

    it("stores a new note with both dates, as texts the server made", async () => {
      const t = fake();
      const r = await importBatchIn(t.db, W1, [
        note("a.md", {
          written_at: "2025-03-14",
          modified_at: "2025-06-01T10:15:30.250+02:00",
        }),
        note("b.md"),
      ]);
      expect(outcomes(r)).toEqual([
        ["a.md", "created"],
        ["b.md", "created"],
      ]);
      expect(shape(t)).toEqual([
        "workspaces.select",
        "members.select",
        "notes.select",
        "notes.insert",
      ]);
      expect(op(t.calls[3]!, "insert")).toEqual([
        [
          {
            hive_id: HIVE,
            member_id: ME,
            workspace_id: W1,
            path: "a.md",
            title: "a",
            body: "text of a.md\n",
            frontmatter: {},
            folder_id: null,
            created_at: WRITTEN,
            updated_at: MODIFIED,
          },
          {
            hive_id: HIVE,
            member_id: ME,
            workspace_id: W1,
            path: "b.md",
            title: "b",
            body: "text of b.md\n",
            frontmatter: {},
            folder_id: null,
          },
        ],
      ]);
    });

    it("corrects only the dates of a note whose content is the same, and says updated", async () => {
      // As a note imported before dates were carried: both stamped with the moment of import.
      const t = fake({
        notes: [
          stored("a.md", {
            created_at: "2026-11-20T10:00:00.123456+00:00",
            updated_at: "2026-11-20T10:00:00.123456+00:00",
          }),
        ],
      });
      expect(outcomes(await importBatchIn(t.db, W1, [dated("a.md")]))).toEqual([
        ["a.md", "updated"],
      ]);
      expect(writes(t)).toHaveLength(1);
      expect(writes(t)[0]!.ops).toEqual([
        ["update", [{ created_at: WRITTEN, updated_at: MODIFIED }]],
        ["eq", ["id", "00000000-0000-4000-8000-00000000e001"]],
        ["select", ["id"]],
      ]);
    });

    it("corrects the dates when only one of them differs, or a stored one cannot be read", async () => {
      for (const extra of [
        { created_at: "2025-03-15T12:00:00+00:00" },
        { updated_at: "2025-06-01T08:15:30.251+00:00" },
        { created_at: null },
        { updated_at: "not a date" },
        { created_at: undefined },
      ]) {
        const t = fake({ notes: [stored("a.md", extra)] });
        expect(
          outcomes(await importBatchIn(t.db, W1, [dated("a.md")])),
          JSON.stringify(extra),
        ).toEqual([["a.md", "updated"]]);
        expect(op(writes(t)[0]!, "update")).toEqual([
          { created_at: WRITTEN, updated_at: MODIFIED },
        ]);
      }
    });

    it("sends only the dates the note carries", async () => {
      const t = fake({
        notes: [stored("a.md", { created_at: "2026-11-20T10:00:00+00:00" })],
      });
      expect(
        outcomes(
          await importBatchIn(t.db, W1, [
            note("a.md", { written_at: WRITTEN }),
          ]),
        ),
      ).toEqual([["a.md", "updated"]]);
      expect(op(writes(t)[0]!, "update")).toEqual([{ created_at: WRITTEN }]);

      const other = fake({
        notes: [stored("a.md", { updated_at: "2026-11-20T10:00:00+00:00" })],
      });
      expect(
        outcomes(
          await importBatchIn(other.db, W1, [
            note("a.md", { modified_at: MODIFIED }),
          ]),
        ),
      ).toEqual([["a.md", "updated"]]);
      expect(op(writes(other)[0]!, "update")).toEqual([
        { updated_at: MODIFIED },
      ]);
    });

    it("leaves a note alone when its content and its dates are the same", async () => {
      const t = fake({
        notes: [stored("a.md"), stored("b.md", { id: NEW_WS })],
      });
      expect(
        outcomes(
          await importBatchIn(t.db, W1, [
            dated("a.md"),
            // The same moments, written another way.
            note("b.md", {
              written_at: "2025-03-14T14:00:00+02:00",
              modified_at: "2025-06-01 08:15:30.250",
            }),
          ]),
        ),
      ).toEqual([
        ["a.md", "unchanged"],
        ["b.md", "unchanged"],
      ]);
      expect(writes(t)).toEqual([]);
      expect(t.tables.notes!.every((n) => n.version === 3)).toBe(true);
    });

    it("compares only the dates that were sent", async () => {
      const t = fake({
        notes: [stored("a.md", { updated_at: "2026-11-20T10:00:00+00:00" })],
      });
      expect(
        outcomes(
          await importBatchIn(t.db, W1, [
            note("a.md", { written_at: WRITTEN }),
          ]),
        ),
      ).toEqual([["a.md", "unchanged"]]);
      // A note sent without dates is as before: whatever is stored, nothing is written.
      expect(outcomes(await importBatchIn(t.db, W1, [note("a.md")]))).toEqual([
        ["a.md", "unchanged"],
      ]);
      expect(writes(t)).toEqual([]);
    });

    it("sends the written date with changed content, and never the last change", async () => {
      const t = fake({
        notes: [stored("a.md"), stored("b.md", { id: NEW_WS })],
      });
      const r = await importBatchIn(t.db, W1, [
        dated("a.md", { body: "new text\n" }),
        note("b.md", { body: "new text\n", modified_at: MODIFIED }),
      ]);
      expect(outcomes(r)).toEqual([
        ["a.md", "updated"],
        ["b.md", "updated"],
      ]);
      expect(writes(t).map((c) => op(c, "update"))).toEqual([
        [
          {
            title: "a",
            body: "new text\n",
            frontmatter: {},
            folder_id: null,
            created_at: WRITTEN,
          },
        ],
        [{ title: "b", body: "new text\n", frontmatter: {}, folder_id: null }],
      ]);
    });

    it("says failed for a date correction the database refuses or that changes no row", async () => {
      const log = quiet();
      for (const said of [no("this hive is being deleted", "P0001"), ok([])]) {
        const t = fake({
          notes: [stored("a.md", { created_at: "2026-11-20T10:00:00+00:00" })],
          fail: (c) => (kind(c) === "update" ? said : undefined),
        });
        const r = await importBatchIn(t.db, W1, [dated("a.md")]);
        expect(outcomes(r)).toEqual([["a.md", "failed"]]);
        expect(JSON.stringify(r)).not.toContain("being deleted");
      }
      for (const line of log.mock.calls)
        expect(line.join(" ")).not.toMatch(/a\.md|text of/);
    });
  });

  it("ignores rows the read answers that were not asked for or are malformed", async () => {
    const t = fake({
      fail: (c) =>
        c.table === "notes" && kind(c) === "select"
          ? ok([
              null,
              "row",
              { id: "nope", path: "a.md", title: "a" },
              { id: NEW_WS, path: 7 },
            ])
          : undefined,
    });
    expect(outcomes(await importBatchIn(t.db, W1, [note("a.md")]))).toEqual([
      ["a.md", "created"],
    ]);
  });
});
