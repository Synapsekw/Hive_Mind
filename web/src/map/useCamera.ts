"use client";
// The map's camera as a hook: the transform lives in a ref (the canvas reads it every frame, so
// it is not React state). `version` is state only for the zoom percentage and for settling.
// Wheel zooms toward the cursor, a drag of 4 px or more pans, double-click zooms x2, and glides
// tween the camera over 650 ms (instant under reduced motion). Maths: camera.ts.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import {
  clampK,
  fit,
  frame,
  keepView,
  pinchCam,
  wheelFactor,
  zoomAt,
  type Cam,
  type StageSize,
} from "./camera";

export type CameraApi = {
  zoomBy(f: number): void;
  fitView(): void;
  frameOn(points: [number, number][]): void;
  panBy(dx: number, dy: number): void;
  k(): number;
  /** Where node `i` is drawn now, in client px (the peek's anchor for a focused dot). */
  screenOf(i: number): { x: number; y: number } | null;
};

/** The camera itself; MapCanvas adds `screenOf`, which needs the drawn positions. */
type CamOnly = Omit<CameraApi, "screenOf">;

/**
 * While set (the Orbit view), the stage's wheel and drag go here instead of to the camera: the
 * wheel zooms the sphere and a drag turns it.
 */
export type Gesture = {
  wheel(deltaY: number): void;
  /** Horizontal movement since the last call, css px. */
  drag(dx: number): void;
  end(): void;
};

/** sw x sh: the stage, css px; w x h: the 1000 x 760 box fitted at k = 1. */
export type Size = StageSize;

const GLIDE_MS = 650;
const DRAG_PX = 4;
const SETTLE_MS = 60;

/**
 * `--ease` is cubic-bezier(0.16, 1, 0.3, 1); `1 - (1 - t)^4` is its close equivalent (the same
 * fast start and long settle) and needs no solver.
 */
const ease = (t: number) => 1 - (1 - t) ** 4;

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function useCamera(
  stage: RefObject<HTMLElement | null>,
  onChange: () => void,
  gesture?: RefObject<Gesture | null>,
) {
  const cam = useRef<Cam>({ k: 1, tx: 0, ty: 0 });
  const size = useRef<Size>({ sw: 0, sh: 0, w: 0, h: 0 });
  /** True from the moment a pointer-down moves 4 px until the next pointer-down. */
  const dragged = useRef(false);
  const dragging = useRef(false);
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState(0);
  const glide = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  const settle = useCallback((ms: number) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettled((v) => v + 1), ms);
  }, []);

  const set = useCallback((c: Cam) => {
    cam.current = c;
    setVersion((v) => v + 1);
    change.current();
  }, []);

  const stop = useCallback(() => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  }, []);

  const jump = useCallback(
    (c: Cam) => {
      stop();
      set(c);
      settle(SETTLE_MS);
    },
    [set, settle, stop],
  );

  // The running glide's ends and start time, so a resize mid-glide can carry them to the new size.
  const path = useRef<{ from: Cam; to: Cam; t0: number } | null>(null);
  const glideTo = useCallback(
    (to: Cam) => {
      stop();
      if (reducedMotion()) return jump(to);
      const g = { from: cam.current, to, t0: performance.now() };
      path.current = g;
      const step = (now: number) => {
        const p = Math.min(1, (now - g.t0) / GLIDE_MS);
        const e = ease(p);
        const { from, to } = g;
        set(
          p >= 1
            ? to
            : {
                k: from.k + (to.k - from.k) * e,
                tx: from.tx + (to.tx - from.tx) * e,
                ty: from.ty + (to.ty - from.ty) * e,
              },
        );
        glide.current = p < 1 ? requestAnimationFrame(step) : null;
      };
      glide.current = requestAnimationFrame(step);
      settle(GLIDE_MS);
    },
    [jump, set, settle, stop],
  );

  const api = useRef<CamOnly>(null as unknown as CamOnly);
  api.current = {
    zoomBy(f) {
      const { sw, sh } = size.current;
      jump(zoomAt(cam.current, f, sw / 2, sh / 2));
    },
    fitView() {
      const { w, h, sw, sh } = size.current;
      glideTo(fit(w, h, sw, sh));
    },
    frameOn(points) {
      const { w, h, sw, sh } = size.current;
      glideTo(frame(points, w, h, sw, sh));
    },
    panBy(dx, dy) {
      const c = cam.current;
      jump({ k: c.k, tx: c.tx + dx, ty: c.ty + dy });
    },
    k: () => cam.current.k,
  };

  // Size: the box fitted to the stage. The first measure fits; a later resize (a rail folding)
  // keeps the view (keepView: a fitted camera stays fitted, a zoomed one keeps its zoom and the
  // map point at the centre). A glide under way carries on toward its target at the new size.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const sw = r.width;
      const sh = r.height;
      const s0 = Math.min(sw / 1000, sh / 760);
      const a = size.current;
      const b = { sw, sh, w: 1000 * s0, h: 760 * s0 };
      if (a.sw === b.sw && a.sh === b.sh) return;
      size.current = b;
      const g = glide.current !== null ? path.current : null;
      if (g) {
        g.from = keepView(g.from, a, b);
        g.to = keepView(g.to, a, b);
        cam.current = keepView(cam.current, a, b);
        change.current();
        return;
      }
      stop();
      set(keepView(cam.current, a, b));
      settle(SETTLE_MS);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage, set, settle, stop]);

  // Wheel, drag and double-click on the stage. Overlays (`data-map-overlay`) are left alone.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onOverlay = (e: Event) =>
      e.target instanceof Element && !!e.target.closest("[data-map-overlay]");

    const wheel = (e: WheelEvent) => {
      if (onOverlay(e)) return;
      e.preventDefault();
      if (gesture?.current) return gesture.current.wheel(e.deltaY);
      const [x, y] = local(e);
      jump(zoomAt(cam.current, wheelFactor(e.deltaY, e.ctrlKey), x, y));
    };
    let start: {
      x: number;
      y: number;
      tx: number;
      ty: number;
      id: number;
      lastX: number;
    } | null = null;
    // Touch pointers in stage pixels. With two, the gesture is a pinch (zoom about the midpoint,
    // pan with it); once a gesture has pinched, a remaining finger never pans on its own.
    const touches = new Map<number, [number, number]>();
    let pinched = false;
    const down = (e: PointerEvent) => {
      if (onOverlay(e)) return;
      if (e.pointerType === "touch") {
        const [x, y] = local(e);
        touches.set(e.pointerId, [x, y]);
        if (touches.size === 1) pinched = false;
        if (touches.size >= 2) {
          pinched = true;
          dragged.current = true; // a pinch is never a click
          dragging.current = false;
          start = null;
          stop();
          return;
        }
      } else if (e.button !== 0) return;
      dragged.current = false;
      start = {
        x: e.clientX,
        y: e.clientY,
        tx: cam.current.tx,
        ty: cam.current.ty,
        id: e.pointerId,
        lastX: e.clientX,
      };
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" && touches.has(e.pointerId)) {
        const [x, y] = local(e);
        const ids = [...touches.keys()].slice(0, 2);
        if (touches.size >= 2 && ids.includes(e.pointerId)) {
          const [a0, b0] = ids.map((i) => touches.get(i)!) as [
            [number, number],
            [number, number],
          ];
          touches.set(e.pointerId, [x, y]);
          const [a1, b1] = ids.map((i) => touches.get(i)!) as [
            [number, number],
            [number, number],
          ];
          set(pinchCam(cam.current, a0, b0, a1, b1));
          return;
        }
        touches.set(e.pointerId, [x, y]);
        if (pinched) return;
      }
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging.current && Math.hypot(dx, dy) < DRAG_PX) return;
      if (!dragging.current) {
        dragging.current = true;
        dragged.current = true;
        stop();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // The pointer may already be gone.
        }
      }
      if (gesture?.current) {
        gesture.current.drag(e.clientX - start.lastX);
        start.lastX = e.clientX;
        return;
      }
      set({ k: cam.current.k, tx: start.tx + dx, ty: start.ty + dy });
    };
    const up = (e: PointerEvent) => {
      if (touches.delete(e.pointerId) && pinched) {
        start = null;
        if (touches.size === 0) pinched = false;
        change.current();
        settle(SETTLE_MS);
        return;
      }
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (dragging.current) {
        dragging.current = false;
        gesture?.current?.end();
        change.current();
        settle(SETTLE_MS);
      }
    };
    const dbl = (e: MouseEvent) => {
      if (onOverlay(e) || gesture?.current) return;
      const [x, y] = local(e);
      const to = zoomAt(cam.current, 2, x, y);
      to.k = clampK(to.k);
      glideTo(to);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("dblclick", dbl);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("dblclick", dbl);
    };
  }, [stage, jump, glideTo, set, settle, stop, gesture]);

  useEffect(
    () => () => {
      stop();
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [stop],
  );

  return { cam, size, api, version, settled, dragged, dragging };
}
