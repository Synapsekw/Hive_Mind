// A theme's swatch: its brand to brand2 gradient in the given mode. The stylesheet only exposes
// the current theme's brand, so the panel reads every theme's seeds from themes.json (the
// colours live there, not here).
import data from "../theme/themes.json";
import type { Mode } from "../theme/look";

const SEEDS = new Map(data.themes.map((t) => [t.id, t]));

export function swatch(theme: string, mode: Mode): string {
  const t = SEEDS.get(theme) ?? data.themes[0]!;
  const s = t[mode];
  return `linear-gradient(135deg, ${s.brand}, ${s.brand2})`;
}
