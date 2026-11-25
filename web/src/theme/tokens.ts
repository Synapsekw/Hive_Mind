// Every colour token, straight from a theme's record in themes.json. Nothing is adjusted here:
// a pair that fails contrast.test.ts is fixed by hand in themes.json.

import {
  css,
  fromHex,
  fromOklch,
  mix,
  mixOklab,
  quantize,
  toOklch,
  type RGB,
} from "./colour";
import type { Scheme } from "./look";
import data from "./themes.json";

export type Tokens = Record<string, string>;
export type Theme = {
  id: string;
  label: string;
  scheme: Scheme;
  bg: string;
  card: string;
  line: string;
  text: string;
  muted: string;
  fg2: string;
  quiet: string;
  accent: string;
  onAccent: string;
  glow: string;
  hub: string;
  /** Old, middle, fresh. */
  ramp: string[];
  /** Opacity of the glow colour behind the centre of the map card. */
  tint: number;
  /** Opacity of the accent in the card's grid lines; absent means no grid. */
  grid?: number;
  activeBg: string;
  activeFg: string;
};

export const FRESH_STEPS = 8;

const LIST = data.themes as Theme[];

export function themeOf(id: string): Theme {
  const t = LIST.find((x) => x.id === id);
  if (!t) throw new Error(`unknown theme: ${id}`);
  return t;
}

/** The ramp at eight even steps, old to fresh, through the middle colour. */
export function ramp(t: Theme): RGB[] {
  const [a, b, c] = t.ramp.map(fromHex) as [RGB, RGB, RGB];
  return Array.from({ length: FRESH_STEPS }, (_, i) => {
    const u = i / (FRESH_STEPS - 1);
    return quantize(
      u < 0.5 ? mixOklab(a, b, u * 2) : mixOklab(b, c, (u - 0.5) * 2),
    );
  });
}

/**
 * The eight topic colours of Timeline and Orbit: eight hues fanned across 160 degrees around
 * the hue midway between the accent and the glow colour, alternating two lightness levels, with
 * neighbouring topics far apart in the fan. An accent with almost no chroma gets eight
 * near-greys instead. The rule is triggered by the chroma, never by the theme's name.
 */
export function topicColours(t: Theme): RGB[] {
  const light = t.scheme === "light";
  const h1 = toOklch(fromHex(t.accent));
  const h2 = toOklch(fromHex(t.glow));
  const midH = h1.h + (((h2.h - h1.h + 540) % 360) - 180) / 2;
  return [0, 4, 1, 5, 2, 6, 3, 7].map((k, i) => {
    if (h1.c < 0.03) {
      const l = Number((light ? 0.3 + k * 0.06 : 0.55 + k * 0.055).toFixed(3));
      return quantize(fromOklch(l, 0.012, Number(midH.toFixed(0))));
    }
    const l = light ? (i % 2 ? 0.5 : 0.6) : i % 2 ? 0.72 : 0.82;
    const h = Number(((midH - 80 + (k * 160) / 7 + 720) % 360).toFixed(0));
    return quantize(fromOklch(l, light ? 0.15 : 0.14, h));
  });
}

const alpha = (hex: string, a: number) => css({ ...fromHex(hex), a });

export function tokens(id: string): Tokens {
  const t = themeOf(id);
  const light = t.scheme === "light";
  const tint = `radial-gradient(circle at 50% 52%, ${alpha(t.glow, t.tint)} 0%, transparent 58%)`;
  const g = t.grid === undefined ? null : alpha(t.accent, t.grid);
  const out: Tokens = {
    "--bg": t.bg,
    "--surface": t.card,
    "--glass": t.card,
    "--glass2": t.card,
    // Kept so the cards' `background: var(--glow), var(--glass)` stays valid; nothing glows there.
    "--glow": "none",
    "--card-tint": g
      ? `linear-gradient(${g} 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, ${g} 1px, transparent 1px) 0 0 / 28px 28px, ${tint}`
      : tint,
    "--fg": t.text,
    "--fg2": t.fg2,
    "--muted": t.muted,
    "--quiet": t.quiet,
    "--line": t.line,
    "--line-hi": css(quantize(mix(fromHex(t.line), fromHex(t.text), 0.25))),
    "--fill": alpha(t.text, 0.06),
    "--fill-on": t.activeBg,
    "--sel": alpha(t.accent, 0.1),
    "--brand": t.accent,
    "--acc": t.accent,
    // One colour now; the name stays so the rules that fill with it are not edited.
    "--grad": t.accent,
    "--on-brand": t.onAccent,
    "--edge": t.line,
    "--edge-card": t.line,
    "--lift": light ? `0 1px 3px 0 ${alpha(t.text, 0.08)}` : "none",
    "--mark": t.accent,
    "--hub": t.hub,
    "--glow-colour": t.glow,
    "--halo-blend": light ? "source-over" : "lighter",
    "--active-bg": t.activeBg,
    "--active-fg": t.activeFg,
  };
  ramp(t).forEach((c, i) => {
    out[`--fresh-${i}`] = css(c);
  });
  topicColours(t).forEach((c, i) => {
    out[`--hue-${i + 1}`] = css(c);
  });
  return out;
}
