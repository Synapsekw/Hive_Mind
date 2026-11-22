import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK } from "../theme/look";
import { lookCookie } from "./cookie";

describe("lookCookie", () => {
  it("remembers the look for a year on every path, Lax", () => {
    expect(lookCookie({ ...DEFAULT_LOOK, theme: "aurora" }, false)).toBe(
      "hive-look=aurora.dark.tinted.theme; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });

  it("is Secure over https and only then", () => {
    expect(lookCookie(DEFAULT_LOOK, true)).toMatch(/; Secure$/);
    expect(lookCookie(DEFAULT_LOOK, false)).not.toContain("Secure");
  });
});
