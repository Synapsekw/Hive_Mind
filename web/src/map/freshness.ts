// How fresh an item is, as a level the renderer turns into a ramp colour and a halo. Pure.
const DAY_MS = 86_400_000;

export const FRESH_LEVELS = 8;

/** 0 (oldest) to 7 (changed in the last two days). A time of 0 or in the future of `now` counts as level 0 and 7. */
export function freshLevel(updatedAt: number, now: number): number {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 0;
  const days = (now - updatedAt) / DAY_MS;
  if (days <= 2) return 7;
  return Math.max(0, Math.min(6, Math.floor(7.4 * Math.exp(-days / 26))));
}
