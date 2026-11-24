import { describe, expect, it } from "vitest";
import { css, fromHex } from "./colour";
import { THEMES } from "./look";
import { FRESH_STEPS, ramp, themeOf, tokens, topicColours } from "./tokens";

const NAMES = [
  "--bg",
  "--surface",
  "--glass",
  "--glass2",
  "--glow",
  "--card-tint",
  "--fg",
  "--fg2",
  "--muted",
  "--quiet",
  "--line",
  "--line-hi",
  "--fill",
  "--fill-on",
  "--sel",
  "--brand",
  "--acc",
  "--grad",
  "--on-brand",
  "--edge",
  "--edge-card",
  "--lift",
  "--mark",
  "--hub",
  "--glow-colour",
  "--halo-blend",
  "--active-bg",
  "--active-fg",
  ...Array.from({ length: 8 }, (_, i) => `--fresh-${i}`),
  ...Array.from({ length: 8 }, (_, i) => `--hue-${i + 1}`),
];

describe("tokens", () => {
  it("gives every theme exactly the same token names", () => {
    for (const { id } of THEMES)
      expect(Object.keys(tokens(id)).sort()).toEqual([...NAMES].sort());
  });

  it("writes no NaN, undefined or empty value", () => {
    for (const { id } of THEMES)
      for (const [k, v] of Object.entries(tokens(id))) {
        expect(v, `${id} ${k}`).not.toMatch(/NaN|undefined/);
        expect(v.length, `${id} ${k}`).toBeGreaterThan(0);
      }
  });

  it("takes the plain colours straight from the record", () => {
    const t = tokens("honey");
    expect(t["--bg"]).toBe("#060606");
    expect(t["--glass"]).toBe("#0c0c0d");
    expect(t["--fg"]).toBe("#f3efe8");
    expect(t["--brand"]).toBe("#f5b544");
    expect(t["--acc"]).toBe("#f5b544");
    expect(t["--grad"]).toBe("#f5b544");
    expect(t["--hub"]).toBe("#f5b544");
    expect(t["--glow-colour"]).toBe("#ffb640");
    expect(t["--glow"]).toBe("none");
    expect(t["--active-fg"]).toBe("#ffd98a");
  });

  it("blends halos by adding light in dark themes and painting in the light one", () => {
    expect(tokens("honey")["--halo-blend"]).toBe("lighter");
    expect(tokens("paper")["--halo-blend"]).toBe("source-over");
  });

  it("gives only Blueprint a grid in the card tint", () => {
    for (const { id } of THEMES) {
      const tint = tokens(id)["--card-tint"]!;
      expect(tint).toContain("radial-gradient(");
      expect(tint.includes("linear-gradient("), id).toBe(id === "blueprint");
    }
  });

  it("lifts the card with a shadow only in the light theme", () => {
    expect(tokens("honey")["--lift"]).toBe("none");
    expect(tokens("paper")["--lift"]).not.toBe("none");
  });
});

describe("ramp", () => {
  it("has eight steps that start and end on the record's colours", () => {
    for (const { id } of THEMES) {
      const t = themeOf(id);
      const r = ramp(t);
      expect(r).toHaveLength(FRESH_STEPS);
      expect(css(r[0]!)).toBe(t.ramp[0]);
      expect(css(r[7]!)).toBe(t.ramp[2]);
      expect(tokens(id)["--fresh-0"]).toBe(t.ramp[0]);
      expect(tokens(id)["--fresh-7"]).toBe(t.ramp[2]);
    }
  });

  it("has eight different steps", () => {
    for (const { id } of THEMES)
      expect(new Set(ramp(themeOf(id)).map(css)).size, id).toBe(8);
  });
});

describe("topicColours", () => {
  it("gives eight different colours per theme", () => {
    for (const { id } of THEMES) {
      const c = topicColours(themeOf(id)).map(css);
      expect(c).toHaveLength(8);
      expect(new Set(c).size, id).toBe(8);
    }
  });

  it("gives near-greys to a theme whose accent has almost no chroma", () => {
    for (const c of topicColours(themeOf("moonstone"))) {
      const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      expect(spread).toBeLessThan(0.08);
    }
  });
});

describe("themeOf", () => {
  it("throws on an unknown id", () => {
    expect(() => themeOf("nope")).toThrow("unknown theme: nope");
    expect(fromHex(themeOf("paper").bg)).toBeTruthy();
  });
});
