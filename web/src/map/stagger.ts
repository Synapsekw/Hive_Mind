/** How long a dot waits before gliding to a new view: outward from the centre in a wave. */
export function staggerDelay(x: number, y: number, i: number): number {
  return Math.min(450, Math.hypot(x - 500, y - 380) * 1.1) + (i % 7) * 12;
}
