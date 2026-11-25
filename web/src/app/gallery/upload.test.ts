import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endUploadIn,
  finishUploadIn,
  MAX_UPLOAD_BYTES,
  segment,
  startUploadIn,
} from "./upload";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const M = "00000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000b01";
const W2 = "00000000-0000-4000-8000-000000000b02";
const SID = "00000000-0000-4000-8000-0000000000c1";
const N = "00000000-0000-4000-8000-000000010001";
const N2 = "00000000-0000-4000-8000-000000010002";
const F = "00000000-0000-4000-8000-0000000000f1";
const FILE = "00000000-0000-4000-8000-000000030001";
const DIR = `${M}/${W}/uploads/${SID}`;

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });
const boom: Res = {
  data: null,
  error: { message: "boom", code: "XX000", details: "Secret name" },
};

const fileRow = (over: Record<string, unknown> = {}) => ({
  id: FILE,
  member_id: M,
  workspace_id: W,
  note_id: N,
  storage_path: `${DIR}/Deck-v2.pptx`,
  name: "Deck-v2.pptx",
  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  size_bytes: 1234,
  created_at: "2026-11-25T10:00:00.000000+00:00",
  kind: "slides",
  session_id: SID,
  ...over,
});

/**
 * A stand-in client. Every `from(table)` chain is recorded; reads answer from the named options,
 * inserts from `insert`. Storage records every signed-upload, list and remove call.
 */
function stub(
  opts: {
    own?: Res;
    workspaces?: Res;
    /** The read of the given home note (by id). */
    note?: Res;
    /** The read of the Uploads note (by workspace and path). */
    uploadNote?: Res;
    /** The insert of the Uploads note. */
    newNote?: Res;
    session?: Res;
    rpc?: Record<string, Res>;
    fileInsert?: Res;
    folderInsert?: Res;
    listed?: unknown;
    signUpload?: (path: string) => unknown;
    user?: { id: string } | null;
  } = {},
) {
  const calls: Call[] = [];
  const has = (c: Call, m: string) => c.ops.some(([op]) => op === m);
  const eqd = (c: Call, col: string) =>
    c.ops.some(([op, a]) => op === "eq" && a[0] === col);
  const answer = (c: Call): Res => {
    switch (c.table) {
      case "members":
        return (
          opts.own ??
          ok([
            {
              id: M,
              hive_id: HIVE,
              display_name: "Danijel",
              role: "owner",
              hive: { name: "Synapse" },
            },
          ])
        );
      case "workspaces":
        return opts.workspaces ?? ok([{ id: W, member_id: M }]);
      case "notes":
        if (has(c, "insert")) return opts.newNote ?? ok([{ id: N }]);
        if (eqd(c, "path")) return opts.uploadNote ?? ok([{ id: N }]);
        if (eqd(c, "id"))
          return (
            opts.note ??
            ok([
              {
                id: N,
                title: "Uploads",
                workspace_id: W,
                member_id: M,
                effective: "private",
              },
            ])
          );
        return ok([]);
      case "sessions":
        return (
          opts.session ??
          ok([
            {
              id: SID,
              hive_id: HIVE,
              member_id: M,
              workspace_id: W,
              agent_id: null,
              ended_at: null,
            },
          ])
        );
      case "files":
        return opts.fileInsert ?? ok([fileRow()]);
      case "gallery_folder_files":
        return opts.folderInsert ?? ok(null);
      default:
        return ok([]);
    }
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "insert"])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call)).then(res, rej);
    return chain;
  });
  const rpc = vi.fn(
    async (name: string, _args: unknown) =>
      opts.rpc?.[name] ?? ok(name === "upload_session_open" ? SID : null),
  );
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  const signedUploads: string[] = [];
  const createSignedUploadUrl = vi.fn(async (path: string) => {
    signedUploads.push(path);
    return opts.signUpload
      ? opts.signUpload(path)
      : {
          data: {
            signedUrl: `https://upload/${signedUploads.length}?token=t`,
            token: "t",
            path,
          },
          error: null,
        };
  });
  const list = vi.fn(async (_dir: string, _o: unknown) =>
    opts.listed !== undefined
      ? opts.listed
      : {
          data: [
            {
              name: "Deck-v2.pptx",
              metadata: {
                size: 1234,
                mimetype:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              },
            },
          ],
          error: null,
        },
  );
  const remove = vi.fn(async (_paths: string[]) => ({ data: [], error: null }));
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({
      path,
      signedUrl: `https://thumb/${path}`,
      error: null,
    })),
    error: null,
  }));
  const buckets: string[] = [];
  const storage = {
    from: vi.fn((bucket: string) => {
      buckets.push(bucket);
      return { createSignedUploadUrl, list, remove, createSignedUrls };
    }),
  };
  const of = (table: string, m: string) =>
    calls
      .filter((c) => c.table === table)
      .flatMap((c) => c.ops.filter(([op]) => op === m).map(([, a]) => a));
  return {
    db: { from, auth, storage, rpc } as never,
    calls,
    from,
    rpc,
    list,
    remove,
    buckets,
    createSignedUploadUrl,
    signedUploadPaths: () => signedUploads,
    inserted: (table: string) => of(table, "insert").map((a) => a[0]),
    of,
    queries: () =>
      from.mock.calls.length +
      rpc.mock.calls.length +
      storage.from.mock.calls.length +
      auth.getUser.mock.calls.length,
  };
}

const request = (over: Record<string, unknown> = {}) => ({
  files: [{ name: "Deck v2.pptx", size: 10 }],
  noteId: null,
  folderId: null,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("segment", () => {
  it("makes one safe path segment, as hive_save_file does", () => {
    expect(segment("Deck v2.pptx")).toBe("Deck-v2.pptx");
    expect(segment("../../etc/passwd")).toBe("etc-passwd");
    expect(segment(" .hidden ")).toBe("hidden");
    expect(segment("Račun #3 (final).pdf")).toBe("Ra-un-3-final-.pdf");
    expect(segment("x".repeat(300))).toHaveLength(120);
  });
});

describe("startUploadIn", () => {
  it("startUpload opens a session in the caller's first workspace and signs one slot per file", async () => {
    const t = stub();
    const out = await startUploadIn(t.db, request());
    expect(out?.batch).toBe(SID);
    expect(out?.noteId).toBe(N);
    expect(t.signedUploadPaths()).toEqual([`${DIR}/Deck-v2.pptx`]);
    expect(t.rpc).toHaveBeenCalledWith("upload_session_open", {
      p_workspace: W,
    });
    expect(t.buckets).toEqual(["files"]);
    expect(out).toEqual({
      batch: SID,
      noteId: N,
      slots: [{ name: "Deck-v2.pptx", url: "https://upload/1?token=t" }],
    });
    // Only the signed URL, which the stub makes path-free; never the token on its own.
    expect(JSON.stringify(out)).not.toContain(`${M}/${W}`);
    const [ws] = t.calls.filter((c) => c.table === "workspaces");
    expect(ws!.ops).toEqual([
      ["select", ["id, member_id"]],
      ["eq", ["member_id", M]],
      ["order", ["created_at", { ascending: true }]],
      ["limit", [1]],
    ]);
  });

  it("finds the private Uploads note of that workspace when it exists", async () => {
    const t = stub();
    await startUploadIn(t.db, request());
    const reads = t.calls.filter((c) => c.table === "notes");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.ops).toContainEqual(["eq", ["workspace_id", W]]);
    expect(reads[0]!.ops).toContainEqual(["eq", ["path", "Uploads.md"]]);
    expect(t.inserted("notes")).toEqual([]);
  });

  it("creates the private Uploads note when none exists and noteId is null", async () => {
    const t = stub({ uploadNote: ok([]), newNote: ok([{ id: N2 }]) });
    const out = await startUploadIn(t.db, request());
    expect(out?.noteId).toBe(N2);
    expect(t.inserted("notes")).toEqual([
      {
        hive_id: HIVE,
        member_id: M,
        workspace_id: W,
        path: "Uploads.md",
        title: "Uploads",
        visibility: "private",
        body: "Files you uploaded in the gallery.",
      },
    ]);
  });

  it("reads the Uploads note again when another request created it first", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let reads = 0;
    const t = stub({
      newNote: { data: null, error: { message: "duplicate", code: "23505" } },
    });
    const base = t.db as unknown as { from: (t: string) => unknown };
    const real = base.from;
    base.from = (table: string) => {
      const chain = real(table) as Record<string, unknown>;
      if (table !== "notes") return chain;
      const then = chain.then as (...a: unknown[]) => unknown;
      chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) => {
        const call = t.calls[t.calls.length - 1]!;
        if (!call.ops.some(([m]) => m === "insert")) {
          reads += 1;
          return Promise.resolve(reads === 1 ? ok([]) : ok([{ id: N2 }])).then(
            res,
            rej,
          );
        }
        return then(res, rej);
      };
      return chain;
    };
    const out = await startUploadIn(t.db, request());
    expect(out?.noteId).toBe(N2);
    expect(reads).toBe(2);
  });

  it("uses the given home note and opens the session in that note's workspace", async () => {
    const t = stub({
      note: ok([
        {
          id: N2,
          title: "Acme",
          workspace_id: W2,
          member_id: M,
          effective: "group",
        },
      ]),
    });
    const out = await startUploadIn(t.db, request({ noteId: N2 }));
    expect(out?.noteId).toBe(N2);
    expect(t.rpc).toHaveBeenCalledWith("upload_session_open", {
      p_workspace: W2,
    });
    expect(t.signedUploadPaths()).toEqual([
      `${M}/${W2}/uploads/${SID}/Deck-v2.pptx`,
    ]);
    expect(t.calls.filter((c) => c.table === "workspaces")).toHaveLength(0);
    expect(t.inserted("notes")).toEqual([]);
  });

  it("refuses a given note that is not the caller's, or not readable, before opening a session", async () => {
    for (const note of [
      ok([]),
      ok([
        {
          id: N2,
          title: "His",
          workspace_id: W2,
          member_id: "someone",
          effective: "group",
        },
      ]),
    ]) {
      const t = stub({ note });
      expect(await startUploadIn(t.db, request({ noteId: N2 }))).toBeNull();
      expect(t.rpc).not.toHaveBeenCalled();
    }
  });

  it("gives files with the same stored name a slot each, under distinct names", async () => {
    const t = stub();
    const out = await startUploadIn(
      t.db,
      request({
        files: [
          { name: "a b.pdf", size: 1 },
          { name: "a-b.pdf", size: 1 },
          { name: "notes", size: 1 },
          { name: "notes", size: 1 },
        ],
      }),
    );
    expect(out!.slots.map((s) => s?.name)).toEqual([
      "a-b.pdf",
      "a-b-2.pdf",
      "notes",
      "notes-2",
    ]);
    expect(new Set(t.signedUploadPaths()).size).toBe(4);
  });

  it("answers a null slot for a file whose link could not be signed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      signUpload: (path) =>
        path.endsWith("b.pdf")
          ? { data: null, error: { message: "exists", statusCode: "409" } }
          : {
              data: { signedUrl: "https://upload/x", token: "t", path },
              error: null,
            },
    });
    const out = await startUploadIn(
      t.db,
      request({
        files: [
          { name: "a.pdf", size: 1 },
          { name: "b.pdf", size: 1 },
        ],
      }),
    );
    expect(out!.slots).toEqual([
      { name: "a.pdf", url: "https://upload/x" },
      null,
    ]);
  });

  it("refuses files over 50 MB, more than 20 files, empty names, and a noteId that is not a uuid", async () => {
    const t = stub();
    for (const bad of [
      request({ files: [{ name: "big.pdf", size: MAX_UPLOAD_BYTES + 1 }] }),
      request({ files: Array(21).fill({ name: "a.pdf", size: 1 }) }),
      request({ files: [{ name: "   ", size: 1 }] }),
      request({ files: [] }),
      request({ noteId: "nope" }),
      request({ folderId: "nope" }),
      null,
    ])
      expect(await startUploadIn(t.db, bad)).toBeNull();
    expect(t.queries()).toBe(0);
  });

  it("answers null when the session cannot be opened, the caller has no workspace or no hive", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const opts of [
      { rpc: { upload_session_open: boom } },
      { workspaces: ok([]) },
      { workspaces: boom },
      { own: ok([]) },
      { user: null },
      { uploadNote: ok([]), newNote: boom },
    ]) {
      const t = stub(opts);
      expect(await startUploadIn(t.db, request())).toBeNull();
      expect(t.createSignedUploadUrl).not.toHaveBeenCalled();
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
  });
});

describe("finishUploadIn", () => {
  it("finishUpload checks the object exists, inserts the row with the declared type from the name, joins the folder, and returns the file", async () => {
    const t = stub();
    const out = await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, F);
    expect(t.list).toHaveBeenCalledWith(DIR, { search: "Deck-v2.pptx" });
    expect(t.inserted("files")).toEqual([
      {
        hive_id: HIVE,
        member_id: M,
        workspace_id: W,
        note_id: N,
        storage_path: `${DIR}/Deck-v2.pptx`,
        name: "Deck-v2.pptx",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes: 1234,
        session_id: SID,
      },
    ]);
    expect(t.inserted("gallery_folder_files")).toEqual([
      { folder_id: F, file_id: FILE },
    ]);
    expect(out).toEqual({
      id: FILE,
      name: "Deck-v2.pptx",
      kind: "slides",
      size: 1234,
      created_at: "2026-11-25T10:00:00.000000+00:00",
      owner: "Danijel",
      owner_id: M,
      mine: true,
      note: { id: N, title: "Uploads" },
      sharing: "private",
      thumb: null,
      session_id: SID,
      refs: [],
      folders: [F],
    });
    expect(JSON.stringify(out)).not.toContain("uploads/");
    expect(t.remove).not.toHaveBeenCalled();
  });

  it("takes the name the slot was given, so an original name finds the same object", async () => {
    const t = stub();
    expect(
      await finishUploadIn(t.db, SID, "Deck v2.pptx", N, null),
    ).not.toBeNull();
    expect(t.list).toHaveBeenCalledWith(DIR, { search: "Deck-v2.pptx" });
    expect(t.inserted("gallery_folder_files")).toEqual([]);
  });

  it("signs a thumbnail for a small image it just stored", async () => {
    const t = stub({
      listed: {
        data: [
          { name: "site.png", metadata: { size: 100, mimetype: "image/png" } },
        ],
        error: null,
      },
      fileInsert: ok([
        fileRow({
          name: "site.png",
          mime: "image/png",
          kind: "image",
          size_bytes: 100,
          storage_path: `${DIR}/site.png`,
        }),
      ]),
    });
    const out = await finishUploadIn(t.db, SID, "site.png", N, null);
    expect(out!.thumb).toBe(`https://thumb/${DIR}/site.png`);
    expect(t.inserted("files")[0]).toMatchObject({
      mime: "image/png",
      size_bytes: 100,
    });
  });

  it("answers null when the object is not there, without inserting a row", async () => {
    for (const listed of [
      { data: [], error: null },
      {
        data: [{ name: "Deck-v2.pptx.old", metadata: { size: 1 } }],
        error: null,
      },
      { data: null, error: { message: "down", statusCode: "500" } },
    ]) {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const t = stub({ listed });
      expect(
        await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, null),
      ).toBeNull();
      expect(t.inserted("files")).toEqual([]);
    }
  });

  it("removes an object that is over 50 MB or stored under a type other than its name's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const metadata of [
      {
        size: MAX_UPLOAD_BYTES + 1,
        mimetype:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      { size: 10, mimetype: "text/html" },
    ]) {
      const t = stub({
        listed: { data: [{ name: "Deck-v2.pptx", metadata }], error: null },
      });
      expect(
        await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, null),
      ).toBeNull();
      expect(t.remove).toHaveBeenCalledWith([`${DIR}/Deck-v2.pptx`]);
      expect(t.inserted("files")).toEqual([]);
    }
  });

  it("accepts an object stored as a plain byte stream", async () => {
    const t = stub({
      listed: {
        data: [
          {
            name: "Deck-v2.pptx",
            metadata: { size: 5, mimetype: "application/octet-stream" },
          },
        ],
        error: null,
      },
    });
    expect(
      await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, null),
    ).not.toBeNull();
    expect(t.remove).not.toHaveBeenCalled();
  });

  it("finishUpload removes the object when the row insert fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ fileInsert: boom });
    expect(await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, F)).toBeNull();
    expect(t.remove).toHaveBeenCalledWith([`${DIR}/Deck-v2.pptx`]);
    expect(t.inserted("gallery_folder_files")).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
    expect(JSON.stringify(log.mock.calls)).not.toContain("uploads/");
  });

  it("keeps the file when joining the folder fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ folderInsert: boom });
    const out = await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, F);
    expect(out!.folders).toEqual([]);
    expect(t.remove).not.toHaveBeenCalled();
  });

  it("refuses a session that is not the caller's open upload, before touching storage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const open = {
      id: SID,
      hive_id: HIVE,
      member_id: M,
      workspace_id: W,
      agent_id: null,
      ended_at: null,
    };
    for (const session of [
      ok([]),
      boom,
      ok([{ ...open, member_id: "someone" }]),
      ok([{ ...open, agent_id: "00000000-0000-4000-8000-00000000a9e7" }]),
      ok([{ ...open, ended_at: "2026-11-25T10:00:00Z" }]),
    ]) {
      const t = stub({ session });
      expect(
        await finishUploadIn(t.db, SID, "Deck-v2.pptx", N, null),
      ).toBeNull();
      expect(t.list).not.toHaveBeenCalled();
      expect(t.inserted("files")).toEqual([]);
    }
  });

  it("refuses bad arguments before any query", async () => {
    const t = stub();
    const bad: [unknown, unknown, unknown, unknown][] = [
      ["nope", "a.pdf", N, null],
      [SID, "", N, null],
      [SID, "   ", N, null],
      [SID, 7, N, null],
      [SID, "x".repeat(256), N, null],
      [SID, "a.pdf", null, null],
      [SID, "a.pdf", "nope", null],
      [SID, "a.pdf", N, "nope"],
    ];
    for (const [b, name, note, folder] of bad)
      expect(await finishUploadIn(t.db, b, name, note, folder)).toBeNull();
    expect(t.queries()).toBe(0);
  });
});

describe("endUploadIn", () => {
  it("endUpload calls upload_session_end with the batch and its home note", async () => {
    const t = stub();
    expect(await endUploadIn(t.db, SID, N)).toEqual({ ok: true });
    expect(t.rpc).toHaveBeenCalledWith("upload_session_end", {
      p_session: SID,
      p_note: N,
    });
  });

  it("answers { ok: false } for a refusal, logging only code and message, and for bad ids", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ rpc: { upload_session_end: boom } });
    expect(await endUploadIn(t.db, SID, N)).toEqual({ ok: false });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Secret name");
    expect(JSON.stringify(log.mock.calls)).toContain("XX000");
    const fresh = stub();
    expect(await endUploadIn(fresh.db, "nope", N)).toEqual({ ok: false });
    expect(await endUploadIn(fresh.db, SID, null)).toEqual({ ok: false });
    expect(fresh.queries()).toBe(0);
  });
});
