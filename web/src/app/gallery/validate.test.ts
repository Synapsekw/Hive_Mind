import { describe, expect, it } from "vitest";
import { cleanCursor, isUuid } from "./validate";

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
