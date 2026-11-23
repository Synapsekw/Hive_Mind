import { describe, expect, it, vi } from "vitest";
import {
  deleteNoteIn,
  previewIn,
  releaseIn,
  saveFolderIn,
  saveNoteIn,
  toPreview,
} from "./write";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const AHMED = "00000000-0000-4000-8000-000000000002";
const OUTSIDE = "00000000-0000-4000-8000-0000000000ff";
const W1 = "00000000-0000-4000-8000-000000000b01";
const NOTE = "00000000-0000-4000-8000-000000010001";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });

function stub(
  opts: {
    write?: Res;
    workspace?: Res;
    rpc?: Res;
    user?: { id: string } | null;
  } = {},
) {
  const calls: Call[] = [];
  const answer = (c: Call): Res => {
    if (c.table === "own")
      return ok([{ id: ME, hive_id: HIVE, hive: { name: "Synapse" } }]);
    if (c.table === "members")
      return ok([
        { id: ME, user_id: "u-me" },
        { id: AHMED, user_id: "u-ahmed" },
      ]);
    if (c.table === "workspaces")
      return opts.workspace ?? ok([{ id: W1, member_id: ME }]);
    return opts.write ?? ok([{ id: NOTE }]);
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "order",
      "limit",
      "update",
      "upsert",
      "delete",
    ])
      chain[m] = (...args: unknown[]) => {
        // The read of the person's own oldest membership is filed apart from the hive's members.
        if (table === "members" && m === "eq" && args[0] === "user_id")
          call.table = "own";
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(answer(call)).then(res, rej);
    return chain;
  });
  const rpc = vi.fn(async () => opts.rpc ?? ok(null));
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, rpc, auth } as never, calls, from, rpc, auth };
}

const writes = (t: { calls: Call[] }, table: string) =>
  t.calls.filter(
    (c) =>
      c.table === table &&
      c.ops.some(([m]) => m === "update" || m === "upsert"),
  );
const args = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];

describe("saveNoteIn", () => {
  it("writes only the decision, by id, and asks for the id back", async () => {
    const t = stub();
    expect(
      await saveNoteIn(t.db, NOTE, {
        visibility: "members",
        shared_with: [AHMED],
        body: "overwrite",
      } as never),
    ).toEqual({ ok: true });
    const [w] = writes(t, "notes");
    expect(args(w!, "update")).toEqual([
      { visibility: "members", shared_with: [AHMED] },
    ]);
    expect(args(w!, "eq")).toEqual(["id", NOTE]);
    expect(args(w!, "select")).toEqual(["id"]);
  });

  it("checks named members against the hive of the person's own oldest membership", async () => {
    const t = stub();
    await saveNoteIn(t.db, NOTE, {
      visibility: "members",
      shared_with: [AHMED],
    });
    expect(t.calls.map((c) => c.table)).toEqual(["own", "members", "notes"]);
    expect(t.from.mock.calls[0]).toEqual(["members"]);
    expect(t.calls[0]!.ops).toEqual([
      ["select", ["id, hive_id, hive:hives!hive_id(name)"]],
      ["eq", ["user_id", "u-me"]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [1]],
    ]);
    expect(args(t.calls[1]!, "eq")).toEqual(["hive_id", HIVE]);
    // The id is the one the auth server answered with, asked for once.
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("sends no own setting as null with an empty list", async () => {
    const t = stub();
    await saveNoteIn(t.db, NOTE, { visibility: null, shared_with: [AHMED] });
    expect(args(writes(t, "notes")[0]!, "update")).toEqual([
      { visibility: null, shared_with: [] },
    ]);
  });

  it("refuses a bad id or choice without writing", async () => {
    const t = stub();
    expect(
      await saveNoteIn(t.db, "1 or 1=1", {
        visibility: "group",
        shared_with: [],
      }),
    ).toEqual({ ok: false });
    expect(
      await saveNoteIn(t.db, NOTE, {
        visibility: "public",
        shared_with: [],
      } as never),
    ).toEqual({ ok: false });
    expect(writes(t, "notes")).toHaveLength(0);
  });

  it("refuses members outside the hive, and the caller themselves", async () => {
    const t = stub();
    expect(
      await saveNoteIn(t.db, NOTE, {
        visibility: "members",
        shared_with: [OUTSIDE],
      }),
    ).toEqual({ ok: false });
    expect(
      await saveNoteIn(t.db, NOTE, {
        visibility: "members",
        shared_with: [ME],
      }),
    ).toEqual({ ok: false });
    expect(writes(t, "notes")).toHaveLength(0);
  });

  it("is not ok without a session", async () => {
    const t = stub({ user: null });
    expect(
      await saveNoteIn(t.db, NOTE, { visibility: "group", shared_with: [] }),
    ).toEqual({ ok: false });
    expect(writes(t, "notes")).toHaveLength(0);
  });

  it("is not ok when no row changed", async () => {
    const t = stub({ write: ok([]) });
    expect(
      await saveNoteIn(t.db, NOTE, { visibility: "group", shared_with: [] }),
    ).toEqual({ ok: false });
  });

  it("is not ok when the database refuses, logging only code and message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      write: {
        data: null,
        error: {
          message: "agents cannot change sharing",
          code: "P0001",
          details: "Secret",
        },
      },
    });
    expect(
      await saveNoteIn(t.db, NOTE, { visibility: "group", shared_with: [] }),
    ).toEqual({ ok: false });
    expect(spy).toHaveBeenCalledWith(
      "saveNote failed",
      "P0001",
      "agents cannot change sharing",
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    spy.mockRestore();
  });
});

describe("saveFolderIn", () => {
  it("upserts the folder on (workspace_id, path) with the workspace owner's member", async () => {
    const t = stub({ write: ok([{ path: "Decisions" }]) });
    expect(
      await saveFolderIn(t.db, W1, "Decisions", {
        visibility: "group",
        shared_with: [],
      }),
    ).toEqual({ ok: true });
    const ws = t.calls.find((c) => c.table === "workspaces")!;
    expect(args(ws, "eq")).toEqual(["id", W1]);
    const [w] = writes(t, "folders");
    expect(args(w!, "upsert")).toEqual([
      {
        workspace_id: W1,
        member_id: ME,
        path: "Decisions",
        visibility: "group",
        shared_with: [],
      },
      { onConflict: "workspace_id,path" },
    ]);
    expect(args(w!, "select")).toEqual(["path"]);
  });

  it("refuses a bad workspace, path or choice without reading or writing", async () => {
    const t = stub();
    const c = { visibility: "group" as const, shared_with: [] };
    expect(await saveFolderIn(t.db, "x", "Decisions", c)).toEqual({
      ok: false,
    });
    expect(await saveFolderIn(t.db, W1, "../x", c)).toEqual({ ok: false });
    expect(await saveFolderIn(t.db, W1, "/x", c)).toEqual({ ok: false });
    expect(t.calls.some((x) => x.table === "workspaces")).toBe(false);
    expect(writes(t, "folders")).toHaveLength(0);
  });

  it("is not ok when the workspace is not the caller's", async () => {
    const t = stub({ workspace: ok([]) });
    expect(
      await saveFolderIn(t.db, W1, "Decisions", {
        visibility: "group",
        shared_with: [],
      }),
    ).toEqual({ ok: false });
    expect(writes(t, "folders")).toHaveLength(0);
  });

  it("is not ok when no row comes back", async () => {
    const t = stub({ write: ok([]) });
    expect(
      await saveFolderIn(t.db, W1, "Decisions", {
        visibility: null,
        shared_with: [],
      }),
    ).toEqual({ ok: false });
  });
});

describe("releaseIn", () => {
  it("sends only quarantined: false, by id", async () => {
    const t = stub();
    expect(await releaseIn(t.db, NOTE)).toEqual({ ok: true });
    const [w] = writes(t, "notes");
    expect(args(w!, "update")).toEqual([{ quarantined: false }]);
    expect(args(w!, "eq")).toEqual(["id", NOTE]);
  });

  it("refuses a bad id, no session, and zero rows", async () => {
    expect(await releaseIn(stub().db, "nope")).toEqual({ ok: false });
    expect(await releaseIn(stub({ user: null }).db, NOTE)).toEqual({
      ok: false,
    });
    expect(await releaseIn(stub({ write: ok([]) }).db, NOTE)).toEqual({
      ok: false,
    });
  });
});

describe("deleteNoteIn", () => {
  const OTHER = "00000000-0000-4000-8000-000000010002";

  it("deletes the note by id, as the person, and asks for the id back", async () => {
    const t = stub();
    expect(await deleteNoteIn(t.db, NOTE)).toEqual({ ok: true });
    expect(t.auth.getUser).toHaveBeenCalledTimes(1);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.table).toBe("notes");
    expect(t.calls[0]!.ops).toEqual([
      ["delete", []],
      ["eq", ["id", NOTE]],
      ["select", ["id"]],
    ]);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("asks in lower case for an id given in upper case, and answers for the row deleted", async () => {
    const LOWER = "abcdef00-0000-4000-8000-00000001abcd";
    const UPPER = "ABCDEF00-0000-4000-8000-00000001ABCD";
    // The database answers the id as it writes it: in lower case.
    const t = stub({ write: ok([{ id: LOWER }]) });
    expect(await deleteNoteIn(t.db, UPPER)).toEqual({ ok: true });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.ops).toEqual([
      ["delete", []],
      ["eq", ["id", LOWER]],
      ["select", ["id"]],
    ]);
  });

  it("refuses anything that is not a uuid without a query or a session check", async () => {
    const bad: unknown[] = [
      "nope",
      "1 or 1=1",
      "",
      `${NOTE} `,
      undefined,
      null,
      42,
      [NOTE],
      { id: NOTE },
    ];
    for (const id of bad) {
      const t = stub();
      expect(await deleteNoteIn(t.db, id)).toEqual({ ok: false });
      expect(t.from).not.toHaveBeenCalled();
      expect(t.rpc).not.toHaveBeenCalled();
      expect(t.auth.getUser).not.toHaveBeenCalled();
    }
  });

  it("is not ok without a session, and sends no query", async () => {
    const t = stub({ user: null });
    expect(await deleteNoteIn(t.db, NOTE)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("is not ok when no row was deleted: not the person's, or already gone", async () => {
    expect(await deleteNoteIn(stub({ write: ok([]) }).db, NOTE)).toEqual({
      ok: false,
    });
  });

  it("is not ok unless the answer is exactly the one row asked for", async () => {
    const answers: unknown[] = [
      null,
      undefined,
      { id: NOTE },
      "deleted",
      [{ id: NOTE }, { id: OTHER }],
      [{ id: NOTE }, { id: NOTE }],
      [{ id: OTHER }],
      [{}],
      [null],
      [NOTE],
    ];
    for (const data of answers)
      expect(await deleteNoteIn(stub({ write: ok(data) }).db, NOTE)).toEqual({
        ok: false,
      });
  });

  it("is not ok when the database refuses, logging only code and message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({
      write: {
        // A row beside an error is still a failure.
        data: [{ id: NOTE }],
        error: {
          message: "agents cannot delete notes",
          code: "P0001",
          details: "Secret",
        },
      },
    });
    expect(await deleteNoteIn(t.db, NOTE)).toEqual({ ok: false });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "deleteNote failed",
      "P0001",
      "agents cannot delete notes",
    );
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Secret");
    spy.mockRestore();
  });
});

describe("previewIn", () => {
  const counts = { follows: 17, own_setting: 2, under_nested_rule: 3, held: 1 };

  it("asks the database for the counts", async () => {
    const t = stub({ rpc: ok(counts) });
    expect(await previewIn(t.db, W1, "Decisions")).toEqual(counts);
    expect(t.rpc).toHaveBeenCalledWith("folder_share_preview", {
      p_workspace: W1,
      p_path: "Decisions",
    });
  });

  it("is null for bad input, no session, an error or a malformed answer", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await previewIn(stub().db, "x", "Decisions")).toBeNull();
    expect(await previewIn(stub().db, W1, "a//b")).toBeNull();
    expect(
      await previewIn(stub({ user: null, rpc: ok(counts) }).db, W1, "D"),
    ).toBeNull();
    expect(
      await previewIn(
        stub({ rpc: { data: null, error: { message: "not your workspace" } } })
          .db,
        W1,
        "D",
      ),
    ).toBeNull();
    expect(
      await previewIn(stub({ rpc: ok({ follows: 1 }) }).db, W1, "D"),
    ).toBeNull();
    spy.mockRestore();
  });
});

describe("toPreview", () => {
  it("keeps four non-negative whole numbers and drops anything else", () => {
    expect(
      toPreview({
        follows: 1,
        own_setting: 0,
        under_nested_rule: 0,
        held: 0,
        x: 9,
      }),
    ).toEqual({ follows: 1, own_setting: 0, under_nested_rule: 0, held: 0 });
    expect(
      toPreview({ follows: -1, own_setting: 0, under_nested_rule: 0, held: 0 }),
    ).toBeNull();
    expect(
      toPreview({
        follows: "1",
        own_setting: 0,
        under_nested_rule: 0,
        held: 0,
      }),
    ).toBeNull();
    expect(toPreview(null)).toBeNull();
  });
});
