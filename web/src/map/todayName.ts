/** The Today button's accessible name: today's writes, and what waits for the person. */
export function todayName(today: number, needs: number): string {
  const base = `Today, ${today} ${today === 1 ? "note" : "notes"} written or changed`;
  if (needs <= 0) return base;
  return `${base}, ${needs} ${needs === 1 ? "needs" : "need"} you`;
}
