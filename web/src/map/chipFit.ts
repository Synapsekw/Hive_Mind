// How many of the filter bar's chips fit in its row; the rest give way to a "+N" chip. Pure
// arithmetic over measured widths, so it is tested without a browser.

export type ChipFitInput = {
  /** Each chip's natural width, px, in order. */
  widths: number[];
  /** The space between chips, px. */
  gap: number;
  /** The row's width, px. */
  room: number;
  /** The "+N" chip's width, px. */
  plus: number;
  /** The least room, px, a chip with a shortened name is shown in rather than counted in "+N". */
  min: number;
};

/** How many chips show, from the start. Every chip after them is counted in the "+N" chip. */
export function chipFit({
  widths,
  gap,
  room,
  plus,
  min,
}: ChipFitInput): number {
  const n = widths.length;
  if (n === 0) return 0;
  const full = widths.reduce((a, w) => a + w, 0) + gap * (n - 1);
  if (full <= room + 0.5) return n;
  // Whole chips that fit with the "+N" chip after them.
  let used = 0;
  let k = 0;
  while (k < n - 1 && used + (k ? gap : 0) + widths[k]! + gap + plus <= room) {
    used += (k ? gap : 0) + widths[k]!;
    k++;
  }
  // Room left for the next chip's start: it shows, its name cut short. The last chip needs no
  // "+N" chip after it.
  const left = room - used - (k ? gap : 0);
  if (k === n - 1 && left >= min) return n;
  if (left - gap - plus >= min) return k + 1;
  return k;
}
