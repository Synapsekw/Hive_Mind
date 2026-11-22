import { describe, expect, it } from "vitest";
import { buildModel } from "./graph";
import { layout, orbit } from "./layouts";
import { fixturePayload } from "./fixture";
import type { MapNode, MapPayload, View } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const FLAT: Exclude<View, "orbit">[] = [
  "rings",
  "circle",
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
