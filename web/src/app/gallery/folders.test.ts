import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addToFolderIn,
  createFolderIn,
  deleteFolderIn,
  removeFromFolderIn,
  renameFolderIn,
} from "./folders";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const FILE = "00000000-0000-4000-8000-000000030001";
const FILE2 = "00000000-0000-4000-8000-000000030002";

type Err = { message: string; code?: string; details?: string };
type Res = { data: unknown; error: Err | null };
type Call = { table: string; ops: [string, unknown[]][] };

const ok = (data: unknown): Res => ({ data, error: null });
const boom: Res = {
  data: null,
  error: { message: "boom", code: "XX000", details: "Secret name" },
};

/**
 * A stand-in client recording every `from(table)` chain. `own` answers the read of the person's
 * own membership; `write` answers every insert, update, upsert or delete.
 */
function stub(
  opts: { own?: Res; write?: Res; user?: { id: string } | null } = {},
) {
  const calls: Call[] = [];
  const writes = ["insert", "update", "upsert", "delete"];
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", ...writes])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (res: (r: Res) => unknown, rej: (e: unknown) => unknown) => {
      const write = call.ops.some(([m]) => writes.includes(m));
      const answer =
        table === "members"
          ? (opts.own ??
            ok([{ id: ME, hive_id: HIVE, hive: { name: "Synapse" } }]))
          : write
            ? (opts.write ?? ok([{ id: F1 }]))
            : ok([]);
      return Promise.resolve(answer).then(res, rej);
    };
    return chain;
  });
  const user = opts.user === undefined ? { id: "u-me" } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  const of = (table: string, m: string) =>
    calls
      .filter((c) => c.table === table)
      .flatMap((c) => c.ops.filter(([op]) => op === m).map(([, a]) => a));
  return {
    db: { from, auth } as never,
    calls,
    from,
    queries: () => from.mock.calls.length,
    inserted: (table: string) => of(table, "insert").map((a) => a[0]),
    of,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("createFolderIn", () => {
  it("createFolder trims the name, inserts for the caller's member and returns the folder", async () => {
    const t = stub({ write: ok([{ id: F1, name: "Acme", parent_id: null }]) });
    expect(await createFolderIn(t.db, "  Acme ", null)).toEqual({
      id: F1,
      name: "Acme",
      parent_id: null,
    });
    expect(t.inserted("gallery_folders")).toEqual([
      { member_id: ME, parent_id: null, name: "Acme" },
    ]);
    expect(t.of("gallery_folders", "select")).toEqual([["id,name,parent_id"]]);
  });

  it("creates a sub-folder under the parent given", async () => {
    const t = stub({ write: ok([{ id: F2, name: "Pricing", parent_id: F1 }]) });
    expect(await createFolderIn(t.db, "Pricing", F1)).toEqual({
      id: F2,
      name: "Pricing",
      parent_id: F1,
    });
    expect(t.inserted("gallery_folders")).toEqual([
      { member_id: ME, parent_id: F1, name: "Pricing" },
    ]);
  });

  it("answers null without a member, or when nothing came back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const opts of [
      { own: ok([]) },
      { own: boom },
      { user: null },
      { write: ok([]) },
    ]) {
      const t = stub(opts);
      expect(await createFolderIn(t.db, "Acme", null)).toBeNull();
    }
  });
});

describe("argument checks", () => {
  it("refuses bad names and ids before any query", async () => {
    const t = stub();
    expect(await createFolderIn(t.db, "", null)).toBeNull();
    expect(await createFolderIn(t.db, "   ", null)).toBeNull();
    expect(await createFolderIn(t.db, "x".repeat(61), null)).toBeNull();
    expect(await createFolderIn(t.db, "ok", "not-a-uuid")).toBeNull();
    expect(await createFolderIn(t.db, 7, null)).toBeNull();
    expect(await renameFolderIn(t.db, F1, "")).toEqual({ ok: false });
    expect(await renameFolderIn(t.db, "nope", "Acme")).toEqual({ ok: false });
    expect(await deleteFolderIn(t.db, "nope")).toEqual({ ok: false });
    expect(await addToFolderIn(t.db, F1, [])).toEqual({ ok: false });
    expect(await addToFolderIn(t.db, F1, Array(201).fill(FILE))).toEqual({
      ok: false,
    });
    expect(await addToFolderIn(t.db, F1, ["nope"])).toEqual({ ok: false });
    expect(await addToFolderIn(t.db, "nope", [FILE])).toEqual({ ok: false });
    expect(await addToFolderIn(t.db, F1, FILE)).toEqual({ ok: false });
    expect(await removeFromFolderIn(t.db, F1, "nope")).toEqual({ ok: false });
    expect(await removeFromFolderIn(t.db, "nope", FILE)).toEqual({ ok: false });
    expect(t.queries()).toBe(0);
  });
});

describe("renameFolderIn and deleteFolderIn", () => {
  it("renames by id with the trimmed name, ok only when a row changed", async () => {
    const t = stub();
    expect(await renameFolderIn(t.db, F1, " Clients ")).toEqual({ ok: true });
    expect(t.of("gallery_folders", "update")).toEqual([[{ name: "Clients" }]]);
    expect(t.of("gallery_folders", "eq")).toEqual([["id", F1]]);
    expect(
      await renameFolderIn(stub({ write: ok([]) }).db, F1, "Clients"),
    ).toEqual({ ok: false });
  });

  it("deletes by id, ok only when a row went", async () => {
    const t = stub();
    expect(await deleteFolderIn(t.db, F1)).toEqual({ ok: true });
    expect(t.of("gallery_folders", "delete")).toHaveLength(1);
    expect(t.of("gallery_folders", "eq")).toEqual([["id", F1]]);
    expect(await deleteFolderIn(stub({ write: ok([]) }).db, F1)).toEqual({
      ok: false,
    });
  });
});

describe("folder memberships", () => {
  it("addToFolder upserts memberships, ignoring ones already there", async () => {
    const t = stub();
    expect(await addToFolderIn(t.db, F1, [FILE, FILE2, FILE])).toEqual({
      ok: true,
    });
    expect(t.of("gallery_folder_files", "upsert")).toEqual([
      [
        [
          { folder_id: F1, file_id: FILE },
          { folder_id: F1, file_id: FILE2 },
        ],
        { onConflict: "folder_id,file_id", ignoreDuplicates: true },
      ],
    ]);
  });

  it("removeFromFolder deletes the one membership, ok only when it was there", async () => {
    const t = stub({ write: ok([{ folder_id: F1 }]) });
    expect(await removeFromFolderIn(t.db, F1, FILE)).toEqual({ ok: true });
    expect(t.of("gallery_folder_files", "delete")).toHaveLength(1);
    expect(t.of("gallery_folder_files", "eq")).toEqual([
      ["folder_id", F1],
      ["file_id", FILE],
    ]);
    expect(
      await removeFromFolderIn(stub({ write: ok([]) }).db, F1, FILE),
    ).toEqual({ ok: false });
  });

  it("a database refusal answers { ok: false } and logs only code and message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = stub({ write: boom });
    expect(await createFolderIn(t.db, "Acme", null)).toBeNull();
    expect(await renameFolderIn(t.db, F1, "Acme")).toEqual({ ok: false });
    expect(await deleteFolderIn(t.db, F1)).toEqual({ ok: false });
    expect(await addToFolderIn(t.db, F1, [FILE])).toEqual({ ok: false });
    expect(await removeFromFolderIn(t.db, F1, FILE)).toEqual({ ok: false });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("Secret name");
    expect(logged).toContain("XX000");
    expect(logged).toContain("boom");
  });
});
