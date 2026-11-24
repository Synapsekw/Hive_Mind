// Draws one frame of the map on a 2D canvas context. No React, no DOM writes: MapCanvas owns the
// element and the loop. Geometry that only changes with the scene (the edges) is built once per
// scene as batched Path2Ds; a frame is a few dozen fills and strokes. Colours
// come from the theme's tokens (readPalette), never from literals; transparency is always
// `globalAlpha`. Line widths and radii are divided by the scale, so they keep their screen size.
import type { Cam } from "./camera";
import { size } from "./nodeShape";
import { orbitAlpha, type OrbitProjection } from "./orbit3d";
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
  pulses: Pulse[];
  time: number; // performance.now() for animations
  reducedMotion: boolean;
  /** The camera is moving (wheel, drag, glide): the resting layer is moved, not redrawn. */
  moving?: boolean;
  /**
   * New dots growing in after a refresh: one shared scale (0 to 1) for one set of nodes. The set
   * keeps its identity for the whole growth, so the dot batches are rebuilt once, not per frame.
   */
  grow?: { nodes: Set<number>; k: number } | null;
  /** The resting layer's opacity (it fades in while the dots glide to a new view). */
  layerAlpha?: number;
  /** Orbit only: this frame's projection of the 3D positions (orbit3d.ts). */
  orbit?: OrbitProjection | null;
};

export type Pulse = {
  from: number;
  to: number;
  t0: number;
  colour: string;
  dur: number;
  /** A faint ambient pulse (brand colour, thinner): calm, drawn at the ambient rate. */
  ambient?: boolean;
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

type SceneCache = {
  edges: Path2D;
  litEdges: WeakMap<boolean[], Path2D>;
  filtered: WeakMap<boolean[], boolean>;
};

const caches = new WeakMap<Scene, SceneCache>();

/** A hexagon of circumradius r, turned by `turn` (radians), added to `p`. */
function hex(p: Path2D, x: number, y: number, r: number, turn: number) {
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
  const out: SceneCache = {
    edges,
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

/** Forget measured label widths (call when web fonts finish loading: the widths change). */
export function clearTextCache(): void {
  fitted.clear();
}

// ---- The frame ----

/**
 * What a frame leaves running: "motion" (a glide, drag, zoom or pulse: draw again on the
 * next animation frame), "ambient" (only the calm breathing and turning: a throttled ~12 fps is
 * enough) or false (nothing: draw again only when something changes).
 */
export type Animating = false | "ambient" | "motion";

type Kind = "note" | "file" | "lnote" | "lfile" | "hub";

/** Everything one frame's drawing functions share. */
type Frame = {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  scene: Scene;
  model: MapModel;
  f: FrameState;
  pal: Palette;
  c: SceneCache;
  s: number; // box units -> css px
  px: number; // one css px in box units
  cssW: number;
  cssH: number;
  still: boolean;
  T: number;
  filtered: boolean;
  busy: boolean;
  near: Set<number>;
  motion: boolean;
  ambient: boolean;
  /** Labels past this x (in `pos` units) sit on the dot's left. */
  flipX: number;
  /** Orbit: perspective per node (dots grow near, shrink far), else null. */
  depth: Float32Array | null;
};

const CENTRE: [number, number] = [500, 380];
const P = (F: Frame, i: number): [number, number] => F.f.pos[i] ?? CENTRE;
const hueOf = (F: Frame, topic: number) =>
  F.pal.hue[F.model.topics[topic]?.hue ?? -1] ?? F.pal.fg2;
const colourOf = (F: Frame, n: ModelNode) =>
  n.topic >= 0 ? hueOf(F, n.topic) : F.pal.fg2;
const strong = (F: Frame, i: number) =>
  i === F.f.hot || i === F.f.focusRing || i === F.f.sel;
const alphaOf = (F: Frame, i: number) =>
  strong(F, i)
    ? 1
    : !F.f.lit[i]
      ? 0.1
      : F.f.soft && !F.f.soft.has(i)
        ? 0.32
        : 1;
const theirs = (n: ModelNode) =>
  !n.mine && !n.locked && (n.kind === "note" || n.kind === "file");

/** A dot's drawn diameter in screen px. */
export function dotDiameter(n: ModelNode): number {
  return size(n);
}

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

function shapePath(path: Path2D, kind: Kind, x: number, y: number, r: number) {
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
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  scene: Scene,
  model: MapModel,
  f: FrameState,
  pal: Palette,
): Animating {
  const cssW = ctx.canvas.width / dpr;
  const cssH = ctx.canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.clearRect(0, 0, cssW, cssH);
  if (f.view === "orbit") {
    if (!f.orbit) return false;
    return drawOrbit(ctx, dpr, scene, model, f, f.orbit, pal, cssW, cssH);
  }

  const s = (f.world.w / 1000) * f.cam.k;
  const c = cacheFor(scene);
  const filtered = isFiltered(c, f.lit);
  const F: Frame = {
    ctx,
    dpr,
    scene,
    model,
    f,
    pal,
    c,
    s,
    px: 1 / s,
    cssW,
    cssH,
    still: f.reducedMotion,
    T: Math.max(1, model.topics.length),
    filtered,
    busy: f.hot !== null || f.sel !== null || filtered,
    near: new Set(f.hot !== null ? (model.nodes[f.hot]?.nb ?? []) : []),
    motion: false,
    ambient: false,
    flipX: 760,
    depth: null,
  };

  drawLayer(F);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * f.cam.tx, dpr * f.cam.ty);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  drawFocusLinks(F);
  drawPulses(F);
  drawCore(F);
  drawTicks(F);
  drawDots(F);
  for (const i of scene.agents) if (!special(F, i)) drawAgent(F, i, 1, 0);
  if (!special(F, scene.root)) drawRoot(F, 1, 0);
  drawGrowing(F);
  drawHot(F);
  drawRings(F);
  drawLabels(F);
  ctx.globalAlpha = 1;
  return F.motion ? "motion" : F.ambient ? "ambient" : false;
}

/** Dots new in a refreshed payload, growing from nothing to their size. */
function drawGrowing(F: Frame) {
  const g = F.f.grow;
  if (!g) return;
  for (const i of g.nodes)
    if (i !== F.f.hot && !F.near.has(i)) drawOne(F, i, g.k, 0);
}

const IDENTITY: Cam = { k: 1, tx: 0, ty: 0 };
const KINDS: Kind[] = ["note", "file", "lnote", "lfile", "hub"];
const KIND_INDEX: Record<Kind, number> = {
  note: 0,
  file: 1,
  lnote: 2,
  lfile: 3,
  hub: 4,
};
/** drawOrbit's per-frame lists, kept between frames so a turning orbit makes little garbage. */
const orbitScratch = {
  lists: new Map<number, number[]>(),
  used: [] as number[],
  loose: [] as number[],
};
/** Depth slices in Orbit: dots are batched within a slice and slices drawn far to near. */
const SLICES = 8;

/**
 * Orbit: the projected dots in stage pixels (scale 1), far to near, faded with depth. The same
 * drawing functions as the flat views run on a frame whose positions are the projection.
 */
function drawOrbit(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  scene: Scene,
  model: MapModel,
  f0: FrameState,
  o: OrbitProjection,
  pal: Palette,
  cssW: number,
  cssH: number,
): Animating {
  const f: FrameState = {
    ...f0,
    pos: o.pos,
    cam: IDENTITY,
    world: { w: 1000, h: 760 },
  };
  const F: Frame = {
    ctx,
    dpr,
    scene,
    model,
    f,
    pal,
    c: cacheFor(scene),
    s: 1,
    px: 1,
    cssW,
    cssH,
    still: f.reducedMotion,
    T: Math.max(1, model.topics.length),
    filtered: false,
    busy: f.hot !== null || f.sel !== null,
    near: new Set(f.hot !== null ? (model.nodes[f.hot]?.nb ?? []) : []),
    motion: false,
    ambient: false,
    flipX: cssW * 0.76,
    depth: o.p,
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // The agents' ring.
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = pal.line;
  ctx.beginPath();
  o.equator.forEach(([x, y], j) =>
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y),
  );
  ctx.stroke();
  drawFocusLinks(F);
  drawPulses(F);

  // Far to near, in slices; within a slice one batch per topic, kind and alpha. Group keys are
  // integers (hubs sort last, so they draw on top) and the group lists are reused every frame.
  const n = o.order.length;
  const per = Math.max(1, Math.ceil(n / SLICES));
  const { lists, used, loose } = orbitScratch;
  for (let a = 0; a < n; a += per) {
    used.length = 0;
    loose.length = 0;
    for (let j = a; j < Math.min(n, a + per); j++) {
      const i = o.order[j]!;
      const node = model.nodes[i];
      if (!node || special(F, i)) continue;
      if (node.kind === "agent" || node.kind === "root") {
        loose.push(i);
        continue;
      }
      const kind = KIND_INDEX[kindOf(node)];
      const base = alphaOf(F, i);
      const al = Math.round(
        (base === 1 ? orbitAlpha(o.p[i]!) : base) *
          (theirs(node) ? 0.72 : 1) *
          20,
      ); // 0..20
      const key =
        ((kind === 4 ? 1 : 0) * 4096 + node.topic) * 128 + kind * 21 + al;
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      if (list.length === 0) used.push(key);
      list.push(i);
    }
    used.sort((x, y) => x - y);
    for (const key of used) {
      const list = lists.get(key)!;
      const al = key % 21;
      const kind = KINDS[Math.floor((key % 128) / 21)]!;
      const topic = Math.floor(key / 128) % 4096;
      fillGroup(
        F,
        kind,
        hueOf(F, topic),
        al / 20,
        groupPaths(F, kind, list, 1),
        0,
        topic,
      );
      list.length = 0;
    }
    for (const i of loose)
      if (model.nodes[i]!.kind === "agent") drawAgent(F, i, 1, 0);
      else drawRoot(F, 1, 0);
  }
  drawGrowing(F);
  drawHot(F);
  drawRings(F);
  drawLabels(F);
  ctx.globalAlpha = 1;
  return F.motion ? "motion" : F.ambient ? "ambient" : false;
}

const special = (F: Frame, i: number) =>
  i === F.f.hot || F.near.has(i) || !!F.f.grow?.nodes.has(i);
/** Orbit: a node's perspective scale (near dots larger); 1 in the flat views. */
const depthOf = (F: Frame, i: number) => (F.depth ? (F.depth[i] ?? 1) : 1);

// ---- The resting layer: guides, resting edges ----

/** Draws the resting layer into `g`, whose transform is already set to the box. */
function drawStatic(F: Frame, g: CanvasRenderingContext2D) {
  const { scene, c, pal, px, f, model } = F;
  g.lineCap = "round";
  g.lineJoin = "round";
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

  // Edges: the timeline draws only the focused links.
  if (f.view !== "timeline") {
    g.strokeStyle = pal.edge;
    g.lineWidth = 0.6 * px;
    g.globalAlpha = F.busy ? 0.08 : 0.3;
    g.stroke(c.edges);
    if (F.filtered && f.sel === null && f.hot === null) {
      let p = c.litEdges.get(f.lit);
      if (!p) {
        p = new Path2D();
        for (const [u, v] of model.edges)
          if (f.lit[u] && f.lit[v]) {
            const a = P(F, u);
            const b = P(F, v);
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
}

type Layer = {
  canvas: HTMLCanvasElement;
  scene: Scene | null;
  pal: Palette | null;
  lit: boolean[] | null;
  busy: boolean;
  dpr: number;
  ww: number;
  W: number;
  H: number;
  ox: number; // overscan, device px on each side
  oy: number;
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
      busy: false,
      dpr: 0,
      ww: 0,
      W: 0,
      H: 0,
      ox: 0,
      oy: 0,
      k: 1,
      tx: 0,
      ty: 0,
    };
    layers.set(ctx, l);
  }
  return l;
}

/** Up to half a viewport of overscan on each side, within this many layer pixels. */
const LAYER_MAX_PX = 16_000_000;

/**
 * The resting layer is a bitmap, redrawn only when what it shows changes or once the camera has
 * been still for a moment. While the camera moves, the last bitmap moves and scales with it (one
 * drawImage instead of thousands of anti-aliased strokes); the overscan keeps a pan or a zoom-out
 * from showing blank edges.
 */
function drawLayer(F: Frame) {
  const { ctx, dpr, f, scene, pal, s } = F;
  const L = layerFor(ctx);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const cam = f.cam;
  // Hover changes `busy`, which only the resting edges show: the timeline has none.
  const busy = f.view !== "timeline" && F.busy;
  const same =
    L.scene === scene &&
    L.pal === pal &&
    L.lit === f.lit &&
    L.busy === busy &&
    L.W === W &&
    L.H === H &&
    L.dpr === dpr &&
    L.ww === f.world.w;
  const camSame = same && L.k === cam.k && L.tx === cam.tx && L.ty === cam.ty;
  if (!same || (!camSame && !f.moving)) {
    const ov = Math.max(
      0,
      Math.min(0.5, (Math.sqrt(LAYER_MAX_PX / (W * H)) - 1) / 2),
    );
    const ox = Math.round(W * ov);
    const oy = Math.round(H * ov);
    if (L.canvas.width !== W + 2 * ox) L.canvas.width = W + 2 * ox;
    if (L.canvas.height !== H + 2 * oy) L.canvas.height = H + 2 * oy;
    const g = L.canvas.getContext("2d");
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.clearRect(0, 0, L.canvas.width, L.canvas.height);
      g.setTransform(
        dpr * s,
        0,
        0,
        dpr * s,
        dpr * cam.tx + ox,
        dpr * cam.ty + oy,
      );
      drawStatic(F, g);
    }
    Object.assign(L, {
      scene,
      pal,
      lit: f.lit,
      busy,
      dpr,
      ww: f.world.w,
      W,
      H,
      ox,
      oy,
      k: cam.k,
      tx: cam.tx,
      ty: cam.ty,
    });
  } else if (!camSame) F.motion = true; // redraw it crisp once the camera stops
  const r = cam.k / L.k;
  ctx.setTransform(
    r,
    0,
    0,
    r,
    dpr * cam.tx - (L.ox + dpr * L.tx) * r,
    dpr * cam.ty - (L.oy + dpr * L.ty) * r,
  );
  ctx.globalAlpha = f.layerAlpha ?? 1;
  ctx.drawImage(L.canvas, 0, 0);
}

// ---- Live layers ----

/** The hot and selected dots' own links, in their colour. */
function drawFocusLinks(F: Frame) {
  const { ctx, model, f, px } = F;
  for (const i of new Set([f.sel, f.hot])) {
    if (i === null) continue;
    const n = model.nodes[i];
    if (!n) continue;
    const [x, y] = P(F, i);
    ctx.beginPath();
    for (const j of n.nb) {
      const b = P(F, j);
      ctx.moveTo(x, y);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = colourOf(F, n);
    ctx.stroke();
  }
}

/** Pulses: a 7%-long segment of light running along a link. */
function drawPulses(F: Frame) {
  const { ctx, f, px } = F;
  for (const p of f.pulses) {
    const k = (f.time - p.t0) / p.dur;
    if (k >= 1) continue;
    if (p.ambient) F.ambient = true;
    else F.motion = true;
    if (k < 0) continue;
    const a = P(F, p.from);
    const b = P(F, p.to);
    const k0 = Math.max(0, k - 0.035);
    const k1 = Math.min(1, k + 0.035);
    ctx.globalAlpha = p.ambient ? 0.55 : 1;
    ctx.strokeStyle = p.colour;
    ctx.shadowColor = p.colour;
    ctx.shadowBlur = p.ambient ? 4 : 6;
    ctx.lineWidth = (p.ambient ? 1.4 : 2.2) * px;
    ctx.beginPath();
    ctx.moveTo(a[0] + (b[0] - a[0]) * k0, a[1] + (b[1] - a[1]) * k0);
    ctx.lineTo(a[0] + (b[0] - a[0]) * k1, a[1] + (b[1] - a[1]) * k1);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

/** The core swarm: last-24h writes, breathing; gone once zoomed in. */
function drawCore(F: Frame) {
  const { ctx, scene, f, pal, px, still } = F;
  if (!scene.core.length || f.cam.k > 1.8) return;
  if (!still) F.ambient = true;
  ctx.globalAlpha = still ? 0.8 : 0.8 + 0.2 * Math.sin((TAU * f.time) / 4000);
  ctx.fillStyle = pal.brand;
  ctx.beginPath();
  for (const [x, y] of scene.core) {
    ctx.moveTo(x + 1.2 * px, y);
    ctx.arc(x, y, 1.2 * px, 0, TAU);
  }
  ctx.fill();
}

function drawTicks(F: Frame) {
  const { ctx, scene, pal, px } = F;
  if (!scene.ticks.length) return;
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = pal.fg2;
  ctx.beginPath();
  for (const [x, y] of scene.ticks) {
    ctx.moveTo(x + 2 * px, y);
    ctx.arc(x, y, 2 * px, 0, TAU);
  }
  ctx.fill();
}

// ---- Dots ----

/** Paths for one group of same-kind dots; a hub has three (outer ring, card ring, centre). */
function groupPaths(
  F: Frame,
  kind: Kind,
  nodes: number[],
  scale: number,
): Path2D[] {
  const { model, px } = F;
  const at = (r: (i: number) => number) => {
    const p = new Path2D();
    for (const i of nodes) {
      const [x, y] = P(F, i);
      shapePath(p, kind, x, y, r(i));
    }
    return p;
  };
  const rad = (i: number) =>
    (dotDiameter(model.nodes[i]!) / 2) * scale * depthOf(F, i) * px;
  if (kind === "hub")
    return [
      at((i) => rad(i) + 1.5 * px),
      at(rad),
      at((i) => Math.max(0.5 * px, rad(i) - 2 * px)),
    ];
  if (kind === "lnote" || kind === "lfile")
    return [at((i) => rad(i) - 0.6 * px)];
  return [at(rad)];
}

/** Fills one group: hubs with their soft breathing glow, locked dots hollow. */
function fillGroup(
  F: Frame,
  kind: Kind,
  colour: string,
  alpha: number,
  paths: Path2D[],
  glow: number,
  topic: number,
) {
  const { ctx, pal, px, still, f, T } = F;
  if (kind === "hub") {
    const [outer, mid, inner] = paths as [Path2D, Path2D, Path2D];
    if (!still) F.ambient = true;
    ctx.fillStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur =
      glow ||
      (still ? 14 : 19 + 5 * Math.sin(TAU * (f.time / 5000 + topic / T)));
    ctx.globalAlpha = 0.35 * alpha;
    ctx.fill(outer);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha;
    ctx.fill(outer);
    ctx.fillStyle = pal.bg;
    ctx.fill(mid);
    ctx.fillStyle = colour;
    ctx.fill(inner);
    return;
  }
  ctx.globalAlpha = alpha;
  if (glow) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = glow;
  }
  const p = paths[0]!;
  if (kind === "lnote" || kind === "lfile") {
    ctx.fillStyle = pal.bg;
    ctx.fill(p);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.2 * px;
    ctx.stroke(p);
  } else {
    ctx.fillStyle = colour;
    ctx.fill(p);
  }
  ctx.shadowBlur = 0;
}

type Batch = {
  topic: number;
  kind: Kind;
  alpha: number;
  paths: Path2D[];
};
type DotCache = {
  pos: FrameState["pos"];
  lit: boolean[];
  soft: Set<number> | null;
  hot: number | null;
  sel: number | null;
  focus: number | null;
  grow: Set<number> | null;
  s: number;
  batches: Batch[];
};
const dotCaches = new WeakMap<Scene, DotCache>();

/**
 * The dots, batched per topic, kind and alpha. The batches (keys and paths) are cached per
 * scene, positions, filter, soft set, hot, selection, focus and scale, so a frame that only
 * breathes is a few dozen fills.
 */
function drawDots(F: Frame) {
  const { scene, model, f, s } = F;
  let dc = dotCaches.get(scene);
  if (
    !dc ||
    dc.pos !== f.pos ||
    dc.lit !== f.lit ||
    dc.soft !== f.soft ||
    dc.hot !== f.hot ||
    dc.sel !== f.sel ||
    dc.focus !== f.focusRing ||
    dc.grow !== (f.grow?.nodes ?? null) ||
    dc.s !== s
  ) {
    const batches: Batch[] = [];
    scene.byTopic.forEach((nodes, topic) => {
      const groups = new Map<string, { kind: Kind; a: number; n: number[] }>();
      for (const i of nodes) {
        if (special(F, i)) continue;
        const n = model.nodes[i]!;
        const kind = kindOf(n);
        const a = alphaOf(F, i) * (theirs(n) ? 0.72 : 1);
        const key = `${kind}|${a}`;
        const g = groups.get(key);
        if (g) g.n.push(i);
        else groups.set(key, { kind, a, n: [i] });
      }
      // Plain dots first, hubs on top.
      for (const g of [...groups.values()].sort(
        (x, y) => +(x.kind === "hub") - +(y.kind === "hub"),
      ))
        batches.push({
          topic,
          kind: g.kind,
          alpha: g.a,
          paths: groupPaths(F, g.kind, g.n, 1),
        });
    });
    dc = {
      pos: f.pos,
      lit: f.lit,
      soft: f.soft,
      hot: f.hot,
      sel: f.sel,
      focus: f.focusRing,
      grow: f.grow?.nodes ?? null,
      s,
      batches,
    };
    dotCaches.set(scene, dc);
  }
  for (const b of dc.batches)
    fillGroup(F, b.kind, hueOf(F, b.topic), b.alpha, b.paths, 0, b.topic);
}

/** Agents: a ring with a centre point. */
function drawAgent(F: Frame, i: number, s0: number, glow: number) {
  const { ctx, model, pal, px } = F;
  const n = model.nodes[i]!;
  const scale = s0 * depthOf(F, i);
  const [x, y] = P(F, i);
  const a = alphaOf(F, i);
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
}

/** The index: a hexagon turning once every 30 s. */
function drawRoot(F: Frame, s0: number, glow: number) {
  const { ctx, model, scene, f, pal, px, still } = F;
  const n = model.nodes[scene.root];
  if (!n) return;
  const scale = s0 * depthOf(F, scene.root);
  const [x, y] = P(F, scene.root);
  if (!still) F.ambient = true;
  const turn = still ? 0 : (TAU * (f.time % 30_000)) / 30_000;
  const p = new Path2D();
  hex(p, x, y, (dotDiameter(n) / 2) * scale * px, turn);
  ctx.globalAlpha = alphaOf(F, scene.root);
  ctx.fillStyle = pal.fg;
  if (glow) {
    ctx.shadowColor = pal.fg;
    ctx.shadowBlur = glow;
  }
  ctx.fill(p);
  ctx.shadowBlur = 0;
}

/** One node on its own (hot, or a neighbour of the hot dot), optionally scaled and glowing. */
function drawOne(F: Frame, i: number, scale: number, glow: number) {
  const n = F.model.nodes[i];
  if (!n) return;
  if (n.kind === "agent") return drawAgent(F, i, scale, glow);
  if (n.kind === "root") return drawRoot(F, scale, glow);
  const kind = kindOf(n);
  fillGroup(
    F,
    kind,
    colourOf(F, n),
    alphaOf(F, i) * (theirs(n) && i !== F.f.hot ? 0.72 : 1),
    groupPaths(F, kind, [i], scale),
    glow,
    n.topic,
  );
}

/** The hot dot grown x1.7 with a glow, and its neighbours with a softer one. */
function drawHot(F: Frame) {
  const { ctx, f, model, pal, px } = F;
  let budget = 400;
  for (const i of F.near) if (i !== f.hot && budget-- > 0) drawOne(F, i, 1, 10);
  if (f.hot === null || !model.nodes[f.hot]) return;
  const n = model.nodes[f.hot]!;
  const [x, y] = P(F, f.hot);
  // A 2 px card-coloured ring under the grown shape.
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.bg;
  ctx.beginPath();
  ctx.arc(
    x,
    y,
    ((dotDiameter(n) / 2) * 1.7 * depthOf(F, f.hot) + 2) * px,
    0,
    TAU,
  );
  ctx.fill();
  drawOne(F, f.hot, 1.7, 14);
}

/** The selection (3 px gap, 1.5 px text colour) and keyboard focus (2 px accent with a 2 px gap). */
function drawRings(F: Frame) {
  const { ctx, model, f, pal, px } = F;
  const ring = (i: number, gap: number, w: number, colour: string) => {
    const n = model.nodes[i];
    if (!n) return;
    const [x, y] = P(F, i);
    const r = (dotDiameter(n) / 2) * (i === f.hot ? 1.7 : 1) * depthOf(F, i);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = w * px;
    ctx.beginPath();
    ctx.arc(x, y, (r + gap + w / 2) * px, 0, TAU);
    ctx.stroke();
  };
  if (f.sel !== null) ring(f.sel, 3, 1.5, pal.fg);
  if (f.focusRing !== null) ring(f.focusRing, 2, 2, pal.accent);
}

/** Guide tags and dot labels, in screen space so text stays crisp at every zoom. */
function drawLabels(F: Frame) {
  const { ctx, dpr, s, f, scene, model, pal, cssW, cssH } = F;
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
    const [bx, by] = P(F, i);
    const x = sx(bx);
    const y = sy(by);
    if (x < -LABEL_MAX || y < -20 || x > cssW + LABEL_MAX || y > cssH + 20)
      continue;
    const weight = n.kind === "hub" || i === f.sel ? 600 : 400;
    const font = `${weight} 12px ${fam}`;
    ctx.font = font;
    const m = fit(ctx, font, n.title, LABEL_MAX - 12);
    const r = (dotDiameter(n) / 2) * (i === f.hot ? 1.7 : 1) * depthOf(F, i);
    const w = m.w + 12;
    const lx = bx > F.flipX ? x - r - 6 - w : x + r + 6;
    const a = alphaOf(F, i);
    ctx.globalAlpha = 0.84 * a;
    ctx.fillStyle = pal.bg;
    ctx.beginPath();
    ctx.roundRect(lx, y - 9, w, 18, 6);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = pal.fg;
    ctx.fillText(m.text, lx + 6, y + 0.5);
  }
}
