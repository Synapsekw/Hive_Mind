import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/vault?x=1")).toBe("/vault?x=1");
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ])("falls back to / for %j", (value) => {
    expect(safeNext(value)).toBe("/");
  });
});
