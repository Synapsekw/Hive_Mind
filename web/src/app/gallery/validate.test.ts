import { describe, expect, it } from "vitest";
import {
  cleanCursor,
  cleanName,
  cleanQuery,
  cleanServerFilter,
  cleanUploadRequest,
  isUuid,
} from "./validate";

const ID = "00000000-0000-4000-8000-000000030001";

describe("isUuid", () => {
  it("is the vault's check", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid("1 or 1=1")).toBe(false);
  });
});

describe("cleanCursor", () => {
  it("accepts a timestamp and a uuid, and returns a fresh object with only those keys", () => {
    const raw = {
      created_at: "2026-11-20T10:00:00.000Z",
      id: ID,
      storage_path: "x",
    };
    const out = cleanCursor(raw);
    expect(out).toEqual({ created_at: "2026-11-20T10:00:00.000Z", id: ID });
    expect(out).not.toBe(raw);
    expect(Object.keys(out!).sort()).toEqual(["created_at", "id"]);
  });

  it("keeps the timestamp exactly as the database wrote it", () => {
    const created_at = "2026-11-20T10:00:00.123456+00:00";
    expect(cleanCursor({ created_at, id: ID })).toEqual({ created_at, id: ID });
  });

  it("refuses anything that is not an object with both keys", () => {
    for (const bad of [
      null,
      undefined,
      "2026-11-20T10:00:00.000Z",
      42,
      [],
      {},
      { id: ID },
      { created_at: "2026-11-20T10:00:00.000Z" },
    ])
      expect(cleanCursor(bad)).toBeNull();
  });

  it("refuses an id that is not a uuid", () => {
    for (const id of ["nope", 7, null, `${ID})`])
      expect(
        cleanCursor({ created_at: "2026-11-20T10:00:00.000Z", id }),
      ).toBeNull();
  });

  it("refuses a created_at that is not a date, is too long, or could break out of the filter", () => {
    for (const created_at of [
      "x",
      "",
      7,
      null,
      "2026-11-20T10:00:00.000Z,id.gt.0",
      "Nov 20, 2026",
      "2026-11-20T10:00:00.000Z)",
      "(2026-11-20T10:00:00.000Z",
      '"2026-11-20T10:00:00.000Z"',
      `2026-11-20T10:00:00.${"0".repeat(40)}Z`,
    ])
      expect(cleanCursor({ created_at, id: ID })).toBeNull();
  });
});

describe("cleanServerFilter", () => {
  const S = "00000000-0000-4000-8000-0000000000a5";
  const base = {
    kinds: [],
    session: null,
    owner: null,
    from: null,
    to: null,
    ids: null,
  };

  it("accepts the empty filter and returns a fresh object with only the known keys", () => {
    const out = cleanServerFilter({ ...base, extra: "x" });
    expect(out).toEqual(base);
    expect(Object.keys(out!).sort()).toEqual(Object.keys(base).sort());
  });

  it("keeps every filter, de-duplicating kinds and writing instants in ISO form", () => {
    expect(
      cleanServerFilter({
        kinds: ["pdf", "slides", "pdf"],
        session: S,
        owner: ID,
        from: "2026-11-01T00:00:00Z",
        to: "2026-11-02T00:00:00.000Z",
        ids: [ID, ID, S],
      }),
    ).toEqual({
      kinds: ["pdf", "slides"],
      session: S,
      owner: ID,
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-02T00:00:00.000Z",
      ids: [ID, S],
    });
  });

  it("refuses anything malformed", () => {
    for (const bad of [
      null,
      "x",
      [],
      { ...base, kinds: ["pdf", "exe"] },
      { ...base, kinds: "pdf" },
      { ...base, session: "s1" },
      { ...base, owner: 7 },
      { ...base, from: "yesterday" },
      { ...base, from: "2026-11-01T00:00:00Z,id.gt.0" },
      { ...base, to: `2026-11-01T00:00:00.${"0".repeat(40)}Z` },
      {
        ...base,
        from: "2026-11-02T00:00:00Z",
        to: "2026-11-01T00:00:00Z",
      },
      { ...base, ids: ["nope"] },
      { ...base, ids: Array(201).fill(ID) },
      { ...base, ids: ID },
    ])
      expect(cleanServerFilter(bad)).toBeNull();
  });
});

describe("cleanName", () => {
  it("trims and keeps 1 to 60 characters", () => {
    expect(cleanName("  Acme ")).toBe("Acme");
    expect(cleanName("x".repeat(60))).toBe("x".repeat(60));
    for (const bad of ["", "   ", "x".repeat(61), 7, null, ["Acme"]])
      expect(cleanName(bad)).toBeNull();
  });
});

describe("cleanQuery", () => {
  it("trims and keeps at most 100 characters", () => {
    expect(cleanQuery(" acme ")).toBe("acme");
    expect(cleanQuery("")).toBe("");
    for (const bad of ["x".repeat(101), 7, null, { q: "a" }])
      expect(cleanQuery(bad)).toBeNull();
  });
});

describe("cleanUploadRequest", () => {
  const good = {
    files: [{ name: "Deck v2.pptx", size: 10 }],
    noteId: null,
    folderId: null,
  };

  it("returns a fresh copy of a good request", () => {
    const raw = { ...good, extra: 1, files: [{ ...good.files[0], type: "x" }] };
    expect(cleanUploadRequest(raw)).toEqual(good);
    expect(cleanUploadRequest({ ...good, noteId: ID, folderId: ID })).toEqual({
      ...good,
      noteId: ID,
      folderId: ID,
    });
  });

  it("refuses too many or too big files, bad names and bad ids", () => {
    for (const bad of [
      null,
      { ...good, files: [] },
      { ...good, files: Array(21).fill(good.files[0]) },
      { ...good, files: [{ name: "a.pdf", size: 50 * 1024 * 1024 + 1 }] },
      { ...good, files: [{ name: "a.pdf", size: -1 }] },
      { ...good, files: [{ name: "a.pdf", size: 1.5 }] },
      { ...good, files: [{ name: "  ", size: 1 }] },
      { ...good, files: [{ name: "x".repeat(256), size: 1 }] },
      { ...good, files: [{ name: 7, size: 1 }] },
      { ...good, noteId: "nope" },
      { ...good, folderId: 7 },
      { files: good.files },
    ])
      expect(cleanUploadRequest(bad)).toBeNull();
  });
});
