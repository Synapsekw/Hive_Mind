import { describe, expect, it } from "vitest";
import { buildModel } from "./graph";
import { forceIterations, layout, orbit } from "./layouts";
import { fixturePayload } from "./fixture";
import type { MapNode, MapPayload, View } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const FLAT: Exclude<View, "orbit" | "hive">[] = [
  "rings",
  "topics",
  "links",
  "timeline",
];

function note(id: string, topic: string): MapNode {
  return {
    id,
    kind: "note",
    topic,
    member_id: "m1",
    updated_at: new Date(NOW - 86_400_000).toISOString(),
    locked: false,
    title: id,
    path: `${topic}/${id}.md`,
    workspace_id: null,
    by_agent: false,
    agent_id: null,
    note_id: null,
  };
}

function base(nodes: MapNode[]): MapPayload {
  return {
    members: [{ id: "m1", display_name: "Me", is_me: true }],
    agents: [
      {
        id: "a1",
        member_id: "m1",
        provider: "Claude",
        trust_tier: "vendor",
        last_used_at: null,
        name: null,
      },
    ],
    nodes,
    links: [],
    truncated: false,
  };
}

const twelve: MapNode[] = [];
for (let t = 0; t < 12; t++)
  for (let j = 0; j <= t * 3; j++)
    twelve.push(note(`t${t}-${j}`, `Topic ${t}`));

const CASES: [string, MapPayload][] = [
  ["fixture", fixturePayload(NOW)],
  [
    "empty",
    { members: [], agents: [], nodes: [], links: [], truncated: false },
  ],
  ["one note", base([note("only", "Solo")])],
  ["12 topics", base(twelve)],
];

describe.each(CASES)("layouts on %s", (_name, payload) => {
  const model = buildModel(payload);

  it.each(FLAT)("%s gives one finite, in-box position per node", (view) => {
    const pos = layout(view, model, NOW);
    expect(pos).toHaveLength(model.nodes.length);
    for (const [x, y] of pos) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(760);
    }
  });

  it.each(FLAT)("%s is deterministic", (view) => {
    expect(layout(view, model, NOW)).toEqual(layout(view, model, NOW));
  });

  it("orbit gives one finite 3D position per node", () => {
    const pos = orbit(model);
    expect(pos).toHaveLength(model.nodes.length);
    for (const p of pos) {
      expect(p).toHaveLength(3);
      for (const c of p) expect(Number.isFinite(c)).toBe(true);
    }
    expect(orbit(model)).toEqual(pos);
  });

  it("puts the root at the centre in rings", () => {
    expect(layout("rings", model, NOW)[0]).toEqual([500, 380]);
  });
});

describe("forceIterations", () => {
  it("is 170 up to 1,500 nodes, then shrinks so pair work stays bounded", () => {
    expect(forceIterations(10)).toBe(170);
    expect(forceIterations(1500)).toBe(170);
    expect(forceIterations(5000)).toBe(15);
    expect(forceIterations(100_000)).toBe(12);
  });
});

describe("rings on a small hive", () => {
  it("keeps every pair of hubs at least 40 apart for topic sizes 17, 7, 1, 1, 1", () => {
    const nodes: MapNode[] = [];
    [17, 7, 1, 1, 1].forEach((c, t) => {
      for (let j = 0; j < c; j++) nodes.push(note(`s${t}-${j}`, `Small ${t}`));
    });
    const model = buildModel(base(nodes));
    const pos = layout("rings", model, NOW);
    const hubs = model.nodes
      .filter((n) => n.kind === "hub")
      .map((n) => pos[n.i]!);
    expect(hubs).toHaveLength(5);
    for (let a = 0; a < hubs.length; a++)
      for (let b = a + 1; b < hubs.length; b++) {
        const d = Math.hypot(
          hubs[a]![0] - hubs[b]![0],
          hubs[a]![1] - hubs[b]![1],
        );
        expect(d).toBeGreaterThanOrEqual(40);
      }
    // Each sector is at least 0.35 rad wide, so neighbouring hubs' angles differ by 0.35 + gap.
    const angles = hubs
      .map(([x, y]) => Math.atan2(y - 380, x - 500))
      .sort((a, b) => a - b);
    for (let k = 1; k < angles.length; k++)
      expect(angles[k]! - angles[k - 1]!).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(
      angles[0]! + 2 * Math.PI - angles[angles.length - 1]!,
    ).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });

  it("keeps hubs clear of the ring labels at twelve o'clock", () => {
    const nodes: MapNode[] = [];
    [17, 7, 1, 1, 1].forEach((c, t) => {
      for (let j = 0; j < c; j++) nodes.push(note(`s${t}-${j}`, `Small ${t}`));
    });
    const model = buildModel(base(nodes));
    const pos = layout("rings", model, NOW);
    for (const n of model.nodes.filter((x) => x.kind === "hub")) {
      const [x, y] = pos[n.i]!;
      // The labels sit straight above the centre; no hub sits in a 60-wide band there.
      if (y < 380) expect(Math.abs(x - 500)).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("timeline", () => {
  it("puts today's items in the rightmost column and old items in the first", () => {
    const recent = note("recent", "A");
    const old = {
      ...note("old", "A"),
      updated_at: new Date(NOW - 40 * 86_400_000).toISOString(),
    };
    recent.updated_at = new Date(NOW - 60_000).toISOString();
    const model = buildModel(base([recent, old]));
    const pos = layout("timeline", model, NOW);
    const ri = model.nodes.findIndex((n) => n.id === "recent");
    const oi = model.nodes.findIndex((n) => n.id === "old");
    expect(pos[ri]![0]).toBeGreaterThanOrEqual(250 + 13 * 51);
    expect(pos[oi]![0]).toBeLessThan(250 + 51);
  });
});
