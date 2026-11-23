import { describe, expect, it } from "vitest";
import data from "./themes.json";
import {
  DEFAULT_LOOK,
  DOT_MODES,
  formatLook,
  LOOK_COOKIE,
  MODES,
  parseLook,
  REACHES,
  THEMES,
} from "./look";

describe("parseLook", () => {
  it("falls back to the default when there is no value", () => {
    expect(parseLook(undefined)).toEqual(DEFAULT_LOOK);
    expect(parseLook("")).toEqual(DEFAULT_LOOK);
  });

  it("is hive, dark, tinted, theme by default", () => {
    expect(DEFAULT_LOOK).toEqual({
      theme: "hive",
      mode: "dark",
      reach: "tinted",
      dots: "theme",
    });
    expect(LOOK_COOKIE).toBe("hive-look");
  });

  it("reads a full valid value", () => {
    expect(parseLook("hive.dark.tinted.theme")).toEqual(DEFAULT_LOOK);
    expect(parseLook("aurora.light.vivid.classic")).toEqual({
      theme: "aurora",
      mode: "light",
      reach: "vivid",
      dots: "classic",
    });
  });

  it("falls back part by part", () => {
    expect(parseLook("nope.light.subtle.classic")).toEqual({
      theme: "hive",
      mode: "light",
      reach: "subtle",
      dots: "classic",
    });
    expect(parseLook("nope.dark.tinted.theme")).toEqual(DEFAULT_LOOK);
    expect(parseLook("aurora.dark")).toEqual({
      ...DEFAULT_LOOK,
      theme: "aurora",
    });
    expect(parseLook("hive.dark")).toEqual(DEFAULT_LOOK);
    expect(parseLook("graphite.sepia.loud.rainbow")).toEqual({
      ...DEFAULT_LOOK,
      theme: "graphite",
    });
  });

  it("never lets markup or junk through", () => {
    expect(parseLook("<script>.dark.tinted.theme")).toEqual(DEFAULT_LOOK);
    expect(parseLook("x".repeat(10_000))).toEqual(DEFAULT_LOOK);
    expect(parseLook("aurora.".repeat(2_000))).toEqual(DEFAULT_LOOK);
    expect(parseLook("__proto__.constructor.toString.valueOf")).toEqual(
      DEFAULT_LOOK,
    );
  });
});

describe("formatLook", () => {
  it("round-trips every valid combination", () => {
    let count = 0;
    for (const t of THEMES)
      for (const mode of MODES)
        for (const reach of REACHES)
          for (const dots of DOT_MODES) {
            const value = `${t.id}.${mode}.${reach}.${dots}`;
            expect(formatLook(parseLook(value))).toBe(value);
            count++;
          }
    expect(count).toBe(18 * 2 * 3 * 2);
  });
});

describe("THEMES", () => {
  it("has the 18 themes of themes.json, in order", () => {
    expect(THEMES).toHaveLength(18);
    expect(THEMES.map((t) => t.id)).toEqual(data.themes.map((t) => t.id));
    expect(THEMES.map((t) => t.label)).toEqual(data.themes.map((t) => t.label));
    expect(THEMES[0]!.id).toBe(data.default);
  });
});

describe("hive default", () => {
  it("starts on the Hive theme when nothing is stored", () => {
    expect(DEFAULT_LOOK.theme).toBe("hive");
    expect(parseLook(undefined).theme).toBe("hive");
    expect(THEMES[0]).toEqual({ id: "hive", label: "Hive" });
    expect(THEMES).toHaveLength(18);
  });

  it("keeps a stored choice", () => {
    expect(parseLook("keystone.dark.tinted.theme").theme).toBe("keystone");
  });
});
