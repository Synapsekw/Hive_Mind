import { describe, expect, it } from "vitest";
import {
  contrast,
  fromHex,
  over,
  parseColour,
  toHex,
  type RGB,
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
  backgrounds,
  baseTokens,
  chromeTokens,
  dotTokens,
  resetTokens,
  type Surface,
  type Tokens,
} from "./tokens";

// Spec §3. Each row: which token set, which tokens, on which surfaces, and the minimum.
// A translucent foreground is composited over the background before measuring.
type Row = {
  scope: string;
  tokens: (t: string, m: Mode) => Tokens;
  names: string[];
  on: Surface[];
  min: number;
};

function rows(mode: Mode): Row[] {
  const base = (t: string, m: Mode) => baseTokens(t, m);
  const reset = (t: string, m: Mode) => resetTokens(t, m);
  const card: Surface[] = ["card", "cardSolid"];
  const sides: Surface[] = ["rail", "panel", "panelSolid"];
  const list: Row[] = [
    {
      scope: "card",
      tokens: base,
      names: ["--fg", "--fg2", "--muted"],
      on: card,
      min: 4.5,
    },
    {
      scope: "card",
      tokens: base,
      names: ["--quiet", "--acc"],
      on: card,
      min: 3,
    },
    {
      scope: "reset popover",
      tokens: reset,
      names: ["--fg", "--fg2", "--muted"],
      on: ["popover"],
      min: 4.5,
    },
    {
      scope: "reset popover",
      tokens: reset,
      names: ["--quiet", "--acc"],
      on: ["popover"],
      min: 3,
    },
  ];
  if (mode === "dark") {
    // No chrome scope in dark: the rail and the side panel use the base tokens.
    list.push(
      {
        scope: "rail/panel",
        tokens: base,
        names: ["--fg", "--muted"],
        on: sides,
        min: 4.5,
      },
      {
        scope: "rail/panel",
        tokens: base,
        names: ["--quiet", "--acc"],
        on: sides,
        min: 3,
      },
    );
  } else {
    const chrome = (t: string, m: Mode) => chromeTokens(t, m);
    list.push(
      {
        scope: "chrome",
        tokens: chrome,
        names: ["--fg", "--muted"],
        on: sides,
        min: 4.5,
      },
      {
        scope: "chrome",
        tokens: chrome,
        names: ["--quiet", "--acc"],
        on: sides,
        min: 3,
      },
    );
  }
  return list;
}

function hexes(value: string): RGB[] {
  return (value.match(/#[0-9a-f]{6}/g) ?? []).map(fromHex);
}

function worst(fg: string, bgs: RGB[]): { ratio: number; bg: string } {
  const c = parseColour(fg);
  let best = { ratio: Infinity, bg: "" };
  for (const bg of bgs) {
    const ratio = contrast(over(c, bg), bg);
    if (ratio < best.ratio) best = { ratio, bg: toHex(bg) };
  }
  return best;
}

function failures(theme: string, mode: Mode, reach: Reach): string[] {
  const out: string[] = [];
  const bgs = backgrounds(theme, mode, reach);
  const where = `${theme} ${mode} ${reach}`;
  const check = (
    label: string,
    fg: string,
    on: string,
    list: RGB[],
    min: number,
  ) => {
    const w = worst(fg, list);
    if (!(w.ratio >= min))
      out.push(
        `${where}: ${label} ${fg} on ${on} ${w.bg} is ${w.ratio.toFixed(2)} < ${min}`,
      );
  };

  for (const row of rows(mode)) {
    const tokens = row.tokens(theme, mode);
    for (const name of row.names)
      for (const surface of row.on)
        check(
          `${row.scope} ${name}`,
          tokens[name]!,
          surface,
          bgs[surface],
          row.min,
        );
  }

  // --on-brand on each stop of --grad.
  const base = baseTokens(theme, mode);
  check(
    "--on-brand",
    base["--on-brand"]!,
    "--grad",
    hexes(base["--grad"]!),
    4.5,
  );
  if (mode === "light") {
    const chrome = chromeTokens(theme, mode);
    check(
      "chrome --on-brand",
      chrome["--on-brand"]!,
      "chrome --grad",
      hexes(chrome["--grad"]!),
      4.5,
    );
  }

  // The eight dots on the card, in both dot modes.
  for (const dots of DOT_MODES) {
    const d = dotTokens(theme, mode, dots);
    for (let i = 1; i <= 8; i++)
      for (const surface of ["card", "cardSolid"] as const)
        check(
          `dots=${dots} --hue-${i}`,
          d[`--hue-${i}`]!,
          surface,
          bgs[surface],
          3,
        );
  }
  return out;
}

describe("contrast, every theme × mode × reach (spec §3)", () => {
  for (const t of THEMES)
    for (const mode of MODES)
      for (const reach of REACHES)
        it(`${t.id} ${mode} ${reach}`, () => {
          expect(failures(t.id, mode, reach)).toEqual([]);
        });
});
