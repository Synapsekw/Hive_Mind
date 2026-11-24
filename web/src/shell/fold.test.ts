import { describe, expect, it } from "vitest";
import { DEFAULT_FOLD, FOLD_COOKIE, formatFold, parseFold } from "./fold";

describe("parseFold", () => {
  it("names the cookie and opens both sides by default", () => {
    expect(FOLD_COOKIE).toBe("hive-fold");
    expect(DEFAULT_FOLD).toEqual({ rail: "open", panel: "open" });
  });

  it("reads a missing, empty or garbage value as open", () => {
    for (const value of [undefined, "", "garbage", "..", "SHUT.SHUT", "x.y"])
      expect(parseFold(value)).toEqual({ rail: "open", panel: "open" });
  });

  it("reads one part as the rail and leaves the panel open", () => {
    expect(parseFold("shut")).toEqual({ rail: "shut", panel: "open" });
  });

  it("reads each part on its own", () => {
    expect(parseFold("shut.open")).toEqual({ rail: "shut", panel: "open" });
    expect(parseFold("open.shut")).toEqual({ rail: "open", panel: "shut" });
    expect(parseFold("shut.shut")).toEqual({ rail: "shut", panel: "shut" });
    expect(parseFold("shut.nope")).toEqual({ rail: "shut", panel: "open" });
  });

  it("ignores a third part", () => {
    expect(parseFold("shut.shut.shut")).toEqual({
      rail: "shut",
      panel: "shut",
    });
    expect(parseFold("open.shut.anything")).toEqual({
      rail: "open",
      panel: "shut",
    });
  });

  it("refuses an overlong value", () => {
    expect(parseFold(`shut.shut.${"x".repeat(200)}`)).toEqual(DEFAULT_FOLD);
  });
});

describe("formatFold", () => {
  it("writes the rail then the panel", () => {
    expect(formatFold({ rail: "open", panel: "shut" })).toBe("open.shut");
    expect(formatFold(DEFAULT_FOLD)).toBe("open.open");
  });

  it("is stable through a parse", () => {
    for (const value of [
      undefined,
      "",
      "garbage",
      "shut",
      "shut.open",
      "open.shut",
      "shut.shut",
      "shut.shut.extra",
    ]) {
      const once = formatFold(parseFold(value));
      expect(formatFold(parseFold(once))).toBe(once);
    }
  });
});
