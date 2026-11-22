import { describe, expect, it } from "vitest";
import {
  contrast,
  luminance,
  over,
  parseColour,
  type RGB,
  type RGBA,
} from "./colour";
import {
  DOT_MODES,
  MODES,
  REACHES,
  THEMES,
  type Mode,
  type Reach,
} from "./look";
import {
  baseTokens,
  chromeTokens,
  dotTokens,
  pageModel,
  resetTokens,
} from "./tokens";

// An independent check of the sparse model the adjustment optimised against: every surface is
// re-sampled on a dense 60 × 60 grid at viewports the model does not use (1920 × 1080, and
// 1100 × 560, the smallest window the screens must fit), straight through the pointwise page
// model (not through `backgrounds()`), and the spec §3 pairs are re-measured.
const VIEWPORTS: [number, number][] = [
  [1920, 1080],
  [1100, 560],
];
const N = 60;

type Surface = "card" | "rail" | "panel" | "popover";

function dense(
  theme: string,
  mode: Mode,
  reach: Reach,
  W: number,
  H: number,
): Record<Surface, RGB[]> {
  const m = pageModel(theme, mode, reach, W, H);
  const rect = {
    card: m.rects.card,
    rail: m.rects.rail,
    panel: m.rects.panel,
    popover: m.rects.rail,
  };
  const out = {} as Record<Surface, RGB[]>;
  for (const k of ["card", "rail", "panel", "popover"] as const) {
    const [x0, y0, x1, y1] = rect[k];
    const list: RGB[] = [];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        list.push(
          ...m.at[k](
            x0 + ((x1 - x0) * i) / (N - 1),
            y0 + ((y1 - y0) * j) / (N - 1),
          ),
        );
    out[k] = list;
  }
  return out;
}

/** Worst ratio of a foreground over many backgrounds. Opaque: only the luminance extremes matter. */
function worst(fg: RGBA, bgs: RGB[], lums: number[]): number {
  if (fg.a >= 1) {
    const lf = luminance(fg);
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of lums) {
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    const ratio = (l: number) =>
      (Math.max(lf, l) + 0.05) / (Math.min(lf, l) + 0.05);
    return Math.min(ratio(lo), ratio(hi));
  }
  let w = Infinity;
  for (const bg of bgs) w = Math.min(w, contrast(over(fg, bg), bg));
  return w;
}

function failures(
  theme: string,
  mode: Mode,
  reach: Reach,
  [W, H]: [number, number],
): string[] {
  const bgs = dense(theme, mode, reach, W, H);
  const lums = Object.fromEntries(
    Object.entries(bgs).map(([k, v]) => [k, v.map(luminance)]),
  ) as Record<Surface, number[]>;
  const base = baseTokens(theme, mode);
  const reset = resetTokens(theme, mode);
  const out: string[] = [];
  const check = (label: string, value: string, on: Surface, min: number) => {
    const r = worst(parseColour(value), bgs[on], lums[on]);
    if (!(r >= min))
      out.push(
        `${W}×${H} ${theme} ${mode} ${reach}: ${label} ${value} on ${on} is ${r.toFixed(3)} < ${min}`,
      );
  };
  for (const t of ["--fg", "--fg2", "--muted"]) check(t, base[t]!, "card", 4.5);
  for (const t of ["--quiet", "--acc"]) check(t, base[t]!, "card", 3);
  for (const t of ["--fg", "--fg2", "--muted"])
    check(`reset ${t}`, reset[t]!, "popover", 4.5);
  for (const t of ["--quiet", "--acc"])
    check(`reset ${t}`, reset[t]!, "popover", 3);
  const side = mode === "dark" ? base : chromeTokens(theme, mode);
  const scope = mode === "dark" ? "" : "chrome ";
  for (const on of ["rail", "panel"] as const) {
    for (const t of ["--fg", "--muted"])
      check(`${scope}${t}`, side[t]!, on, 4.5);
    for (const t of ["--quiet", "--acc"])
      check(`${scope}${t}`, side[t]!, on, 3);
  }
  for (const dm of DOT_MODES) {
    const d = dotTokens(theme, mode, dm);
    for (let i = 1; i <= 8; i++)
      check(`dots=${dm} --hue-${i}`, d[`--hue-${i}`]!, "card", 3);
  }
  return out;
}

describe("contrast on a dense grid at unmodelled viewports (independent of backgrounds())", () => {
  for (const t of THEMES)
    for (const mode of MODES)
      it(`${t.id} ${mode}, every reach`, () => {
        expect(
          VIEWPORTS.flatMap((v) =>
            REACHES.flatMap((reach) => failures(t.id, mode, reach, v)),
          ),
        ).toEqual([]);
      });
});
