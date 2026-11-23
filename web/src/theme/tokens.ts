// Every colour token of Keystone glass, derived from the seeds in themes.json with the
// prototype's formulas (docs/ui/map.dc.html lines 353–381, light chrome at lines 36–37), then
// adjusted in lightness where a pair of spec §3 would fail. Seeds and backgrounds never move.

import {
  contrast,
  luminance,
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

// ---------------------------------------------------------------------------------------------
// The real page background, evaluated at points (fix round 1: replaces "every bloom stacked")

/** A radial gradient `rx ry at cx cy, colour 0%, transparent end`; sizes as fractions of the box. */
type Radial = {
  rx: number;
  ry: number;
  cx: number;
  cy: number;
  end: number;
  colour: RGBA;
};

/** The five page radials in the prototype's order (line 366 then the bloom of line 361), top first. */
function radials(b: Blooms, factor: number): Radial[] {
  const [p1, p2] = b.pooled;
  const [e1, e2, e3] = b.edge;
  const k = (c: RGBA): RGBA => withAlpha(c, c.a * factor);
  return [
    { rx: 0.46, ry: 0.58, cx: 0.6, cy: 0.4, end: 0.72, colour: k(p1!) },
    { rx: 0.34, ry: 0.42, cx: 0.34, cy: 0.78, end: 0.72, colour: k(p2!) },
    { rx: 1.1, ry: 0.85, cx: 0.08, cy: -0.06, end: 0.58, colour: k(e1!) },
    { rx: 0.9, ry: 0.6, cx: 1, cy: 1, end: 0.6, colour: k(e2!) },
    { rx: 0.7, ry: 0.4, cx: 0, cy: 0.8, end: 0.6, colour: k(e3!) },
  ];
}

/**
 * A radial's colour at (x, y) in a w × h box. Colour to `transparent` fades the alpha only
 * (browsers interpolate premultiplied), linearly from the 0% stop to the end stop.
 */
function radialAt(g: Radial, x: number, y: number, w: number, h: number): RGBA {
  const t = Math.hypot(
    (x - g.cx * w) / (g.rx * w),
    (y - g.cy * h) / (g.ry * h),
  );
  return withAlpha(g.colour, t >= g.end ? 0 : g.colour.a * (1 - t / g.end));
}

/** `linear-gradient(168deg, w0 0%, w1 46%, w2 100%)` at (x, y) in a w × h box. */
function washAt(wash: RGB[], x: number, y: number, w: number, h: number): RGB {
  const a = (168 * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const length = Math.abs(w * dx) + Math.abs(h * dy);
  const p = Math.min(
    1,
    Math.max(0, ((x - w / 2) * dx + (y - h / 2) * dy) / length + 0.5),
  );
  return p <= 0.46
    ? mix(wash[0]!, wash[1]!, p / 0.46)
    : mix(wash[1]!, wash[2]!, (p - 0.46) / 0.54);
}

/**
 * Layout assumption of the contrast model: the prototype's rail of 208 px and side panel of
 * 280 px (card between), sampled at the reference viewports 1600 × 1000 and 1280 × 620. If the
 * layout's widths or the supported viewports change materially, revisit these figures: the
 * blooms are sized in % of the page, so what lies behind each surface moves with them.
 * Fix round 3 added 1440 × 900, 2560 × 1440 and 3840 × 2160: the Vivid card glows are 224 px
 * tall whatever the viewport, so where they land on the page blooms depends on its size, and
 * the dense check (dense.test.ts, 1920 × 1080 and 1100 × 560) found misses of up to 0.012 below
 * 3:1 with the two reference viewports alone.
 */
export const MODEL_VIEWPORTS: [number, number][] = [
  [1600, 1000],
  [1280, 620],
  [1440, 900],
  [2560, 1440],
  [3840, 2160],
];
const RAIL = 208;
const PANEL = 280;
const GRID = 12;

type Rect = [x0: number, y0: number, x1: number, y1: number];

function layout(w: number, h: number): Record<"rail" | "card" | "panel", Rect> {
  const panelLeft = w - 8 - PANEL;
  return {
    rail: [0, 0, RAIL, h],
    // margin 8px 4px; the panel's left margin is 4px.
    card: [RAIL + 4, 8, panelLeft - 4 - 4, h - 8],
    panel: [panelLeft, 8, w - 8, h - 8],
  };
}

/** GRID × GRID points across a rectangle, corners and edges included. */
function grid([x0, y0, x1, y1]: Rect): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      out.push([
        x0 + ((x1 - x0) * i) / (GRID - 1),
        y0 + ((y1 - y0) * j) / (GRID - 1),
      ]);
  return out;
}

export type SampleOptions = {
  /** Multiplies every bloom strength (1 = as designed). */
  bloomFactor?: number;
  /** Alpha of a black layer over the side panel's glass, and over the rail. */
  panelScrim?: number;
  railScrim?: number;
};

type Point = [number, number];
type PageSurface = "card" | "rail" | "panel" | "popover";

/** The model of one viewport: the surfaces' rectangles, their colour at a point, their peaks. */
export type PageModel = {
  rects: Record<"rail" | "card" | "panel", Rect>;
  /** The opaque colour(s) a surface shows at a page point (the card gives plain and under the stage glow). */
  at: Record<PageSurface, (x: number, y: number) => RGB[]>;
  /** Points where a gradient peaks inside each surface: every centre clamped into its rectangle. */
  peaks: Record<PageSurface, Point[]>;
};

const clampInto = ([x0, y0, x1, y1]: Rect, x: number, y: number): Point => [
  Math.min(x1, Math.max(x0, x)),
  Math.min(y1, Math.max(y0, y)),
];

/**
 * The page at a w × h viewport, pointwise (for `surfaceSamples` and the dense contrast check).
 * Blur is ignored: it averages neighbours, so the unblurred extremes are the conservative case.
 * - rail: the page at its points;
 * - card: `--glass` over the page, with the Vivid top-edge glows evaluated on the card box; plus
 *   the stage's faint brand glow (prototype line 97, 8%) at its centre strength over every point;
 * - panel: `--glass2` over the page;
 * - popover (opened from the rail): `--glass` over the rail's points.
 * A radial's strength falls with a separable ellipse distance, so its peak inside a rectangle is
 * its centre clamped into that rectangle; those points are the `peaks`.
 */
export function pageModel(
  theme: string,
  mode: Mode,
  reach: Reach,
  w: number,
  h: number,
  options: SampleOptions = {},
): PageModel {
  const s = seeds(theme, mode);
  const r = reached(s, mode, reach);
  const layers = radials(blooms(s, mode), options.bloomFactor ?? 1);
  const glass2 = FIXED[mode].glass2;
  const stage = withAlpha(s.brand, 0.08);
  const rects = layout(w, h);
  const page = (x: number, y: number) => {
    let c = washAt(s.wash, x, y, w, h);
    for (let i = layers.length - 1; i >= 0; i--)
      c = over(radialAt(layers[i]!, x, y, w, h), c);
    return c;
  };
  const [cx0, cy0, cx1, cy1] = rects.card;
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  // The Vivid glows: `60% 224px at 14% 0` and `30% 224px at 76% 0`, transparent at 70%.
  const glows: Radial[] = r.glow.map((colour, i) => ({
    rx: i === 0 ? 0.6 : 0.3,
    ry: 224 / ch,
    cx: i === 0 ? 0.14 : 0.76,
    cy: 0,
    end: 0.7,
    colour,
  }));
  const rail = (x: number, y: number) => {
    const c = page(x, y);
    return options.railScrim ? over(black(options.railScrim), c) : c;
  };
  const centres: Point[] = layers.map((g) => [g.cx * w, g.cy * h]);
  // Every centre clamped into the rectangle, and every crossing of those clamped x and y lines
  // (where two gradients overlap, the brightest point tends to sit on such a crossing).
  const peaks = (rect: Rect, extra: Point[] = []) => {
    const pts = [...centres, ...extra].map(([x, y]) => clampInto(rect, x, y));
    const xs = [...new Set(pts.map((p) => p[0]))];
    const ys = [...new Set(pts.map((p) => p[1]))];
    const cross = xs.flatMap((x) => ys.map((y): Point => [x, y]));
    const seen = new Set(pts.map((p) => p.join()));
    return [...pts, ...cross.filter((p) => !seen.has(p.join()))];
  };
  return {
    rects,
    at: {
      rail: (x, y) => [rail(x, y)],
      popover: (x, y) => [over(r.glass, page(x, y))],
      panel: (x, y) => {
        const c = over(glass2, page(x, y));
        return [options.panelScrim ? over(black(options.panelScrim), c) : c];
      },
      card: (x, y) => {
        let c = over(r.glass, page(x, y));
        for (let i = glows.length - 1; i >= 0; i--)
          c = over(radialAt(glows[i]!, x - cx0, y - cy0, cw, ch), c);
        return [c, over(stage, c)];
      },
    },
    peaks: {
      rail: peaks(rects.rail),
      popover: peaks(rects.rail),
      panel: peaks(rects.panel),
      card: peaks(
        rects.card,
        glows.map((g) => [cx0 + g.cx * cw, cy0] as Point),
      ),
    },
  };
}

/**
 * Every sampled background, before reducing to extremes (for analysis and tests): each surface
 * on a GRID × GRID grid plus its gradient peaks, at both reference viewports.
 */
export function surfaceSamples(
  theme: string,
  mode: Mode,
  reach: Reach,
  options: SampleOptions = {},
): Record<PageSurface, RGB[]> {
  const out: Record<PageSurface, RGB[]> = {
    card: [],
    rail: [],
    panel: [],
    popover: [],
  };
  for (const [w, h] of MODEL_VIEWPORTS) {
    const m = pageModel(theme, mode, reach, w, h, options);
    const where: Record<PageSurface, Rect> = {
      card: m.rects.card,
      rail: m.rects.rail,
      panel: m.rects.panel,
      popover: m.rects.rail,
    };
    for (const k of ["rail", "popover", "panel", "card"] as const)
      for (const [x, y] of [...grid(where[k]), ...m.peaks[k]])
        out[k].push(...m.at[k](x, y));
  }
  return out;
}

const EXTREMES = [
  "lightest",
  "darkest",
  "least red",
  "most red",
  "least green",
  "most green",
  "least blue",
  "most blue",
] as const;

/** The samples' extremes, in the order of EXTREMES: by luminance, then per channel. */
function extremes(list: RGB[]): RGB[] {
  const by = (f: (c: RGB) => number) => {
    let lo = list[0]!;
    let hi = list[0]!;
    for (const c of list) {
      if (f(c) < f(lo)) lo = c;
      if (f(c) > f(hi)) hi = c;
    }
    return [lo, hi];
  };
  const [dark, light] = by(luminance);
  return [
    light!,
    dark!,
    ...by((c) => c.r),
    ...by((c) => c.g),
    ...by((c) => c.b),
  ];
}

const panelSolid = (s: Seeds, mode: Mode) =>
  quantize(over(FIXED[mode].glass2, s.wash[1]!));

/**
 * The opaque colours each surface can sit on, for the contrast test: the extremes of the real
 * page background sampled on a 12 × 12 grid over each surface at 1600 × 1000 and 1280 × 620
 * (see `surfaceSamples`). Each of card, rail, panel holds the 8 extremes; popover holds its 8
 * plus `--surface`, its solid fallback (spec §4). cardSolid is the opaque `--bg`; panelSolid
 * is `--glass2` over the middle wash stop.
 */
export function backgrounds(
  theme: string,
  mode: Mode,
  reach: Reach,
): Record<Surface, RGB[]> {
  const s = seeds(theme, mode);
  const r = reached(s, mode, reach);
  const sm = surfaceSamples(theme, mode, reach);
  return {
    card: extremes(sm.card),
    rail: extremes(sm.rail),
    panel: extremes(sm.panel),
    popover: [...extremes(sm.popover), r.surface],
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

/** Names entry `i` of `backgrounds()[surface]`, e.g. "panel, lightest sample". */
function describe(surface: Surface, i: number): string {
  if (surface === "cardSolid" || surface === "panelSolid") return surface;
  if (surface === "popover" && i === EXTREMES.length)
    return "popover --surface (solid)";
  return `${surface}, ${EXTREMES[i]} sample`;
}

function worst(fg: RGBA, on: Labelled[]): { ratio: number; against: string } {
  let w = { ratio: Infinity, against: "" };
  for (const bg of on) {
    const ratio = contrast(over(fg, bg.c), bg.c);
    if (ratio < w.ratio) w = { ratio, against: bg.label };
  }
  return w;
}

/**
 * What the adjustment aims for, above the minimums that the tests assert (4.5 text, 3 the rest).
 * The model samples a finite set of viewports, and the Vivid card glows are a fixed 224 px tall,
 * so on windows the model does not sample (ultrawide 3440 × 1440, 2560 × 1080) they land on the
 * page glows a little differently and a colour tuned to exactly the minimum can dip just below
 * it (2.988 seen). Aiming 0.1 higher closes that gap without more viewports.
 */
export const TEXT_TARGET = 4.6;
export const NON_TEXT_TARGET = 3.1;
const aim = (min: number) =>
  min === 4.5 ? TEXT_TARGET : min === 3 ? NON_TEXT_TARGET : min;

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

/**
 * Fix round 2: for a low-chroma brand (Graphite), the eight greys are spaced evenly across the
 * part of the prototype's lightness run that reaches NON_TEXT_TARGET (3.1) on every card background (all reaches),
 * keeping the prototype's topic order, instead of clamping each grey on its own. The run is
 * dark 0.55 → 0.55 + 7 × 0.055, light 0.30 → 0.30 + 7 × 0.06; it is walked from its start in
 * 0.001 steps, and the spaced range runs from the first passing lightness to the last one
 * before the first failure after it. Returns null (prototype values stand) when the brand has
 * chroma, when the prototype's eight already pass, or when nothing in the run passes.
 */
function spacedGreys(s: Seeds, mode: Mode, on: Labelled[]): RGB[] | null {
  const h1 = toOklch(s.brand);
  if (h1.c >= 0.03) return null;
  const h2 = toOklch(s.brand2);
  const hue = Number(
    (h1.h + (((h2.h - h1.h + 540) % 360) - 180) / 2).toFixed(0),
  );
  const light = mode === "light";
  const start = light ? 0.3 : 0.55;
  const step = light ? 0.06 : 0.055;
  const grey = (l: number) => quantize(fromOklch(l, 0.012, hue));
  const passes = (l: number) =>
    worst(opaque(grey(l)), on).ratio >= NON_TEXT_TARGET;
  const ks = [0, 4, 1, 5, 2, 6, 3, 7];
  if (ks.every((k) => passes(Number((start + k * step).toFixed(3)))))
    return null;
  const span = Math.round(7 * step * 1000);
  let lo: number | null = null;
  let hi: number | null = null;
  for (let n = 0; n <= span; n++) {
    const l = Number((start + n / 1000).toFixed(3));
    if (passes(l)) {
      if (lo === null) lo = l;
      hi = l;
    } else if (lo !== null) break;
  }
  if (lo === null || hi === null) return null;
  const from = lo;
  const to = hi;
  return ks.map((k) => grey(Number((from + (k * (to - from)) / 7).toFixed(3))));
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
    // Aim at the minimum plus a margin; fall back to the bare minimum if the margin is out of
    // reach, and only then treat the pair as unreachable.
    let out = adjust(value, bgs, aim(min), avoid);
    if (!out.ok) out = adjust(value, bgs, min, avoid);
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
  const markFill = (
    data.themes.find((x) => x.id === theme) as { mark?: string }
  ).mark;

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
    "--mark": markFill === "brand" ? "var(--grad)" : "var(--fg)",
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
    const spaced = dm === "theme" ? spacedGreys(s, mode, dotOn) : null;
    const start = spaced ?? raw;
    const final: RGBA[] = [];
    raw.forEach((c, i) => {
      const token = `dots=${dm} --hue-${i + 1}`;
      const from = opaque(start[i]!);
      if (css(from) !== css(c))
        adjustments.push({
          token,
          theme,
          mode,
          reach: "any",
          from: css(c),
          to: css(from),
        });
      const avoid = new Set([...final, ...start.slice(i + 1)].map(css));
      final.push(run(token, from, dotOn, 3, avoid));
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
