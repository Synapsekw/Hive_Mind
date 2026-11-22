import { describe, expect, it } from "vitest";
import { cleanChoice, cleanPath, isUuid, othersIn } from "./validate";

const A = "00000000-0000-4000-8000-000000000002";
const B = "00000000-0000-4000-8000-000000000003";
const OUTSIDE = "00000000-0000-4000-8000-0000000000ff";

describe("isUuid", () => {
  it("accepts a uuid in either case", () => {
    expect(isUuid("6f1c2a1e-3b7d-4c8e-9a0b-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("6F1C2A1E-3B7D-4C8E-9A0B-1C2D3E4F5A6B")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isUuid("1 or 1=1")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(" 6f1c2a1e-3b7d-4c8e-9a0b-1c2d3e4f5a6b")).toBe(false);
  });
});

describe("cleanPath", () => {
  it("accepts folder paths", () => {
    expect(cleanPath("Decisions")).toBe("Decisions");
    expect(cleanPath("clients/acme")).toBe("clients/acme");
    expect(cleanPath("x".repeat(500))).toBe("x".repeat(500));
  });
  it("refuses a leading or trailing slash, an empty or dot segment, and bad lengths", () => {
    for (const bad of [
      "/x",
      "x/",
      "a//b",
      "../x",
      "a/../b",
      "a/./b",
      "",
      "x".repeat(501),
      42,
      null,
      "a\u0000b",
    ])
      expect(cleanPath(bad)).toBeNull();
  });
});

describe("cleanChoice", () => {
  const allowed = [A, B];
  it("accepts each visibility", () => {
    expect(
      cleanChoice({ visibility: "private", shared_with: [] }, allowed),
    ).toEqual({
      visibility: "private",
      shared_with: [],
    });
    expect(
      cleanChoice({ visibility: "group", shared_with: [] }, allowed),
    ).toEqual({
      visibility: "group",
      shared_with: [],
    });
    expect(
      cleanChoice({ visibility: "members", shared_with: [A] }, allowed),
    ).toEqual({
      visibility: "members",
      shared_with: [A],
    });
  });
  it("accepts no own setting with an empty list", () => {
    expect(cleanChoice({ visibility: null, shared_with: [] }, allowed)).toEqual(
      {
        visibility: null,
        shared_with: [],
      },
    );
  });
  it("sends an empty list for everything but named members", () => {
    expect(
      cleanChoice({ visibility: null, shared_with: [A] }, allowed),
    ).toEqual({
      visibility: null,
      shared_with: [],
    });
    expect(
      cleanChoice({ visibility: "group", shared_with: [A] }, allowed),
    ).toEqual({
      visibility: "group",
      shared_with: [],
    });
  });
  it("refuses an unknown visibility", () => {
    expect(
      cleanChoice({ visibility: "public", shared_with: [] }, allowed),
    ).toBeNull();
    expect(cleanChoice({ shared_with: [] }, allowed)).toBeNull();
  });
  it("refuses named members with nobody named, or somebody outside the hive", () => {
    expect(
      cleanChoice({ visibility: "members", shared_with: [] }, allowed),
    ).toBeNull();
    expect(
      cleanChoice(
        { visibility: "members", shared_with: [A, OUTSIDE] },
        allowed,
      ),
    ).toBeNull();
    expect(
      cleanChoice({ visibility: "members", shared_with: [A, 7] }, allowed),
    ).toBeNull();
    expect(
      cleanChoice({ visibility: "members", shared_with: A }, allowed),
    ).toBeNull();
  });
  it("drops duplicates and ignores extra keys", () => {
    expect(
      cleanChoice(
        {
          visibility: "members",
          shared_with: [A, A, B],
          body: "x",
          member_id: OUTSIDE,
        },
        allowed,
      ),
    ).toEqual({ visibility: "members", shared_with: [A, B] });
  });
  it("refuses something that is not an object", () => {
    expect(cleanChoice(null, allowed)).toBeNull();
    expect(cleanChoice("group", allowed)).toBeNull();
    expect(cleanChoice([], allowed)).toBeNull();
  });
});

describe("othersIn", () => {
  it("is every member of the hive except the caller", () => {
    expect(
      othersIn(
        [
          { id: "m1", user_id: "u1" },
          { id: A, user_id: "u2" },
          { id: B, user_id: "u3" },
        ],
        "u1",
      ),
    ).toEqual([A, B]);
  });
});
