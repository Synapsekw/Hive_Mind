import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_THUMB_MAX, THUMB_MAX } from "../../gallery/kind";
import { loadGallery, loadPage, NO_FILTER } from "./load-gallery";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const U_ME = "11111111-1111-4111-8111-111111111101";
const GONE = "00000000-0000-4000-8000-0000000000ee";
const W1 = "00000000-0000-4000-8000-000000000b01";
const N1 = "00000000-0000-4000-8000-000000010001";
const N2 = "00000000-0000-4000-8000-000000010002";
const N3 = "00000000-0000-4000-8000-000000010003";
const S1 = "00000000-0000-4000-8000-0000000000c1";
const S2 = "00000000-0000-4000-8000-0000000000c2";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";

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
    kind: "pdf",
    session_id: null,
    ...over,
  };
}

/** A deck: never a thumbnail, never opened inline. */
const deck = (n: number, over: Record<string, unknown> = {}) =>
  file(n, {
    name: `deck-${n}.pptx`,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "slides",
    storage_path: `${ME}/${W1}/outputs/deck/acme/deck-${n}.pptx`,
    ...over,
  });

function session(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: "Proposal work",
    agent_name: "Claude",
    started_at: "2026-11-20T09:00:00+00:00",
    ended_at: "2026-11-20T09:30:00+00:00",
    note_id: null,
    member_id: ME,
    ...over,
  };
}

const image = (n: number, over: Record<string, unknown> = {}) =>
  file(n, {
    name: `photo-${n}.png`,
    mime: "image/png",
    kind: "image",
    storage_path: `${ME}/${W1}/outputs/img/acme/photo-${n}.png`,
    ...over,
  });

/** The session cookie's access token: its payload names the user. */
const tokenOf = (sub: string) =>
  `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

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
  // Each request is filed under how many requests had been answered when it was made: requests
  // made together (one wave) share the number.
  let answered = 0;
  const made: { name: string; at: number }[] = [];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const entry = { name: table, at: answered };
    made.push(entry);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "neq",
      "order",
      "limit",
      "in",
      "or",
      "gte",
      "lt",
    ])
      chain[m] = (...args: unknown[]) => {
        // The read of the person's own oldest membership is filed apart from the hive's members.
        if (table === "members" && m === "eq" && args[0] === "user_id")
          entry.name = call.table = "own";
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call) ?? ok([]))
        .then((r) => {
          answered += 1;
          return r;
        })
        .then(res, rej);
    return chain;
  });
  const user = opts.user === undefined ? { id: U_ME } : opts.user;
  const auth = {
    getUser: vi.fn(async (): Promise<never> => {
      throw new Error("a loader must not call the auth server");
    }),
    getSession: vi.fn(async () => ({
      data: { session: user ? { access_token: tokenOf(user.id) } : null },
      error: null,
    })),
  };
  const buckets: string[] = [];
  const createSignedUrls = vi.fn(async (paths: string[], _ttl: number) => {
    made.push({ name: "storage", at: answered });
    return opts.sign
      ? opts.sign(paths)
      : {
          data: paths.map((path): Signed => ({
            path,
            signedUrl: `https://signed/${path}`,
            error: null,
          })),
          error: null,
        };
  });
  const storage = {
    from: vi.fn((bucket: string) => {
      buckets.push(bucket);
      return { createSignedUrls };
    }),
  };
  return {
    db: { from, auth, storage } as never,
    calls,
    from,
    getUser: auth.getUser,
    createSignedUrls,
    buckets,
    /** The requests made, wave by wave, each wave's names sorted. */
    waves: () => {
      const at = [...new Set(made.map((m) => m.at))].sort((a, b) => a - b);
      return at.map((n) =>
        made
          .filter((m) => m.at === n)
          .map((m) => m.name)
          .sort(),
      );
    },
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
    /** The read of the person's own oldest membership. */
    own?: unknown[];
    members?: unknown[];
    sessions?: unknown[];
    refs?: unknown[];
    folders?: unknown[];
    memberships?: unknown[];
    /** Notes answered only to a second notes read (the sessions' notes). */
    laterNotes?: unknown[];
    fail?: string;
  } = {},
) {
  return (c: Call): Res | undefined => {
    if (opts.fail === c.table)
      return {
        data: null,
        error: { message: "boom", code: "XX000", details: "Secret name" },
      };
    if (c.table === "own")
      return ok(
        opts.own ?? [{ id: ME, hive_id: HIVE, hive: { name: "Synapse" } }],
      );
    if (c.table === "members")
      return ok(
        opts.members ?? [
          { id: ME, display_name: "Danijel", user_id: U_ME },
          { id: AHMED, display_name: "Ahmed", user_id: "u-ahmed" },
        ],
      );
    if (c.table === "files") return ok(opts.files ?? []);
    if (c.table === "notes") return ok(opts.notes ?? []);
    if (c.table === "sessions") return ok(opts.sessions ?? []);
    if (c.table === "file_references") return ok(opts.refs ?? []);
    if (c.table === "gallery_folders") return ok(opts.folders ?? []);
    if (c.table === "gallery_folder_files") return ok(opts.memberships ?? []);
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
    const t = stub(world({ own: [] }));
    expect(await loadGallery(t.db)).toEqual({ state: "no-hive" });
    expect(table(t, "files")).toHaveLength(0);
  });

  it.each([
    "own",
    "members",
    "files",
    "notes",
    "gallery_folders",
    "gallery_folder_files",
  ])(
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
      data: {
        files: [],
        sessions: [],
        folders: [],
        members: [
          { id: ME, name: "Danijel" },
          { id: AHMED, name: "Ahmed" },
        ],
        next: null,
      },
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
      "id,member_id,workspace_id,note_id,storage_path,name,mime,size_bytes,created_at,kind,session_id",
    ]);
    expect(op(q!, "eq").map(([, a]) => a)).toEqual([["hive_id", HIVE]]);
    expect(op(q!, "order").map(([, a]) => a)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(args(q!, "limit")).toEqual([201]);
    expect(op(q!, "or")).toHaveLength(0);
  });

  it("reads the hive of the person's own oldest membership, once", async () => {
    const t = stub(world({ files: [file(1)] }));
    await loaded(t);
    expect(table(t, "own")).toHaveLength(1);
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
    expect(args(table(t, "files")[0]!, "eq")).toEqual(["hive_id", HIVE]);
    // No call to the auth server: the user id is the one the session's token names.
    expect(t.getUser).not.toHaveBeenCalled();
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
            file(4, {
              size_bytes: null,
              name: "x.png",
              mime: "text/html",
              kind: "other",
            }),
            file(5, { kind: "something-new" }),
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
      owner_id: ME,
      mine: true,
      note: null,
      sharing: "private",
      // A PDF up to 5 MB is its own thumbnail.
      thumb: `https://signed/${file(1).storage_path}`,
      session_id: null,
      refs: [],
      folders: [],
    });
    expect(data.files[1]).toMatchObject({ owner: "Ahmed", mine: false });
    expect(data.files[2]).toMatchObject({ owner: "", mine: false });
    expect(data.files[3]).toMatchObject({ size: 0, kind: "other" });
    // The stored kind is read, not worked out again; one the gallery does not know is "other".
    expect(data.files[4]).toMatchObject({ kind: "other" });
  });

  it("never returns a storage path, a workspace or a member id", async () => {
    const data = await loaded(
      stub(
        world({
          files: [
            image(1, { note_id: N1 }),
            deck(2, { member_id: AHMED, note_id: N2 }),
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
    expect(json).not.toContain("outputs/deck");
    for (const f of data.files)
      expect(Object.keys(f).sort()).toEqual(
        [
          "created_at",
          "folders",
          "id",
          "kind",
          "mine",
          "name",
          "note",
          "owner",
          "owner_id",
          "refs",
          "session_id",
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

  it("asks for many notes in requests of at most 50 ids, so no request line grows too long", async () => {
    const nid = (n: number) =>
      `00000000-0000-4000-8000-0000000${String(10000 + n)}`;
    const files = Array.from({ length: 120 }, (_, i) =>
      file(i + 1, { note_id: nid(i + 1) }),
    );
    const t = stub(world({ files }));
    await loaded(t);
    const asked = table(t, "notes").map(
      (q) => (args(q, "in") as [string, string[]])[1],
    );
    expect(asked.map((ids) => ids.length)).toEqual([50, 50, 20]);
    expect(new Set(asked.flat()).size).toBe(120);
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
          deck(2),
          big,
          edge,
          image(5, { mime: "text/html", kind: "other" }),
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
    const t = stub(
      world({ files: [deck(1), file(2, { size_bytes: PDF_THUMB_MAX + 1 })] }),
    );
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
    const page = await loadPage(t.db, NO_FILTER, cursor);
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
    const page = await loadPage(
      stub(world({ files: all })).db,
      NO_FILTER,
      cursor,
    );
    expect(page!.files).toHaveLength(200);
    expect(page!.next).toEqual({
      created_at: all[199]!.created_at,
      id: all[199]!.id,
    });
  });

  it("answers null on any failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fail of [
      "own",
      "members",
      "files",
      "notes",
      "gallery_folder_files",
    ])
      expect(
        await loadPage(
          stub(world({ fail, files: [file(1, { note_id: N1 })] })).db,
          NO_FILTER,
          cursor,
        ),
      ).toBeNull();
    expect(
      await loadPage(stub(world({ own: [] })).db, NO_FILTER, cursor),
    ).toBeNull();
    expect(
      await loadPage(stub(world(), { user: null }).db, NO_FILTER, cursor),
    ).toBeNull();
  });
});

describe("loadGallery: sessions, references and folders", () => {
  it("reads files, folders and memberships in the second wave and never sends storage_path", async () => {
    const t = stub(
      world({
        files: [file(1, { session_id: S1 })],
        sessions: [session(S1, { note_id: N2 })],
        folders: [{ id: F1, name: "Acme", parent_id: null }],
        memberships: [{ folder_id: F1, file_id: fid(1) }],
      }),
    );
    const data = await loaded(t);
    expect(JSON.stringify(data)).not.toContain("storage_path");
    expect(JSON.stringify(data)).not.toContain("client_key");
    expect(data.files[0]!.folders).toEqual([F1]);
    expect(data.files[0]!.session_id).toBe(S1);
    expect(data.sessions.map((s) => s.id)).toEqual([S1]);
    expect(data.folders).toEqual([{ id: F1, name: "Acme", parent_id: null }]);
    expect(t.waves()).toEqual([
      ["own"],
      ["files", "gallery_folder_files", "gallery_folders", "members"],
      ["file_references", "sessions", "storage"],
      ["notes"],
    ]);
  });

  it("reads only the caller's own folders in this hive, and memberships at most 5000", async () => {
    const t = stub(world({ files: [file(1)] }));
    await loaded(t);
    const [f] = table(t, "gallery_folders");
    expect(args(f!, "select")).toEqual(["id,name,parent_id"]);
    expect(args(f!, "eq")).toEqual(["member_id", ME]);
    expect(args(f!, "limit")).toBeDefined();
    const [m] = table(t, "gallery_folder_files");
    expect(args(m!, "select")).toEqual(["folder_id,file_id"]);
    expect(args(m!, "limit")).toEqual([5000]);
  });

  it("reads the shown files' home notes, references and sessions in one wave, never the session key", async () => {
    const t = stub(
      world({
        files: [file(1, { note_id: N1, session_id: S1 }), file(2)],
        sessions: [session(S1, { note_id: N1 })],
        notes: [{ id: N1, title: "Acme", member_id: ME, effective: "group" }],
      }),
    );
    const data = await loaded(t);
    const [r] = table(t, "file_references");
    expect(args(r!, "select")).toEqual(["file_id, notes(id,title)"]);
    expect(args(r!, "in")).toEqual(["file_id", [fid(1), fid(2)]]);
    const [s] = table(t, "sessions");
    expect(args(s!, "select")).toEqual([
      "id,title,agent_name,started_at,ended_at,note_id,member_id",
    ]);
    expect(args(s!, "in")).toEqual(["id", [S1]]);
    // The session's note was read with the files': no fourth wave.
    expect(table(t, "notes")).toHaveLength(1);
    expect(data.sessions).toEqual([
      {
        id: S1,
        title: "Proposal work",
        agent: "Claude",
        started_at: "2026-11-20T09:00:00+00:00",
        ended_at: "2026-11-20T09:30:00+00:00",
        note: { id: N1, title: "Acme" },
        mine: true,
      },
    ]);
  });

  it("calls a session that is still open 'Open session' and knows whose it is", async () => {
    const data = await loaded(
      stub(
        world({
          files: [file(1, { session_id: S1 }), file(2, { session_id: S2 })],
          sessions: [
            session(S1, { title: null, ended_at: null }),
            session(S2, { member_id: AHMED }),
          ],
        }),
      ),
    );
    expect(data.sessions.map((s) => [s.title, s.ended_at, s.mine])).toEqual([
      ["Open session", null, true],
      ["Proposal work", "2026-11-20T09:30:00+00:00", false],
    ]);
  });

  it("asks for each session once, in requests of at most 50 ids", async () => {
    const sid = (n: number) =>
      `00000000-0000-4000-8000-0000000${String(20000 + n)}`;
    const files = Array.from({ length: 120 }, (_, i) =>
      file(i + 1, { session_id: sid(Math.floor(i / 2)) }),
    );
    const t = stub(world({ files }));
    await loaded(t);
    const asked = table(t, "sessions").map(
      (q) => (args(q, "in") as [string, string[]])[1],
    );
    expect(asked.map((ids) => ids.length)).toEqual([50, 10]);
    const refs = table(t, "file_references").map(
      (q) => (args(q, "in") as [string, string[]])[1].length,
    );
    expect(refs).toEqual([50, 50, 20]);
  });

  it("carries the references the caller may read, leaving out a note that came back empty", async () => {
    const data = await loaded(
      stub(
        world({
          files: [file(1), file(2)],
          refs: [
            { file_id: fid(1), notes: { id: N2, title: "Pricing" } },
            { file_id: fid(1), notes: { id: N1, title: "Acme" } },
            { file_id: fid(1), notes: null },
            { file_id: fid(2), notes: { id: N3, title: "Kickoff" } },
          ],
        }),
      ),
    );
    expect(data.files.map((f) => f.refs)).toEqual([
      [
        { id: N1, title: "Acme" },
        { id: N2, title: "Pricing" },
      ],
      [{ id: N3, title: "Kickoff" }],
    ]);
  });

  it("puts a file in every folder of the caller's that holds it", async () => {
    const data = await loaded(
      stub(
        world({
          files: [file(1), file(2)],
          folders: [
            { id: F1, name: "Acme", parent_id: null },
            { id: F2, name: "Pricing", parent_id: F1 },
          ],
          memberships: [
            { folder_id: F1, file_id: fid(1) },
            { folder_id: F2, file_id: fid(1) },
            { folder_id: F2, file_id: GONE },
          ],
        }),
      ),
    );
    expect(data.files.map((f) => f.folders)).toEqual([[F1, F2], []]);
    expect(data.folders).toEqual([
      { id: F1, name: "Acme", parent_id: null },
      { id: F2, name: "Pricing", parent_id: F1 },
    ]);
  });

  it("signs PDFs up to 5 MB and images up to 2 MB, nothing else", async () => {
    const MB = 1024 * 1024;
    const smallPdf = file(1, { size_bytes: MB });
    const bigPdf = file(2, { size_bytes: 6 * MB });
    const smallPng = image(3, { size_bytes: MB });
    const bigPng = image(4, { size_bytes: 3 * MB });
    const csv = file(5, {
      name: "rows.csv",
      mime: "text/csv",
      kind: "csv",
      size_bytes: 1024,
      storage_path: `${ME}/${W1}/outputs/data/rows.csv`,
    });
    const edgePdf = file(6, { size_bytes: PDF_THUMB_MAX });
    const t = stub(
      world({ files: [smallPdf, bigPdf, smallPng, bigPng, csv, edgePdf] }),
    );
    const data = await loaded(t);
    expect(t.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(t.createSignedUrls.mock.calls[0]![0]).toEqual([
      smallPdf.storage_path,
      smallPng.storage_path,
      edgePdf.storage_path,
    ]);
    expect(data.files.map((f) => f.thumb !== null)).toEqual([
      true,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it("an unreadable session note leaves the session without a note, not an error", async () => {
    const t = stub(
      world({
        files: [file(1, { session_id: S1 })],
        sessions: [session(S1, { note_id: N2 })],
        notes: [],
      }),
    );
    const data = await loaded(t);
    expect(data.sessions[0]!.note).toBeNull();
    // Read in its own, fourth wave, only for the note not read with the files'.
    const reads = table(t, "notes");
    expect(reads).toHaveLength(1);
    expect(args(reads[0]!, "in")).toEqual(["id", [N2]]);
  });

  it("a session note read in the fourth wave gives the session its title", async () => {
    const t = stub((c) =>
      c.table === "notes" &&
      (args(c, "in") as [string, string[]])[1].includes(N2)
        ? ok([
            {
              id: N2,
              title: "Session log",
              member_id: ME,
              effective: "private",
            },
          ])
        : world({
            files: [file(1, { session_id: S1, note_id: N1 })],
            sessions: [session(S1, { note_id: N2 })],
            notes: [
              { id: N1, title: "Home", member_id: ME, effective: "private" },
            ],
          })(c),
    );
    const data = await loaded(t);
    expect(data.sessions[0]!.note).toEqual({ id: N2, title: "Session log" });
    expect(data.files[0]!.note).toEqual({ id: N1, title: "Home" });
    expect(table(t, "notes").map((q) => args(q, "in"))).toEqual([
      ["id", [N1]],
      ["id", [N2]],
    ]);
  });

  it("a failed folders query fails the page; a failed references query costs only the references", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fail of ["gallery_folders", "gallery_folder_files"]) {
      const t = stub(world({ fail, files: [file(1)] }));
      expect(await loadGallery(t.db)).toEqual({ state: "error" });
    }
    const t = stub(
      world({
        fail: "file_references",
        files: [file(1, { note_id: N1 })],
        notes: [{ id: N1, title: "Acme", member_id: ME, effective: "group" }],
      }),
    );
    const data = await loaded(t);
    expect(data.files[0]).toMatchObject({
      refs: [],
      note: { id: N1, title: "Acme" },
      sharing: "through-note",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
  });

  it("a failed sessions query costs only the sessions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await loaded(
      stub(world({ fail: "sessions", files: [file(1, { session_id: S1 })] })),
    );
    expect(data.sessions).toEqual([]);
    expect(data.files[0]!.session_id).toBe(S1);
  });
});

describe("loadPage: server filters", () => {
  it("loadPage applies every server filter on indexed columns", async () => {
    const t = stub(world({ files: [] }));
    await loadPage(
      t.db,
      {
        kinds: ["pdf", "slides"],
        session: S1,
        owner: AHMED,
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-02T00:00:00.000Z",
        ids: [fid(1), fid(2)],
      },
      null,
    );
    const [q] = table(t, "files");
    const ops = q!.ops.map(([m, a]) => [m, ...a]);
    expect(ops).toContainEqual(["in", "kind", ["pdf", "slides"]]);
    expect(ops).toContainEqual(["eq", "session_id", S1]);
    expect(ops).toContainEqual(["eq", "member_id", AHMED]);
    expect(ops).toContainEqual([
      "gte",
      "created_at",
      "2026-11-01T00:00:00.000Z",
    ]);
    expect(ops).toContainEqual([
      "lt",
      "created_at",
      "2026-11-02T00:00:00.000Z",
    ]);
    expect(ops).toContainEqual(["in", "id", [fid(1), fid(2)]]);
    expect(ops).toContainEqual(["eq", "hive_id", HIVE]);
    expect(args(q!, "limit")).toEqual([201]);
    expect(op(q!, "or")).toHaveLength(0);
  });

  it("adds nothing for an empty filter, and the keyset with a cursor", async () => {
    const t = stub(world({ files: [] }));
    const cursor = {
      created_at: "2026-11-20T10:00:00.000100+00:00",
      id: fid(9),
    };
    await loadPage(t.db, { ...NO_FILTER, kinds: ["csv"] }, cursor);
    const [q] = table(t, "files");
    expect(op(q!, "in").map(([, a]) => a)).toEqual([["kind", ["csv"]]]);
    expect(op(q!, "eq").map(([, a]) => a)).toEqual([["hive_id", HIVE]]);
    expect(op(q!, "gte")).toHaveLength(0);
    expect(op(q!, "lt")).toHaveLength(0);
    expect(args(q!, "or")).toEqual([
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    ]);
  });

  it("returns files, their sessions and next, and reads no folders", async () => {
    const t = stub(
      world({
        files: [file(1, { session_id: S1 })],
        sessions: [session(S1)],
        memberships: [{ folder_id: F1, file_id: fid(1) }],
      }),
    );
    const page = await loadPage(t.db, NO_FILTER, null);
    expect(Object.keys(page!).sort()).toEqual(["files", "next", "sessions"]);
    expect(page!.sessions.map((s) => s.id)).toEqual([S1]);
    expect(page!.files[0]!.folders).toEqual([F1]);
    expect(table(t, "gallery_folders")).toHaveLength(0);
  });
});
