import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and both line endings", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n3,4', 10).rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["3", "4"],
    ]);
  });
  it("keeps a newline inside quotes and stops at maxRows", () => {
    const r = parseCsv('"l1\nl2",b\n1,2\n3,4', 2);
    expect(r.rows).toEqual([
      ["l1\nl2", "b"],
      ["1", "2"],
    ]);
    expect(r.truncated).toBe(true);
  });
  it("ignores one trailing newline", () => {
    expect(parseCsv("a\n", 5)).toEqual({ rows: [["a"]], truncated: false });
  });
});
