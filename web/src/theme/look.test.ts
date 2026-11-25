import { describe, expect, it } from "vitest";
import data from "./themes.json";
import {
  DEFAULT_LOOK,
  formatLook,
  LOOK_COOKIE,
  parseLook,
  schemeOf,
  THEMES,
} from "./look";

describe("look", () => {
  it("is honey by default, in the cookie hive-look", () => {
    expect(DEFAULT_LOOK).toEqual({ theme: "honey" });
    expect(LOOK_COOKIE).toBe("hive-look");
  });

  it("lists the eight themes in order, with their scheme", () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      "honey",
      "abyss",
      "ember",
      "aurora",
      "moonstone",
      "ultraviolet",
      "blueprint",
      "paper",
    ]);
    expect(THEMES.map((t) => t.id)).toEqual(data.themes.map((t) => t.id));
    expect(THEMES.filter((t) => t.scheme === "light").map((t) => t.id)).toEqual(
      ["paper"],
    );
  });

  it("falls back to the default when there is no value or a junk one", () => {
    expect(parseLook(undefined)).toEqual(DEFAULT_LOOK);
    expect(parseLook("")).toEqual(DEFAULT_LOOK);
    expect(parseLook("<script>alert(1)</script>")).toEqual(DEFAULT_LOOK);
    expect(parseLook("x".repeat(101))).toEqual(DEFAULT_LOOK);
  });

  it("reads a theme id", () => {
    expect(parseLook("abyss")).toEqual({ theme: "abyss" });
  });

  it("reads the first part of an old four-part value, and falls back if that theme is gone", () => {
    expect(parseLook("aurora.light.vivid.classic")).toEqual({
      theme: "aurora",
    });
    expect(parseLook("keystone.light.vivid.classic")).toEqual(DEFAULT_LOOK);
    expect(parseLook("hive.dark.tinted.theme")).toEqual(DEFAULT_LOOK);
  });

  it("formats as the theme id and round-trips", () => {
    for (const t of THEMES)
      expect(parseLook(formatLook({ theme: t.id }))).toEqual({ theme: t.id });
    expect(formatLook({ theme: "paper" })).toBe("paper");
  });

  it("knows a theme's scheme, dark for an unknown one", () => {
    expect(schemeOf("paper")).toBe("light");
    expect(schemeOf("honey")).toBe("dark");
    expect(schemeOf("nope")).toBe("dark");
  });
});
