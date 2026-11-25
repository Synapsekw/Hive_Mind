import { beforeAll, describe, expect, it } from "vitest";
import { fixturePayload } from "./fixture";
import { activity, buildModel } from "./graph";
import { layout } from "./layouts";
import {
  canvasDpr,
  dotBatches,
  dotDiameter,
  drawFrame,
  fitGroupLabel,
  haloAlpha,
  LAYER_MAX_PX,
  type FrameState,
  type Palette,
} from "./renderer";
import { buildScene, type Scene } from "./scene";
import type { MapModel, ModelNode } from "./types";

// ---- A recording 2D context (no DOM under Vitest) ----

type Log = {
  /** Every property assignment, in order: [name, value]. */
  sets: [string, unknown][];
  /** Method calls by name. */
  calls: Map<string, number>;
};

function fakeCanvas(log: Log = { sets: [], calls: new Map() }) {
  const canvas = { width: 0, height: 0, log, getContext: () => ctx };
  const state: Record<string | symbol, unknown> = { canvas };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "createRadialGradient" || k === "createLinearGradient")
        return () => ({ addColorStop() {} });
      if (k === "measureText")
        return (text: string) => ({ width: text.length * 6 });
      if (k === "getTransform") return () => ({ a: 1, d: 1 });
      return (..._: unknown[]) => {
        const name = String(k);
        log.calls.set(name, (log.calls.get(name) ?? 0) + 1);
      };
    },
    set(t, k, v) {
      log.sets.push([String(k), v]);
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { canvas, ctx, log };
}

/** Every canvas the renderer makes for itself (layers, sprites), so their logs can be read. */
const made: ReturnType<typeof fakeCanvas>[] = [];

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    arc() {}
    closePath() {}
    rect() {}
  };
  g.document = {
    createElement: () => {
      const c = fakeCanvas();
      made.push(c);
      return c.canvas;
    },
  };
});

const NOW = Date.UTC(2026, 10, 23, 14, 0);
// Any parseable colour: the fake context draws nothing.
const C = "rgb(10, 20, 30)";
const PAL: Palette = {
  hue: Array.from({ length: 8 }, () => C),
  fg: C,
  fg2: C,
  bg: C,
  brand: C,
  line: C,
  lineHi: C,
  edge: C,
  accent: C,
  fresh: Array.from({ length: 8 }, () => C),
  glow: C,
  hub: C,
  haloBlend: "lighter",
};

function world(view: "rings" | "timeline"): {
  model: MapModel;
  scene: Scene;
  pos: [number, number][];
  lit: boolean[];
} {
  const model = buildModel(fixturePayload(NOW));
  const pos = layout(view, model, NOW);
  const scene = buildScene(model, view, pos, activity(model, NOW), NOW);
  return { model, scene, pos, lit: model.nodes.map(() => true) };
}

function frame(
  view: "rings" | "timeline",
  w: ReturnType<typeof world>,
  over: Partial<FrameState> = {},
): FrameState {
  return {
    view,
    cam: { k: 1, tx: 0, ty: 0 },
    world: { w: 1000, h: 760 },
    pos: w.pos,
    lit: w.lit,
    soft: null,
    hot: null,
    sel: null,
    focusRing: null,
    labels: new Set(),
    pulses: [],
    time: 1000,
    reducedMotion: false,
    ...over,
  };
}

function node(kind: ModelNode["kind"], nb: number[] = []): ModelNode {
  return {
    i: 1,
    id: kind === "hub" || kind === "root" ? null : "x",
    kind,
    topic: kind === "agent" || kind === "root" ? -1 : 0,
    member: null,
    mine: true,
    locked: false,
    title: "x",
    path: null,
    updatedAt: 0,
    createdAt: 0,
    byAgent: false,
    nb,
  };
}

describe("dotDiameter", () => {
  it("gives a note with no neighbours its normal size at scale 1", () => {
    // size(): 5 + neighbours, at most 10.
    expect(dotDiameter(node("note"), 1)).toBe(5);
    expect(dotDiameter(node("note", [2, 3, 4]), 1)).toBe(8);
    expect(dotDiameter(node("file", [2, 3, 4, 5, 6, 7, 8]), 1)).toBe(10);
  });

  it("keeps notes and files at 2.5 or more when shrunk", () => {
    expect(dotDiameter(node("note"), 0.3)).toBe(2.5);
    expect(dotDiameter(node("file"), 0.3)).toBe(2.5);
    expect(dotDiameter(node("note", [2, 3, 4, 5, 6]), 0.3)).toBe(3);
  });

  it("scales hubs and agents without the floor", () => {
    expect(dotDiameter(node("hub"), 0.3)).toBeCloseTo(4.8, 12);
    expect(dotDiameter(node("agent"), 0.3)).toBeCloseTo(4.2, 12);
    expect(dotDiameter(node("hub"), 0.1)).toBeCloseTo(1.6, 12);
  });

  it("is scale 1 when the scale is left out", () => {
    for (const kind of ["note", "file", "hub", "agent", "root"] as const)
      expect(dotDiameter(node(kind, [2]))).toBe(
        dotDiameter(node(kind, [2]), 1),
      );
    expect(dotDiameter(node("root"))).toBe(28);
  });
});

describe("fitGroupLabel", () => {
  // Every character 6 px wide.
  const m = (s: string) => s.length * 6;
  const label = "Quadruped fleet · 384"; // 21 characters, 126 px

  it("keeps a label that fits", () => {
    expect(fitGroupLabel(label, 126, m)).toBe(label);
  });

  it("cuts the name with an ellipsis and keeps the count whole", () => {
    // 72 px = 12 characters: 5 of the name, "…", then " · 384".
    expect(fitGroupLabel(label, 72, m)).toBe("Quadr… · 384");
    expect(m(fitGroupLabel(label, 72, m))).toBeLessThanOrEqual(72);
  });

  it("shows only the count when fewer than 4 name characters fit", () => {
    // 60 px = 10 characters: 3 of the name would fit.
    expect(fitGroupLabel(label, 60, m)).toBe("384");
    expect(fitGroupLabel(label, 0, m)).toBe("384");
  });

  it("drops a trailing space before the ellipsis", () => {
    // 96 px = 16 characters: "Quadruped " (10) trimmed to "Quadruped" leaves room for "…".
    expect(fitGroupLabel(label, 96, m)).toBe("Quadruped… · 384");
  });
});

describe("haloAlpha", () => {
  it("is nothing below level 6", () => {
    for (let level = 0; level < 6; level++)
      expect(haloAlpha(level, 1234, false)).toBe(0);
  });

  it("is 0.3 at level 6, moving or still", () => {
    expect(haloAlpha(6, 0, false)).toBe(0.3);
    expect(haloAlpha(6, 999, true)).toBe(0.3);
  });

  it("is 0.5 at level 7 when still", () => {
    expect(haloAlpha(7, 777, true)).toBe(0.5);
  });

  it("breathes between 0.42 and 0.58 at level 7 on a four-second cycle", () => {
    expect(haloAlpha(7, 0, false)).toBeCloseTo(0.5, 10);
    expect(haloAlpha(7, 1000, false)).toBeCloseTo(0.58, 10);
    expect(haloAlpha(7, 3000, false)).toBeCloseTo(0.42, 10);
    expect(haloAlpha(7, 4000, false)).toBeCloseTo(0.5, 10);
  });
});

describe("hub glow", () => {
  it("is stamped from a sprite: a calm frame never sets a shadow blur", () => {
    for (const view of ["timeline", "rings"] as const) {
      const w = world(view);
      for (const time of [1000, 3333]) {
        const { canvas, ctx, log } = fakeCanvas();
        canvas.width = 1000;
        canvas.height = 760;
        drawFrame(ctx, 2, w.scene, w.model, frame(view, w, { time }), PAL);
        const blurs = log.sets.filter(([k, v]) => k === "shadowBlur" && v);
        expect(blurs).toEqual([]);
      }
    }
  });

  it("a hovered hub glows from a sprite too", () => {
    const w = world("timeline");
    const hub = w.model.nodes.find((n) => n.kind === "hub" && n.nb.length)!;
    // Its neighbours keep their own soft glow; the hub's is the one drawn at 14 px.
    const { canvas, ctx, log } = fakeCanvas();
    canvas.width = 1000;
    canvas.height = 760;
    drawFrame(
      ctx,
      1,
      w.scene,
      w.model,
      frame("timeline", w, { hot: hub.i }),
      PAL,
    );
    const blurs = new Set(
      log.sets.filter(([k, v]) => k === "shadowBlur" && v).map(([, v]) => v),
    );
    expect(blurs.has(14)).toBe(false);
  });
});

describe("hover and zoom keep the caches", () => {
  function setup(view: "rings" | "timeline") {
    const w = world(view);
    const { canvas, ctx } = fakeCanvas();
    canvas.width = 1000;
    canvas.height = 760;
    const draw = (over: Partial<FrameState> = {}) =>
      drawFrame(ctx, 1, w.scene, w.model, frame(view, w, over), PAL);
    const strokes = () =>
      made.reduce((n, c) => n + (c.log.calls.get("stroke") ?? 0), 0);
    const hub = w.model.nodes.find((n) => n.kind === "hub" && n.nb.length)!;
    const soft = new Set([hub.i, ...hub.nb]);
    return { w, draw, strokes, hub, soft };
  }

  for (const view of ["rings", "timeline"] as const)
    it(`${view}: hovering a dot reuses the dot batches`, () => {
      const { w, draw, hub, soft } = setup(view);
      draw();
      const before = dotBatches(w.scene);
      expect(before).toBeDefined();
      draw({ hot: hub.i, soft });
      expect(dotBatches(w.scene)).toBe(before);
      draw();
      expect(dotBatches(w.scene)).toBe(before);
    });

  it("hovering a dot does not stroke the edge layer again", () => {
    const { draw, strokes, hub, soft } = setup("rings");
    draw();
    const n = strokes();
    expect(n).toBeGreaterThan(0);
    draw({ hot: hub.i, soft });
    draw({ sel: hub.i });
    draw();
    expect(strokes()).toBe(n);
  });

  it("a zoom keeps the dot batches while it moves and rebuilds them once settled", () => {
    const { w, draw } = setup("rings");
    draw();
    const before = dotBatches(w.scene);
    draw({ cam: { k: 1.5, tx: -100, ty: -80 }, moving: true });
    draw({ cam: { k: 2, tx: -200, ty: -160 }, moving: true });
    expect(dotBatches(w.scene)).toBe(before);
    draw({ cam: { k: 2, tx: -200, ty: -160 }, moving: false });
    const settled = dotBatches(w.scene);
    expect(settled).not.toBe(before);
    draw({ cam: { k: 2, tx: -200, ty: -160 }, moving: false });
    expect(dotBatches(w.scene)).toBe(settled);
  });
});

describe("canvas size caps", () => {
  it("draws at a device pixel ratio of at most 2", () => {
    expect(canvasDpr(1)).toBe(1);
    expect(canvasDpr(1.5)).toBe(1.5);
    expect(canvasDpr(2)).toBe(2);
    expect(canvasDpr(3)).toBe(2);
    expect(canvasDpr(undefined)).toBe(1);
    expect(canvasDpr(0)).toBe(1);
  });

  it("keeps the edge layer within 6 megapixels", () => {
    expect(LAYER_MAX_PX).toBe(6_000_000);
  });
});
