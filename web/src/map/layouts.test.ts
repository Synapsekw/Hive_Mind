import { describe, expect, it } from "vitest";
import { grouping } from "./arrange";
import { buildModel, dayIndex } from "./graph";
import { layout, orbit, ringsLayout, timelineScale } from "./layouts";
import { fixturePayload } from "./fixture";
import type { MapModel, MapNode, MapPayload } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const FLAT: ("rings" | "timeline")[] = ["rings", "timeline"];

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
});

const radius = ([x, y]: [number, number]) => Math.hypot(x - 500, y - 380);

/** Items (notes and files) of each group, as node indices. */
function sectors(model: MapModel): number[][] {
  const out: number[][] = model.topics.map(() => []);
  for (const n of model.nodes)
    if (n.kind === "note" || n.kind === "file") out[n.topic]!.push(n.i);
  return out;
}

const RINGS_CASES: [string, MapModel][] = [
  ["60 items", buildModel(fixturePayload(NOW, { items: 60 }))],
  ["300 items", buildModel(fixturePayload(NOW))],
  ["5,000 items", buildModel(fixturePayload(NOW, { items: 5000 }))],
  [
    "12 groups",
    buildModel(base(twelve), grouping(base(twelve), "folder", NOW, 12)),
  ],
];

describe.each(RINGS_CASES)("ringsLayout on %s", (_name, model) => {
  const r = ringsLayout(model);

  it("puts the freshest notes innermost in every group", () => {
    for (const list of sectors(model)) {
      const notes = list
        .map((i) => model.nodes[i]!)
        .filter((n) => n.kind === "note")
        .sort(
          (a, b) =>
            b.updatedAt - a.updatedAt ||
            (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0),
        );
      for (let k = 1; k < notes.length; k++)
        expect(radius(r.pos[notes[k]!.i]!)).toBeGreaterThanOrEqual(
          radius(r.pos[notes[k - 1]!.i]!) - 1e-9,
        );
    }
  });

  it("puts every file outside every note of its group", () => {
    for (const list of sectors(model)) {
      const notes = list.filter((i) => model.nodes[i]!.kind === "note");
      const files = list.filter((i) => model.nodes[i]!.kind === "file");
      if (!notes.length || !files.length) continue;
      const outerNote = Math.max(...notes.map((i) => radius(r.pos[i]!)));
      const innerFile = Math.min(...files.map((i) => radius(r.pos[i]!)));
      expect(innerFile).toBeGreaterThan(outerNote);
    }
  });

  it("keeps items at least 13.5 apart, scaled", () => {
    const min = 13.5 * r.scale - 0.01;
    for (const list of sectors(model))
      for (let a = 0; a < list.length; a++)
        for (let b = a + 1; b < list.length; b++) {
          const p = r.pos[list[a]!]!;
          const q = r.pos[list[b]!]!;
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < min) expect(d).toBeGreaterThanOrEqual(min);
        }
  });

  it("gives one label per group, its count and the side of the circle", () => {
    const counts = sectors(model).map((l) => l.length);
    expect(r.labels).toHaveLength(model.topics.length);
    r.labels.forEach((l, t) => {
      expect(l.text.endsWith(` · ${counts[t]}`)).toBe(true);
      const c = (l.x - 500) / Math.hypot(l.x - 500, l.y - 380);
      expect(l.align).toBe(c > 0.25 ? "left" : c < -0.25 ? "right" : "centre");
    });
  });

  it("puts every group name on one circle 20 past the agent ring, in line with its hub", () => {
    const hubs = model.nodes.filter((n) => n.kind === "hub");
    r.labels.forEach((l, t) => {
      expect(radius([l.x, l.y])).toBeCloseTo(r.agentR + 20, 9);
      const hub = r.pos[hubs.find((n) => n.topic === t)!.i]!;
      const a = Math.atan2(l.y - 380, l.x - 500);
      const b = Math.atan2(hub[1] - 380, hub[0] - 500);
      expect(Math.cos(a - b)).toBeCloseTo(1, 9);
    });
  });

  it("keeps every position inside the box and the agent ring within 350", () => {
    for (const [x, y] of r.pos) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(760);
    }
    expect(r.agentR).toBeLessThanOrEqual(350 + 1e-9);
    expect(r.hubR).toBeCloseTo(120 * r.scale, 9);
    expect(r.firstR).toBeCloseTo(165 * r.scale, 9);
    for (const n of model.nodes)
      if (n.kind === "agent")
        expect(radius(r.pos[n.i]!)).toBeCloseTo(r.agentR, 6);
  });

  it("is what layout gives for rings", () => {
    expect(layout("rings", model, NOW)).toEqual(r.pos);
  });
});

describe("ringsLayout scale", () => {
  it("keeps 60 items at full size with the agent ring at 300 or more", () => {
    const r = ringsLayout(buildModel(fixturePayload(NOW, { items: 60 })));
    expect(r.scale).toBe(1);
    expect(r.agentR).toBeGreaterThanOrEqual(300);
    expect(r.hubR).toBe(120);
    expect(r.firstR).toBe(165);
  });

  it("shrinks 5,000 items so the agent ring lands on 350", () => {
    const r = ringsLayout(buildModel(fixturePayload(NOW, { items: 5000 })));
    expect(r.scale).toBeLessThan(1);
    expect(Math.abs(r.agentR - 350)).toBeLessThanOrEqual(0.01);
  });

  it("works on an empty hive", () => {
    const r = ringsLayout(
      buildModel({
        members: [],
        agents: [],
        nodes: [],
        links: [],
        truncated: false,
      }),
    );
    expect(r.pos[0]).toEqual([500, 380]);
    expect(r.labels).toEqual([]);
    expect(r.scale).toBe(1);
    expect(r.agentR).toBe(300);
  });

  it("works for 1 to 12 groups", () => {
    for (let g = 1; g <= 12; g++) {
      const nodes = twelve.filter((n) => Number(n.topic.split(" ")[1]) < g);
      const p = base(nodes);
      const model = buildModel(p, grouping(p, "folder", NOW, 12));
      expect(model.topics).toHaveLength(g);
      const r = ringsLayout(model);
      expect(r.labels).toHaveLength(g);
      for (const [x, y] of r.pos)
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it("puts the agent ring 30 past the last arc that holds a note when a group has no files", () => {
    // One group of 900 notes and no files fills nine arcs, out to 285.
    const nodes: MapNode[] = [];
    for (let j = 0; j < 900; j++) nodes.push(note(`n${j}`, "Only notes"));
    const model = buildModel(base(nodes));
    const r = ringsLayout(model);
    const last = Math.max(
      ...model.nodes
        .filter((n) => n.kind === "note")
        .map((n) => radius(r.pos[n.i]!) / r.scale),
    );
    expect(last).toBeGreaterThan(270);
    expect(r.agentR / r.scale).toBeCloseTo(Math.max(300, last + 30), 6);
  });

  it("cuts a long group name to 44 characters", () => {
    const long =
      "A folder name that runs on for far longer than any label should";
    const r = ringsLayout(buildModel(base([note("x", long)])));
    const label = r.labels[0]!.text;
    expect(label).toBe(`${long.slice(0, 43).trimEnd()}… · 1`);
  });
});

describe("timeline", () => {
  const DAY = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString();
  /** The column a position's x falls in. */
  const col = (x: number) => Math.floor((x - 250) / 51);
  const at = (model: MapModel, pos: [number, number][], id: string) =>
    col(pos[model.nodes.findIndex((n) => n.id === id)]![0]);
  const hubOf = (model: MapModel, pos: [number, number][], topic: string) =>
    col(
      pos[
        model.nodes.findIndex((n) => n.kind === "hub" && n.title === topic)
      ]![0],
    );

  it("puts today's items in the rightmost column and the oldest of two weeks in the first", () => {
    const recent = note("recent", "A");
    const old = {
      ...note("old", "A"),
      updated_at: iso(NOW - 13 * DAY),
    };
    recent.updated_at = iso(NOW - 60_000);
    const model = buildModel(base([recent, old]));
    const pos = layout("timeline", model, NOW);
    const ri = model.nodes.findIndex((n) => n.id === "recent");
    const oi = model.nodes.findIndex((n) => n.id === "old");
    expect(pos[ri]![0]).toBeGreaterThanOrEqual(250 + 13 * 51);
    expect(pos[oi]![0]).toBeLessThan(250 + 51);
  });

  it("gives a hive of recent notes the positions it had by day and last change", () => {
    // Before created dates the Timeline placed an item by the day of its last change. A sample
    // written and changed within 14 days must sit exactly there still.
    const model = buildModel(fixturePayload(NOW));
    expect(timelineScale(model, NOW).unit).toBe("day");
    const pos = layout("timeline", model, NOW);
    const total = new Array<number>(14).fill(0);
    for (const n of model.nodes)
      if (n.kind === "note" || n.kind === "file")
        total[dayIndex(n.updatedAt, NOW)]!++;
    const seen = new Array<number>(14).fill(0);
    for (const n of model.nodes) {
      if (n.kind !== "note" && n.kind !== "file") continue;
      const c = dayIndex(n.updatedAt, NOW);
      const k = seen[c]!++;
      const rows = Math.ceil(total[c]! / 4);
      const step = rows > 1 ? Math.min(11, (745 - 430) / (rows - 1)) : 11;
      expect(pos[n.i]).toEqual([
        250 + c * 51 + 6 + (k % 4) * 11,
        430 + Math.floor(k / 4) * step,
      ]);
    }
  });

  it("places an old note in the column of its created date, not of its last change", () => {
    const old = {
      ...note("old", "A"),
      created_at: iso(Date.UTC(2026, 7, 5)),
      updated_at: iso(NOW - 60_000),
    };
    const fresh = {
      ...note("fresh", "A"),
      created_at: iso(NOW - 60_000),
      updated_at: iso(NOW - 60_000),
    };
    const model = buildModel(base([old, fresh]));
    // August to November: more than 14 weeks, so months.
    expect(timelineScale(model, NOW)).toEqual({ unit: "month", now: NOW });
    const pos = layout("timeline", model, NOW);
    expect(at(model, pos, "fresh")).toBe(13);
    expect(at(model, pos, "old")).toBe(10);
  });

  it("falls back to the last change for a note without a created date", () => {
    const old = { ...note("old", "A"), updated_at: iso(NOW - 40 * DAY) };
    const fresh = { ...note("fresh", "A"), updated_at: iso(NOW - 60_000) };
    const model = buildModel(base([old, fresh]));
    expect(timelineScale(model, NOW).unit).toBe("week");
    const pos = layout("timeline", model, NOW);
    expect(at(model, pos, "fresh")).toBe(13);
    // 13 October 2026 is five Mondays before the week of 22 November.
    expect(at(model, pos, "old")).toBe(8);
  });

  it("puts a hub under its topic's newest created date", () => {
    const a1 = { ...note("a1", "A"), created_at: iso(Date.UTC(2025, 2, 1)) };
    const a2 = {
      ...note("a2", "A"),
      created_at: iso(Date.UTC(2026, 4, 9)),
    };
    // Changed a minute ago: only the created date counts.
    const b1 = {
      ...note("b1", "B"),
      created_at: iso(Date.UTC(2025, 2, 1)),
      updated_at: iso(NOW - 60_000),
    };
    const model = buildModel(base([a1, a2, b1]));
    const scale = timelineScale(model, NOW);
    expect(scale.unit).toBe("quarter");
    const pos = layout("timeline", model, NOW, scale);
    // Q4 2026 is the last column; Q2 2026 two before it, Q1 2025 seven before.
    expect(hubOf(model, pos, "A")).toBe(11);
    expect(hubOf(model, pos, "B")).toBe(6);
    expect(at(model, pos, "a1")).toBe(6);
    expect(layout("timeline", model, NOW)).toEqual(pos);
  });

  it("uses the scale it is given", () => {
    const model = buildModel(base([note("n", "A")]));
    const day = layout("timeline", model, NOW, { unit: "day", now: NOW });
    const year = layout("timeline", model, NOW, { unit: "year", now: NOW });
    expect(at(model, day, "n")).toBe(12);
    expect(at(model, year, "n")).toBe(13);
  });

  it("takes the scale from the oldest created date among notes and files only", () => {
    const model = buildModel(base([]));
    expect(timelineScale(model, NOW).unit).toBe("day");
    const old = buildModel(fixturePayload(NOW, { old: true }));
    expect(timelineScale(old, NOW).unit).toBe("quarter");
    const pos = layout("timeline", old, NOW);
    const used = new Set(
      old.nodes
        .filter((n) => n.kind === "note" || n.kind === "file")
        .map((n) => col(pos[n.i]![0])),
    );
    // Spread over the columns, not piled on today.
    expect(used.size).toBeGreaterThan(8);
  });
});
