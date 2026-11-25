import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteIn, downloadIn, findNotesIn, openIn, setHomeIn } from "./write";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const W1 = "00000000-0000-4000-8000-000000000b01";
const FILE = "00000000-0000-4000-8000-000000030001";
const PATH = `${ME}/${W1}/outputs/proposal/acme/Proposal v2.pdf`;
const NOTE = "00000000-0000-4000-8000-000000010001";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });

function row(over: Record<string, unknown> = {}) {
  return {
    id: FILE,
    member_id: ME,
    storage_path: PATH,
    name: "Proposal v2.pdf",
    mime: "application/pdf",
    kind: "pdf",
    ...over,
  };
}

/**
 * A stand-in client. `file` answers the read of the row, `gone` the row delete; `sign` and
 * `remove` answer the storage calls. `log` holds every database and storage step in order.
 */
function stub(
  opts: {
    file?: Res;
    gone?: Res;
    /** The read of the person's own oldest membership. */
    own?: Res;
    sign?: unknown;
    remove?: unknown;
    user?: { id: string } | null;
    /** The answer to any rpc call. */
    rpc?: Res;
    /** The answer to the note search. */
    notes?: Res;
  } = {},
) {
  const calls: Call[] = [];
  const log: string[] = [];
  const isDelete = (c: Call) => c.ops.some(([m]) => m === "delete");
  const answer = (c: Call): Res => {
    if (c.table === "members")
      return (
        opts.own ?? ok([{ id: ME, hive_id: HIVE, hive: { name: "Synapse" } }])
      );
    if (isDelete(c)) return opts.gone ?? ok([{ id: FILE }]);
    if (c.table === "notes") return opts.notes ?? ok([]);
    return opts.file ?? ok([row()]);
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "delete", "in", "ilike"])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) => {
      log.push(isDelete(call) ? `delete ${table}` : `read ${table}`);
      return Promise.resolve(answer(call)).then(res, rej);
    };
    return chain;
  });
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  const rpc = vi.fn(async (..._args: unknown[]) => {
    log.push("rpc");
    return opts.rpc ?? ok(null);
  });
  const buckets: string[] = [];
  const createSignedUrl = vi.fn(async (..._args: unknown[]) => {
    log.push("sign");
    return (
      opts.sign ?? { data: { signedUrl: "https://signed/one" }, error: null }
    );
  });
  const remove = vi.fn(async (_paths: string[]) => {
    log.push("remove");
    return opts.remove ?? { data: [{ name: PATH }], error: null };
  });
  const storage = {
    from: vi.fn((bucket: string) => {
      buckets.push(bucket);
      return { createSignedUrl, remove };
    }),
  };
  return {
    db: { from, auth, storage, rpc } as never,
    rpc,
    calls,
    getUser: auth.getUser,
    log,
    from,
    storage,
    buckets,
    createSignedUrl,
    remove,
  };
}

const boom: Res = {
  data: null,
  error: { message: "boom", code: "XX000", details: "Secret name" },
};
const storageDown = {
  data: null,
  error: { message: "storage down", statusCode: "500" },
};
const table = (t: { calls: Call[] }, name: string) =>
  t.calls.filter((c) => c.table === name);
const op = (c: Call, name: string) => c.ops.filter(([m]) => m === name);

afterEach(() => vi.restoreAllMocks());

describe("openIn", () => {
  it("refuses an id that is not a uuid without any query", async () => {
    const t = stub();
    for (const bad of ["nope", "", 7, null, undefined, { id: FILE }])
      expect(await openIn(t.db, bad)).toBeNull();
    expect(t.from).not.toHaveBeenCalled();
    expect(t.storage.from).not.toHaveBeenCalled();
  });

  it("answers null for an id with no readable row, and signs nothing", async () => {
    const t = stub({ file: ok([]) });
    expect(await openIn(t.db, FILE)).toBeNull();
    expect(t.createSignedUrl).not.toHaveBeenCalled();
  });

  it("answers the same for a failed read as for a missing row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ file: boom });
    expect(await openIn(t.db, FILE)).toBeNull();
    expect(t.createSignedUrl).not.toHaveBeenCalled();
  });

  it("reads the row by id and signs its path for 600 seconds with no download option", async () => {
    const t = stub();
    expect(await openIn(t.db, FILE)).toEqual({
      url: "https://signed/one",
      kind: "pdf",
    });
    const [q] = table(t, "files");
    expect(op(q!, "eq").map(([, a]) => a)).toEqual([["id", FILE]]);
    expect(t.buckets).toEqual(["files"]);
    expect(t.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(t.createSignedUrl.mock.calls[0]).toEqual([PATH, 600]);
  });

  it("signs no inline link for a file the viewer cannot show", async () => {
    // A PDF by name that declares HTML, a page, a drawing, a deck: download only.
    for (const over of [
      { mime: "text/html", kind: "other" },
      { name: "page.html", mime: "text/html", kind: "other" },
      { name: "drawing.svg", mime: "image/svg+xml", kind: "other" },
      { name: "deck.pptx", mime: "application/pdf", kind: "slides" },
      { name: "x.pdf", kind: "not-a-kind" },
    ]) {
      const t = stub({ file: ok([row(over)]) });
      expect(await openIn(t.db, FILE)).toBeNull();
      expect(t.createSignedUrl).not.toHaveBeenCalled();
    }
  });

  it("opens an image as an image", async () => {
    const t = stub({
      file: ok([row({ name: "site.png", mime: "image/png", kind: "image" })]),
    });
    expect(await openIn(t.db, FILE)).toEqual({
      url: "https://signed/one",
      kind: "image",
    });
  });

  it("returns nothing but the link and the kind", async () => {
    const out = await openIn(stub().db, FILE);
    expect(Object.keys(out!).sort()).toEqual(["kind", "url"]);
    expect(JSON.stringify(out)).not.toContain("outputs/");
  });

  it("answers null when signing fails, logging only code and message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await openIn(stub({ sign: storageDown }).db, FILE)).toBeNull();
    expect(
      await openIn(
        stub({ sign: { data: { signedUrl: "" }, error: null } }).db,
        FILE,
      ),
    ).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("outputs/");
  });
});

describe("downloadIn", () => {
  it("refuses a bad id without any query", async () => {
    const t = stub();
    expect(await downloadIn(t.db, "nope")).toBeNull();
    expect(t.from).not.toHaveBeenCalled();
  });

  it("answers null for an id with no readable row", async () => {
    const t = stub({ file: ok([]) });
    expect(await downloadIn(t.db, FILE)).toBeNull();
    expect(t.createSignedUrl).not.toHaveBeenCalled();
  });

  it("signs the path for 600 seconds and names the download itself", async () => {
    const t = stub();
    expect(await downloadIn(t.db, FILE)).toEqual({
      url: "https://signed/one&download=Proposal%20v2.pdf",
    });
    expect(t.buckets).toEqual(["files"]);
    // No download option: the client library would encode the name a second time.
    expect(t.createSignedUrl.mock.calls[0]).toEqual([PATH, 600]);
  });

  it("encodes a name with reserved characters exactly once", async () => {
    const t = stub({ file: ok([row({ name: "R&D #3 (final) Račun.pdf" })]) });
    const out = await downloadIn(t.db, FILE);
    const name = out!.url.split("&download=")[1]!;
    expect(name).not.toContain("%25");
    expect(decodeURIComponent(name)).toBe("R&D #3 (final) Račun.pdf");
    expect(out!.url.split("&")).toHaveLength(2);
  });

  it("still downloads, under the stored name, a file whose name is empty", async () => {
    const t = stub({ file: ok([row({ name: "" })]) });
    expect(await downloadIn(t.db, FILE)).toEqual({
      url: "https://signed/one&download=",
    });
  });

  it("answers null when signing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await downloadIn(stub({ sign: storageDown }).db, FILE)).toBeNull();
  });
});

describe("deleteIn", () => {
  it("refuses a bad id without any query", async () => {
    const t = stub();
    for (const bad of ["nope", 7, null, undefined])
      expect(await deleteIn(t.db, bad)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.storage.from).not.toHaveBeenCalled();
  });

  it("refuses without a signed-in user", async () => {
    const t = stub({ user: null });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
    expect(t.remove).not.toHaveBeenCalled();
    expect(t.log).not.toContain("delete files");
  });

  it("refuses an id with no readable row", async () => {
    const t = stub({ file: ok([]) });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
    expect(t.remove).not.toHaveBeenCalled();
    expect(t.log).not.toContain("delete files");
  });

  it("refuses a colleague's file shared with the caller before any storage call", async () => {
    const t = stub({
      file: ok([
        row({ member_id: AHMED, storage_path: `${AHMED}/${W1}/outputs/x.pdf` }),
      ]),
    });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
    expect(t.storage.from).not.toHaveBeenCalled();
    expect(t.remove).not.toHaveBeenCalled();
    expect(t.log).not.toContain("delete files");
  });

  it("refuses when the caller's membership cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const opts of [{ own: boom }, { own: ok([]) }, { file: boom }]) {
      const t = stub(opts);
      expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
      expect(t.remove).not.toHaveBeenCalled();
      expect(t.log).not.toContain("delete files");
    }
  });

  it("reads the caller's member id from their own oldest membership, in one read", async () => {
    const t = stub();
    await deleteIn(t.db, FILE);
    expect(table(t, "hives")).toHaveLength(0);
    expect(table(t, "members")).toHaveLength(1);
    const [m] = table(t, "members");
    expect(m!.ops).toEqual([
      [
        "select",
        [
          "id, hive_id, display_name, role, hive:hives!hive_id(name, delete_after)",
        ],
      ],
      ["eq", ["user_id", "u-me"]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [50]],
    ]);
    // The id is the one the auth server answered with, asked for once.
    expect(t.getUser).toHaveBeenCalledTimes(1);
  });

  it("refuses the caller's own file from a hive that is not the one they use", async () => {
    const elsewhere = "00000000-0000-4000-8000-0000000000e9";
    const t = stub({ file: ok([row({ member_id: elsewhere })]) });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
    expect(t.remove).not.toHaveBeenCalled();
    expect(t.log).not.toContain("delete files");
  });

  it("removes the stored object first, then the row, by id only", async () => {
    const t = stub();
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: true });
    expect(t.buckets).toEqual(["files"]);
    expect(t.remove).toHaveBeenCalledTimes(1);
    expect(t.remove).toHaveBeenCalledWith([PATH]);
    expect(t.log.indexOf("remove")).toBeGreaterThan(-1);
    expect(t.log.indexOf("remove")).toBeLessThan(t.log.indexOf("delete files"));
    const gone = table(t, "files").filter((c) => op(c, "delete").length);
    expect(gone).toHaveLength(1);
    expect(op(gone[0]!, "eq").map(([, a]) => a)).toEqual([["id", FILE]]);
    expect(op(gone[0]!, "neq")).toHaveLength(0);
  });

  it("stops before the row when removing the object fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ remove: storageDown });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
    expect(t.remove).toHaveBeenCalledTimes(1);
    expect(t.log).not.toContain("delete files");
    expect(JSON.stringify(log.mock.calls)).not.toContain("outputs/");
  });

  it("still deletes the row when the object was already gone", async () => {
    const t = stub({ remove: { data: [], error: null } });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: true });
    expect(t.log).toContain("delete files");
  });

  it("answers not ok when the row delete fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ gone: boom });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
  });

  it("answers not ok when the database deleted no row", async () => {
    const t = stub({ gone: ok([]) });
    expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
  });
});

describe("openIn: kinds", () => {
  it("reads the stored kind, not the name", async () => {
    const t = stub();
    await openIn(t.db, FILE);
    const [q] = table(t, "files");
    expect(op(q!, "select")[0]![1]).toEqual([
      "id,member_id,storage_path,name,kind",
    ]);
  });

  it("openFile answers a link for text and csv kinds, still never for slides or other", async () => {
    for (const [over, kind] of [
      [{ name: "notes.md", mime: "text/markdown", kind: "text" }, "text"],
      [{ name: "rows.csv", mime: "text/csv", kind: "csv" }, "csv"],
    ] as const) {
      const t = stub({ file: ok([row(over)]) });
      expect(await openIn(t.db, FILE)).toEqual({
        url: "https://signed/one",
        kind,
      });
    }
    for (const kind of ["slides", "sheet", "doc", "other"]) {
      const t = stub({ file: ok([row({ kind })]) });
      expect(await openIn(t.db, FILE)).toBeNull();
      expect(t.createSignedUrl).not.toHaveBeenCalled();
    }
  });
});

describe("setHomeIn", () => {
  it("setHome calls file_set_home and answers ok; a refusal answers { ok: false }", async () => {
    const t = stub();
    expect(await setHomeIn(t.db, FILE, NOTE)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("file_set_home", {
      p_file: FILE,
      p_note: NOTE,
    });
    const none = stub();
    expect(await setHomeIn(none.db, FILE, null)).toEqual({ ok: true });
    expect(none.rpc).toHaveBeenCalledWith("file_set_home", {
      p_file: FILE,
      p_note: null,
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = stub({ rpc: boom });
    expect(await setHomeIn(refused.db, FILE, NOTE)).toEqual({ ok: false });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
    expect(JSON.stringify(log.mock.calls)).toContain("XX000");
  });

  it("refuses ids that are not uuids before any call", async () => {
    const t = stub();
    expect(await setHomeIn(t.db, "nope", NOTE)).toEqual({ ok: false });
    expect(await setHomeIn(t.db, FILE, "nope")).toEqual({ ok: false });
    expect(await setHomeIn(t.db, FILE, undefined)).toEqual({ ok: false });
    expect(t.rpc).not.toHaveBeenCalled();
    expect(t.from).not.toHaveBeenCalled();
  });
});

describe("findNotesIn", () => {
  it("findMyNotes searches the caller's own notes by title, at most 20", async () => {
    const t = stub({
      notes: ok([
        { id: NOTE, title: "Acme", path: "clients/acme.md", body: "x" },
      ]),
    });
    expect(await findNotesIn(t.db, " acme ")).toEqual([
      { id: NOTE, title: "Acme", path: "clients/acme.md" },
    ]);
    const [q] = table(t, "notes");
    expect(op(q!, "select")[0]![1]).toEqual(["id,title,path"]);
    expect(op(q!, "ilike")[0]![1]).toEqual(["title", "%acme%"]);
    expect(op(q!, "in")[0]![1]).toEqual(["member_id", [ME]]);
    expect(op(q!, "limit")[0]![1]).toEqual([20]);
  });

  it("escapes the pattern's own characters in the query", async () => {
    const t = stub();
    await findNotesIn(t.db, "50%_off\\*");
    const [q] = table(t, "notes");
    expect(op(q!, "ilike")[0]![1]).toEqual(["title", "%50\\%\\_off\\\\%"]);
  });

  it("lists the newest of the caller's notes for an empty query, without a title filter", async () => {
    const t = stub();
    await findNotesIn(t.db, "");
    const [q] = table(t, "notes");
    expect(op(q!, "ilike")).toHaveLength(0);
    expect(op(q!, "limit")[0]![1]).toEqual([20]);
  });

  it("answers [] for a bad query before any call, and when the search fails", async () => {
    const t = stub();
    for (const bad of [7, null, "x".repeat(101)])
      expect(await findNotesIn(t.db, bad)).toEqual([]);
    expect(t.from).not.toHaveBeenCalled();
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await findNotesIn(stub({ notes: boom }).db, "acme")).toEqual([]);
    expect(await findNotesIn(stub({ own: ok([]) }).db, "acme")).toEqual([]);
  });
});
