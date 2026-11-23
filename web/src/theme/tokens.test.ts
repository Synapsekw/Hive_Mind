import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrast,
  css,
  fromHex,
  luminance,
  mix,
  toHex,
  toOklch,
} from "./colour";
import { DOT_MODES, MODES, REACHES, THEMES } from "./look";
import data from "./themes.json";
import {
  adjustments,
  backgrounds,
  baseTokens,
  chromeTokens,
  dotTokens,
  reachTokens,
  resetTokens,
  MODEL_VIEWPORTS,
  pageModel,
  surfaceSamples,
} from "./tokens";

const CLASSIC = {
  dark: [
    "#F5B556",
    "#62B8FF",
    "#FF8FB3",
    "#C4A2FF",
    "#5FE0B0",
    "#FF9D5C",
    "#5CD6E6",
    "#C3E36A",
  ],
  light: [
    "#C98A1B",
    "#2F7FD1",
    "#D9567F",
    "#8B62D9",
    "#1FA57A",
    "#DB6A22",
    "#1C9BAA",
    "#7F9E1F",
  ],
};

describe("seeds", () => {
  it("are an exact copy of docs/ui/themes.json", () => {
    const docs = JSON.parse(
      readFileSync(
        new URL("../../../docs/ui/themes.json", import.meta.url),
        "utf8",
      ),
    );
    expect(data).toEqual(docs);
  });
});

describe("baseTokens and reachTokens", () => {
  it("derive Keystone dark tinted as the prototype does", () => {
    const bg = mix(fromHex("#0e0e10"), fromHex("#8ea2eb"), 0.05);
    const reach = reachTokens("keystone", "dark", "tinted");
    expect(reach["--bg"]).toBe(toHex(bg));
    expect(reach["--glass"]).toBe(css({ ...fromHex(toHex(bg)), a: 0.56 }));
    expect(reach["--surface"]).toBe(
      toHex(mix(fromHex("#161619"), fromHex("#8ea2eb"), 0.04)),
    );
    const base = baseTokens("keystone", "dark");
    expect(base["--sel"]).toBe(css({ ...fromHex("#8ea2eb"), a: 0.14 }));
    expect(base["--brand"]).toBe("#8ea2eb");
    expect(base["--brand-2"]).toBe("#8ea2eb");
    expect(base["--wash"]).toBe(
      "linear-gradient(168deg, #212540 0%, #141728 46%, #08090d 100%)",
    );
  });

  it("mix light-mode reach at 2.5% and 78% glass", () => {
    const bg = toHex(mix(fromHex("#ffffff"), fromHex("#5a6ed5"), 0.025));
    expect(reachTokens("keystone", "light", "vivid")["--bg"]).toBe(bg);
    expect(reachTokens("keystone", "light", "vivid")["--glass"]).toBe(
      css({ ...fromHex(bg), a: 0.78 }),
    );
    expect(reachTokens("keystone", "light", "subtle")["--bg"]).toBe("#ffffff");
  });

  it("use brandMid in Prism's gradient and the midpoint elsewhere", () => {
    expect(baseTokens("prism", "dark")["--grad"]).toBe(
      "linear-gradient(90deg, #3bd4e8, #b9a9ff, #f48fc0)",
    );
    const mid = toHex(mix(fromHex("#5fd6c4"), fromHex("#9d8df7"), 0.5));
    expect(baseTokens("aurora", "dark")["--grad"]).toBe(
      `linear-gradient(90deg, #5fd6c4, ${mid}, #9d8df7)`,
    );
  });

  it("give Vivid a glow and the others none", () => {
    for (const t of THEMES)
      for (const mode of MODES) {
        expect(reachTokens(t.id, mode, "vivid")["--glow"]).toMatch(
          /^radial-gradient\(/,
        );
        expect(reachTokens(t.id, mode, "tinted")["--glow"]).toBe("none");
        expect(reachTokens(t.id, mode, "subtle")["--glow"]).toBe("none");
      }
  });

  it("produce no NaN and no undefined anywhere", () => {
    for (const t of THEMES)
      for (const mode of MODES) {
        const all = [
          baseTokens(t.id, mode),
          chromeTokens(t.id, mode),
          resetTokens(t.id, mode),
          ...REACHES.map((r) => reachTokens(t.id, mode, r)),
          ...DOT_MODES.map((d) => dotTokens(t.id, mode, d)),
        ];
        for (const tokens of all)
          for (const value of Object.values(tokens)) {
            expect(value).not.toMatch(/NaN|undefined|Infinity/);
          }
      }
  });

  it("throw on an unknown theme", () => {
    expect(() => baseTokens("nope", "dark")).toThrow(/nope/);
  });
});

describe("chromeTokens", () => {
  it("are empty in dark and white text in light", () => {
    for (const t of THEMES) {
      expect(chromeTokens(t.id, "dark")).toEqual({});
      const light = chromeTokens(t.id, "light");
      expect(light["--fg"]).toBe("#ffffff");
      expect(light["--grad"]).toBe("#ffffff");
    }
  });

  it("reset restores the card's text tokens", () => {
    const base = baseTokens("aurora", "light");
    const reset = resetTokens("aurora", "light");
    expect(Object.keys(reset).sort()).toEqual(
      Object.keys(chromeTokens("aurora", "light")).sort(),
    );
    for (const [k, v] of Object.entries(reset)) expect(v).toBe(base[k]);
  });
});

describe("dotTokens", () => {
  it("gives eight distinct colours for every theme, mode and dot mode", () => {
    for (const t of THEMES)
      for (const mode of MODES)
        for (const dots of DOT_MODES) {
          const d = dotTokens(t.id, mode, dots);
          const values = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => d[`--hue-${i}`]);
          for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/);
          expect(new Set(values).size).toBe(8);
        }
  });

  it("keeps Classic at the concept doc's lists unless an adjustment names the token", () => {
    const adj = adjustments();
    for (const t of THEMES)
      for (const mode of MODES) {
        const d = dotTokens(t.id, mode, "classic");
        CLASSIC[mode].forEach((hex, i) => {
          const token = `--hue-${i + 1}`;
          const moved = adj.find(
            (a) =>
              a.theme === t.id &&
              a.mode === mode &&
              a.token === `dots=classic ${token}`,
          );
          if (moved) {
            expect(moved.from).toBe(hex.toLowerCase());
            expect(d[token]).toBe(moved.to);
          } else expect(d[token]).toBe(hex.toLowerCase());
        });
      }
  });

  it("follows the theme with the prototype's fan", () => {
    // Keystone dark has one hue; the first dot sits 80 degrees below it at lightness 0.82.
    const d = dotTokens("keystone", "dark", "theme");
    expect(d["--hue-1"]).not.toBe(d["--hue-2"]);
    // Graphite is near-grey: every channel within a few units of the others.
    const g = dotTokens("graphite", "dark", "theme");
    for (let i = 1; i <= 8; i++) {
      const c = fromHex(g[`--hue-${i}`]!);
      expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeLessThan(
        0.05,
      );
    }
  });
});

describe("low-chroma greys (Graphite)", () => {
  for (const mode of MODES)
    it(`are at least 0.02 apart in lightness and pass 3:1 on the card in ${mode}`, () => {
      const d = dotTokens("graphite", mode, "theme");
      const values = Object.values(d).map(fromHex);
      const ls = values.map((c) => toOklch(c).l);
      for (let i = 0; i < 8; i++)
        for (let j = i + 1; j < 8; j++)
          expect(Math.abs(ls[i]! - ls[j]!)).toBeGreaterThanOrEqual(0.02);
      for (const reach of REACHES) {
        const b = backgrounds("graphite", mode, reach);
        for (const c of values)
          for (const bg of [...b.card, ...b.cardSolid])
            expect(contrast(c, bg)).toBeGreaterThanOrEqual(3);
      }
    });
});

describe("backgrounds", () => {
  it("lists every surface, with single opaque solids", () => {
    const b = backgrounds("keystone", "dark", "tinted");
    // The 8 extremes of the sampled page (lightest, darkest, then min/max per channel).
    expect(b.card).toHaveLength(8);
    expect(b.rail).toHaveLength(8);
    expect(b.panel).toHaveLength(8);
    expect(b.popover).toHaveLength(9);
    expect(b.popover[8]).toEqual(
      fromHex(reachTokens("keystone", "dark", "tinted")["--surface"]!),
    );
    expect(b.cardSolid).toEqual([
      fromHex(reachTokens("keystone", "dark", "tinted")["--bg"]!),
    ]);
    expect(b.panelSolid).toEqual([
      fromHex(baseTokens("keystone", "dark")["--panel-solid"]!),
    ]);
  });
});

describe("surfaceSamples", () => {
  const lum = (c: { r: number; g: number; b: number }) => luminance(c);

  it("samples a 12 × 12 grid plus the gradient peaks per surface at every model viewport", () => {
    expect(MODEL_VIEWPORTS).toContainEqual([1600, 1000]);
    expect(MODEL_VIEWPORTS).toContainEqual([1280, 620]);
    for (const reach of ["tinted", "vivid"] as const) {
      const s = surfaceSamples("keystone", "dark", reach);
      const sum = (k: "rail" | "panel" | "popover" | "card") =>
        MODEL_VIEWPORTS.reduce(
          (n, [w, h]) =>
            n +
            144 +
            pageModel("keystone", "dark", reach, w, h).peaks[k].length,
          0,
        );
      expect(s.rail).toHaveLength(sum("rail"));
      expect(s.panel).toHaveLength(sum("panel"));
      expect(s.popover).toHaveLength(sum("popover"));
      // Each card point plain and under the stage glow.
      expect(s.card).toHaveLength(2 * sum("card"));
    }
  });

  it("samples every gradient's peak, the Vivid card glows included", () => {
    const m = pageModel("aurora", "light", "vivid", 1600, 1000);
    const [x0, y0, x1] = m.rects.card;
    const cw = x1 - x0;
    const has = (pts: [number, number][], x: number, y: number) =>
      pts.some(
        ([px, py]) => Math.abs(px - x) < 1e-9 && Math.abs(py - y) < 1e-9,
      );
    expect(has(m.peaks.card, x0 + 0.14 * cw, y0)).toBe(true);
    expect(has(m.peaks.card, x0 + 0.76 * cw, y0)).toBe(true);
    // The pooled glow at 60% 40% lies inside the card: its centre itself is a peak.
    expect(has(m.peaks.card, 0.6 * 1600, 0.4 * 1000)).toBe(true);
    // The top-left bloom at 8% -6% is clamped onto the rail's top edge.
    expect(has(m.peaks.rail, 0.08 * 1600, 0)).toBe(true);
    // And the samples contain the glow peak's colour.
    const peak = m.at.card(x0 + 0.14 * cw, y0)[0]!;
    const samples = surfaceSamples("aurora", "light", "vivid").card;
    expect(samples.some((c) => toHex(c) === toHex(peak))).toBe(true);
  });

  it("is the bare wash where no bloom reaches, and the blooms only lighten a dark wash", () => {
    const bare = surfaceSamples("keystone", "dark", "subtle", {
      bloomFactor: 0,
    });
    const full = surfaceSamples("keystone", "dark", "subtle");
    const stops = data.themes[0]!.dark.wash.map(fromHex);
    // The rail's top-left corner sits on the first stop's side of the 168° wash.
    const corner = bare.rail[0]!;
    expect(lum(corner)).toBeLessThanOrEqual(lum(stops[0]!) + 1e-9);
    full.rail.forEach((c, i) =>
      expect(lum(c)).toBeGreaterThanOrEqual(lum(bare.rail[i]!) - 1e-12),
    );
  });

  it("darkens under a scrim", () => {
    const plain = surfaceSamples("aurora", "light", "tinted");
    const dim = surfaceSamples("aurora", "light", "tinted", {
      panelScrim: 0.2,
      railScrim: 0.2,
    });
    plain.panel.forEach((c, i) =>
      expect(lum(dim.panel[i]!)).toBeLessThan(lum(c)),
    );
    plain.rail.forEach((c, i) =>
      expect(lum(dim.rail[i]!)).toBeLessThan(lum(c)),
    );
  });

  it("backgrounds() keeps the lightest and darkest sample", () => {
    const s = surfaceSamples("sunset", "light", "vivid");
    const b = backgrounds("sunset", "light", "vivid");
    for (const k of ["card", "rail", "panel"] as const) {
      const ls = s[k].map(lum);
      expect(lum(b[k][0]!)).toBe(Math.max(...ls));
      expect(lum(b[k][1]!)).toBe(Math.min(...ls));
    }
  });
});

describe("adjustments", () => {
  it("only move derived tokens, never seeds or backgrounds", () => {
    for (const a of adjustments()) {
      expect(a.token).not.toMatch(
        /--(brand|brand-2|bg|surface|glass|glass2|wash|bloom|glow)$/,
      );
      expect(a.from).not.toBe(a.to);
      expect(a.reach).toBe("any");
    }
  });
});

describe("--mark", () => {
  it("fills the mark with the brand gradient only where the seed asks for it", () => {
    for (const t of THEMES)
      for (const m of MODES) {
        const mark = baseTokens(t.id, m)["--mark"];
        expect(mark).toBe(t.id === "hive" ? "var(--grad)" : "var(--fg)");
      }
  });
});
