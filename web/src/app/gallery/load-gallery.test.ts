import { afterEach, describe, expect, it, vi } from "vitest";
import { THUMB_MAX } from "../../gallery/kind";
import { loadGallery, loadPage } from "./load-gallery";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const GONE = "00000000-0000-4000-8000-0000000000ee";
const W1 = "00000000-0000-4000-8000-000000000b01";
const N1 = "00000000-0000-4000-8000-000000010001";
const N2 = "00000000-0000-4000-8000-000000010002";
const N3 = "00000000-0000-4000-8000-000000010003";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };
type Signed = {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
};

const ok = (data: unknown): Res => ({ data, error: null });
const fid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function file(n: number, over: Record<string, unknown> = {}) {
  return {
    id: fid(n),
    member_id: ME,
    workspace_id: W1,
    note_id: null,
    storage_path: `${ME}/${W1}/outputs/doc/acme/file-${n}.pdf`,
    name: `file-${n}.pdf`,
    mime: "application/pdf",
    size_bytes: 1000 + n,
    created_at: `2026-11-20T10:00:00.${String(999999 - n).padStart(6, "0")}+00:00`,
    ...over,
  };
}

const image = (n: number, over: Record<string, unknown> = {}) =>
  file(n, {
    name: `photo-${n}.png`,
    mime: "image/png",
    storage_path: `${ME}/${W1}/outputs/img/acme/photo-${n}.png`,
    ...over,
  });

/**
 * A stand-in client: every `from(table)` chain is recorded and resolves to what `answer`
 * returns for it; `storage.from(bucket).createSignedUrls` is recorded and answers `sign`.
 */
function stub(
  answer: (c: Call) => Res | undefined,
  opts: {
    user?: { id: string } | null;
    sign?: (paths: string[]) => unknown;
  } = {},
) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "in", "or"])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call) ?? ok([])).then(res, rej);
    return chain;
  });
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  const buckets: string[] = [];
  const createSignedUrls = vi.fn(async (paths: string[], _ttl: number) =>
    opts.sign
      ? opts.sign(paths)
      : {
          data: paths.map((path): Signed => ({
            path,
            signedUrl: `https://signed/${path}`,
            error: null,
          })),
          error: null,
        },
  );
  const storage = {
    from: vi.fn((bucket: string) => {
      buckets.push(bucket);
      return { createSignedUrls };
    }),
  };
  return {
    db: { from, auth, storage } as never,
    calls,
    createSignedUrls,
    buckets,
  };
}

const op = (c: Call, name: string) => c.ops.filter(([m]) => m === name);
const args = (c: Call, name: string) => op(c, name)[0]?.[1];
const table = (t: { calls: Call[] }, name: string) =>
  t.calls.filter((c) => c.table === name);

/** A hive with me and Ahmed; `files` and `notes` answer the two index reads. */
function world(
  opts: {
    files?: unknown[];
    notes?: unknown[];
    hives?: unknown[];
    members?: unknown[];
    fail?: string;
  } = {},
) {
  return (c: Call): Res | undefined => {
    if (opts.fail === c.table)
      return {
        data: null,
        error: { message: "boom", code: "XX000", details: "Secret name" },
      };
    if (c.table === "hives") return ok(opts.hives ?? [{ id: HIVE }]);
    if (c.table === "members")
      return ok(
        opts.members ?? [
          { id: ME, display_name: "Danijel", user_id: "u-me" },
          { id: AHMED, display_name: "Ahmed", user_id: "u-ahmed" },
        ],
      );
    if (c.table === "files") return ok(opts.files ?? []);
    if (c.table === "notes") return ok(opts.notes ?? []);
    return undefined;
  };
}

async function loaded(t: { db: never }) {
  const out = await loadGallery(t.db);
  if (out.state !== "ok") throw new Error(`state ${out.state}`);
  return out.data;
}

afterEach(() => vi.restoreAllMocks());

describe("loadGallery: states", () => {
  it("answers no-hive when the caller is in none", async () => {
    const t = stub(world({ hives: [] }));
    expect(await loadGallery(t.db)).toEqual({ state: "no-hive" });
    expect(table(t, "files")).toHaveLength(0);
  });

  it.each(["hives", "members", "files", "notes"])(
    "answers error when the %s query fails, logging only code and message",
    async (failing) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub(
        world({
          fail: failing,
          files: [file(1, { note_id: N1 })],
        }),
      );
      expect(await loadGallery(t.db)).toEqual({ state: "error" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
      expect(JSON.stringify(log.mock.calls)).toContain("XX000");
    },
  );

  it("answers error with no signed-in user", async () => {
    const t = stub(world({ files: [file(1)] }), { user: null });
    expect(await loadGallery(t.db)).toEqual({ state: "error" });
  });

  it("answers error when the user has no member row in the hive", async () => {
    const t = stub(world({ files: [file(1)] }), { user: { id: "u-nobody" } });
    expect(await loadGallery(t.db)).toEqual({ state: "error" });
  });

  it("answers an empty first page for a hive with no files", async () => {
    const t = stub(world());
    expect(await loadGallery(t.db)).toEqual({
      state: "ok",
      data: { files: [], next: null },
    });
    expect(table(t, "notes")).toHaveLength(0);
    expect(t.createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("loadGallery: the files query", () => {
  it("selects the index columns, filters the hive, orders newest first and asks for 201", async () => {
    const t = stub(world({ files: [file(1)] }));
    await loaded(t);
    const [q] = table(t, "files");
    expect(table(t, "files")).toHaveLength(1);
    expect(args(q!, "select")).toEqual([
      "id,member_id,workspace_id,note_id,storage_path,name,mime,size_bytes,created_at",
    ]);
    expect(op(q!, "eq").map(([, a]) => a)).toEqual([["hive_id", HIVE]]);
    expect(op(q!, "order").map(([, a]) => a)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(args(q!, "limit")).toEqual([201]);
    expect(op(q!, "or")).toHaveLength(0);
  });

  it("reads the members of the hive with their names and users", async () => {
    const t = stub(world({ files: [file(1)] }));
    await loaded(t);
    const [q] = table(t, "members");
    expect(args(q!, "select")).toEqual(["id, display_name, user_id"]);
    expect(args(q!, "eq")).toEqual(["hive_id", HIVE]);
  });

  it("cuts 201 rows to 200 and points next at the 200th", async () => {
    const all = Array.from({ length: 201 }, (_, i) => file(i + 1));
    const t = stub(world({ files: all }));
    const data = await loaded(t);
    expect(data.files).toHaveLength(200);
    expect(data.files[199]!.id).toBe(fid(200));
    expect(data.next).toEqual({
      created_at: all[199]!.created_at,
      id: fid(200),
    });
  });

  it("has no next when exactly 200 rows come back", async () => {
    const all = Array.from({ length: 200 }, (_, i) => file(i + 1));
    const data = await loaded(stub(world({ files: all })));
    expect(data.files).toHaveLength(200);
    expect(data.next).toBeNull();
  });
});

describe("loadGallery: a file", () => {
  it("carries the name, kind, size, date, owner and whether it is mine", async () => {
    const data = await loaded(
      stub(
        world({
          files: [
            file(1),
            file(2, { member_id: AHMED }),
            file(3, { member_id: GONE }),
            file(4, { size_bytes: null, name: "x.png", mime: "text/html" }),
          ],
        }),
      ),
    );
    expect(data.files[0]).toEqual({
      id: fid(1),
      name: "file-1.pdf",
      kind: "pdf",
      size: 1001,
      created_at: file(1).created_at,
      owner: "Danijel",
      mine: true,
      note: null,
      sharing: "private",
      thumb: null,
    });
    expect(data.files[1]).toMatchObject({ owner: "Ahmed", mine: false });
    expect(data.files[2]).toMatchObject({ owner: "", mine: false });
    expect(data.files[3]).toMatchObject({ size: 0, kind: "other" });
  });

  it("never returns a storage path, a workspace or a member id", async () => {
    const data = await loaded(
      stub(
        world({
          files: [
            image(1, { note_id: N1 }),
            file(2, { member_id: AHMED, note_id: N2 }),
          ],
          notes: [
            { id: N1, title: "Mine", member_id: ME, effective: "group" },
            { id: N2, title: "His", member_id: AHMED, effective: "members" },
          ],
        }),
      ),
    );
    const json = JSON.stringify(data);
    for (const key of ["storage_path", "workspace_id", "member_id", "note_id"])
      expect(json).not.toContain(key);
    // A signed link names the object it opens, so a thumbnail is the one place a path shows.
    const besidesLinks = JSON.stringify(
      data.files.map((f) => ({ ...f, thumb: null })),
    );
    expect(besidesLinks).not.toContain(W1);
    expect(besidesLinks).not.toContain("outputs/");
    expect(json).not.toContain("outputs/doc");
    for (const f of data.files)
      expect(Object.keys(f).sort()).toEqual(
        [
          "created_at",
          "id",
          "kind",
          "mine",
          "name",
          "note",
          "owner",
          "sharing",
          "size",
          "thumb",
        ].sort(),
      );
  });
});

describe("loadGallery: notes and sharing", () => {
  it("asks only for the distinct attached notes, with the database's visibility", async () => {
    const t = stub(
      world({
        files: [
          file(1, { note_id: N1 }),
          file(2, { note_id: N1 }),
          file(3),
          file(4, { note_id: N2 }),
        ],
      }),
    );
    await loaded(t);
    const [q] = table(t, "notes");
    expect(table(t, "notes")).toHaveLength(1);
    expect(args(q!, "select")).toEqual([
      "id,title,member_id,effective:note_visibility",
    ]);
    expect(args(q!, "in")).toEqual(["id", [N1, N2]]);
  });

  it("skips the notes query when no file is attached to one", async () => {
    const t = stub(world({ files: [file(1), file(2)] }));
    await loaded(t);
    expect(table(t, "notes")).toHaveLength(0);
  });

  it("works out sharing from whose file it is and what the note's sharing is", async () => {
    const data = await loaded(
      stub(
        world({
          files: [
            file(1),
            file(2, { note_id: N1 }),
            file(3, { note_id: N2 }),
            file(4, { note_id: N3 }),
            file(5, { note_id: GONE }),
            file(6, { member_id: AHMED, note_id: N2 }),
            file(7, { member_id: AHMED, note_id: GONE }),
            file(8, { member_id: AHMED }),
          ],
          notes: [
            { id: N1, title: "Quiet", member_id: ME, effective: "private" },
            { id: N2, title: "Team", member_id: ME, effective: "group" },
            { id: N3, title: "Named", member_id: ME, effective: "members" },
          ],
        }),
      ),
    );
    const got = data.files.map((f) => [f.sharing, f.note]);
    expect(got).toEqual([
      ["private", null],
      ["private", { id: N1, title: "Quiet" }],
      ["through-note", { id: N2, title: "Team" }],
      ["through-note", { id: N3, title: "Named" }],
      ["private", null],
      ["shared-with-me", { id: N2, title: "Team" }],
      ["shared-with-me", null],
      ["shared-with-me", null],
    ]);
  });
});

describe("loadGallery: thumbnails", () => {
  it("signs, in one call, the paths of images up to the cap for 600 seconds in the files bucket", async () => {
    const big = image(3, { size_bytes: THUMB_MAX + 1 });
    const edge = image(4, { size_bytes: THUMB_MAX });
    const t = stub(
      world({
        files: [
          image(1),
          file(2),
          big,
          edge,
          image(5, { mime: "text/html" }),
          image(6, { size_bytes: null }),
        ],
      }),
    );
    const data = await loaded(t);
    expect(t.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(t.createSignedUrls).toHaveBeenCalledWith(
      [image(1).storage_path, edge.storage_path],
      600,
    );
    expect(t.buckets).toEqual(["files"]);
    expect(data.files.map((f) => f.thumb)).toEqual([
      `https://signed/${image(1).storage_path}`,
      null,
      null,
      `https://signed/${edge.storage_path}`,
      null,
      null,
    ]);
  });

  it("makes no storage call when nothing has a thumbnail", async () => {
    const t = stub(world({ files: [file(1), file(2)] }));
    await loaded(t);
    expect(t.createSignedUrls).not.toHaveBeenCalled();
  });

  it("matches links to files by path, not by position, and drops an entry with an error", async () => {
    const t = stub(world({ files: [image(1), image(2), image(3)] }), {
      sign: (paths) => ({
        data: [
          { path: paths[2], signedUrl: "https://signed/three", error: null },
          { path: paths[1], signedUrl: "https://signed/two", error: "denied" },
          { path: paths[0], signedUrl: "https://signed/one", error: null },
          { path: null, signedUrl: "https://signed/none", error: null },
        ],
        error: null,
      }),
    });
    const data = await loaded(t);
    expect(data.files.map((f) => f.thumb)).toEqual([
      "https://signed/one",
      null,
      "https://signed/three",
    ]);
  });

  it("still loads, without thumbnails, when signing fails or throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = stub(world({ files: [image(1)] }), {
      sign: () => ({
        data: null,
        error: { message: "storage down", statusCode: "500" },
      }),
    });
    expect((await loaded(failed)).files[0]!.thumb).toBeNull();
    const threw = stub(world({ files: [image(1)] }), {
      sign: () => {
        throw new Error("network");
      },
    });
    expect((await loaded(threw)).files[0]!.thumb).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("outputs/img");
  });
});

describe("loadPage", () => {
  const cursor = { created_at: "2026-11-20T10:00:00.000100+00:00", id: fid(9) };

  it("adds the keyset filter after the cursor and returns the page", async () => {
    const t = stub(world({ files: [image(10), file(11, { note_id: N2 })] }));
    const page = await loadPage(t.db, cursor);
    const [q] = table(t, "files");
    expect(args(q!, "or")).toEqual([
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    ]);
    expect(op(q!, "eq").map(([, a]) => a)).toEqual([["hive_id", HIVE]]);
    expect(args(q!, "limit")).toEqual([201]);
    expect(page!.files.map((f) => f.id)).toEqual([fid(10), fid(11)]);
    expect(page!.files[0]!.thumb).toBe(
      `https://signed/${image(10).storage_path}`,
    );
    expect(page!.next).toBeNull();
    expect(table(t, "notes")).toHaveLength(1);
  });

  it("points next at the 200th file when more remain", async () => {
    const all = Array.from({ length: 201 }, (_, i) => file(i + 10));
    const page = await loadPage(stub(world({ files: all })).db, cursor);
    expect(page!.files).toHaveLength(200);
    expect(page!.next).toEqual({
      created_at: all[199]!.created_at,
      id: all[199]!.id,
    });
  });

  it("answers null on any failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fail of ["hives", "members", "files", "notes"])
      expect(
        await loadPage(
          stub(world({ fail, files: [file(1, { note_id: N1 })] })).db,
          cursor,
        ),
      ).toBeNull();
    expect(await loadPage(stub(world({ hives: [] })).db, cursor)).toBeNull();
    expect(await loadPage(stub(world(), { user: null }).db, cursor)).toBeNull();
  });
});
