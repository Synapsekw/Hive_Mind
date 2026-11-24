const n = (v: number) => v.toLocaleString("en-US");

/** The one count in the map's bar. */
export function countText(c: {
  shown: number;
  total: number;
  active: boolean;
  truncated: boolean;
}): string {
  if (c.active) return `${n(c.shown)} of ${n(c.total)} shown`;
  if (c.truncated) return `${n(c.total)} most recent items`;
  return `${n(c.total)} ${c.total === 1 ? "item" : "items"}`;
}
