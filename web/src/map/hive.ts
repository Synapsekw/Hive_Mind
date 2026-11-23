// The Hive view: one honeycomb. Each topic claims a contiguous territory of hexagonal cells
// around its hub; items sit nearest the hub, most recently changed first. Agents are geometric
// marks on their member's freshest cell (live, today) or at the entrance under the comb (idle).
// Pure: the same model and `now` always give the same comb.
import type { MapModel } from "./types";

export type Axial = [number, number];
export type CellKind = "root" | "hub" | "item" | "empty";
export type Cell = {
  q: number;
  r: number;
  x: number;
  y: number;
  kind: CellKind;
  node: number | null;
  topic: number;
  honey: number;
  capped: boolean;
};
export type MarkState = "live" | "today" | "idle";
export type AgentMark = {
  node: number;
  state: MarkState;
  at: number | null;
  pos: [number, number];
};
export type Comb = {
  radius: number;
  size: number;
  cells: Cell[];
  pos: [number, number][];
  axial: Map<number, Axial>;
  entrance: [number, number];
  marks: AgentMark[];
};

export const HIVE_MIN_RADIUS = 12;
export const HIVE_CELL = 15.5;
const CX = 500;
const CY = 380;
const SQ3 = Math.sqrt(3);
const HOUR = 3_600_000;
const LIVE_MS = 70 * 60_000; // mirrors CONNECTED_MS in graph.ts (agentStatus "connected"); not exported there
const TODAY_MS = 24 * HOUR;
const NEIGHBOURS: Axial[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const key = (a: Axial) => `${a[0]},${a[1]}`;

export function hexDist(a: Axial, b: Axial): number {
  return (
    (Math.abs(a[0] - b[0]) +
      Math.abs(a[0] + a[1] - b[0] - b[1]) +
      Math.abs(a[1] - b[1])) /
    2
  );
}

export function honey(hours: number): number {
  return Math.max(0.06, 0.5 * Math.exp(-Math.max(0, hours) / 336));
}

export function gridRadiusFor(items: number): number {
  const need = Math.ceil(items * 1.15);
  let R = HIVE_MIN_RADIUS;
  while (3 * R * R + 3 * R + 1 < need) R++;
  return R;
}

export function markState(lastUsedAt: string | null, now: number): MarkState {
  if (lastUsedAt === null) return "idle";
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return "idle";
  if (now - t <= LIVE_MS) return "live";
  if (now - t <= TODAY_MS) return "today";
  return "idle";
}

/** The comb's cell size: the minimum at radius 12, smaller as the grid grows, so it fits 740 tall. */
function cellSize(R: number): number {
  const fit = 300 / (1.5 * R + 1); // half-height of the comb within the box, with room for the entrance
  return Math.min(HIVE_CELL, fit);
}

function axialRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export function hiveComb(
  model: MapModel,
  now: number,
  agentsLastUsed: Map<string, string | null>,
): Comb {
  const items = model.nodes.filter(
    (n) => n.kind === "note" || n.kind === "file",
  );
  const R = gridRadiusFor(items.length + model.topics.length + 1);
  const S = cellSize(R);
  const xy = (a: Axial): [number, number] => [
    CX + S * SQ3 * (a[0] + a[1] / 2),
    CY + S * 1.5 * a[1],
  ];

  const all: Axial[] = [];
  for (let q = -R; q <= R; q++)
    for (let r = -R; r <= R; r++)
      if (hexDist([q, r], [0, 0]) <= R) all.push([q, r]);

  const T = model.topics.length;
  const owner = new Map<string, number | "root">([["0,0", "root"]]);
  const seedRing = R * 0.525; // 6.3 cells at R = 12
  const seeds: Axial[] = model.topics.map((_, i) => {
    const a = (i / Math.max(1, T)) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * seedRing * SQ3;
    const py = Math.sin(a) * seedRing * SQ3;
    return axialRound((SQ3 / 3) * px - py / 3, (2 / 3) * py);
  });

  const hours = (t: number) => (now - t) / HOUR;
  const members = model.topics.map((_, t) =>
    items
      .filter((n) => n.topic === t)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.i - b.i),
  );
  const quota = members.map((m) => m.length + 1);
  const region: Axial[][] = model.topics.map(() => []);
  seeds.forEach((c, i) => {
    // Two seeds can round to the same cell only with many tiny topics; nudge outward.
    let s = c;
    while (owner.has(key(s))) s = [s[0], s[1] + 1];
    seeds[i] = s;
    owner.set(key(s), i);
    region[i]!.push(s);
    quota[i]!--;
  });

  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < T; i++) {
      if (quota[i]! <= 0) continue;
      let best: Axial | null = null;
      let bd = Infinity;
      for (const c of region[i]!)
        for (const [dq, dr] of NEIGHBOURS) {
          const nb: Axial = [c[0] + dq, c[1] + dr];
          if (hexDist(nb, [0, 0]) > R || owner.has(key(nb))) continue;
          const d = hexDist(nb, seeds[i]!) + hexDist(nb, [0, 0]) * 0.08;
          if (d < bd || (d === bd && best && key(nb) < key(best))) {
            bd = d;
            best = nb;
          }
        }
      if (best) {
        owner.set(key(best), i);
        region[i]!.push(best);
        quota[i]!--;
        grew = true;
      }
    }
  }

  const pos: [number, number][] = model.nodes.map(() => [CX, CY]);
  const axial = new Map<number, Axial>([[0, [0, 0]]]);
  const cellNode = new Map<string, number>([["0,0", 0]]);
  for (let t = 0; t < T; t++) {
    const cs = region[t]!.slice().sort(
      (a, b) =>
        hexDist(a, seeds[t]!) - hexDist(b, seeds[t]!) ||
        key(a).localeCompare(key(b)),
    );
    const hub = model.nodes.find((n) => n.kind === "hub" && n.topic === t);
    if (hub && cs[0]) {
      pos[hub.i] = xy(cs[0]);
      axial.set(hub.i, cs[0]);
      cellNode.set(key(cs[0]), hub.i);
    }
    members[t]!.forEach((n, j) => {
      const c = cs[j + 1];
      if (!c) return;
      pos[n.i] = xy(c);
      axial.set(n.i, c);
      cellNode.set(key(c), n.i);
    });
  }

  const cells: Cell[] = all.map((a) => {
    const [x, y] = xy(a);
    const o = owner.get(key(a));
    const node = cellNode.get(key(a)) ?? null;
    if (o === "root")
      return {
        q: a[0],
        r: a[1],
        x,
        y,
        kind: "root",
        node: 0,
        topic: -1,
        honey: 0.12,
        capped: false,
      };
    if (o === undefined || node === null)
      return {
        q: a[0],
        r: a[1],
        x,
        y,
        kind: "empty",
        node: null,
        topic: -1,
        honey: 0,
        capped: false,
      };
    const n = model.nodes[node]!;
    const isHub = n.kind === "hub";
    return {
      q: a[0],
      r: a[1],
      x,
      y,
      kind: isHub ? "hub" : "item",
      node,
      topic: o,
      honey: isHub ? 0.32 : honey(hours(n.updatedAt)),
      capped: n.locked,
    };
  });

  const entrance: [number, number] = [CX, CY + S * 1.5 * R + 26];
  const agents = model.nodes.filter((n) => n.kind === "agent");
  const marks: AgentMark[] = agents.map((n) => {
    const state = markState(agentsLastUsed.get(n.id ?? "") ?? null, now);
    const fresh = items
      .filter((m) => m.member === n.member && axial.has(m.i))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.i - b.i);
    const at = state === "idle" ? null : (fresh[0]?.i ?? null);
    return { node: n.i, state: at === null ? "idle" : state, at, pos: [0, 0] };
  });
  const idle = marks.filter((m) => m.state === "idle");
  idle.forEach((m, j) => {
    m.pos = [CX + (j - (idle.length - 1) / 2) * 18, entrance[1]];
  });
  for (const m of marks)
    if (m.at !== null) {
      const [x, y] = pos[m.at]!;
      m.pos = [x + S * 0.45, y - S * 0.52]; // on the cell's upper-right edge
    }
  for (const m of marks) pos[m.node] = m.pos;

  return { radius: R, size: S, cells, pos, axial, entrance, marks };
}

export function nextCell(
  comb: Comb,
  model: MapModel,
  mark: AgentMark,
  now: number,
  pick: number,
): number | null {
  if (mark.state !== "live" || mark.at === null) return null;
  const from = comb.axial.get(mark.at);
  if (!from) return null;
  const member = model.nodes[mark.node]!.member;
  const near = model.nodes.filter(
    (n) =>
      (n.kind === "note" || n.kind === "file") &&
      n.member === member &&
      n.i !== mark.at &&
      now - n.updatedAt <= 120 * HOUR &&
      comb.axial.has(n.i) &&
      hexDist(comb.axial.get(n.i)!, from) <= 3,
  );
  if (!near.length) return null;
  return near[Math.min(near.length - 1, Math.floor(pick * near.length))]!.i;
}
