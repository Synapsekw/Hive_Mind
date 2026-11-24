import { describe, expect, it } from "vitest";
import { compareRanked, type Ranked } from "./order";

const r = (
  id: string,
  confidence: number,
  kind: Ranked["kind"],
  name: string | null,
): Ranked => ({ id, confidence, kind, name });

const ids = (xs: Ranked[]) => [...xs].sort(compareRanked).map((x) => x.id);

describe("compareRanked", () => {
  it("puts the higher confidence first, whatever the kind", () => {
    expect(
      ids([r("a", 0.5, "client", "A"), r("b", 0.9, "subject", "Z")]),
    ).toEqual(["b", "a"]);
  });
  it("then the kind in KINDS order", () => {
    expect(
      ids([r("v", 0.9, "vendor", "A"), r("c", 0.9, "client", "Z")]),
    ).toEqual(["c", "v"]);
  });
  it("then the name in plain string order", () => {
    expect(
      ids([r("b", 0.9, "client", "b"), r("a", 0.9, "client", "B")]),
    ).toEqual(["a", "b"]);
  });
  it("then the id", () => {
    expect(
      ids([r("2", 0.9, "client", "A"), r("1", 0.9, "client", "A")]),
    ).toEqual(["1", "2"]);
  });
  it("puts an unknown topic after every known one at the same confidence, by id", () => {
    expect(
      ids([
        r("u2", 0.9, null, null),
        r("s", 0.9, "subject", "Z"),
        r("u1", 0.9, null, null),
      ]),
    ).toEqual(["s", "u1", "u2"]);
  });
  it("still ranks an unknown topic by confidence first", () => {
    expect(ids([r("k", 0.5, "client", "A"), r("u", 0.9, null, null)])).toEqual([
      "u",
      "k",
    ]);
  });
});
