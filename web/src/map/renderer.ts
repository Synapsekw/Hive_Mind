// Draws one frame of the map on a 2D canvas context. No React, no DOM writes: MapCanvas owns the
// element and the loop. Geometry that only changes with the scene (the edges) is built once per
// scene as batched Path2Ds; a frame is a few dozen fills and strokes. Colours
// come from the theme's tokens (readPalette), never from literals; transparency is always
// `globalAlpha`. Line widths and radii are divided by the scale, so they keep their screen size.
import { css, parseColour } from "../theme/colour";
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
  /**
   * The decorative phase (breathing, the index's turn, the level-7 halos): advances only while
   * the ambient motion is awake, so it freezes in place when the map goes idle. Defaults to time.
   */
  clock?: number;
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
  /** The "Labels" switch: off hides the group names too. */
  labelsOn?: boolean;
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
  /** Rings: a note's colour by freshness level, 0 (oldest) to 7. */
  fresh: string[];
  /** The colour of the halo under a fresh note. */
  glow: string;
  /** A hub's colour in Rings. */
  hub: string;
  /** How a halo meets what is under it: added light in dark themes, painted in the light one. */
  haloBlend: GlobalCompositeOperation;
};

const TAU = Math.PI * 2;
const SQ2 = Math.SQRT2;
const LABEL_MAX = 220;
/** Opacity of the thin outline, in the dot's own colour, around a readable dot in Rings (times its dim). */
export const OUTLINE_ALPHA = 0.45;
/** A locked dot's stroke in Rings, in screen px (other views keep 1.2). */
const LOCKED_W = 1.6;
/** The smallest note or file drawn, in screen px, however far Rings shrank the drawing. */
const MIN_DOT = 2.5;
/** Dots smaller than this on screen get no outline (it would swallow the fill). */
const OUTLINE_MIN = 4;
/** Above this many dots at freshness levels 6 and 7 the halos are skipped (too many to stamp per frame while dots move). */
const GLOW_MAX = 400;

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
    fresh: Array.from({ length: 8 }, (_, i) => v(`--fresh-${i}`)),
    // A missing token falls back to the accent: parseColour throws on an empty string.
    glow: v("--glow-colour") || v("--acc"),
    hub: v("--hub") || v("--acc"),
    haloBlend: v("--halo-blend") === "source-over" ? "source-over" : "lighter",
  };
}

// ---- Per-scene cache ----

type SceneCache = {
  edges: Path2D;
  litEdges: WeakMap<boolean[], Path2D>;
  filtered: WeakMap<boolean[], boolean>;
  /** At most GLOW_MAX dots at freshness levels 6 and 7: only then do the fresh ones get a halo. */
  glow: boolean;
  /** Per group: does any of its nodes stay lit (its name at full, else faint)? */
  groupOn: WeakMap<boolean[], boolean[]>;
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
  let fresh = 0;
  for (const v of scene.fresh) if (v >= 6) fresh++;
  const out: SceneCache = {
    edges,
    litEdges: new WeakMap(),
    filtered: new WeakMap(),
    glow: fresh <= GLOW_MAX,
    groupOn: new WeakMap(),
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

function groupsOn(c: SceneCache, scene: Scene, lit: boolean[]): boolean[] {
  let v = c.groupOn.get(lit);
  if (!v) {
    v = scene.byTopic.map((nodes) => nodes.some((i) => lit[i]));
    c.groupOn.set(lit, v);
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

/** A group name keeps at least this many characters, or only the count is shown. */
const GROUP_NAME_MIN = 4;
/** Group names stay this many screen px inside the map box. */
const GROUP_MARGIN = 8;
/** A group name whose group has nothing lit (filter, search, selection). */
const GROUP_DIM = 0.4;

/**
 * A group label "<name> · <count>" fitted into `room` px: the name is cut with "…" and the
 * count stays whole. With fewer than four name characters left, only the count ("384").
 */
export function fitGroupLabel(
  text: string,
  room: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= room) return text;
  const at = text.lastIndexOf(" · ");
  if (at < 0) return text;
  const name = text.slice(0, at);
  const tail = text.slice(at);
  let lo = 0;
  let hi = name.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(`${name.slice(0, mid).trimEnd()}…${tail}`) <= room) lo = mid;
    else hi = mid - 1;
  }
  const kept = name.slice(0, lo).trimEnd();
  return kept.length >= GROUP_NAME_MIN ? `${kept}…${tail}` : tail.slice(3);
}

/** fitGroupLabel, measured once per font, label and whole pixel of room. */
function fitGroup(
  ctx: CanvasRenderingContext2D,
  font: string,
  text: string,
  room: number,
): string {
  const px = Math.max(0, Math.floor(room));
  const key = `${font}\u0000${px}\u0000${text}`;
  const hit = fitted.get(key);
  if (hit) return hit.text;
  if (fitted.size > 20_000) fitted.clear();
  const out = fitGroupLabel(text, px, (s) => ctx.measureText(s).width);
  fitted.set(key, { text: out, w: 0 });
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
  /** The scene's dot scale (Rings shrinks dots with the drawing); 1 in Orbit. */
  dotScale: number;
  /**
   * Rings only: freshness per node; notes and files are drawn in the brand colour, brighter
   * when fresher. Null in Timeline and Orbit, which keep the group hues.
   */
  fresh: Uint8Array | null;
};

const CENTRE: [number, number] = [500, 380];
const P = (F: Frame, i: number): [number, number] => F.f.pos[i] ?? CENTRE;
const hueOf = (F: Frame, topic: number) =>
  F.pal.hue[F.model.topics[topic]?.hue ?? -1] ?? F.pal.fg2;
const colourOf = (F: Frame, n: ModelNode) =>
  n.topic >= 0 ? hueOf(F, n.topic) : F.pal.fg2;
/** A hub's colour: the theme's hub colour in Rings, its group's hue elsewhere. */
const hubColour = (F: Frame, topic: number) =>
  F.fresh ? F.pal.hub : hueOf(F, topic);
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

/** A dot's drawn diameter in screen px, shrunk by `scale`; notes and files never below 2.5. */
export function dotDiameter(n: ModelNode, scale = 1): number {
  const d = size(n) * scale;
  return n.kind === "note" || n.kind === "file" ? Math.max(MIN_DOT, d) : d;
}
const diam = (F: Frame, n: ModelNode) => dotDiameter(n, F.dotScale);

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
    dotScale: scene.dotScale,
    fresh: f.view === "rings" ? scene.fresh : null,
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
    dotScale: 1,
    fresh: null,
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
        0,
        kind === "hub" ? list : [],
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
  const { scene, c, pal, px, f } = F;
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
      // Cached per scene and filter, so it is built from the scene's own resting coordinates,
      // never from the glide's: a path built mid-glide would stay where the dots were.
      let p = c.litEdges.get(f.lit);
      if (!p) {
        p = new Path2D();
        const e = scene.edges;
        scene.rest.forEach(([u, v], k) => {
          if (!f.lit[u] || !f.lit[v]) return;
          p!.moveTo(e[k * 4]!, e[k * 4 + 1]!);
          p!.lineTo(e[k * 4 + 2]!, e[k * 4 + 3]!);
        });
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

/**
 * Pulses: a 7%-long segment of light running along a link. All pulses of one colour and kind
 * are stroked as one path: a shadow blur is a full pass per draw call, and a hub fires 160 at
 * once (one stroke each made a big hub's hover run at a few frames a second).
 */
function drawPulses(F: Frame) {
  const { ctx, f, px } = F;
  const paths = new Map<
    string,
    { p: Path2D; colour: string; ambient: boolean }
  >();
  for (const q of f.pulses) {
    const k = (f.time - q.t0) / q.dur;
    if (k >= 1) continue;
    if (q.ambient) F.ambient = true;
    else F.motion = true;
    if (k < 0) continue;
    const a = P(F, q.from);
    const b = P(F, q.to);
    const k0 = Math.max(0, k - 0.035);
    const k1 = Math.min(1, k + 0.035);
    const key = `${q.ambient ? 1 : 0}${q.colour}`;
    let g = paths.get(key);
    if (!g)
      paths.set(
        key,
        (g = { p: new Path2D(), colour: q.colour, ambient: !!q.ambient }),
      );
    g.p.moveTo(a[0] + (b[0] - a[0]) * k0, a[1] + (b[1] - a[1]) * k0);
    g.p.lineTo(a[0] + (b[0] - a[0]) * k1, a[1] + (b[1] - a[1]) * k1);
  }
  for (const { p, colour, ambient } of paths.values()) {
    ctx.globalAlpha = ambient ? 0.55 : 1;
    ctx.strokeStyle = colour;
    ctx.shadowColor = colour;
    ctx.shadowBlur = ambient ? 4 : 6;
    ctx.lineWidth = (ambient ? 1.4 : 2.2) * px;
    ctx.stroke(p);
  }
  ctx.shadowBlur = 0;
}

/** The core swarm: last-24h writes, breathing; gone once zoomed in. */
function drawCore(F: Frame) {
  const { ctx, scene, f, pal, px, still } = F;
  if (!scene.core.length || f.cam.k > 1.8) return;
  if (!still) F.ambient = true;
  ctx.globalAlpha = still
    ? 0.8
    : 0.8 + 0.2 * Math.sin((TAU * (f.clock ?? f.time)) / 4000);
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

/** A locked dot's stroke width in screen px: heavier in Rings, where readable dots are faint. */
const lockedW = (F: Frame) => (F.fresh ? LOCKED_W : 1.2);

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
    (diam(F, model.nodes[i]!) / 2) * scale * depthOf(F, i) * px;
  if (kind === "hub")
    return [
      at((i) => rad(i) + 1.5 * px),
      at(rad),
      at((i) => Math.max(0.5 * px, rad(i) - 2 * px)),
    ];
  // Clamped: a dot growing in starts near scale 0, and a negative radius makes `arc` throw.
  if (kind === "lnote" || kind === "lfile")
    return [at((i) => Math.max(0, rad(i) - (lockedW(F) / 2) * px))];
  return [at(rad)];
}

/** A hub's breathing glow, in device px of blur: its centre and its value when still. */
const HUB_BLUR = 19;
const HUB_BLUR_STILL = 14;
const GLOW_STEP = 1.08;
const glowSprites = new Map<string, { c: HTMLCanvasElement; pad: number }>();

/**
 * A hub's glow, drawn once per colour, outer radius and blur (device px, whole): the disc and
 * its shadow blur on a small canvas, stamped with drawImage. A shadow blur on the map's canvas
 * is a full blur pass per fill, every frame; the sprite is one copy.
 */
function glowSprite(colour: string, r: number, blur: number) {
  const key = `${colour}|${r}|${blur}`;
  const hit = glowSprites.get(key);
  if (hit) return hit;
  const pad = r + 2 * blur;
  const c = document.createElement("canvas");
  c.width = c.height = 2 * pad;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = colour;
    g.shadowColor = colour;
    g.shadowBlur = blur;
    g.beginPath();
    g.arc(pad, pad, r, 0, TAU);
    g.fill();
  }
  // Hub sizes and colours per theme are few; a theme change or a long zoom starts afresh.
  if (glowSprites.size > 64) glowSprites.clear();
  const out = { c, pad };
  glowSprites.set(key, out);
  return out;
}

/** Stamps the glow under each hub in `hubs` (drawn at `scale`), `blur` device px wide. */
function stampHubGlow(
  F: Frame,
  colour: string,
  hubs: readonly number[],
  scale: number,
  blur: number,
  a: number,
) {
  const { ctx, dpr, s, model } = F;
  // One drawing unit in device px (the flat views draw in box units, Orbit in stage px).
  const dev = dpr * s;
  ctx.globalAlpha = Math.min(1, a);
  for (const i of hubs) {
    const n = model.nodes[i];
    if (!n) continue;
    // The outer ring's radius (groupPaths), in device px.
    const rDev = ((diam(F, n) / 2) * scale * depthOf(F, i) + 1.5) * dpr;
    // Radii in 8% steps, so a zoom reuses a handful of sprites instead of making one per frame;
    // the sprite is stretched to the exact radius.
    const rb = Math.max(
      1,
      Math.round(GLOW_STEP ** Math.round(Math.log(rDev) / Math.log(GLOW_STEP))),
    );
    const { c, pad } = glowSprite(colour, rb, blur);
    const [x, y] = P(F, i);
    const h = (pad * (rDev / rb)) / dev;
    ctx.drawImage(c, x - h, y - h, 2 * h, 2 * h);
  }
}

/**
 * Fills one group: hubs with their soft breathing glow, locked dots hollow. `outline` is the
 * opacity of a 1 px outline, in the dot's own colour, around readable dots (0: none). `hubs`
 * are the group's hub nodes (for their glow), drawn at `scale`.
 */
function fillGroup(
  F: Frame,
  kind: Kind,
  colour: string,
  alpha: number,
  paths: Path2D[],
  glow: number,
  topic: number,
  outline = 0,
  hubs: readonly number[] = [],
  scale = 1,
) {
  const { ctx, pal, px, still, f, T } = F;
  if (kind === "hub") {
    const [outer, mid, inner] = paths as [Path2D, Path2D, Path2D];
    if (!still && !F.fresh) F.ambient = true;
    ctx.fillStyle = colour;
    if (!F.fresh || glow) {
      // Timeline and Orbit keep the soft breathing glow; so does a hub the pointer is on. The
      // breathing swells its opacity (it once swelled the blur, 14 to 24 px).
      const breath =
        glow || still
          ? 1
          : 1 + 0.25 * Math.sin(TAU * ((f.clock ?? f.time) / 5000 + topic / T));
      stampHubGlow(
        F,
        colour,
        hubs,
        scale,
        glow || (still ? HUB_BLUR_STILL : HUB_BLUR),
        0.35 * alpha * breath,
      );
    }
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
    ctx.lineWidth = lockedW(F) * px;
    ctx.stroke(p);
  } else {
    ctx.fillStyle = colour;
    ctx.fill(p);
    ctx.shadowBlur = 0;
    if (outline > 0) {
      ctx.globalAlpha = outline;
      ctx.strokeStyle = colour;
      ctx.lineWidth = px;
      ctx.stroke(p);
    }
  }
  ctx.shadowBlur = 0;
}

/** Outline opacity for a readable dot drawn `d` px wide on screen at dim `a`. */
const outlineOf = (d: number, a: number) =>
  d >= OUTLINE_MIN ? OUTLINE_ALPHA * a : 0;

/** The halo's fade: [fraction of the radius, share of the peak opacity]. */
const HALO_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.4, 0.35],
  [1, 0],
];
/** A halo is this many dot radii wide (radius, not diameter). */
const HALO_REACH = 6.5;
/** A hub's and the index's halo, in their own radii. */
const HUB_REACH = 2.75;
const ROOT_REACH = 3.8;
const HALO_PX = 128;

/**
 * A halo's peak opacity by freshness level: none below 6, 0.3 at 6, 0.5 at 7, where it breathes
 * between 0.42 and 0.58 every four seconds unless the map is still.
 */
export function haloAlpha(level: number, time: number, still: boolean): number {
  if (level < 6) return 0;
  if (level === 6) return 0.3;
  if (still) return 0.5;
  return 0.5 + 0.08 * Math.sin((TAU * time) / 4000);
}

const sprites = new Map<string, HTMLCanvasElement>();

/** Paper paints its halos at 0.42 at the peak where the dark themes add light at 0.5. */
const HALO_PAINTED = 0.84;

/** The halo of one colour, drawn once: a radial fade on a small canvas, stamped with drawImage. */
function haloSprite(colour: string): HTMLCanvasElement {
  const hit = sprites.get(colour);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = HALO_PX;
  const g = c.getContext("2d")!;
  const base = parseColour(colour);
  const r = HALO_PX / 2;
  const fade = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, share] of HALO_STOPS)
    fade.addColorStop(at, css({ ...base, a: share }));
  g.fillStyle = fade;
  g.fillRect(0, 0, HALO_PX, HALO_PX);
  // A handful of colours per theme; a theme change leaves the old ones to be collected.
  if (sprites.size > 16) sprites.clear();
  sprites.set(colour, c);
  return c;
}

/** Stamps a halo of radius `r` (in drawing units) at (x, y), at opacity `a`. */
function stampHalo(
  F: Frame,
  colour: string,
  x: number,
  y: number,
  r: number,
  a: number,
) {
  if (a <= 0 || r <= 0) return;
  const { ctx, pal } = F;
  ctx.globalAlpha = pal.haloBlend === "source-over" ? a * HALO_PAINTED : a;
  ctx.globalCompositeOperation = pal.haloBlend;
  ctx.drawImage(haloSprite(colour), x - r, y - r, 2 * r, 2 * r);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

type Batch = {
  topic: number; // hubs: their group; notes and files: -1 (brand colour)
  kind: Kind;
  alpha: number;
  level: number; // freshness, for the halo; 0 for hubs and locked dots
  tone: number; // Rings: the ramp step the dots are filled with (7 for hot, focused, selected)
  outline: number;
  halo: number[]; // Rings: the nodes of this batch that get a halo (level 6 or 7, hubs), else []
  hubs: number[]; // the batch's hub nodes (for their glow), else []
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

type Group = Omit<Batch, "paths" | "hubs"> & { n: number[] };
const toBatch = (F: Frame, { n, ...g }: Group): Batch => ({
  ...g,
  hubs: g.kind === "hub" ? n : [],
  paths: groupPaths(F, g.kind, n, 1),
});

/**
 * Rings: notes and files batched per kind, freshness level, alpha and outline, in the brand
 * colour, freshest on top; then the hubs per group in their hue.
 */
function freshBatches(F: Frame, fresh: Uint8Array): Batch[] {
  const { scene, model } = F;
  const dots = new Map<string, Group>();
  const hubs: Group[] = [];
  scene.byTopic.forEach((nodes, topic) => {
    const own = new Map<number, Group>();
    for (const i of nodes) {
      if (special(F, i)) continue;
      const n = model.nodes[i]!;
      const kind = kindOf(n);
      const dim = alphaOf(F, i);
      if (kind === "hub") {
        let g = own.get(dim);
        if (!g) {
          g = {
            topic,
            kind,
            alpha: dim,
            level: 0,
            tone: 0,
            outline: 0,
            halo: [],
            n: [],
          };
          own.set(dim, g);
          hubs.push(g);
        }
        g.n.push(i);
        g.halo.push(i);
        continue;
      }
      const locked = kind === "lnote" || kind === "lfile";
      const level = locked ? 0 : fresh[i]!;
      // The ramp carries freshness now; opacity only dims for a filter or a selection.
      const tone = strong(F, i) ? 7 : level;
      const outline = locked ? 0 : outlineOf(diam(F, n), dim);
      const key = `${kind}|${level}|${tone}|${dim}|${outline}`;
      let g = dots.get(key);
      if (!g) {
        g = {
          topic: -1,
          kind,
          alpha: dim,
          level,
          tone,
          outline,
          halo: [],
          n: [],
        };
        dots.set(key, g);
      }
      g.n.push(i);
      if (level >= 6) g.halo.push(i);
    }
  });
  // Older dots first so fresher ones draw over them, hubs on top.
  return [...[...dots.values()].sort((x, y) => x.level - y.level), ...hubs].map(
    (g) => toBatch(F, g),
  );
}

/** Timeline: per topic, kind and alpha in the topic's hue; a colleague's item at 0.72. */
function topicBatches(F: Frame): Batch[] {
  const { scene, model } = F;
  const batches: Batch[] = [];
  scene.byTopic.forEach((nodes, topic) => {
    const groups = new Map<string, Group>();
    for (const i of nodes) {
      if (special(F, i)) continue;
      const n = model.nodes[i]!;
      const kind = kindOf(n);
      const alpha = alphaOf(F, i) * (theirs(n) ? 0.72 : 1);
      const key = `${kind}|${alpha}`;
      const g = groups.get(key);
      if (g) g.n.push(i);
      else
        groups.set(key, {
          topic,
          kind,
          alpha,
          level: 0,
          tone: 0,
          outline: 0,
          halo: [],
          n: [i],
        });
    }
    // Plain dots first, hubs on top.
    for (const g of [...groups.values()].sort(
      (x, y) => +(x.kind === "hub") - +(y.kind === "hub"),
    ))
      batches.push(toBatch(F, g));
  });
  return batches;
}

/**
 * The dots, in Rings by freshness (freshBatches), elsewhere by topic (topicBatches). The batches
 * (keys and paths) are cached per scene, positions, filter, soft set, hot, selection, focus and
 * scale, so a frame that only breathes is a few dozen fills.
 */
function drawDots(F: Frame) {
  const { scene, f, s } = F;
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
    const batches = F.fresh ? freshBatches(F, F.fresh) : topicBatches(F);
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
  if (F.fresh) {
    // Every halo first, so none covers a neighbour's dot. Hubs are few, so they keep theirs
    // when too many notes are fresh for note halos.
    for (const b of dc.batches) {
      if (!b.halo.length) continue;
      const hub = b.kind === "hub";
      if (!hub && !F.c.glow) continue;
      const peak = hub
        ? 0.3
        : haloAlpha(b.level, F.f.clock ?? F.f.time, F.still);
      if (!hub && b.level === 7 && !F.still) F.ambient = true;
      for (const i of b.halo) {
        const [x, y] = P(F, i);
        const r = (diam(F, F.model.nodes[i]!) / 2) * depthOf(F, i) * F.px;
        stampHalo(
          F,
          hub ? F.pal.hub : F.pal.glow,
          x,
          y,
          r * (hub ? HUB_REACH : HALO_REACH),
          peak * b.alpha,
        );
      }
    }
  }
  for (const b of dc.batches)
    if (b.topic >= 0)
      fillGroup(
        F,
        b.kind,
        b.kind === "hub" ? hubColour(F, b.topic) : hueOf(F, b.topic),
        b.alpha,
        b.paths,
        0,
        b.topic,
        0,
        b.hubs,
      );
    else
      fillGroup(
        F,
        b.kind,
        b.kind === "lnote" || b.kind === "lfile"
          ? F.pal.accent
          : F.pal.fresh[b.tone]!,
        b.alpha,
        b.paths,
        0,
        -1,
        b.outline,
      );
}

/** Agents: a ring with a centre point. */
function drawAgent(F: Frame, i: number, s0: number, glow: number) {
  const { ctx, model, pal, px } = F;
  const n = model.nodes[i]!;
  const scale = s0 * depthOf(F, i);
  const [x, y] = P(F, i);
  const a = alphaOf(F, i);
  const r = (diam(F, n) / 2) * scale * px;
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
  // An agent that is still growing in can be smaller than its own stroke.
  ctx.arc(x, y, Math.max(0, r - 0.75 * px), 0, TAU);
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
  const turn = still ? 0 : (TAU * ((f.clock ?? f.time) % 30_000)) / 30_000;
  const p = new Path2D();
  hex(p, x, y, (diam(F, n) / 2) * scale * px, turn);
  if (F.fresh)
    stampHalo(
      F,
      pal.glow,
      x,
      y,
      (diam(F, n) / 2) * scale * px * ROOT_REACH,
      0.4 * alphaOf(F, scene.root),
    );
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
  const paths = groupPaths(F, kind, [i], scale);
  if (F.fresh && kind !== "hub") {
    // Rings: the ramp colour of its freshness; hot, focused and selected take the fresh end.
    const dim = alphaOf(F, i);
    const locked = kind === "lnote" || kind === "lfile";
    const level = locked ? 0 : (F.fresh[i] ?? 0);
    if (F.c.glow && level >= 6) {
      const [x, y] = P(F, i);
      if (level === 7 && !F.still) F.ambient = true;
      stampHalo(
        F,
        F.pal.glow,
        x,
        y,
        (diam(F, n) / 2) * scale * depthOf(F, i) * F.px * HALO_REACH,
        haloAlpha(level, F.f.clock ?? F.f.time, F.still) * dim,
      );
    }
    fillGroup(
      F,
      kind,
      locked ? F.pal.accent : F.pal.fresh[strong(F, i) ? 7 : level]!,
      dim,
      paths,
      glow,
      n.topic,
      locked ? 0 : outlineOf(diam(F, n) * scale, dim),
    );
    return;
  }
  if (F.fresh)
    stampHalo(
      F,
      F.pal.hub,
      ...P(F, i),
      (diam(F, n) / 2) * scale * depthOf(F, i) * F.px * HUB_REACH,
      0.3 * alphaOf(F, i),
    );
  fillGroup(
    F,
    kind,
    kind === "hub" ? hubColour(F, n.topic) : colourOf(F, n),
    alphaOf(F, i) * (theirs(n) && i !== F.f.hot ? 0.72 : 1),
    paths,
    glow,
    n.topic,
    0,
    [i],
    scale,
  );
}

/** At most this many of the hot dot's neighbours are drawn in front with the soft glow. */
const NEAR_MAX = 400;
/** The neighbours' glow, in screen px. */
const NEAR_GLOW = 10;

/**
 * A batch of the hot dot's neighbours. `tone`: a group (>= 0), a Rings note or file (-1: its
 * colour is the ramp step `step`, or the accent if locked) or fg2 (-2).
 */
type NearBatch = {
  tone: number;
  kind: Kind;
  alpha: number;
  outline: number;
  step: number; // Rings: the ramp step of a note or file; else 0
  level: number; // Rings: its freshness, for the halo; else 0
  halo: number[]; // Rings: the nodes that get a halo (hubs, notes at level 6 or 7), else []
  hubs: number[]; // the batch's hub nodes (for their glow), else []
  paths: Path2D[];
};
type NearCache = Omit<DotCache, "batches" | "grow"> & {
  batches: NearBatch[];
  /** Agents and the index among the neighbours: drawn one by one (there are few). */
  loose: number[];
};
const nearCaches = new WeakMap<Scene, NearCache>();

/**
 * The hot dot's neighbours, batched per kind, colour, alpha and outline exactly as drawOne would
 * colour each one. A shadow blur costs a full pass per draw call, so one fill per batch instead of
 * one per dot is what keeps hovering a big hub (hundreds of neighbours) smooth.
 */
function nearBatches(F: Frame): Pick<NearCache, "batches" | "loose"> {
  const { model, f } = F;
  const groups = new Map<
    string,
    Omit<NearBatch, "paths" | "hubs"> & { n: number[] }
  >();
  const loose: number[] = [];
  let budget = NEAR_MAX;
  for (const i of F.near) {
    if (i === f.hot) continue;
    if (budget-- <= 0) break;
    const n = model.nodes[i];
    if (!n) continue;
    if (n.kind === "agent" || n.kind === "root") {
      loose.push(i);
      continue;
    }
    const kind = kindOf(n);
    let tone: number;
    let alpha: number;
    let outline = 0;
    let step = 0;
    let level = 0;
    if (F.fresh && kind !== "hub") {
      const dim = alphaOf(F, i);
      const locked = kind === "lnote" || kind === "lfile";
      level = locked ? 0 : (F.fresh[i] ?? 0);
      step = strong(F, i) ? 7 : level;
      tone = -1;
      alpha = dim;
      outline = locked ? 0 : outlineOf(diam(F, n), dim);
    } else {
      tone = kind === "hub" || n.topic >= 0 ? n.topic : -2;
      alpha = alphaOf(F, i) * (theirs(n) ? 0.72 : 1);
    }
    const key = `${kind}|${tone}|${alpha}|${outline}|${step}|${level}`;
    let g = groups.get(key);
    if (!g) {
      g = { tone, kind, alpha, outline, step, level, halo: [], n: [] };
      groups.set(key, g);
    }
    g.n.push(i);
    if (F.fresh && (kind === "hub" || level >= 6)) g.halo.push(i);
  }
  // Plain dots first, hubs on top.
  const batches = [...groups.values()]
    .sort((x, y) => +(x.kind === "hub") - +(y.kind === "hub"))
    .map(({ n, ...g }) => ({
      ...g,
      hubs: g.kind === "hub" ? n : [],
      paths: groupPaths(F, g.kind, n, 1),
    }));
  return { batches, loose };
}

/** The neighbours' batches, cached like the resting dots' (a hover frame only fills). */
function drawNear(F: Frame) {
  const { scene, f, s, pal } = F;
  let nc = nearCaches.get(scene);
  if (
    !nc ||
    nc.pos !== f.pos ||
    nc.lit !== f.lit ||
    nc.soft !== f.soft ||
    nc.hot !== f.hot ||
    nc.sel !== f.sel ||
    nc.focus !== f.focusRing ||
    nc.s !== s ||
    // Orbit: the projection (sizes per depth) changes while it turns.
    F.depth !== null
  ) {
    nc = {
      pos: f.pos,
      lit: f.lit,
      soft: f.soft,
      hot: f.hot,
      sel: f.sel,
      focus: f.focusRing,
      s,
      ...nearBatches(F),
    };
    nearCaches.set(scene, nc);
  }
  if (F.fresh) {
    // Rings: every halo first, so none covers a neighbour's dot (as in drawDots).
    for (const b of nc.batches) {
      const hub = b.kind === "hub";
      if (!b.halo.length || (!hub && !F.c.glow)) continue;
      const peak = hub ? 0.3 : haloAlpha(b.level, f.clock ?? f.time, F.still);
      if (!hub && b.level === 7 && !F.still) F.ambient = true;
      for (const i of b.halo) {
        const [x, y] = P(F, i);
        const r = (diam(F, F.model.nodes[i]!) / 2) * depthOf(F, i) * F.px;
        stampHalo(
          F,
          hub ? pal.hub : pal.glow,
          x,
          y,
          r * (hub ? HUB_REACH : HALO_REACH),
          peak * b.alpha,
        );
      }
    }
  }
  for (const b of nc.batches) {
    const colour =
      b.kind === "hub"
        ? hubColour(F, b.tone)
        : b.tone === -1
          ? b.kind === "lnote" || b.kind === "lfile"
            ? pal.accent
            : pal.fresh[b.step]!
          : b.tone === -2
            ? pal.fg2
            : hueOf(F, b.tone);
    fillGroup(
      F,
      b.kind,
      colour,
      b.alpha,
      b.paths,
      NEAR_GLOW,
      b.tone >= 0 ? b.tone : -1,
      b.outline,
      b.hubs,
    );
  }
  for (const i of nc.loose) drawOne(F, i, 1, NEAR_GLOW);
}

/** The hot dot grown x1.7 with a glow, and its neighbours with a softer one. */
function drawHot(F: Frame) {
  const { ctx, f, model, pal, px } = F;
  if (F.near.size) drawNear(F);
  if (f.hot === null || !model.nodes[f.hot]) return;
  const n = model.nodes[f.hot]!;
  const [x, y] = P(F, f.hot);
  // A 2 px card-coloured ring under the grown shape.
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.bg;
  ctx.beginPath();
  ctx.arc(x, y, ((diam(F, n) / 2) * 1.7 * depthOf(F, f.hot) + 2) * px, 0, TAU);
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
    const r = (diam(F, n) / 2) * (i === f.hot ? 1.7 : 1) * depthOf(F, i);
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

  // Group names outside the circle, aligned away from it and cut to stay inside the box; a
  // group with nothing lit is drawn faint.
  if (scene.groupLabels.length && f.labelsOn !== false) {
    const on = groupsOn(F.c, scene, f.lit);
    const font = `600 12px ${fam}`;
    ctx.font = font;
    ctx.fillStyle = pal.fg;
    const x0 = sx(0) + GROUP_MARGIN;
    const x1 = sx(1000) - GROUP_MARGIN;
    scene.groupLabels.forEach((g, t) => {
      const x = sx(g.x);
      const text =
        g.align === "centre"
          ? g.text
          : fitGroup(ctx, font, g.text, g.align === "left" ? x1 - x : x - x0);
      ctx.globalAlpha = on[t] ? 1 : GROUP_DIM;
      ctx.textAlign =
        g.align === "centre" ? "center" : g.align === "left" ? "left" : "right";
      ctx.fillText(text, x, sy(g.y) + 0.5);
    });
    ctx.textAlign = "left";
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
    const r = (diam(F, n) / 2) * (i === f.hot ? 1.7 : 1) * depthOf(F, i);
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
