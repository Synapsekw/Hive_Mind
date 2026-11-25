import { describe, expect, it } from "vitest";
import { rowTopics, topicsById } from "./rowTopics";
import type { VaultTopic } from "./types";

const T = (id: string): VaultTopic => ({
  id,
  kind: "client",
  name: id.toUpperCase(),
});
const hive = ["a", "b", "c", "d", "e"].map(T);

describe("rowTopics", () => {
  it("shows nothing for a note without topics", () => {
    expect(rowTopics([], hive)).toEqual({ shown: [], more: 0 });
  });
  it("shows up to two, in the note's order", () => {
    expect(rowTopics(["b", "a"], hive)).toEqual({
      shown: [T("b"), T("a")],
      more: 0,
    });
  });
  it("counts the rest", () => {
    expect(rowTopics(["a", "b", "c", "d", "e"], hive)).toEqual({
      shown: [T("a"), T("b")],
      more: 3,
    });
  });
  it("takes a prebuilt map as well as the list", () => {
    expect(rowTopics(["x", "a", "b", "c"], topicsById(hive))).toEqual(
      rowTopics(["x", "a", "b", "c"], hive),
    );
  });
  it("skips ids the hive does not have, and does not count them", () => {
    expect(rowTopics(["x", "a", "y", "b", "c"], hive)).toEqual({
      shown: [T("a"), T("b")],
      more: 1,
    });
  });
});
