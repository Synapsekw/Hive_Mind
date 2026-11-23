// The side panel's 14-day line of agent writes.
import type { Activity } from "./types";

export function daySeries(act: Activity, days = 14): number[] {
  const out = new Array<number>(days).fill(0);
  for (const d of act.days)
    if (d.day >= 0 && d.day < days) out[d.day]! += d.count;
  return out;
}

/** 4 px of headroom at the top; the baseline is the bottom edge. */
export function sparkPath(series: number[], w: number, h: number) {
  const max = Math.max(1, ...series);
  const n = Math.max(1, series.length - 1);
  const pts = series.map(
    (v, i) => [(i / n) * w, h - (v / max) * (h - 10)] as const,
  );
  const line = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join("");
  return { line, area: `${line}L${w} ${h}L0 ${h}Z` };
}
