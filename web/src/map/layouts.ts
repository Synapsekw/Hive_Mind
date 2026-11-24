// One pure function per view, from the model to positions in the 1000 x 760 box (orbit: 3D).
// Ported from the prototype's geometry in docs/ui/map.dc.html (`build()`).
import { BOX, dayIndex, DAYS } from "./graph";
import type { MapModel } from "./types";

type P2 = [number, number];
type P3 = [number, number, number];
type Sector = { a0: number; w: number; mid: number };

const CX = 500;
const CY = 380;
const TAU = Math.PI * 2;
const GAP = 0.05;
/** The narrowest sector a topic gets, so one item next to two hundred is still visible. */
const MIN_SECTOR = 0.12;
/**
 * The narrowest sector once widths are shared out: 0.35 rad keeps neighbouring hubs more than
 * 40 apart at the hub radius (120). Eight topics at 0.35 rad fit the circle.
 */
const MIN_HUB_SECTOR = 0.35;

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
  // The 0.28 rad left at twelve o'clock keeps hubs clear of the ring labels there.
  const usable = TAU - 0.28 - T * GAP;
  const min = T > 0 ? Math.min(MIN_SECTOR, usable / T) : 0;
  const spare = usable - T * min;
  const widths = spread(
    items.map(
      (l) => min + (total > 0 ? (spare * l.length) / total : spare / T),
    ),
    T > 0 ? Math.min(MIN_HUB_SECTOR, usable / T) : 0,
  );
  let a = -TAU / 4 + 0.14;
  const sec = widths.map((w) => {
    const s = { a0: a, w, mid: a + w / 2 };
    a += w + GAP;
    return s;
  });
  return { hubs, items, agents, sec };
}

/**
 * Lifts every width below `floor` to `floor` and takes the difference from the wider ones in
 * proportion, so the total stays the same. Widths already at or above `floor` come back as given.
 */
function spread(w: number[], floor: number): number[] {
  const sum = w.reduce((s, x) => s + x, 0);
  const fixed = new Array<boolean>(w.length).fill(false);
  let out = w;
  for (;;) {
    const low = out.some((x, i) => !fixed[i] && x < floor);
    if (!low) return out;
    out.forEach((x, i) => {
      if (x < floor) fixed[i] = true;
    });
    const nFixed = fixed.filter(Boolean).length;
    const freeSum = w.reduce((s, x, i) => (fixed[i] ? s : s + x), 0);
    const budget = sum - nFixed * floor;
    out = w.map((x, i) =>
      fixed[i] ? floor : freeSum > 0 ? (x * budget) / freeSum : floor,
    );
  }
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

const clamp = (v: number, hi: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : fallback;

function inBox(pos: P2[]): P2[] {
  return Array.from(pos, (q): P2 =>
    q ? [clamp(q[0], BOX.w, CX), clamp(q[1], BOX.h, CY)] : [CX, CY],
  );
}

/** Flat positions in the 1000 x 760 box, one per model node. */
export function layout(
  view: "rings" | "timeline",
  model: MapModel,
  now: number,
): [number, number][] {
  const p = parts(model);
  switch (view) {
    case "rings":
      return inBox(rings(model, p));
    case "timeline":
      return inBox(timeline(model, p, now));
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
