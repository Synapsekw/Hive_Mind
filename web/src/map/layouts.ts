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
 * 40 apart at the hub radius (120). Up to twelve groups at 0.35 rad fit the circle.
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
  const usable = TAU - T * GAP;
  const min = T > 0 ? Math.min(MIN_SECTOR, usable / T) : 0;
  const spare = usable - T * min;
  const widths = spread(
    items.map(
      (l) => min + (total > 0 ? (spare * l.length) / total : spare / T),
    ),
    T > 0 ? Math.min(MIN_HUB_SECTOR, usable / T) : 0,
  );
  // The first sector starts at twelve o'clock; sectors go clockwise.
  let a = -TAU / 4 + GAP / 2;
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

export type RingsLayout = {
  pos: [number, number][];
  scale: number; // 1, or less when the rings were shrunk into the box
  hubR: number; // radius of the hub ring, after scaling
  firstR: number; // radius of the first item arc, after scaling
  agentR: number; // radius of the agent ring, after scaling
  labels: {
    text: string;
    x: number;
    y: number;
    align: "left" | "right" | "centre";
  }[];
};

const HUB_R = 120;
const FIRST_R = 165;
const ARC_STEP = 15;
const ALONG = 13.5;
const AGENT_PAST = 30;
const AGENT_MIN = 300;
const AGENT_MAX = 350;
/** Group names sit on one circle this far past the agent ring (after scaling). */
const LABEL_PAST = 20;
const NAME_MAX = 44;

/** Newest first, ties by id, so the order never depends on the payload's. */
function byFreshness(model: MapModel, list: number[]): number[] {
  return list.sort((a, b) => {
    const x = model.nodes[a]!;
    const y = model.nodes[b]!;
    const d = y.updatedAt - x.updatedAt;
    if (d !== 0) return d;
    const ia = x.id ?? "";
    const ib = y.id ?? "";
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

const cut = (name: string) =>
  name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;

/**
 * Rings: the index at the centre, one hub per group, each group's items on arcs outward in its
 * sector (freshest notes first, files after one empty arc), the agents on a ring past the
 * outermost arc. Everything shrinks by one factor when the agent ring would pass 350.
 */
export function ringsLayout(model: MapModel): RingsLayout {
  const p = parts(model);
  // Unscaled first: a radius and an angle per node.
  const r = new Float64Array(model.nodes.length);
  const an = new Float64Array(model.nodes.length);
  const lastR: number[] = [];
  /** Fills arcs from arc `k0` outward; returns the first arc left unused. */
  const place = (list: number[], s: Sector, k0: number): number => {
    let k = k0;
    let idx = 0;
    while (idx < list.length) {
      const rad = FIRST_R + ARC_STEP * k;
      const cap = Math.max(1, Math.floor((s.w * rad) / ALONG));
      const m = Math.min(cap, list.length - idx);
      for (let c = 0; c < m; c++) {
        const id = list[idx + c]!;
        r[id] = rad;
        an[id] = s.a0 + ((c + 0.5) * s.w) / cap;
      }
      idx += m;
      k++;
    }
    return k;
  };
  p.items.forEach((list, i) => {
    const s = p.sec[i]!;
    r[p.hubs[i]!] = HUB_R;
    an[p.hubs[i]!] = s.mid;
    const of = (kind: "note" | "file") =>
      byFreshness(
        model,
        list.filter((id) => model.nodes[id]!.kind === kind),
      );
    const kNotes = place(of("note"), s, 0);
    const kFiles = kNotes > 0 ? kNotes + 1 : 0;
    const kEnd = place(of("file"), s, kFiles);
    // The outermost arc that holds an item: with no files, the empty arc kept before them is not.
    const kLast = kEnd > kFiles ? kEnd - 1 : kNotes - 1;
    lastR.push(FIRST_R + ARC_STEP * Math.max(0, kLast));
  });
  const outer = lastR.length ? Math.max(...lastR) : 0;
  const agentR = Math.max(AGENT_MIN, outer + AGENT_PAST);
  const scale = Math.min(1, AGENT_MAX / agentR);
  const A = p.agents.length;
  p.agents.forEach((id, t) => {
    r[id] = agentR;
    an[id] = -TAU / 4 + ((t + 0.5) * TAU) / A;
  });

  const pos = new Array<P2>(model.nodes.length);
  for (let i = 0; i < model.nodes.length; i++)
    pos[i] = i === 0 ? [CX, CY] : polar(r[i]! * scale, an[i]!);
  const labels = model.topics.map((t, i): RingsLayout["labels"][number] => {
    const s = p.sec[i]!;
    const [x, y] = polar(agentR * scale + LABEL_PAST, s.mid);
    const c = Math.cos(s.mid);
    return {
      text: `${cut(t.name)} · ${p.items[i]!.length}`,
      x,
      y,
      align: c > 0.25 ? "left" : c < -0.25 ? "right" : "centre",
    };
  });
  return {
    pos: inBox(pos),
    scale,
    hubR: HUB_R * scale,
    firstR: FIRST_R * scale,
    agentR: agentR * scale,
    labels,
  };
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
  switch (view) {
    case "rings":
      return ringsLayout(model).pos;
    case "timeline":
      return inBox(timeline(model, parts(model), now));
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
