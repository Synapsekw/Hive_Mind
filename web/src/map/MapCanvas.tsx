"use client";
// The map's one canvas: owns the element, the camera, pointer hit testing and the draw-on-demand
// loop. A frame is drawn only when something changed (a prop, the camera, the theme); the loop
// keeps running only while drawFrame reports an animation. Spec 1.01.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type JSX,
  type RefObject,
} from "react";
import { toScreen } from "./camera";
import { buildHitGrid, hitTest } from "./hitGrid";
import {
  clearTextCache,
  dotDiameter,
  drawFrame,
  readPalette,
  type Palette,
} from "./renderer";
import type { Scene } from "./scene";
import type { MapModel, View } from "./types";
import { reducedMotion, useCamera, type CameraApi } from "./useCamera";
import { ZoomControl } from "./ZoomControl";
import { zoomLabels } from "./zoomLabels";
import s from "./map.module.css";

export type { CameraApi } from "./useCamera";

type Props = {
  model: MapModel;
  scene: Scene;
  view: View;
  pos: [number, number][];
  lit: boolean[];
  soft: Set<number> | null;
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
  fire: { from: number; at: number } | null;
  flare: { node: number; at: number } | null;
};

const NO_PULSES: never[] = [];
const NO_FLARES = new Map<number, number>();
const MOVING_MS = 120;
/** ~12 fps for the ambient breathing and turning. */
const AMBIENT_MS = 83;
/** The largest hit radius any shape can have, in screen px (the hot index, x1.7). */
const MAX_REACH = 24;
const THEME_ATTRS = ["data-theme", "data-mode", "data-dots", "data-reach"];

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
  const camera = useCamera(stage, onCamera);
  const { cam, size, api, dragged, dragging } = camera;

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
    // Still for MOVING_MS, even with the pointer held down: the resting layer is redrawn crisp.
    const moving = time - lastMove.current < MOVING_MS;
    // Zoom-driven labels were placed for the last settled camera; hide them while it moves.
    const labels =
      moving || zoomSet.current.size === 0
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
        pos: p.pos,
        lit: p.lit,
        soft: p.soft,
        hot: p.hot,
        sel: p.sel,
        focusRing: p.focusRing,
        labels,
        marks: p.marks,
        pulses: NO_PULSES,
        flares: NO_FLARES,
        time,
        reducedMotion: still.current,
        moving,
      },
      pal.current,
    );
    el.setAttribute("data-k", cam.current.k.toFixed(2));
    // Real motion runs every frame; the calm breathing and turning only ~12 times a second.
    if (anim === "motion") {
      el.setAttribute("data-animating", "");
      el.removeAttribute("data-ambient");
      request();
    } else if (anim === "ambient") {
      el.removeAttribute("data-animating");
      el.setAttribute("data-ambient", "");
      ambientTimer.current = setTimeout(() => {
        ambientTimer.current = null;
        request();
      }, AMBIENT_MS);
    } else {
      el.removeAttribute("data-animating");
      el.removeAttribute("data-ambient");
    }
  };

  // Any prop change draws one frame.
  useEffect(() => {
    request();
  });

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
    };
  }, [request]);

  // The theme's colours: read on mount and again when the look changes.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    still.current = reducedMotion();
    const onMotion = () => {
      still.current = reducedMotion();
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

  // The camera for the map screen (keys, picking, the view switch).
  useEffect(() => {
    const ref = props.cameraRef;
    ref.current = {
      zoomBy: (f) => api.current.zoomBy(f),
      fitView: () => api.current.fitView(),
      frameOn: (pts) => api.current.frameOn(pts),
      panBy: (dx, dy) => api.current.panBy(dx, dy),
      k: () => api.current.k(),
    };
    return () => {
      ref.current = null;
    };
  }, [props.cameraRef, api]);

  // Zoom-driven labels, worked out once a pan or zoom settles (never per frame).
  const { model, pos, lit, view, labelsOn, labels } = props;
  useEffect(() => {
    const { sw, sh, w, h } = size.current;
    const k = cam.current.k;
    if (!labelsOn || k < 1.8 || sw <= 0) {
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

  const grid = useMemo(() => buildHitGrid(pos), [pos]);
  // The zoom a screen reader hears: only once the camera settles, not on every frame.
  const settledK = useMemo(() => cam.current.k, [camera.settled, cam]);

  const hitAt = (clientX: number, clientY: number): number | null => {
    const el = canvas.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = cam.current;
    const sc = (size.current.w / 1000) * c.k;
    if (sc <= 0) return null;
    const bx = (clientX - r.left - c.tx) / sc;
    const by = (clientY - r.top - c.ty) / sc;
    const p = latest.current;
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
      if (!p.lit[i] && p.hot !== i) return false;
      const [x, y] = p.pos[i] ?? [500, 380];
      return Math.hypot(x - bx, y - by) <= reach(i);
    });
  };

  const setHover = (i: number | null, at: { x: number; y: number } | null) => {
    if (i === hover.current) return;
    hover.current = i;
    latest.current.onHover(i, at);
  };

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
        data-preview=""
        onPointerMove={(e) => {
          const el = e.currentTarget;
          if (dragging.current) {
            el.style.cursor = "grabbing";
            if (hover.current !== null) setHover(null, null);
            return;
          }
          const i = hitAt(e.clientX, e.clientY);
          setHover(i, i === null ? null : { x: e.clientX, y: e.clientY });
          el.style.cursor = i !== null ? "pointer" : "grab";
        }}
        onPointerUp={(e) => {
          e.currentTarget.style.cursor =
            hover.current !== null ? "pointer" : "grab";
        }}
        onPointerLeave={() => setHover(null, null)}
        onClick={(e) => {
          // A drag is not a click, and the second click of a double-click (which zooms) must
          // not undo the first one's selection.
          if (dragged.current || e.detail >= 2) return;
          latest.current.onPick(hitAt(e.clientX, e.clientY));
        }}
      />
      <ZoomControl
        k={cam.current.k}
        settledK={settledK}
        onZoom={(f) => api.current.zoomBy(f)}
        onFit={() => api.current.fitView()}
      />
    </>
  );
}
