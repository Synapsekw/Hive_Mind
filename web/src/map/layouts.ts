// One pure function per view, from the model to positions in the 1000 x 760 box (orbit: 3D).
// Ported from the prototype's geometry in docs/ui/map.dc.html (`build()` and `force()`).
import { BOX, dayIndex, DAYS } from "./graph";
import type { MapModel, View } from "./types";

type P2 = [number, number];
type P3 = [number, number, number];
type Sector = { a0: number; w: number; mid: number };

const CX = 500;
const CY = 380;
const TAU = Math.PI * 2;
const GAP = 0.05;
/** The narrowest sector a topic gets, so one item next to two hundred is still visible. */
const MIN_SECTOR = 0.12;

const polar = (r: number, a: number): P2 => [
  CX + r * Math.cos(a),
  CY + r * Math.sin(a),
];

type Parts = {
  hubs: number[]; // node index of each topic's hub
  items: number[][]; // node indices of each topic's items, in model order
  agents: number[];
  sec: Sector[];
};

function parts(model: MapModel): Parts {
  const T = model.topics.length;
  const hubs = new Array<number>(T).fill(0);
  const items: number[][] = model.topics.map(() => []);
  const agents: number[] = [];
  for (const n of model.nodes) {
    if (n.kind === "hub") hubs[n.topic] = n.i;
    else if (n.kind === "agent") agents.push(n.i);
    else if (n.kind !== "root") items[n.topic]!.push(n.i);
  }
  const total = items.reduce((s, l) => s + l.length, 0);
  const usable = TAU - 0.28 - T * GAP;
  const min = T > 0 ? Math.min(MIN_SECTOR, usable / T) : 0;
  const spare = usable - T * min;
  let a = -TAU / 4 + 0.14;
  const sec = items.map((l) => {
    const w = min + (total > 0 ? (spare * l.length) / total : spare / T);
    const s = { a0: a, w, mid: a + w / 2 };
    a += w + GAP;
    return s;
  });
  return { hubs, items, agents, sec };
}

function rings(model: MapModel, p: Parts): P2[] {
  const out = new Array<P2>(model.nodes.length);
  out[0] = [CX, CY];
  const A = p.agents.length;
  p.agents.forEach((id, t) => {
    out[id] = polar(300, -TAU / 4 + ((t + 0.5) * TAU) / A);
  });
  const place = (list: number[], s: Sector, r0: number) => {
    let k = 0;
    let idx = 0;
    while (idx < list.length) {
      const r = r0 + 15 * k;
      const cap = Math.max(1, Math.floor((s.w * r) / 13.5));
      const m = Math.min(cap, list.length - idx);
      for (let c = 0; c < m; c++)
        out[list[idx + c]!] = polar(r, s.a0 + ((c + 0.5) * s.w) / cap);
      idx += m;
      k++;
    }
  };
  p.items.forEach((list, i) => {
    const s = p.sec[i]!;
    out[p.hubs[i]!] = polar(120, s.mid);
    place(
      list.filter((id) => model.nodes[id]!.kind === "note"),
      s,
      165,
    );
    place(
      list.filter((id) => model.nodes[id]!.kind === "file"),
      s,
      245,
    );
  });
  return out;
}

function topics(model: MapModel, p: Parts): P2[] {
  const out = new Array<P2>(model.nodes.length);
  out[0] = [CX, CY];
  const A = p.agents.length;
  p.agents.forEach((id, t) => {
    out[id] = polar(64, (t * TAU) / A);
  });
  p.items.forEach((list, i) => {
    const c = polar(240, p.sec[i]!.mid);
    out[p.hubs[i]!] = c;
    list.forEach((id, j) => {
      const rr = 5.6 * Math.sqrt(j + 2);
      const an = j * 2.39996 + i;
      out[id] = [c[0] + rr * Math.cos(an), c[1] + rr * Math.sin(an)];
    });
  });
  return out;
}

function circle(model: MapModel, p: Parts): P2[] {
  const out = new Array<P2>(model.nodes.length);
  out[0] = [CX, CY];
  const A = p.agents.length;
  p.agents.forEach((id, t) => {
    out[id] = polar(110, (t * TAU) / A);
  });
  const R = [318, 306, 330] as const;
  p.items.forEach((list, i) => {
    const s = p.sec[i]!;
    list.forEach((id, j) => {
      out[id] = polar(R[j % 3]!, s.a0 + ((j + 0.5) * s.w) / list.length);
    });
    out[p.hubs[i]!] = polar(268, s.mid);
  });
  return out;
}

const X0 = 250;
const CW = 51;
const ITEM_Y0 = 430;
const ITEM_Y_MAX = 745;
const AGENT_Y0 = 70;
const AGENT_Y_MAX = 300;

function timeline(model: MapModel, p: Parts, now: number): P2[] {
  const out = new Array<P2>(model.nodes.length);
  out[0] = [30, 330];
  const A = p.agents.length;
  const agentStep =
    A > 1 ? Math.min(40, (AGENT_Y_MAX - AGENT_Y0) / (A - 1)) : 40;
  p.agents.forEach((id, t) => {
    out[id] = [30, AGENT_Y0 + agentStep * t];
  });

  // Items stack under their day in rows of four; a crowded column packs its rows tighter.
  const colOf = new Map<number, number>();
  const colTotal = new Array<number>(DAYS).fill(0);
  for (const n of model.nodes) {
    if (n.kind !== "note" && n.kind !== "file") continue;
    const c = dayIndex(n.updatedAt, now);
    colOf.set(n.i, c);
    colTotal[c]!++;
  }
  const step = colTotal.map((t) => {
    const rows = Math.ceil(t / 4);
    return rows > 1 ? Math.min(11, (ITEM_Y_MAX - ITEM_Y0) / (rows - 1)) : 11;
  });
  const colN = new Array<number>(DAYS).fill(0);
  for (const [id, c] of colOf) {
    const k = colN[c]!++;
    out[id] = [
      X0 + c * CW + 6 + (k % 4) * 11,
      ITEM_Y0 + Math.floor(k / 4) * step[c]!,
    ];
  }

  // A hub sits under the day of its topic's most recent item.
  const hubN = new Array<number>(DAYS).fill(0);
  p.items.forEach((list, i) => {
    let latest = 0;
    for (const id of list)
      latest = Math.max(latest, model.nodes[id]!.updatedAt);
    const c = dayIndex(latest, now);
    const k = hubN[c]!++;
    out[p.hubs[i]!] = [
      X0 + c * CW + 10 + (k % 3) * 14,
      330 + Math.floor(k / 3) * 14,
    ];
  });
  return out;
}

const ITERATIONS = 170;

function force(model: MapModel, start: P2[]): P2[] {
  const N = model.nodes.length;
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  start.forEach((q, i) => {
    px[i] = q[0];
    py[i] = q[1];
  });
  const E = model.edges.length;
  const rest = new Float64Array(E);
  const stiff = new Float64Array(E);
  model.edges.forEach(([u, v], e) => {
    const a = model.nodes[u]!;
    const b = model.nodes[v]!;
    const top =
      a.kind === "root" ||
      a.kind === "agent" ||
      b.kind === "root" ||
      b.kind === "agent";
    const same = !top && a.topic === b.topic;
    rest[e] = top ? 170 : same ? 18 : 150;
    stiff[e] = top ? 0.015 : same ? 0.08 : 0.008;
  });
  const fx = new Float64Array(N);
  const fy = new Float64Array(N);
  for (let it = 0; it < ITERATIONS; it++) {
    const cool = 1 - it / ITERATIONS;
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = px[i]! - px[j]!;
        const dy = py[i]! - py[j]!;
        const d2 = Math.max(dx * dx + dy * dy, 16);
        const d = Math.sqrt(d2);
        const f = 260 / d2;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        fx[i]! += ux;
        fy[i]! += uy;
        fx[j]! -= ux;
        fy[j]! -= uy;
      }
    }
    for (let e = 0; e < E; e++) {
      const [u, v] = model.edges[e]!;
      const dx = px[v]! - px[u]!;
      const dy = py[v]! - py[u]!;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (d - rest[e]!) * stiff[e]!;
      fx[u]! += (dx / d) * f;
      fy[u]! += (dy / d) * f;
      fx[v]! -= (dx / d) * f;
      fy[v]! -= (dy / d) * f;
    }
    for (let i = 1; i < N; i++) {
      fx[i]! += (CX - px[i]!) * 0.004;
      fy[i]! += (CY - py[i]!) * 0.004;
      px[i] = Math.min(
        970,
        Math.max(30, px[i]! + Math.max(-8, Math.min(8, fx[i]!)) * cool),
      );
      py[i] = Math.min(
        735,
        Math.max(25, py[i]! + Math.max(-8, Math.min(8, fy[i]!)) * cool),
      );
    }
  }
  return Array.from({ length: N }, (_, i): P2 => [px[i]!, py[i]!]);
}

const clamp = (v: number, hi: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : fallback;

function inBox(pos: P2[]): P2[] {
  return Array.from(pos, (q): P2 =>
    q ? [clamp(q[0], BOX.w, CX), clamp(q[1], BOX.h, CY)] : [CX, CY],
  );
}

/** Flat positions in the 1000 x 760 box, one per model node. `links` is O(n^2 * 170): cache it. */
export function layout(
  view: Exclude<View, "orbit">,
  model: MapModel,
  now: number,
): [number, number][] {
  const p = parts(model);
  switch (view) {
    case "rings":
      return inBox(rings(model, p));
    case "circle":
      return inBox(circle(model, p));
    case "topics":
      return inBox(topics(model, p));
    case "timeline":
      return inBox(timeline(model, p, now));
    case "links":
      return inBox(force(model, inBox(topics(model, p))));
  }
}

/** 3D positions around the origin, one per model node. */
export function orbit(model: MapModel): [number, number, number][] {
  const p = parts(model);
  const out = new Array<P3>(model.nodes.length);
  out[0] = [0, 0, 0];
  const A = p.agents.length;
  p.agents.forEach((id, t) => {
    const an = (t * TAU) / A;
    out[id] = [340 * Math.cos(an), 0, 340 * Math.sin(an)];
  });
  p.items.forEach((list, i) => {
    const s = p.sec[i]!;
    out[p.hubs[i]!] = [140 * Math.cos(s.mid), 0, 140 * Math.sin(s.mid)];
    list.forEach((id, j) => {
      const lon = s.a0 + s.w * ((j * 0.618034) % 1);
      const u = Math.max(-1, Math.min(1, (2 * (j + 0.5)) / list.length - 1));
      const lat = Math.asin(u) * 0.82;
      const R = model.nodes[id]!.kind === "file" ? 285 : 250;
      out[id] = [
        R * Math.cos(lat) * Math.cos(lon),
        R * Math.sin(lat),
        R * Math.cos(lat) * Math.sin(lon),
      ];
    });
  });
  return Array.from(out, (q): P3 => q ?? [0, 0, 0]);
}
