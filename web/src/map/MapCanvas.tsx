"use client";
// The map's one canvas: owns the element, the camera, pointer hit testing and the draw-on-demand
// loop. A frame is drawn only when something changed (a prop, the camera, the theme); the loop
// keeps running only while drawFrame reports an animation. Spec 1.01.
//
// It also owns the map's motion, none of which is React state: dots gliding to a new view in a
// wave (and blooming out of the core on arrival), new dots growing in after a refresh, firing
// and ambient pulses along links, cell flares, and the Orbit view's turn, drag and zoom.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";
import { toScreen } from "./camera";
import { buildHitGrid, hitTest, type HitGrid } from "./hitGrid";
import { projectOrbit, type OrbitProjection } from "./orbit3d";
import {
  clearTextCache,
  dotDiameter,
  drawFrame,
  readPalette,
  type Palette,
  type Pulse,
} from "./renderer";
import type { Scene } from "./scene";
import { nodeKey } from "./select";
import { staggerDelay } from "./stagger";
import { ease, tweenPositions } from "./tween";
import type { Filter, MapModel, View } from "./types";
import {
  reducedMotion,
  useCamera,
  type CameraApi,
  type Gesture,
} from "./useCamera";
import { ZoomControl } from "./ZoomControl";
import { zoomLabels } from "./zoomLabels";
import s from "./map.module.css";

export type { CameraApi } from "./useCamera";

/** What the legend dock is pointing at: its matching dots stay, the rest drop to the soft dim. */
export type Preview = Partial<Pick<Filter, "topic" | "kind" | "member">>;

/** The canvas's `data-preview`: `topic:0`, `kind:note`, `member:<id>`, or empty. */
export function previewTag(p: Preview | null): string {
  if (!p) return "";
  if (p.topic !== undefined && p.topic !== null) return `topic:${p.topic}`;
  if (p.kind !== undefined && p.kind !== null) return `kind:${p.kind}`;
  if (p.member !== undefined && p.member !== null) return `member:${p.member}`;
  return "";
}

type Props = {
  model: MapModel;
  scene: Scene;
  view: View;
  pos: [number, number][];
  /** Orbit: the cached 3D positions (layouts.ts `orbit`); null in the other views. */
  orbit: [number, number, number][] | null;
  lit: boolean[];
  soft: Set<number> | null;
  preview: Preview | null;
  hot: number | null;
  sel: number | null;
  focusRing: number | null;
  labelsOn: boolean;
  /** Labels from the map's own rules (selection, hubs, search, agents); zoom adds more. */
  labels: Set<number>;
  marks: Map<number, { state: "live" | "today" | "idle" }>;
  onHover(i: number | null, at: { x: number; y: number } | null): void;
  onPick(i: number | null): void; // null = empty-stage click
  cameraRef: RefObject<CameraApi | null>;
  /** A dot became hot or selected: one pulse runs out along each of its links. */
  fire: { from: number; at: number } | null;
  /** A comb cell's honey flares and fades back (an agent mark arrived). */
  flare: { node: number; at: number } | null;
};

type Tween = {
  from: [number, number][];
  to: [number, number][];
  delays: number[];
  t0: number;
  dur: number;
  /** A view change (staggered wave) rather than a mark's short move. */
  glide: boolean;
  /** When the last dot lands, ms after t0. */
  end: number;
};

const CENTRE: [number, number] = [500, 380];
const MOVING_MS = 120;
/** ~12 fps for the ambient breathing and turning. */
const AMBIENT_MS = 83;
/** ~30 fps while a faint ambient pulse travels (smooth enough, a third of the cost). */
const AMBIENT_PULSE_MS = 33;
/** The largest hit radius any shape can have, in screen px (the hot index, x1.7). */
const MAX_REACH = 24;
const THEME_ATTRS = ["data-theme", "data-mode", "data-dots", "data-reach"];
const GLIDE_MS = 900;
const MARK_MS = 800;
const GROW_MS = 600;
const PULSE_MS = 1100;
/** A hub can link to hundreds of items; one firing draws at most this many pulses. */
const MAX_FIRE = 160;
const AMBIENT_EVERY = 700;
const AMBIENT_MAX = 3;
const ORBIT_SPIN = 0.0012; // rad per frame at 60 fps
const ORBIT_DRAG = 0.006; // rad per px
const ORBIT_REST_MS = 3000;
const PULSE_VIEWS = new Set<View>(["rings", "topics", "links"]);

export function MapCanvas(props: Props): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<HTMLElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const raf = useRef<number | null>(null);
  const pal = useRef<Palette | null>(null);
  const still = useRef(false);
  const zoomSet = useRef<Set<number>>(new Set());
  const hover = useRef<number | null>(null);
  /** The last pointer position over the canvas (client px), to hover again once a glide ends. */
  const pointer = useRef<{ x: number; y: number } | null>(null);

  // Motion state (refs: the loop reads and writes them every frame).
  const target = useRef<{
    pos: [number, number][];
    model: MapModel;
    view: View;
  } | null>(null);
  const shown = useRef<[number, number][] | null>(null);
  const tween = useRef<Tween | null>(null);
  const grow = useRef<{ nodes: number[]; t0: number } | null>(null);
  const pulses = useRef<Pulse[]>([]);
  const lastAmbient = useRef(-Infinity);
  const flares = useRef(new Map<number, number>());
  const orbitState = useRef({
    ry: 0,
    zoom: 1,
    dragging: false,
    lastDrag: -Infinity,
    lastT: null as number | null,
  });
  const orbitProj = useRef<OrbitProjection | null>(null);
  const orbitGrid = useRef<{ proj: OrbitProjection; grid: HitGrid } | null>(
    null,
  );
  const [orbitZoom, setOrbitZoom] = useState(1);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ambientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The canvas is in the viewport and the tab is showing; otherwise nothing is drawn. */
  const onScreen = useRef(true);

  const drawRef = useRef<(t: number) => void>(() => {});
  const request = useCallback(() => {
    if (!onScreen.current || document.hidden) return;
    if (ambientTimer.current !== null) {
      clearTimeout(ambientTimer.current);
      ambientTimer.current = null;
    }
    if (raf.current === null)
      raf.current = requestAnimationFrame((t) => drawRef.current(t));
  }, []);

  // When the camera last moved: while it moves, the renderer moves its resting layer instead of
  // redrawing it, and redraws it crisp once the camera has been still for MOVING_MS.
  const lastMove = useRef(-Infinity);
  const onCamera = useCallback(() => {
    lastMove.current = performance.now();
    request();
  }, [request]);

  // In Orbit the stage's wheel zooms the sphere and a drag turns it.
  const orbitZoomBy = useCallback(
    (f: number) => {
      const o = orbitState.current;
      o.zoom = Math.max(0.6, Math.min(2.4, o.zoom * f));
      setOrbitZoom(o.zoom);
      request();
    },
    [request],
  );
  const gesture = useRef<Gesture | null>(null);
  gesture.current =
    props.view === "orbit"
      ? {
          wheel: (dy) => orbitZoomBy(Math.exp(-dy * 0.002)),
          drag: (dx) => {
            const o = orbitState.current;
            o.dragging = true;
            o.ry += dx * ORBIT_DRAG;
            request();
          },
          end: () => {
            const o = orbitState.current;
            o.dragging = false;
            o.lastDrag = performance.now();
            // Turning resumes 3 s after a drag.
            if (restTimer.current) clearTimeout(restTimer.current);
            restTimer.current = setTimeout(request, ORBIT_REST_MS + 20);
          },
        }
      : null;

  const camera = useCamera(stage, onCamera, gesture);
  const { cam, size, api, dragged, dragging } = camera;

  /** Starts a glide, a mark's move or a growth when the positions change. */
  const syncMotion = (p: Props, time: number) => {
    const prev = target.current;
    if (prev && prev.pos === p.pos) return;
    target.current = { pos: p.pos, model: p.model, view: p.view };
    const to = p.pos;
    if (still.current || p.view === "orbit") {
      tween.current = null;
      grow.current = null;
      shown.current = to;
      return;
    }
    let from: [number, number][];
    let glide = true;
    const fresh: number[] = [];
    if (!prev) {
      // Arrival: every dot blooms out of the core.
      from = to.map(() => CENTRE);
    } else if (prev.model !== p.model) {
      // A refresh: dots glide from where they were (matched by key); new ones grow in place.
      const cur = shown.current ?? prev.pos;
      const old = new Map<string, [number, number]>();
      for (const n of prev.model.nodes) {
        const k = nodeKey(prev.model, n.i);
        const at = cur[n.i];
        if (k !== null && at) old.set(k, at);
      }
      from = to.map((b, i) => {
        const k = nodeKey(p.model, i);
        const a = k !== null ? old.get(k) : undefined;
        if (!a) fresh.push(i);
        return a ?? b;
      });
    } else {
      from = shown.current ?? prev.pos;
      // The same view and model: only a few dots moved (an agent mark).
      glide = prev.view !== p.view;
    }
    let moved = false;
    for (let i = 0; i < to.length && !moved; i++) {
      const a = from[i];
      const b = to[i]!;
      if (!a || Math.abs(a[0] - b[0]) > 0.01 || Math.abs(a[1] - b[1]) > 0.01)
        moved = true;
    }
    if (fresh.length && fresh.length < to.length)
      grow.current = { nodes: fresh, t0: time };
    if (!moved) {
      tween.current = null;
      shown.current = to;
      return;
    }
    const dur = glide ? GLIDE_MS : MARK_MS;
    const delays = glide
      ? to.map(([x, y], i) => staggerDelay(x, y, i))
      : to.map(() => 0);
    let last = 0;
    for (const d of delays) if (d > last) last = d;
    tween.current = { from, to, delays, t0: time, dur, glide, end: last + dur };
  };

  drawRef.current = (time: number) => {
    raf.current = null;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const { sw, sh, w, h } = size.current;
    if (!el || !ctx || sw <= 0 || sh <= 0) return;
    if (!pal.current) pal.current = readPalette(el);
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(sw * dpr));
    const H = Math.max(1, Math.round(sh * dpr));
    if (el.width !== W || el.height !== H) {
      el.width = W;
      el.height = H;
    }
    const p = latest.current;
    let motion = false;

    // Positions: the glide, a mark's move, or where the dots are.
    syncMotion(p, time);
    let drawn = p.pos;
    let layerAlpha = 1;
    let landed = false;
    const tw = tween.current;
    if (tw) {
      const r = tweenPositions(tw.from, tw.to, tw.delays, time - tw.t0, tw.dur);
      if (r.done) {
        tween.current = null;
        landed = tw.glide;
      } else {
        drawn = r.pos;
        motion = true;
        // The comb, guides and links fade in as the dots arrive.
        if (tw.glide) layerAlpha = ease(Math.min(1, (time - tw.t0) / tw.end));
      }
    }
    shown.current = drawn;
    let growing: Map<number, number> | null = null;
    const g = grow.current;
    if (g) {
      const u = (time - g.t0) / GROW_MS;
      if (u >= 1) grow.current = null;
      else {
        growing = new Map(g.nodes.map((i) => [i, ease(Math.max(0, u))]));
        motion = true;
      }
    }

    // Orbit: turn unless dragged (or within 3 s of a drag), hovered, or still; then project.
    let proj: OrbitProjection | null = null;
    if (p.view === "orbit" && p.orbit) {
      const o = orbitState.current;
      const spin =
        !still.current &&
        p.hot === null &&
        !o.dragging &&
        time - o.lastDrag > ORBIT_REST_MS;
      if (spin && o.lastT !== null)
        o.ry += ORBIT_SPIN * Math.min(4, (time - o.lastT) / (1000 / 60));
      o.lastT = spin ? time : null;
      if (spin) motion = true;
      proj = projectOrbit(p.orbit, o.ry, o.zoom, sw, sh);
      el.setAttribute("data-ry", o.ry.toFixed(3));
    } else el.removeAttribute("data-ry");
    orbitProj.current = proj;

    // Pulses: firing ones, and a faint ambient one about every 700 ms in the calm flat views.
    pulses.current = pulses.current.filter((q) => time < q.t0 + q.dur);
    const ambientOk =
      !still.current &&
      PULSE_VIEWS.has(p.view) &&
      p.hot === null &&
      !tw?.glide &&
      p.model.edges.length > 0;
    if (
      ambientOk &&
      time - lastAmbient.current >= AMBIENT_EVERY &&
      pulses.current.filter((q) => q.ambient).length < AMBIENT_MAX
    ) {
      const [u, v] =
        p.model.edges[Math.floor(Math.random() * p.model.edges.length)]!;
      const flip = Math.random() < 0.5;
      pulses.current.push({
        from: flip ? v : u,
        to: flip ? u : v,
        t0: time,
        dur: PULSE_MS,
        colour: pal.current.brand,
        ambient: true,
      });
      lastAmbient.current = time;
    }
    for (const [node, t0] of flares.current)
      if (time - t0 > 1400) flares.current.delete(node);

    // Still for MOVING_MS, even with the pointer held down: the resting layer is redrawn crisp.
    const moving = time - lastMove.current < MOVING_MS;
    // Zoom-driven labels were placed for the last settled camera; hide them while it moves.
    const labels =
      moving || zoomSet.current.size === 0 || p.view === "orbit"
        ? p.labels
        : new Set([...p.labels, ...zoomSet.current]);
    const anim = drawFrame(
      ctx,
      dpr,
      p.scene,
      p.model,
      {
        view: p.view,
        cam: cam.current,
        world: { w, h },
        pos: drawn,
        lit: p.lit,
        soft: p.soft,
        hot: p.hot,
        sel: p.sel,
        focusRing: p.focusRing,
        labels,
        marks: p.marks,
        pulses: pulses.current,
        flares: flares.current,
        time,
        reducedMotion: still.current,
        moving,
        grow: growing,
        layerAlpha,
        orbit: proj,
      },
      pal.current,
    );
    el.setAttribute("data-k", cam.current.k.toFixed(2));
    // Real motion runs every frame; the calm breathing and turning only ~12 times a second.
    const kind =
      motion || anim === "motion"
        ? "motion"
        : anim || (ambientOk ? "ambient" : false);
    if (kind === "motion") {
      el.setAttribute("data-animating", "");
      el.removeAttribute("data-ambient");
      request();
    } else if (kind === "ambient") {
      el.removeAttribute("data-animating");
      el.setAttribute("data-ambient", "");
      const fast = pulses.current.some((q) => q.ambient);
      ambientTimer.current = setTimeout(
        () => {
          ambientTimer.current = null;
          request();
        },
        fast ? AMBIENT_PULSE_MS : AMBIENT_MS,
      );
    } else {
      el.removeAttribute("data-animating");
      el.removeAttribute("data-ambient");
    }
    // The dots have landed: the pointer may now be over one.
    if (landed && pointer.current && !dragging.current) {
      const at = pointer.current;
      setHover(hitAt(at.x, at.y), at);
    }
  };

  // Any prop change draws one frame.
  useEffect(() => {
    request();
  });

  // Firing: one pulse out along each link of a dot that became hot or selected.
  const { fire, flare } = props;
  useEffect(() => {
    if (!fire || still.current) return;
    const { model } = latest.current;
    const n = model.nodes[fire.from];
    if (!n) return;
    if (!pal.current && canvas.current)
      pal.current = readPalette(canvas.current);
    const P = pal.current;
    if (!P) return;
    const colour =
      n.topic >= 0
        ? (P.hue[model.topics[n.topic]?.hue ?? -1] ?? P.fg2)
        : n.kind === "agent" && latest.current.view === "hive"
          ? P.brand
          : P.fg2;
    for (const j of n.nb.slice(0, MAX_FIRE))
      pulses.current.push({
        from: fire.from,
        to: j,
        t0: fire.at + Math.random() * 120,
        dur: PULSE_MS,
        colour,
      });
    request();
  }, [fire, request]);

  // A flare: the cell's honey brightens and fades back over 1.4 s.
  useEffect(() => {
    if (!flare || still.current) return;
    flares.current.set(flare.node, flare.at);
    request();
  }, [flare, request]);

  // Pause entirely while the canvas is off-screen or the tab is hidden; draw again on return.
  useEffect(() => {
    const el = canvas.current;
    const resume = () => {
      if (onScreen.current && !document.hidden) request();
    };
    document.addEventListener("visibilitychange", resume);
    const io =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            onScreen.current = entries.some((e) => e.isIntersecting);
            resume();
          })
        : null;
    if (el) io?.observe(el);
    // Web fonts change label widths: measure them again once they load.
    const fonts = document.fonts;
    const refont = () => {
      clearTextCache();
      request();
    };
    fonts?.addEventListener?.("loadingdone", refont);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      io?.disconnect();
      fonts?.removeEventListener?.("loadingdone", refont);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      if (ambientTimer.current !== null) clearTimeout(ambientTimer.current);
      ambientTimer.current = null;
      if (restTimer.current !== null) clearTimeout(restTimer.current);
      restTimer.current = null;
    };
  }, [request]);

  // The theme's colours: read on mount and again when the look changes.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    still.current = reducedMotion();
    const onMotion = () => {
      still.current = reducedMotion();
      if (still.current) {
        tween.current = null;
        grow.current = null;
        pulses.current = [];
        flares.current.clear();
      }
      request();
    };
    mq?.addEventListener?.("change", onMotion);
    const mo = new MutationObserver(() => {
      if (canvas.current) pal.current = readPalette(canvas.current);
      request();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: THEME_ATTRS,
    });
    return () => {
      mq?.removeEventListener?.("change", onMotion);
      mo.disconnect();
    };
  }, [request]);

  // The camera for the map screen (keys, picking, the view switch, the peek's anchor).
  useEffect(() => {
    const ref = props.cameraRef;
    const orbiting = () => latest.current.view === "orbit";
    ref.current = {
      zoomBy: (f) => (orbiting() ? orbitZoomBy(f) : api.current.zoomBy(f)),
      fitView: () => {
        if (orbiting()) {
          orbitState.current.zoom = 1;
          setOrbitZoom(1);
          request();
        }
        api.current.fitView();
      },
      frameOn: (pts) => api.current.frameOn(pts),
      panBy: (dx, dy) => api.current.panBy(dx, dy),
      k: () => api.current.k(),
      screenOf: (i) => {
        const el = canvas.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const proj = orbitProj.current;
        if (orbiting()) {
          const at = proj?.pos[i];
          return at ? { x: r.left + at[0], y: r.top + at[1] } : null;
        }
        const at = shown.current?.[i] ?? latest.current.pos[i];
        if (!at) return null;
        const { w, h } = size.current;
        const [x, y] = toScreen(cam.current, at[0], at[1], w, h);
        return { x: r.left + x, y: r.top + y };
      },
    };
    return () => {
      ref.current = null;
    };
  }, [props.cameraRef, api, orbitZoomBy, request, cam, size]);

  // Zoom-driven labels, worked out once a pan or zoom settles (never per frame).
  const { model, pos, lit, view, labelsOn, labels } = props;
  useEffect(() => {
    const { sw, sh, w, h } = size.current;
    const k = cam.current.k;
    if (!labelsOn || k < 1.8 || sw <= 0 || view === "orbit") {
      if (zoomSet.current.size) {
        zoomSet.current = new Set();
        request();
      }
      return;
    }
    const c = cam.current;
    const width = (i: number) =>
      Math.min(220, (model.nodes[i]?.title.length ?? 0) * 6.6 + 14);
    const zoomed = zoomLabels(
      model.nodes
        .filter((n) => n.kind !== "root")
        .map((n) => {
          const [x, y] = pos[n.i] ?? [500, 380];
          return {
            i: n.i,
            on: !!lit[n.i],
            links: n.nb.length,
            x,
            y,
            width: width(n.i),
          };
        }),
      k,
      { w: sw, h: sh },
      (x, y) => toScreen(c, x, y, w, h),
    );
    // A second pass with the boxes as the renderer places them (left of the dot past x 760),
    // the rule labels placed first, so a zoom label never runs into a hub's or the selection's.
    type Box = [number, number, number, number];
    const box = (i: number): Box => {
      const [x, y] = pos[i] ?? [500, 380];
      const [sx, sy] = toScreen(c, x, y, w, h);
      const wd = width(i);
      const x0 = x > 760 ? sx - 12 - wd : sx + 6;
      return [x0, sy - 10, x0 + wd, sy + 10];
    };
    const hit = (a: Box, b: Box) =>
      a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const placed = [...labels].map(box);
    const keep = new Set<number>();
    for (const i of zoomed) {
      if (labels.has(i)) continue;
      const b = box(i);
      if (placed.some((p) => hit(p, b))) continue;
      placed.push(b);
      keep.add(i);
    }
    zoomSet.current = keep;
    request();
  }, [
    camera.settled,
    model,
    pos,
    lit,
    view,
    labelsOn,
    labels,
    cam,
    size,
    request,
  ]);

  // Hit testing runs against where the dots land, not where a glide has them mid-way.
  const grid = useMemo(() => buildHitGrid(pos), [pos]);
  // The zoom a screen reader hears: only once the camera settles, not on every frame.
  const settledK = useMemo(() => cam.current.k, [camera.settled, cam]);

  const hitAt = (clientX: number, clientY: number): number | null => {
    const el = canvas.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const p = latest.current;
    const eligible = (i: number) => !!p.lit[i] || p.hot === i;
    if (p.view === "orbit") {
      const proj = orbitProj.current;
      if (!proj) return null;
      // The projection moves while the orbit turns: re-bucket only when it changed.
      let og = orbitGrid.current;
      if (!og || og.proj !== proj) {
        og = { proj, grid: buildHitGrid(proj.pos) };
        orbitGrid.current = og;
      }
      const x = clientX - r.left;
      const y = clientY - r.top;
      return hitTest(og.grid, x, y, MAX_REACH, (i) => {
        const n = p.model.nodes[i];
        if (!n || !eligible(i)) return false;
        const rad =
          (dotDiameter(n, false, false) / 2) *
          (i === p.hot ? 1.7 : 1) *
          (proj.p[i] ?? 1);
        const [px, py] = proj.pos[i]!;
        return Math.hypot(px - x, py - y) <= Math.max(8, rad);
      });
    }
    const c = cam.current;
    const sc = (size.current.w / 1000) * c.k;
    if (sc <= 0) return null;
    const bx = (clientX - r.left - c.tx) / sc;
    const by = (clientY - r.top - c.ty) / sc;
    // Within 8 px of the dot, or within its drawn radius for the larger shapes.
    const hive = p.view === "hive";
    const small = p.scene.combSize > 0 && p.scene.combSize < 10;
    const reach = (i: number) => {
      const n = p.model.nodes[i];
      if (!n) return 8 / sc;
      const r = (dotDiameter(n, hive, small) / 2) * (i === p.hot ? 1.7 : 1);
      return Math.max(8, r) / sc;
    };
    return hitTest(grid, bx, by, MAX_REACH / sc, (i) => {
      if (!eligible(i)) return false;
      const [x, y] = p.pos[i] ?? CENTRE;
      return Math.hypot(x - bx, y - by) <= reach(i);
    });
  };

  const setHover = (i: number | null, at: { x: number; y: number } | null) => {
    if (i === hover.current) return;
    hover.current = i;
    latest.current.onHover(i, at);
  };

  const orbiting = props.view === "orbit";
  return (
    <>
      <canvas
        ref={(el) => {
          canvas.current = el;
          stage.current = el?.parentElement ?? null;
        }}
        className={s.canvas}
        aria-hidden="true"
        data-map-canvas=""
        data-view={props.view}
        data-hot={props.hot ?? ""}
        data-preview={previewTag(props.preview)}
        onPointerMove={(e) => {
          const el = e.currentTarget;
          pointer.current = { x: e.clientX, y: e.clientY };
          if (dragging.current) {
            el.style.cursor = "grabbing";
            if (hover.current !== null) setHover(null, null);
            return;
          }
          // While the dots glide to a new view, hover waits for them to land.
          if (tween.current?.glide) return;
          const i = hitAt(e.clientX, e.clientY);
          setHover(i, i === null ? null : { x: e.clientX, y: e.clientY });
          el.style.cursor = i !== null ? "pointer" : "grab";
        }}
        onPointerUp={(e) => {
          e.currentTarget.style.cursor =
            hover.current !== null ? "pointer" : "grab";
        }}
        onPointerLeave={() => {
          pointer.current = null;
          setHover(null, null);
        }}
        onClick={(e) => {
          // A drag is not a click, and the second click of a double-click (which zooms) must
          // not undo the first one's selection.
          if (dragged.current || e.detail >= 2) return;
          latest.current.onPick(hitAt(e.clientX, e.clientY));
        }}
      />
      <ZoomControl
        k={orbiting ? orbitZoom : cam.current.k}
        settledK={orbiting ? orbitZoom : settledK}
        onZoom={(f) => (orbiting ? orbitZoomBy(f) : api.current.zoomBy(f))}
        onFit={() => props.cameraRef.current?.fitView()}
      />
    </>
  );
}
