// Draws one frame of the map on a 2D canvas context. No React, no DOM writes: MapCanvas owns the
// element and the loop. Geometry that only changes with the scene (edges, comb cells per topic)
// is built once per scene as batched Path2Ds; a frame is a few dozen fills and strokes. Colours
// come from the theme's tokens (readPalette), never from literals; transparency is always
// `globalAlpha`. Line widths and radii are divided by the scale, so they keep their screen size.
import type { Cam } from "./camera";
import { size } from "./nodeShape";
import type { Scene } from "./scene";
import type { MapModel, ModelNode, View } from "./types";

export type FrameState = {
  view: View;
  cam: Cam; // stage pixels
  world: { w: number; h: number }; // box fitted at k = 1
  pos: [number, number][]; // current (possibly tweening) positions
  lit: boolean[]; // filter/search/selection result (10% dim when false)
  soft: Set<number> | null; // preview/hover soft-dim keep-set (32% outside), null = none
  hot: number | null;
  sel: number | null;
  focusRing: number | null; // keyboard-focused dot
  labels: Set<number>;
  marks: Map<number, { state: "live" | "today" | "idle" }>; // agent node -> mark state (Hive)
  pulses: {
    from: number;
    to: number;
    t0: number;
    colour: string;
    dur: number;
  }[];
  flares: Map<number, number>; // comb cell node -> flare start time
  time: number; // performance.now() for animations
  reducedMotion: boolean;
  /** The camera is moving (wheel, drag, glide): the resting layer is moved, not redrawn. */
  moving?: boolean;
};

export type Palette = {
  hue: string[];
  fg: string;
  fg2: string;
  bg: string;
  brand: string;
  line: string;
  lineHi: string;
  edge: string;
  accent: string;
};

const TAU = Math.PI * 2;
const SQ2 = Math.SQRT2;
const FLARE_MS = 1400;
const LABEL_MAX = 220;

/** The theme's colours, read once per theme change (getComputedStyle is not free). */
export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    hue: Array.from({ length: 8 }, (_, i) => v(`--hue-${i + 1}`)),
    fg: v("--fg"),
    fg2: v("--fg2"),
    bg: v("--bg"),
    brand: v("--brand"),
    line: v("--line"),
    lineHi: v("--line-hi"),
    edge: v("--edge"),
    accent: v("--acc"),
  };
}

// ---- Per-scene cache ----

type TopicPath = { topic: number; path: Path2D };
type SceneCache = {
  edges: Path2D;
  combFill: { topic: number; alpha: number; path: Path2D }[];
  combStroke: TopicPath[];
  capped: TopicPath[];
  hubs: TopicPath[];
  empty: Path2D;
  root: Path2D | null;
  hexR: number;
  cellOf: Map<number, number>; // node -> index in scene.combCells
  dimCells: WeakMap<boolean[], Path2D>;
  softCells: WeakMap<Set<number>, Path2D>;
  litEdges: WeakMap<boolean[], Path2D>;
  filtered: WeakMap<boolean[], boolean>;
};

const caches = new WeakMap<Scene, SceneCache>();

/** A pointy-top hexagon (the comb's orientation) of circumradius r, added to `p`. */
function hex(p: Path2D, x: number, y: number, r: number, turn = Math.PI / 6) {
  for (let i = 0; i < 6; i++) {
    const a = turn + (i * Math.PI) / 3;
    const hx = x + r * Math.cos(a);
    const hy = y + r * Math.sin(a);
    if (i === 0) p.moveTo(hx, hy);
    else p.lineTo(hx, hy);
  }
  p.closePath();
}

function cacheFor(scene: Scene): SceneCache {
  const hit = caches.get(scene);
  if (hit) return hit;
  const edges = new Path2D();
  const e = scene.edges;
  for (let i = 0; i < e.length; i += 4) {
    edges.moveTo(e[i]!, e[i + 1]!);
    edges.lineTo(e[i + 2]!, e[i + 3]!);
  }
  // One hex per cell, appended straight into its batch (the same as addPath of one translated hex).
  const hexR = Math.max(0.5, scene.combSize - 1.2);
  const fills = new Map<
    string,
    { topic: number; alpha: number; path: Path2D }
  >();
  const strokes = new Map<number, Path2D>();
  const capped = new Map<number, Path2D>();
  const hubs = new Map<number, Path2D>();
  const empty = new Path2D();
  let root: Path2D | null = null;
  const cellOf = new Map<number, number>();
  const get = (m: Map<number, Path2D>, t: number) => {
    let p = m.get(t);
    if (!p) m.set(t, (p = new Path2D()));
    return p;
  };
  scene.combCells.forEach((c, i) => {
    if (c.node !== null) cellOf.set(c.node, i);
    if (c.kind === "empty") return hex(empty, c.x, c.y, hexR);
    if (c.kind === "root") {
      root = new Path2D();
      return hex(root, c.x, c.y, hexR);
    }
    if (c.capped) return hex(get(capped, c.topic), c.x, c.y, hexR);
    // Fill alphas in steps of 0.05, so a topic is a handful of fills rather than one per cell.
    const alpha = Math.max(0.05, Math.round(c.honey / 0.05) * 0.05);
    const key = `${c.topic}|${alpha}`;
    let f = fills.get(key);
    if (!f) fills.set(key, (f = { topic: c.topic, alpha, path: new Path2D() }));
    hex(f.path, c.x, c.y, hexR);
    hex(get(strokes, c.topic), c.x, c.y, hexR);
    if (c.kind === "hub") hex(get(hubs, c.topic), c.x, c.y, hexR);
  });
  const list = (m: Map<number, Path2D>): TopicPath[] =>
    [...m].map(([topic, path]) => ({ topic, path }));
  const out: SceneCache = {
    edges,
    combFill: [...fills.values()],
    combStroke: list(strokes),
    capped: list(capped),
    hubs: list(hubs),
    empty,
    root,
    hexR,
    cellOf,
    dimCells: new WeakMap(),
    softCells: new WeakMap(),
    litEdges: new WeakMap(),
    filtered: new WeakMap(),
  };
  caches.set(scene, out);
  return out;
}

function isFiltered(c: SceneCache, lit: boolean[]): boolean {
  let v = c.filtered.get(lit);
  if (v === undefined) {
    v = lit.some((on) => !on);
    c.filtered.set(lit, v);
  }
  return v;
}

/** The comb cells whose item is outside `keep`, as one path (cached per keep-set). */
function cellsOutside(
  scene: Scene,
  c: SceneCache,
  keep: (node: number) => boolean,
): Path2D {
  const p = new Path2D();
  for (const cell of scene.combCells)
    if (cell.node !== null && cell.kind !== "root" && !keep(cell.node))
      hex(p, cell.x, cell.y, c.hexR + 0.6);
  return p;
}

// ---- Text ----

const fonts = new WeakMap<HTMLCanvasElement | OffscreenCanvas, string>();
function family(ctx: CanvasRenderingContext2D): string {
  let f = fonts.get(ctx.canvas);
  if (f === undefined) {
    f =
      typeof getComputedStyle === "function" && "style" in ctx.canvas
        ? getComputedStyle(ctx.canvas as HTMLCanvasElement).fontFamily ||
          "sans-serif"
        : "sans-serif";
    fonts.set(ctx.canvas, f);
  }
  return f;
}

const fitted = new Map<string, { text: string; w: number }>();
/** The title cut to `max` px with an ellipsis, measured once per font and title. */
function fit(
  ctx: CanvasRenderingContext2D,
  font: string,
  title: string,
  max: number,
): { text: string; w: number } {
  const key = `${font}\u0000${title}`;
  const hit = fitted.get(key);
  if (hit) return hit;
  if (fitted.size > 20_000) fitted.clear();
  let text = title;
  let w = ctx.measureText(text).width;
  if (w > max) {
    let lo = 0;
    let hi = title.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(`${title.slice(0, mid)}…`).width <= max) lo = mid;
      else hi = mid - 1;
    }
    text = `${title.slice(0, lo).trimEnd()}…`;
    w = ctx.measureText(text).width;
  }
  const out = { text, w };
  fitted.set(key, out);
  return out;
}

// ---- The resting layer's bitmap, one per target context ----

type Layer = {
  canvas: HTMLCanvasElement;
  scene: Scene | null;
  pal: Palette | null;
  lit: boolean[] | null;
  soft: Set<number> | null;
  busy: boolean;
  marks: FrameState["marks"] | null;
  dpr: number;
  ww: number;
  k: number;
  tx: number;
  ty: number;
};
const layers = new WeakMap<CanvasRenderingContext2D, Layer>();
function layerFor(ctx: CanvasRenderingContext2D): Layer {
  let l = layers.get(ctx);
  if (!l) {
    l = {
      canvas: document.createElement("canvas"),
      scene: null,
      pal: null,
      lit: null,
      soft: null,
      busy: false,
      marks: null,
      dpr: 0,
      ww: 0,
      k: 1,
      tx: 0,
      ty: 0,
    };
    layers.set(ctx, l);
  }
  return l;
}

// ---- The frame ----

type Kind = "note" | "file" | "lnote" | "lfile" | "hub";

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  scene: Scene,
  model: MapModel,
  f: FrameState,
  pal: Palette,
): boolean {
  const cssW = ctx.canvas.width / dpr;
  const cssH = ctx.canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.clearRect(0, 0, cssW, cssH);
  if (f.view === "orbit") return false;

  const s = (f.world.w / 1000) * f.cam.k;
  const px = 1 / s;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * f.cam.tx, dpr * f.cam.ty);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const c = cacheFor(scene);
  const hive = f.view === "hive";
  const t = f.time;
  const still = f.reducedMotion;
  let anim = false;
  const T = Math.max(1, model.topics.length);
  const hueOf = (topic: number) =>
    pal.hue[model.topics[topic]?.hue ?? -1] ?? pal.fg2;
  const colourOf = (n: ModelNode) => (n.topic >= 0 ? hueOf(n.topic) : pal.fg2);
  const filtered = isFiltered(c, f.lit);
  const small = scene.combSize > 0 && scene.combSize < 10;
  const strong = (i: number) => i === f.hot || i === f.focusRing || i === f.sel;
  const alphaOf = (i: number) =>
    strong(i) ? 1 : !f.lit[i] ? 0.1 : f.soft && !f.soft.has(i) ? 0.32 : 1;
  /** Diameter in screen px. */
  const diam = (n: ModelNode) => {
    if (!hive) return size(n);
    if (n.kind === "hub") return small ? 8 : 11;
    if (n.kind === "note" || n.kind === "file") return small ? 4 : 6;
    if (n.kind === "root") return small ? 14 : 22;
    return 12;
  };
  const P = (i: number): [number, number] => f.pos[i] ?? [500, 380];

  const busy = f.hot !== null || f.sel !== null || filtered;

  /** The resting layer: comb, guides and resting edges, drawn into `g` at the current camera. */
  const drawStatic = (g: CanvasRenderingContext2D) => {
    g.lineCap = "round";
    g.lineJoin = "round";
    // -- Comb --
    if (scene.combCells.length) {
      for (const b of c.combFill) {
        g.globalAlpha = b.alpha;
        g.fillStyle = hueOf(b.topic);
        g.fill(b.path);
      }
      g.lineWidth = px;
      g.globalAlpha = 0.28;
      for (const b of c.combStroke) {
        g.strokeStyle = hueOf(b.topic);
        g.stroke(b.path);
      }
      g.globalAlpha = 1;
      g.strokeStyle = pal.line;
      g.stroke(c.empty);
      if (c.root) {
        g.globalAlpha = 0.22;
        g.fillStyle = pal.brand;
        g.fill(c.root);
      }
      g.setLineDash([2 * px, 2 * px]);
      for (const b of c.capped) {
        g.globalAlpha = 1;
        g.fillStyle = pal.bg;
        g.fill(b.path);
        g.globalAlpha = 0.8;
        g.strokeStyle = hueOf(b.topic);
        g.stroke(b.path);
      }
      g.setLineDash([]);
      g.lineWidth = 1.5 * px;
      g.globalAlpha = 0.9;
      for (const b of c.hubs) {
        g.strokeStyle = hueOf(b.topic);
        g.stroke(b.path);
      }
      // Cells outside the filter (or the soft keep-set) drop to a near-empty frame.
      g.fillStyle = pal.bg;
      if (filtered) {
        let p = c.dimCells.get(f.lit);
        if (!p) {
          const lit = f.lit;
          p = cellsOutside(scene, c, (n) => !!lit[n]);
          c.dimCells.set(lit, p);
        }
        g.globalAlpha = 0.8;
        g.fill(p);
      }
      if (f.soft) {
        let p = c.softCells.get(f.soft);
        if (!p) {
          const soft = f.soft;
          p = cellsOutside(scene, c, (n) => soft.has(n));
          c.softCells.set(soft, p);
        }
        g.globalAlpha = 0.55;
        g.fill(p);
      }
      if (scene.entrance) {
        const [ex, ey] = scene.entrance;
        const idle = scene.agents.filter(
          (i) => (f.marks.get(i)?.state ?? "idle") === "idle",
        ).length;
        const r = Math.max(14, idle * 9 + 6);
        g.globalAlpha = 1;
        g.lineWidth = px;
        g.strokeStyle = pal.line;
        g.beginPath();
        g.arc(ex, ey + 6, r, Math.PI, TAU);
        g.stroke();
      }
    }

    // -- Guides --
    g.globalAlpha = 1;
    g.lineWidth = px;
    g.strokeStyle = pal.line;
    if (scene.guides.rings.length || scene.guides.axis) {
      g.beginPath();
      for (const r of scene.guides.rings) {
        g.moveTo(500 + r, 380);
        g.arc(500, 380, r, 0, TAU);
      }
      const ax = scene.guides.axis;
      if (ax) {
        g.moveTo(ax[0], ax[2]);
        g.lineTo(ax[1], ax[2]);
      }
      g.stroke();
    }

    // -- Edges: none at rest in Hive; the timeline draws only the focused links --
    if (!hive && f.view !== "timeline") {
      g.strokeStyle = pal.edge;
      g.lineWidth = 0.6 * px;
      g.globalAlpha = busy ? 0.08 : f.view === "links" ? 0.55 : 0.3;
      g.stroke(c.edges);
      if (filtered && f.sel === null && f.hot === null) {
        let p = c.litEdges.get(f.lit);
        if (!p) {
          p = new Path2D();
          for (const [u, v] of model.edges)
            if (f.lit[u] && f.lit[v]) {
              const a = P(u);
              const b = P(v);
              p.moveTo(a[0], a[1]);
              p.lineTo(b[0], b[1]);
            }
          c.litEdges.set(f.lit, p);
        }
        g.globalAlpha = 0.55;
        g.lineWidth = 0.8 * px;
        g.stroke(p);
      }
    }
  };

  // The resting layer is kept as a bitmap and redrawn only when what it shows changes, or once
  // the camera stops. While the camera moves, the last bitmap moves and scales with it, so a zoom
  // frame is one drawImage instead of thousands of anti-aliased strokes.
  const L = layerFor(ctx);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cam = f.cam;
  const same =
    L.scene === scene &&
    L.pal === pal &&
    L.lit === f.lit &&
    L.soft === f.soft &&
    L.busy === busy &&
    L.marks === f.marks &&
    L.canvas.width === W &&
    L.canvas.height === H &&
    L.dpr === dpr &&
    L.ww === f.world.w;
  const camSame = same && L.k === cam.k && L.tx === cam.tx && L.ty === cam.ty;
  if (!same || (!camSame && !f.moving)) {
    if (L.canvas.width !== W) L.canvas.width = W;
    if (L.canvas.height !== H) L.canvas.height = H;
    const g = L.canvas.getContext("2d");
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.clearRect(0, 0, W, H);
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * cam.tx, dpr * cam.ty);
      drawStatic(g);
    }
    Object.assign(L, {
      scene,
      pal,
      lit: f.lit,
      soft: f.soft,
      busy,
      marks: f.marks,
      dpr,
      ww: f.world.w,
      k: cam.k,
      tx: cam.tx,
      ty: cam.ty,
    });
  } else if (!camSame) anim = true; // redraw it crisp once the camera stops
  const r = cam.k / L.k;
  ctx.setTransform(
    r,
    0,
    0,
    r,
    dpr * (cam.tx - L.tx * r),
    dpr * (cam.ty - L.ty * r),
  );
  ctx.globalAlpha = 1;
  ctx.drawImage(L.canvas, 0, 0);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * cam.tx, dpr * cam.ty);

  if (scene.combCells.length) {
    // Flares: a cell's honey brightens to 0.9 and fades back over 1.4 s.
    for (const [node, t0] of f.flares) {
      const p = (t - t0) / FLARE_MS;
      const ci = c.cellOf.get(node);
      if (p >= 1 || ci === undefined) continue;
      anim = true;
      if (p < 0) continue;
      const cell = scene.combCells[ci]!;
      const path = new Path2D();
      hex(path, cell.x, cell.y, c.hexR);
      ctx.globalAlpha = cell.honey + (0.9 - cell.honey) * (1 - p);
      ctx.fillStyle = hueOf(cell.topic);
      ctx.fill(path);
    }
  }

  // The hot and selected dots' own links, in their colour.
  for (const i of new Set([f.sel, f.hot])) {
    if (i === null) continue;
    const n = model.nodes[i];
    if (!n) continue;
    const [x, y] = P(i);
    ctx.beginPath();
    for (const j of n.nb) {
      const b = P(j);
      ctx.moveTo(x, y);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = colourOf(n);
    ctx.stroke();
  }

  // -- Pulses: a 7%-long segment of light running along a link --
  for (const p of f.pulses) {
    const k = (t - p.t0) / p.dur;
    if (k >= 1) continue;
    anim = true;
    if (k < 0) continue;
    const a = P(p.from);
    const b = P(p.to);
    const k0 = Math.max(0, k - 0.035);
    const k1 = Math.min(1, k + 0.035);
    const ambient = p.colour === pal.brand;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.colour;
    ctx.shadowColor = p.colour;
    ctx.shadowBlur = 6;
    ctx.lineWidth = (ambient ? 1.4 : 2.2) * px;
    ctx.beginPath();
    ctx.moveTo(a[0] + (b[0] - a[0]) * k0, a[1] + (b[1] - a[1]) * k0);
    ctx.lineTo(a[0] + (b[0] - a[0]) * k1, a[1] + (b[1] - a[1]) * k1);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // -- Core swarm: last-24h writes, breathing; gone once zoomed in --
  if (scene.core.length && f.cam.k <= 1.8) {
    if (!still) anim = true;
    ctx.globalAlpha = still ? 0.8 : 0.8 + 0.2 * Math.sin((TAU * t) / 4000);
    ctx.fillStyle = pal.brand;
    ctx.beginPath();
    for (const [x, y] of scene.core) {
      ctx.moveTo(x + 1.2 * px, y);
      ctx.arc(x, y, 1.2 * px, 0, TAU);
    }
    ctx.fill();
  }

  // -- Timeline ticks --
  if (scene.ticks.length) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = pal.fg2;
    ctx.beginPath();
    for (const [x, y] of scene.ticks) {
      ctx.moveTo(x + 2 * px, y);
      ctx.arc(x, y, 2 * px, 0, TAU);
    }
    ctx.fill();
  }

  // -- Dots, batched per topic, kind and alpha --
  const shapePath = (
    path: Path2D,
    kind: Kind,
    x: number,
    y: number,
    r: number,
  ) => {
    if (kind === "file" || kind === "lfile") {
      const h = r * SQ2;
      path.moveTo(x, y - h);
      path.lineTo(x + h, y);
      path.lineTo(x, y + h);
      path.lineTo(x - h, y);
      path.closePath();
    } else {
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, TAU);
    }
  };
  const kindOf = (n: ModelNode): Kind =>
    n.kind === "hub"
      ? "hub"
      : n.locked
        ? n.kind === "file"
          ? "lfile"
          : "lnote"
        : n.kind === "file"
          ? "file"
          : "note";

  /** One group of same-kind, same-colour, same-alpha dots, drawn with one fill per layer. */
  const drawGroup = (
    kind: Kind,
    colour: string,
    alpha: number,
    nodes: number[],
    scale: number,
    glow: number,
    topic: number,
  ) => {
    const at = (r: (i: number) => number) => {
      const p = new Path2D();
      for (const i of nodes) {
        const [x, y] = P(i);
        shapePath(p, kind, x, y, r(i));
      }
      return p;
    };
    const rad = (i: number) => (diam(model.nodes[i]!) / 2) * scale * px;
    if (kind === "hub") {
      // A 1.5 px topic ring outside a 2 px card-coloured ring, with a soft breathing glow.
      const outer = at((i) => rad(i) + 1.5 * px);
      const blur = still ? 14 : 19 + 5 * Math.sin(TAU * (t / 5000 + topic / T));
      if (!still) anim = true;
      ctx.fillStyle = colour;
      ctx.shadowColor = colour;
      ctx.shadowBlur = glow || blur;
      ctx.globalAlpha = 0.35 * alpha;
      ctx.fill(outer);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha;
      ctx.fill(outer);
      ctx.fillStyle = pal.bg;
      ctx.fill(at(rad));
      ctx.fillStyle = colour;
      ctx.fill(at((i) => Math.max(0.5 * px, rad(i) - 2 * px)));
      return;
    }
    ctx.globalAlpha = alpha;
    if (glow) {
      ctx.shadowColor = colour;
      ctx.shadowBlur = glow;
    }
    if (kind === "lnote" || kind === "lfile") {
      const p = at((i) => rad(i) - 0.6 * px);
      ctx.fillStyle = pal.bg;
      ctx.fill(p);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.2 * px;
      ctx.stroke(p);
    } else {
      ctx.fillStyle = colour;
      ctx.fill(at(rad));
    }
    ctx.shadowBlur = 0;
  };

  const near = new Set<number>(
    f.hot !== null ? (model.nodes[f.hot]?.nb ?? []) : [],
  );
  const special = (i: number) => i === f.hot || near.has(i);
  scene.byTopic.forEach((nodes, topic) => {
    const colour = hueOf(topic);
    const groups = new Map<string, { kind: Kind; a: number; n: number[] }>();
    for (const i of nodes) {
      if (special(i)) continue;
      const n = model.nodes[i]!;
      const kind = kindOf(n);
      const theirs =
        !n.mine && !n.locked && (n.kind === "note" || n.kind === "file");
      const a = alphaOf(i) * (theirs ? 0.72 : 1);
      const key = `${kind}|${a}`;
      const g = groups.get(key);
      if (g) g.n.push(i);
      else groups.set(key, { kind, a, n: [i] });
    }
    // Plain dots first, hubs on top.
    for (const g of [...groups.values()].sort(
      (x, y) => +(x.kind === "hub") - +(y.kind === "hub"),
    ))
      drawGroup(g.kind, colour, g.a, g.n, 1, 0, topic);
  });

  /** Agents: a ring with a centre point, or in Hive a hexagon mark by state. */
  const drawAgent = (i: number, scale: number, glow: number) => {
    const n = model.nodes[i]!;
    const [x, y] = P(i);
    const a = alphaOf(i);
    if (hive) {
      const state = f.marks.get(i)?.state ?? "idle";
      const p = new Path2D();
      hex(p, x, y, 6 * scale * px, -Math.PI / 2);
      ctx.globalAlpha = a * (state === "idle" ? 0.4 : 1);
      ctx.fillStyle = pal.bg;
      ctx.fill(p);
      ctx.strokeStyle = pal.brand;
      ctx.lineWidth = 1.6 * px;
      if (glow) {
        ctx.shadowColor = pal.brand;
        ctx.shadowBlur = glow;
      }
      ctx.stroke(p);
      ctx.shadowBlur = 0;
      if (state === "live") {
        if (!still) anim = true;
        ctx.shadowColor = pal.brand;
        ctx.shadowBlur = still ? 7 : 7 + 5 * Math.sin((TAU * t) / 2600);
        ctx.fillStyle = pal.brand;
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * scale * px, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (state === "today") {
        ctx.fillStyle = pal.fg2;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 * scale * px, 0, TAU);
        ctx.fill();
      }
      return;
    }
    const r = (size(n) / 2) * scale * px;
    ctx.globalAlpha = a;
    if (glow) {
      ctx.shadowColor = pal.fg2;
      ctx.shadowBlur = glow;
    }
    ctx.fillStyle = pal.bg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = pal.fg2;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(x, y, r - 0.75 * px, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = pal.fg2;
    ctx.beginPath();
    ctx.arc(x, y, 2 * scale * px, 0, TAU);
    ctx.fill();
  };
  for (const i of scene.agents) if (!special(i)) drawAgent(i, 1, 0);

  /** The index: a hexagon turning once every 30 s. */
  const drawRoot = (scale: number, glow: number) => {
    const n = model.nodes[scene.root];
    if (!n) return;
    const [x, y] = P(scene.root);
    if (!still) anim = true;
    const turn = still ? 0 : (TAU * (t % 30_000)) / 30_000;
    const p = new Path2D();
    hex(p, x, y, (diam(n) / 2) * scale * px, turn);
    ctx.globalAlpha = alphaOf(scene.root);
    ctx.fillStyle = hive ? pal.brand : pal.fg;
    if (glow) {
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = glow;
    }
    ctx.fill(p);
    ctx.shadowBlur = 0;
  };
  if (!special(scene.root)) drawRoot(1, 0);

  /** One node on its own (hot, or a neighbour of the hot dot), optionally scaled and glowing. */
  const drawOne = (i: number, scale: number, glow: number) => {
    const n = model.nodes[i];
    if (!n) return;
    if (n.kind === "agent") return drawAgent(i, scale, glow);
    if (n.kind === "root") return drawRoot(scale, glow);
    const theirs =
      !n.mine && !n.locked && (n.kind === "note" || n.kind === "file");
    drawGroup(
      kindOf(n),
      colourOf(n),
      alphaOf(i) * (theirs && i !== f.hot ? 0.72 : 1),
      [i],
      scale,
      glow,
      n.topic,
    );
  };
  let budget = 400;
  for (const i of near) if (i !== f.hot && budget-- > 0) drawOne(i, 1, 10);
  if (f.hot !== null && model.nodes[f.hot]) {
    const n = model.nodes[f.hot]!;
    const [x, y] = P(f.hot);
    // A 2 px card-coloured ring under the grown shape.
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.bg;
    ctx.beginPath();
    ctx.arc(x, y, ((diam(n) / 2) * 1.7 + 2) * px, 0, TAU);
    ctx.fill();
    drawOne(f.hot, 1.7, 14);
  }

  // -- Rings: the selection (3 px gap, 1.5 px text colour) and keyboard focus (2 px accent) --
  const ring = (i: number, gap: number, w: number, colour: string) => {
    const n = model.nodes[i];
    if (!n) return;
    const [x, y] = P(i);
    const r = (diam(n) / 2) * (i === f.hot ? 1.7 : 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = w * px;
    ctx.beginPath();
    ctx.arc(x, y, (r + gap + w / 2) * px, 0, TAU);
    ctx.stroke();
  };
  if (f.sel !== null) ring(f.sel, 3, 1.5, pal.fg);
  if (f.focusRing !== null) ring(f.focusRing, 2, 2, pal.accent);

  // -- Labels, in screen space so text stays crisp at every zoom --
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textBaseline = "middle";
  const fam = family(ctx);
  const sx = (x: number) => x * s + f.cam.tx;
  const sy = (y: number) => y * s + f.cam.ty;

  if (scene.guideLabels.length) {
    const font = `500 10px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.font = font;
    for (const g of scene.guideLabels) {
      const m = fit(ctx, font, g.text.toUpperCase(), LABEL_MAX);
      const x = sx(g.x) - (g.align === "centre" ? m.w / 2 : 0);
      const y = sy(g.y);
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = pal.bg;
      ctx.beginPath();
      ctx.roundRect(x - 6, y - 8, m.w + 12, 16, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.fg2;
      ctx.fillText(m.text, x, y + 0.5);
    }
  }

  for (const i of f.labels) {
    const n = model.nodes[i];
    if (!n) continue;
    const [bx, by] = P(i);
    const x = sx(bx);
    const y = sy(by);
    if (x < -LABEL_MAX || y < -20 || x > cssW + LABEL_MAX || y > cssH + 20)
      continue;
    const weight = n.kind === "hub" || i === f.sel ? 600 : 400;
    const font = `${weight} 12px ${fam}`;
    ctx.font = font;
    const m = fit(ctx, font, n.title, LABEL_MAX - 12);
    const r = (diam(n) / 2) * (i === f.hot ? 1.7 : 1);
    const w = m.w + 12;
    const lx = bx > 760 ? x - r - 6 - w : x + r + 6;
    const a = alphaOf(i);
    ctx.globalAlpha = 0.84 * a;
    ctx.fillStyle = pal.bg;
    ctx.beginPath();
    ctx.roundRect(lx, y - 9, w, 18, 6);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = pal.fg;
    ctx.fillText(m.text, lx + 6, y + 0.5);
  }
  ctx.globalAlpha = 1;
  return anim;
}
