// Every colour token of Keystone glass, derived from the seeds in themes.json with the
// prototype's formulas (docs/ui/map.dc.html lines 353–381, light chrome at lines 36–37), then
// adjusted in lightness where a pair of spec §3 would fail. Seeds and backgrounds never move.

import {
  contrast,
  css,
  fromHex,
  fromOklch,
  mix,
  over,
  quantize,
  toOklch,
  type RGB,
  type RGBA,
} from "./colour";
import {
  DOT_MODES,
  REACHES,
  type DotMode,
  type Mode,
  type Reach,
} from "./look";
import data from "./themes.json";

export type Tokens = Record<string, string>;
export type Surface =
  "card" | "rail" | "panel" | "popover" | "cardSolid" | "panelSolid";
export type Adjustment = {
  token: string;
  theme: string;
  mode: Mode;
  reach: Reach | "any";
  from: string;
  to: string;
};
/** A pair that lightness alone cannot make pass. The contrast test fails on it. */
export type Unreachable = {
  token: string;
  theme: string;
  mode: Mode;
  value: string;
  min: number;
  /** The worst ratio the best lightness reaches, and on which background. */
  best: { value: string; ratio: number; against: string };
  /** Every background (surface[index], any reach) that stays below the minimum. */
  failing: string[];
};

type Seeds = {
  brand: RGB;
  brand2: RGB;
  mid: RGB;
  content: RGB;
  text: RGB;
  textMuted: RGB;
  surface: RGB;
  wash: RGB[];
};

const WHITE: RGB = { r: 1, g: 1, b: 1 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };
const white = (a: number): RGBA => ({ ...WHITE, a });
const black = (a: number): RGBA => ({ ...BLACK, a });
const opaque = (c: RGB): RGBA => ({ r: c.r, g: c.g, b: c.b, a: 1 });
const withAlpha = (c: RGB, a: number): RGBA => ({ r: c.r, g: c.g, b: c.b, a });

function seeds(theme: string, mode: Mode): Seeds {
  const t = data.themes.find((x) => x.id === theme);
  if (!t) throw new Error(`unknown theme: ${theme}`);
  const s = t[mode];
  const brand = fromHex(s.brand);
  const brand2 = fromHex(s.brand2);
  return {
    brand,
    brand2,
    // brandMid null means color-mix(in srgb, brand, brand2): the 50/50 sRGB midpoint.
    mid: quantize(s.brandMid ? fromHex(s.brandMid) : mix(brand, brand2, 0.5)),
    content: fromHex(s.content),
    text: fromHex(s.text),
    textMuted: fromHex(s.textMuted),
    surface: fromHex(s.surface),
    wash: s.wash.map(fromHex),
  };
}

// Prototype `rc`: [dark --bg, dark --surface, light --bg, light --surface], percent of brand.
const RC: Record<Reach, [number, number, number, number]> = {
  subtle: [0, 0, 0, 0],
  tinted: [5, 4, 2.5, 4],
  vivid: [8, 7, 2.5, 5],
};

// Fixed per-mode values, exactly as the prototype sets them (line 364 light, 365 dark).
const FIXED = {
  dark: {
    fg2: fromHex("#c6c7cf"),
    quiet: fromHex("#7c7e88"),
    line: white(0.1),
    lineHi: white(0.26),
    fill: white(0.06),
    fillOn: white(0.11),
    edge: fromHex("#6a6f85"),
    edgeCard: white(0.14),
    glass2: white(0.045),
    lift: `inset 0 1px 0 0 ${css(white(0.1))}, 0 8px 24px -12px ${css(black(0.6))}`,
    onBrand: fromHex("#0e0e10"),
    glassAlpha: 0.56,
  },
  light: {
    fg2: fromHex("#3d3d45"),
    quiet: fromHex("#8b8b93"),
    line: black(0.1),
    lineHi: black(0.24),
    fill: black(0.05),
    fillOn: black(0.09),
    edge: fromHex("#9aa0b4"),
    edgeCard: white(0.7),
    glass2: white(0.13),
    lift: `-1px -1px 0 0 ${css({ r: 30 / 255, g: 40 / 255, b: 90 / 255, a: 0.08 })}, 0 1px 3px 0 ${css({ r: 30 / 255, g: 40 / 255, b: 90 / 255, a: 0.08 })}`,
    onBrand: fromHex("#ffffff"),
    glassAlpha: 0.78,
  },
} as const;

type Reached = { bg: RGB; surface: RGB; glass: RGBA; glow: RGBA[] };

function reached(s: Seeds, mode: Mode, reach: Reach): Reached {
  const rc = RC[reach];
  const light = mode === "light";
  const bg = quantize(mix(s.content, s.brand, rc[light ? 2 : 0] / 100));
  return {
    bg,
    surface: quantize(mix(s.surface, s.brand, rc[light ? 3 : 1] / 100)),
    glass: withAlpha(bg, FIXED[mode].glassAlpha),
    // Two faint glows along the card's top edge, Vivid only; listed top layer first.
    glow:
      reach === "vivid"
        ? [withAlpha(s.brand, 0.1), withAlpha(s.brand2, 0.08)]
        : [],
  };
}

type Blooms = { pooled: RGBA[]; edge: RGBA[] };

/** The five radial glows over the wash at their 0% stop, top layer first. */
function blooms(s: Seeds, mode: Mode): Blooms {
  const light = mode === "light";
  // Light-mode tints are mixed 70% with white.
  const tint = (c: RGB) => quantize(light ? mix(c, WHITE, 0.3) : c);
  const at = (c: RGB, pct: number) => withAlpha(tint(c), pct / 100);
  return {
    // Pooled behind the card: brand2 at 46% 58% at 60% 40%, brand at 34% 42% at 34% 78%.
    pooled: [at(s.brand2, light ? 22 : 16), at(s.brand, light ? 18 : 12)],
    // At the edges: brand top-left, brand2 bottom-right, mid left.
    edge: light
      ? [at(s.brand, 18), at(s.brand2, 16), at(s.mid, 16)]
      : [at(s.brand, 22), at(s.brand2, 18), at(s.mid, 12)],
  };
}

function bloomCss(b: Blooms): string {
  const [p1, p2] = b.pooled;
  const [e1, e2, e3] = b.edge;
  return [
    `radial-gradient(46% 58% at 60% 40%, ${css(p1!)} 0%, transparent 72%)`,
    `radial-gradient(34% 42% at 34% 78%, ${css(p2!)} 0%, transparent 72%)`,
    `radial-gradient(110% 85% at 8% -6%, ${css(e1!)} 0%, transparent 58%)`,
    `radial-gradient(90% 60% at 100% 100%, ${css(e2!)} 0%, transparent 60%)`,
    `radial-gradient(70% 40% at 0% 80%, ${css(e3!)} 0%, transparent 60%)`,
  ].join(", ");
}

/** Paints `layers` (top first, as CSS lists them) over an opaque colour. */
function stack(under: RGB, layers: RGBA[]): RGB {
  let c = under;
  for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i]!, c);
  return c;
}

const panelSolid = (s: Seeds, mode: Mode) =>
  quantize(over(FIXED[mode].glass2, s.wash[1]!));

/**
 * The opaque colours each surface can sit on, for the contrast test (spec "Settled details":
 * blur ignored; each surface over each of the three wash stops, plain and with every bloom tint
 * that can overlap it at its full 0%-stop strength, stacked). Overlap, conservatively:
 * - rail: the three edge blooms (it runs the full height of the left edge);
 * - card and side panel: the two pooled glows behind the card plus the three edge blooms; the
 *   card's tinted variant also carries the Vivid top-edge glow over the glass;
 * - popover (the Appearance panel and other reset popovers, glass, opened from the rail): the
 *   edge blooms, plus `--surface`, its solid fallback (spec §4);
 * - cardSolid: the opaque `--bg`; panelSolid: `--glass2` over the middle wash stop.
 */
export function backgrounds(
  theme: string,
  mode: Mode,
  reach: Reach,
): Record<Surface, RGB[]> {
  const s = seeds(theme, mode);
  const r = reached(s, mode, reach);
  const b = blooms(s, mode);
  const all = [...b.pooled, ...b.edge];
  const glass2 = FIXED[mode].glass2;
  return {
    card: s.wash.flatMap((w) => [
      over(r.glass, w),
      stack(over(r.glass, stack(w, all)), r.glow),
    ]),
    rail: s.wash.flatMap((w) => [w, stack(w, b.edge)]),
    panel: s.wash.flatMap((w) => [
      over(glass2, w),
      over(glass2, stack(w, all)),
    ]),
    popover: [
      ...s.wash.flatMap((w) => [
        over(r.glass, w),
        over(r.glass, stack(w, b.edge)),
      ]),
      r.surface,
    ],
    cardSolid: [r.bg],
    panelSolid: [panelSolid(s, mode)],
  };
}

// ---------------------------------------------------------------------------------------------
// Adjustment

type Labelled = { c: RGB; label: string };

/** "panel over wash stop 1 at subtle", "… at tinted", … → "panel over wash stop 1 (every reach)". */
function groupByReach(labels: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const label of labels) {
    const m = / at (subtle|tinted|vivid)$/.exec(label);
    const key = m ? label.slice(0, m.index) : label;
    groups.set(key, [...(groups.get(key) ?? []), ...(m ? [m[1]!] : [])]);
  }
  return [...groups].map(([key, reaches]) =>
    reaches.length === 0
      ? key
      : `${key} (${reaches.length === REACHES.length ? "every reach" : reaches.join(", ")})`,
  );
}

/** Names entry `i` of `backgrounds()[surface]`, e.g. "panel over wash stop 1 with blooms". */
function describe(surface: Surface, i: number): string {
  if (surface === "cardSolid" || surface === "panelSolid") return surface;
  if (surface === "popover" && i === 6) return "popover --surface (solid)";
  return `${surface} over wash stop ${Math.floor(i / 2) + 1}${i % 2 ? " with blooms" : ""}`;
}

function worst(fg: RGBA, on: Labelled[]): { ratio: number; against: string } {
  let w = { ratio: Infinity, against: "" };
  for (const bg of on) {
    const ratio = contrast(over(fg, bg.c), bg.c);
    if (ratio < w.ratio) w = { ratio, against: bg.label };
  }
  return w;
}

type Outcome = {
  value: RGBA;
  ok: boolean;
  best: { value: RGBA; ratio: number; against: string };
};

/**
 * Steps OKLCH lightness by 0.01 away from the backgrounds' average lightness (hue and chroma kept,
 * chroma only reduced where sRGB requires) until every background passes, at most 100 steps.
 * `avoid` holds values the result must not equal (keeps the eight dots distinct).
 */
function adjust(
  value: RGBA,
  on: Labelled[],
  min: number,
  avoid: Set<string>,
): Outcome {
  const passes = (c: RGBA) => worst(c, on).ratio >= min && !avoid.has(css(c));
  const start = worst(value, on);
  let best = { value, ...start };
  if (passes(value)) return { value, ok: true, best };
  const o = toOklch(value);
  const avg = on.reduce((sum, bg) => sum + toOklch(bg.c).l, 0) / on.length;
  const dir = o.l >= avg ? 1 : -1;
  for (let n = 1; n <= 100; n++) {
    const l = o.l + dir * 0.01 * n;
    const cand = quantize(withAlpha(fromOklch(l, o.c, o.h), value.a));
    const w = worst(cand, on);
    if (w.ratio > best.ratio) best = { value: cand, ...w };
    if (passes(cand)) return { value: cand, ok: true, best };
    if (l >= 1 || l <= 0) break;
  }
  return { value, ok: false, best };
}

// ---------------------------------------------------------------------------------------------
// Resolution, cached per theme × mode

const CLASSIC: Record<Mode, string[]> = {
  dark: [
    "#f5b556",
    "#62b8ff",
    "#ff8fb3",
    "#c4a2ff",
    "#5fe0b0",
    "#ff9d5c",
    "#5cd6e6",
    "#c3e36a",
  ],
  light: [
    "#c98a1b",
    "#2f7fd1",
    "#d9567f",
    "#8b62d9",
    "#1fa57a",
    "#db6a22",
    "#1c9baa",
    "#7f9e1f",
  ],
};

/** Prototype lines 376–381: an eight-hue fan across 160° around the brand hues' midpoint. */
function themeDots(s: Seeds, mode: Mode): RGB[] {
  const light = mode === "light";
  const h1 = toOklch(s.brand);
  const h2 = toOklch(s.brand2);
  const midH = h1.h + (((h2.h - h1.h + 540) % 360) - 180) / 2;
  return [0, 4, 1, 5, 2, 6, 3, 7].map((k, i) => {
    if (h1.c < 0.03) {
      // Near-greys, lightness rising in eight steps (the prototype rounds it to 3 decimals).
      const l = Number((light ? 0.3 + k * 0.06 : 0.55 + k * 0.055).toFixed(3));
      return quantize(fromOklch(l, 0.012, Number(midH.toFixed(0))));
    }
    const l = light ? (i % 2 ? 0.5 : 0.6) : i % 2 ? 0.72 : 0.82;
    // The prototype writes the hue rounded to whole degrees.
    const h = Number(((midH - 80 + (k * 160) / 7 + 720) % 360).toFixed(0));
    return quantize(fromOklch(l, light ? 0.15 : 0.14, h));
  });
}

const CHROME_KEYS = [
  "--fg",
  "--fg2",
  "--muted",
  "--quiet",
  "--line",
  "--line-hi",
  "--fill",
  "--fill-on",
  "--sel",
  "--grad",
  "--on-brand",
  "--acc",
] as const;

type Resolved = {
  base: Tokens;
  chrome: Tokens;
  reset: Tokens;
  dots: Record<DotMode, Tokens>;
  adjustments: Adjustment[];
  unreachable: Unreachable[];
};

const cache = new Map<string, Resolved>();

function resolve(theme: string, mode: Mode): Resolved {
  const key = `${theme}.${mode}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s = seeds(theme, mode);
  const f = FIXED[mode];
  const light = mode === "light";
  const adjustments: Adjustment[] = [];
  const unreachable: Unreachable[] = [];

  const on = (surfaces: Surface[]): Labelled[] =>
    REACHES.flatMap((reach) => {
      const b = backgrounds(theme, mode, reach);
      return surfaces.flatMap((sf) =>
        b[sf].map((c, i) => ({ c, label: `${describe(sf, i)} at ${reach}` })),
      );
    });
  const fixedOn = (list: [RGB, string][]): Labelled[] =>
    list.map(([c, label]) => ({ c, label }));

  const run = (
    token: string,
    value: RGBA,
    bgs: Labelled[],
    min: number,
    avoid = new Set<string>(),
  ) => {
    let out = adjust(value, bgs, min, avoid);
    if (!out.ok) {
      // Lightness alone cannot pass every background. Record the pair, then adjust for the
      // backgrounds that can pass, so the contrast test fails on exactly the unreachable ones.
      const best = out.best;
      const failing = bgs.filter((bg) => worst(best.value, [bg]).ratio < min);
      unreachable.push({
        failing: groupByReach(failing.map((bg) => bg.label)),
        token,
        theme,
        mode,
        value: css(value),
        min,
        best: {
          value: css(best.value),
          ratio: Math.round(best.ratio * 100) / 100,
          against: best.against,
        },
      });
      const reachable = bgs.filter(
        (bg) => worst(best.value, [bg]).ratio >= min,
      );
      out = reachable.length
        ? adjust(value, reachable, min, avoid)
        : { ...out, value };
    }
    if (css(out.value) !== css(value)) {
      adjustments.push({
        token,
        theme,
        mode,
        reach: "any",
        from: css(value),
        to: css(out.value),
      });
    }
    return out.value;
  };

  // Card text is also the reset popover's text, so it must pass on both. In dark mode there is no
  // chrome scope, so the same tokens must also pass on the rail and the side panel.
  const sides = on(["rail", "panel", "panelSolid"]);
  const cardish = on(["card", "cardSolid", "popover"]);
  const text = light ? cardish : [...cardish, ...sides];

  const fg = run("--fg", opaque(s.text), text, 4.5);
  const fg2 = run("--fg2", opaque(f.fg2), cardish, 4.5);
  const muted = run("--muted", opaque(s.textMuted), text, 4.5);
  const quiet = run("--quiet", opaque(f.quiet), text, 3);
  const acc = run("--acc", opaque(s.brand), text, 3);
  const grad = fixedOn([
    [s.brand, "--grad brand"],
    [s.mid, "--grad mid"],
    [s.brand2, "--grad brand-2"],
  ]);
  const onBrand = run("--on-brand", opaque(f.onBrand), grad, 4.5);

  const base: Tokens = {
    "--brand": css(s.brand),
    "--brand-2": css(s.brand2),
    "--acc": css(acc),
    "--grad": `linear-gradient(90deg, ${css(s.brand)}, ${css(s.mid)}, ${css(s.brand2)})`,
    "--sel": css(withAlpha(s.brand, 0.14)),
    "--fg": css(fg),
    "--fg2": css(fg2),
    "--muted": css(muted),
    "--quiet": css(quiet),
    "--line": css(f.line),
    "--line-hi": css(f.lineHi),
    "--fill": css(f.fill),
    "--fill-on": css(f.fillOn),
    "--edge": css(f.edge),
    "--edge-card": css(f.edgeCard),
    "--glass2": css(f.glass2),
    "--panel-solid": css(panelSolid(s, mode)),
    "--lift": f.lift,
    "--on-brand": css(onBrand),
    "--wash": `linear-gradient(168deg, ${css(s.wash[0]!)} 0%, ${css(s.wash[1]!)} 46%, ${css(s.wash[2]!)} 100%)`,
    "--bloom": bloomCss(blooms(s, mode)),
  };

  // Light mode "bold frame": white text on the saturated wash (prototype line 36).
  let chrome: Tokens = {};
  if (light) {
    const cFg = run("chrome --fg", opaque(WHITE), sides, 4.5);
    const cMuted = run("chrome --muted", white(0.9), sides, 4.5);
    const cQuiet = run("chrome --quiet", white(0.6), sides, 3);
    const cAcc = run("chrome --acc", opaque(WHITE), sides, 3);
    const cOnBrand = run(
      "chrome --on-brand",
      opaque(s.brand),
      fixedOn([[WHITE, "chrome --grad"]]),
      4.5,
    );
    chrome = {
      "--fg": css(cFg),
      "--fg2": css(cFg),
      "--muted": css(cMuted),
      "--quiet": css(cQuiet),
      "--line": css(white(0.24)),
      "--line-hi": css(white(0.55)),
      "--fill": css(white(0.09)),
      "--fill-on": css(white(0.18)),
      "--sel": css(white(0.18)),
      "--grad": css(WHITE),
      "--on-brand": css(cOnBrand),
      "--acc": css(cAcc),
    };
  }

  const reset: Tokens = {};
  for (const k of CHROME_KEYS) reset[k] = base[k]!;

  const dotOn = on(["card", "cardSolid"]);
  const dots = {} as Record<DotMode, Tokens>;
  for (const dm of DOT_MODES) {
    const raw =
      dm === "theme" ? themeDots(s, mode) : CLASSIC[mode].map(fromHex);
    const final: RGBA[] = [];
    raw.forEach((c, i) => {
      const avoid = new Set([...final, ...raw.slice(i + 1)].map(css));
      final.push(run(`dots=${dm} --hue-${i + 1}`, opaque(c), dotOn, 3, avoid));
    });
    dots[dm] = Object.fromEntries(
      final.map((c, i) => [`--hue-${i + 1}`, css(c)]),
    );
  }

  const out: Resolved = { base, chrome, reset, dots, adjustments, unreachable };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Public API

/** Everything that does not depend on reach, after adjustment. */
export function baseTokens(theme: string, mode: Mode): Tokens {
  return { ...resolve(theme, mode).base };
}

export function reachTokens(theme: string, mode: Mode, reach: Reach): Tokens {
  const s = seeds(theme, mode);
  const r = reached(s, mode, reach);
  const [g1, g2] = r.glow;
  return {
    "--bg": css(r.bg),
    "--surface": css(r.surface),
    "--glass": css(r.glass),
    "--glow":
      g1 && g2
        ? `radial-gradient(60% 224px at 14% 0, ${css(g1)} 0%, transparent 70%), radial-gradient(30% 224px at 76% 0, ${css(g2)} 0%, transparent 70%)`
        : "none",
  };
}

/** The light-mode chrome scope (rail, side panel); `{}` in dark. */
export function chromeTokens(theme: string, mode: Mode): Tokens {
  return { ...resolve(theme, mode).chrome };
}

/** What a reset popover restores inside chrome: the card's values of every chrome token. */
export function resetTokens(theme: string, mode: Mode): Tokens {
  return { ...resolve(theme, mode).reset };
}

/** `--hue-1` … `--hue-8`. */
export function dotTokens(theme: string, mode: Mode, dots: DotMode): Tokens {
  return { ...resolve(theme, mode).dots[dots] };
}

/** The raw Classic eight for a mode, before any per-theme adjustment. */
export function classicDots(mode: Mode): Tokens {
  return Object.fromEntries(
    CLASSIC[mode].map((hex, i) => [`--hue-${i + 1}`, hex]),
  );
}

const ALL_THEMES = data.themes.map((t) => t.id);
const ALL_MODES: Mode[] = ["dark", "light"];

export function adjustments(): Adjustment[] {
  return ALL_THEMES.flatMap((t) =>
    ALL_MODES.flatMap((m) => resolve(t, m).adjustments),
  );
}

export function unreachable(): Unreachable[] {
  return ALL_THEMES.flatMap((t) =>
    ALL_MODES.flatMap((m) => resolve(t, m).unreachable),
  );
}
