// The map's geometry for one model, view and layout, as plain data: edge segments, node groups
// per topic, the comb, guides and their labels, the core swarm and the timeline ticks. Pure;
// colours are not decided here (the renderer reads them from tokens), and the renderer builds
// its batched Path2Ds from this once per scene.
import { DAYS } from "./graph";
import type { Comb } from "./hive";
import type { Activity, MapModel, View } from "./types";

export type CombCell = {
  topic: number;
  x: number;
  y: number;
  kind: "hub" | "item" | "root" | "empty";
  capped: boolean;
  honey: number;
  node: number | null;
};

export type GuideLabel = {
  text: string;
  x: number;
  y: number;
  align: "centre" | "left";
};

export type Scene = {
  edges: Float32Array; // x1,y1,x2,y2 per edge
  byTopic: number[][]; // node indices per topic (notes, files, hubs)
  agents: number[];
  root: number;
  combCells: CombCell[];
  guides: { rings: number[]; axis: [number, number, number] | null }; // ring radii; timeline axis x0,x1,y
  guideLabels: GuideLabel[];
  core: [number, number][]; // swarm points, last-24h writes
  ticks: [number, number][]; // timeline agent-write ticks
  /** The comb's cell size (box units), 0 outside the Hive view. */
  combSize: number;
  /** The entrance arch under the comb (Hive only). */
  entrance: [number, number] | null;
};

const CX = 500;
const CY = 380;
const X0 = 250;
const CW = 51;
const DAY_MS = 86_400_000;
const RINGS = [143, 228, 272];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Deterministic points for the core: one per item written in the last 24 hours (up to 200). */
export function swarm(count: number): [number, number][] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const out: [number, number][] = [];
  for (let i = 0; i < Math.min(count, 200); i++) {
    const r = 4 + 46 * rnd() * rnd();
    const a = rnd() * Math.PI * 2;
    out.push([CX + r * Math.cos(a), CY + r * Math.sin(a)]);
  }
  return out;
}

/** Agent writes per day: one row per member, level with that member's first agent. */
export function ticks(
  model: MapModel,
  pos: [number, number][],
  act: Activity,
): [number, number][] {
  const rowY = new Map<string, number>();
  let next = 0;
  for (const n of model.nodes) {
    if (n.kind !== "agent" || n.member === null) continue;
    const y = pos[n.i]?.[1] ?? 0;
    if (!rowY.has(n.member)) rowY.set(n.member, y);
    next = Math.max(next, y);
  }
  const out: [number, number][] = [];
  for (const { day, member, count } of act.days) {
    let y = rowY.get(member);
    if (y === undefined) {
      next = Math.min(300, next + 40);
      y = next;
      rowY.set(member, y);
    }
    // Up to four dots sit apart; a busier day closes them into a bar.
    const n = Math.min(count, 41);
    const step = n > 1 ? Math.min(10, 36 / (n - 1)) : 0;
    for (let k = 0; k < n; k++) out.push([X0 + day * CW + 8 + k * step, y]);
  }
  return out;
}

function dayLabel(c: number, now: number): string {
  if (c === DAYS - 1) return "Today";
  const d = new Date((Math.floor(now / DAY_MS) - (DAYS - 1 - c)) * DAY_MS);
  const day = d.getUTCDate();
  return c === 0 || day === 1 ? `${day} ${MONTHS[d.getUTCMonth()]}` : `${day}`;
}

/** Text on the guides: ring names in Rings (on the rings, upper left), axis names and dates in Timeline. */
export function guideLabels(view: View, now: number): GuideLabel[] {
  const out: GuideLabel[] = [];
  if (view === "rings") {
    for (const [text, r] of [
      ["Notes", 143],
      ["Files", 228],
      ["Agents", 272],
    ] as const)
      out.push({
        text,
        x: CX - r * Math.cos(0.8),
        y: CY - r * Math.sin(0.8),
        align: "centre",
      });
  } else if (view === "timeline") {
    out.push({ text: "Agent writes by day", x: 22, y: 30, align: "left" });
    out.push({ text: "Topics", x: 46, y: 330, align: "left" });
    out.push({
      text: "Notes and files by last change",
      x: 22,
      y: 436,
      align: "left",
    });
    for (let c = 0; c < DAYS; c++)
      out.push({
        text: dayLabel(c, now),
        x: X0 + c * CW + 22,
        y: 410,
        align: "centre",
      });
  }
  return out;
}

export function buildScene(
  model: MapModel,
  view: View,
  pos: [number, number][],
  act: Activity,
  now: number,
  comb: Comb | null,
): Scene {
  const edges = new Float32Array(model.edges.length * 4);
  model.edges.forEach(([u, v], e) => {
    const a = pos[u] ?? [CX, CY];
    const b = pos[v] ?? [CX, CY];
    edges[e * 4] = a[0];
    edges[e * 4 + 1] = a[1];
    edges[e * 4 + 2] = b[0];
    edges[e * 4 + 3] = b[1];
  });

  const byTopic: number[][] = model.topics.map(() => []);
  const agents: number[] = [];
  for (const n of model.nodes) {
    if (n.kind === "agent") agents.push(n.i);
    else if (n.kind !== "root" && n.topic >= 0) byTopic[n.topic]!.push(n.i);
  }

  const hive = view === "hive" && comb !== null;
  const combCells: CombCell[] = hive
    ? comb.cells.map((c) => ({
        topic: c.topic,
        x: c.x,
        y: c.y,
        kind: c.kind,
        capped: c.capped,
        honey: c.honey,
        node: c.node,
      }))
    : [];

  const isTime = view === "timeline";
  return {
    edges,
    byTopic,
    agents,
    root: 0,
    combCells,
    guides: {
      rings: view === "rings" ? RINGS : [],
      axis: isTime ? [X0, 964, 392] : null,
    },
    guideLabels: guideLabels(view, now),
    core: !isTime && view !== "hive" && act.today > 0 ? swarm(act.today) : [],
    ticks: isTime ? ticks(model, pos, act) : [],
    combSize: hive ? comb.size : 0,
    entrance: hive ? comb.entrance : null,
  };
}
