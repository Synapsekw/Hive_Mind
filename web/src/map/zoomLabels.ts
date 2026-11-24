// Semantic zoom: which lit dots get a label because the map is zoomed in (spec 1.2). Runs once a
// pan or zoom settles, never per frame.
export type LabelInput = {
  i: number;
  on: boolean;
  links: number;
  x: number;
  y: number;
  width: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export function zoomLabels(
  dots: LabelInput[],
  k: number,
  stage: { w: number; h: number },
  screen: (x: number, y: number) => [number, number],
  cap = 60,
): Set<number> {
  if (k < 1.8) return new Set();
  const cx = stage.w / 2;
  const cy = stage.h / 2;
  const picked: { i: number; d: number; sx: number; sy: number; w: number }[] =
    [];
  for (const d of dots) {
    if (!d.on) continue;
    if (k < 3 && d.links < 3) continue;
    const [sx, sy] = screen(d.x, d.y);
    if (sx < 0 || sy < 0 || sx > stage.w || sy > stage.h) continue;
    picked.push({
      i: d.i,
      d: (sx - cx) ** 2 + (sy - cy) ** 2,
      sx,
      sy,
      w: d.width,
    });
  }
  picked.sort((a, b) => a.d - b.d || a.i - b.i);
  // Nearest the centre first; a label whose box (right of the dot, 20 px tall) would overlap a
  // placed one is skipped. Linear scan over at most `cap` placed boxes.
  const placed: Box[] = [];
  const out = new Set<number>();
  for (const p of picked) {
    if (out.size >= cap) break;
    const b: Box = {
      x0: p.sx + 6,
      y0: p.sy - 10,
      x1: p.sx + 6 + p.w,
      y1: p.sy + 10,
    };
    if (placed.some((q) => overlaps(q, b))) continue;
    placed.push(b);
    out.add(p.i);
  }
  return out;
}
