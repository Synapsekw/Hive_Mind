// The map's geometry for one model, view and layout, as plain data: edge segments, node groups
// per topic, guides and their labels, the core swarm and the timeline ticks. Pure; colours are
// not decided here (the renderer reads them from tokens), and the renderer builds its batched
// Path2Ds from this once per scene.
import { freshLevel } from "./freshness";
import { agentColumns } from "./graph";
import { ringsLayout, timelineScale, type RingsLayout } from "./layouts";
import { COLUMNS, columnLabel, type Scale } from "./timescale";
import type { Activity, AgentColumn, MapModel, View } from "./types";

export type GuideLabel = {
  text: string;
  x: number;
  y: number;
  align: "centre" | "left";
};

export type Scene = {
  edges: Float32Array; // x1,y1,x2,y2 per edge in `rest`
  /** The edges drawn at rest: index-to-hub spokes in Rings, every model edge elsewhere. */
  rest: [number, number][];
  byTopic: number[][]; // node indices per topic (notes, files, hubs)
  agents: number[];
  root: number;
  guides: { rings: number[]; axis: [number, number, number] | null }; // ring radii; timeline axis x0,x1,y
  guideLabels: GuideLabel[];
  /** Freshness level per model node (freshness.ts): notes and files only, 0 for the rest. */
  fresh: Uint8Array;
  /** The factor Rings shrank the drawing by (dots shrink with it); 1 in the other views. */
  dotScale: number;
  /** Group names outside the circle in Rings; empty in the other views. */
  groupLabels: RingsLayout["labels"];
  core: [number, number][]; // swarm points, last-24h writes
  ticks: [number, number][]; // timeline agent-write ticks
};

const CX = 500;
const CY = 380;
const X0 = 250;
const CW = 51;

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

/**
 * Agent writes per Timeline column (`agentColumns`): one row per member, level with that
 * member's first agent.
 */
export function ticks(
  model: MapModel,
  pos: [number, number][],
  writes: AgentColumn[],
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
  for (const { column, member, count } of writes) {
    let y = rowY.get(member);
    if (y === undefined) {
      next = Math.min(300, next + 40);
      y = next;
      rowY.set(member, y);
    }
    // Up to four dots sit apart; a busier column closes them into a bar.
    const n = Math.min(count, 41);
    const step = n > 1 ? Math.min(10, 36 / (n - 1)) : 0;
    for (let k = 0; k < n; k++) out.push([X0 + column * CW + 8 + k * step, y]);
  }
  return out;
}

/**
 * Text on the guides: axis names and the column labels of `scale` in Timeline (days when no
 * scale is given). Rings has none (the group names sit outside the circle and the legend names
 * the agents).
 */
export function guideLabels(
  view: View,
  now: number,
  scale: Scale = { unit: "day", now },
): GuideLabel[] {
  const out: GuideLabel[] = [];
  if (view === "timeline") {
    out.push({
      text: `Agent writes by ${scale.unit}`,
      x: 22,
      y: 30,
      align: "left",
    });
    out.push({ text: "Topics", x: 46, y: 330, align: "left" });
    out.push({
      text: "Notes and files by date written",
      x: 22,
      y: 436,
      align: "left",
    });
    for (let c = 0; c < COLUMNS; c++)
      out.push({
        text: columnLabel(scale, c),
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
  rings?: RingsLayout | null, // given in Rings
  /** The scale the Timeline's positions were laid out on; worked out here when not given. */
  scale?: Scale | null,
): Scene {
  // Rings is quiet at rest: only the spokes from the index to the hubs.
  const rest =
    view === "rings"
      ? model.edges.filter(
          ([u, v]) =>
            (u === 0 && model.nodes[v]?.kind === "hub") ||
            (v === 0 && model.nodes[u]?.kind === "hub"),
        )
      : model.edges;
  const edges = new Float32Array(rest.length * 4);
  rest.forEach(([u, v], e) => {
    const a = pos[u] ?? [CX, CY];
    const b = pos[v] ?? [CX, CY];
    edges[e * 4] = a[0];
    edges[e * 4 + 1] = a[1];
    edges[e * 4 + 2] = b[0];
    edges[e * 4 + 3] = b[1];
  });

  const byTopic: number[][] = model.topics.map(() => []);
  const agents: number[] = [];
  const fresh = new Uint8Array(model.nodes.length);
  for (const n of model.nodes) {
    if (n.kind === "agent") agents.push(n.i);
    else if (n.kind !== "root" && n.topic >= 0) byTopic[n.topic]!.push(n.i);
    if (n.kind === "note" || n.kind === "file")
      fresh[n.i] = freshLevel(n.updatedAt, now);
  }

  const isTime = view === "timeline";
  // Rings without a layout from the caller works it out here.
  const r = view === "rings" ? (rings ?? ringsLayout(model)) : null;
  const sc = isTime ? (scale ?? timelineScale(model, now)) : null;
  return {
    edges,
    rest,
    byTopic,
    agents,
    root: 0,
    guides: {
      rings: r ? [r.hubR, r.firstR, r.agentR] : [],
      axis: isTime ? [X0, 964, 392] : null,
    },
    guideLabels: sc ? guideLabels(view, now, sc) : guideLabels(view, now),
    fresh,
    dotScale: r ? r.scale : 1,
    groupLabels: r ? r.labels : [],
    core: !isTime && act.today > 0 ? swarm(act.today) : [],
    ticks: sc ? ticks(model, pos, agentColumns(model, sc)) : [],
  };
}
