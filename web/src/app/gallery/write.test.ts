import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteIn, downloadIn, openIn } from "./write";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const W1 = "00000000-0000-4000-8000-000000000b01";
const FILE = "00000000-0000-4000-8000-000000030001";
const PATH = `${ME}/${W1}/outputs/proposal/acme/Proposal v2.pdf`;

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
    hives?: Res;
    members?: Res;
    sign?: unknown;
    remove?: unknown;
    user?: { id: string } | null;
  } = {},
) {
  const calls: Call[] = [];
  const log: string[] = [];
  const isDelete = (c: Call) => c.ops.some(([m]) => m === "delete");
  const answer = (c: Call): Res => {
    if (c.table === "hives") return opts.hives ?? ok([{ id: HIVE }]);
    if (c.table === "members")
      return (
        opts.members ??
        ok([
          { id: ME, user_id: "u-me" },
          { id: AHMED, user_id: "u-ahmed" },
        ])
      );
    if (isDelete(c)) return opts.gone ?? ok([{ id: FILE }]);
    return opts.file ?? ok([row()]);
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "delete"])
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
    db: { from, auth, storage } as never,
    calls,
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
      { mime: "text/html" },
      { name: "page.html", mime: "text/html" },
      { name: "drawing.svg", mime: "image/svg+xml" },
      { name: "deck.pptx", mime: "application/pdf" },
    ]) {
      const t = stub({ file: ok([row(over)]) });
      expect(await openIn(t.db, FILE)).toBeNull();
      expect(t.createSignedUrl).not.toHaveBeenCalled();
    }
  });

  it("opens an image as an image", async () => {
    const t = stub({
      file: ok([row({ name: "site.png", mime: "image/png" })]),
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

  it("refuses when the caller's members cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const opts of [
      { hives: boom },
      { hives: ok([]) },
      { members: boom },
      { members: ok([]) },
      { file: boom },
    ]) {
      const t = stub(opts);
      expect(await deleteIn(t.db, FILE)).toEqual({ ok: false });
      expect(t.remove).not.toHaveBeenCalled();
      expect(t.log).not.toContain("delete files");
    }
  });

  it("reads the caller's members from their first hive", async () => {
    const t = stub();
    await deleteIn(t.db, FILE);
    const [m] = table(t, "members");
    expect(op(m!, "eq").map(([, a]) => a)).toEqual([["hive_id", HIVE]]);
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
