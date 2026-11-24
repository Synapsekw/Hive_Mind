// A theme's swatch: its card colour and the fresh end of its ramp. The stylesheet only exposes
// the current theme's colours, so the panel reads every theme's record from themes.json (the
// colours live there, not here).
import data from "../theme/themes.json";

const RECORDS = new Map(data.themes.map((t) => [t.id, t]));

export function swatch(theme: string): string {
  const t = RECORDS.get(theme) ?? data.themes[0]!;
  return `linear-gradient(135deg, ${t.card} 0 50%, ${t.ramp[2]} 50% 100%)`;
}
