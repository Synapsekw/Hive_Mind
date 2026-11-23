import { describe, expect, it } from "vitest";
import { checkPassword } from "./rules";

describe("checkPassword: the rules for a password a person chooses", () => {
  it("takes 10 characters, typed the same twice", () => {
    expect(checkPassword("abcdefghij", "abcdefghij")).toBeNull();
    expect(
      checkPassword("correct horse battery", "correct horse battery"),
    ).toBeNull();
  });

  it.each([
    ["nothing", ""],
    ["9 characters", "abcdefghi"],
    ["9 characters that are many bytes", "ééééééééé"],
    ["9 emoji", "😀".repeat(9)],
  ])("is short for %s", (_n, p) => {
    expect(checkPassword(p, p)).toBe("short");
  });

  it("counts characters, not bytes or code units, for the minimum", () => {
    expect(checkPassword("😀".repeat(10), "😀".repeat(10))).toBeNull();
  });

  it("is long past 72 bytes in UTF-8, the most the auth server's hash reads", () => {
    expect(checkPassword("a".repeat(72), "a".repeat(72))).toBeNull();
    expect(checkPassword("a".repeat(73), "a".repeat(73))).toBe("long");
    // 36 two-byte characters fit; 37 do not.
    expect(checkPassword("é".repeat(36), "é".repeat(36))).toBeNull();
    expect(checkPassword("é".repeat(37), "é".repeat(37))).toBe("long");
    expect(checkPassword("😀".repeat(19), "😀".repeat(19))).toBe("long");
  });

  it("is different when the two are not the same, to the character", () => {
    expect(checkPassword("abcdefghij", "abcdefghik")).toBe("different");
    expect(checkPassword("abcdefghij", "abcdefghij ")).toBe("different");
    expect(checkPassword("abcdefghij", "ABCDEFGHIJ")).toBe("different");
    expect(checkPassword("abcdefghij", "")).toBe("different");
  });

  it("names the length before the difference", () => {
    expect(checkPassword("abc", "abd")).toBe("short");
    expect(checkPassword("a".repeat(80), "b")).toBe("long");
  });

  it("changes nothing in what was typed: spaces count", () => {
    expect(checkPassword("  abcdef  ", "  abcdef  ")).toBeNull();
    expect(checkPassword("         ", "         ")).toBe("short");
  });

  it.each([
    ["nothing at all", undefined, undefined],
    ["a number", 1234567890, 1234567890],
    ["a file", new Blob(["abcdefghij"]), new Blob(["abcdefghij"])],
    ["a list", ["abcdefghij"], ["abcdefghij"]],
  ])("is short for a password that is %s", (_n, a, b) => {
    expect(checkPassword(a, b)).toBe("short");
  });

  it("is different for a repeat that is not text", () => {
    expect(checkPassword("abcdefghij", null)).toBe("different");
  });
});
