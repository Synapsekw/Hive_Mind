import { describe, expect, it } from "vitest";
import { fixturePayload } from "./fixture";
import { activity, buildModel } from "./graph";
import { freshLevel } from "./freshness";
import { layout, ringsLayout, timelineScale } from "./layouts";
import { buildScene, guideLabels } from "./scene";

const NOW = Date.UTC(2026, 10, 23, 14, 0);
const payload = fixturePayload(NOW);
const model = buildModel(payload);
const act = activity(model, NOW);

describe("buildScene", () => {
  it("groups every topic node once and lists agents and the root apart", () => {
    const s = buildScene(model, "rings", layout("rings", model, NOW), act, NOW);
    const grouped = s.byTopic.flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.length + s.agents.length + 1).toBe(model.nodes.length);
    const r = ringsLayout(model);
    expect(s.guides.rings).toEqual([r.hubR, r.firstR, r.agentR]);
  });
  it("draws only the index-to-hub spokes at rest in Rings", () => {
    const pos = layout("rings", model, NOW);
    const s = buildScene(model, "rings", pos, act, NOW);
    const hubs = model.nodes.filter((n) => n.kind === "hub").map((n) => n.i);
    expect(hubs.length).toBe(model.topics.length);
    expect(model.edges.length).toBeGreaterThan(hubs.length);
    expect(s.rest.map(([u, v]) => (u === 0 ? v : u)).sort()).toEqual(
      [...hubs].sort(),
    );
    for (const e of s.rest) expect(e).toContain(0);
    expect(s.edges.length).toBe(hubs.length * 4);
    // Each segment joins the index and its hub.
    s.rest.forEach(([u, v], k) => {
      expect([...s.edges.slice(k * 4, k * 4 + 4)]).toEqual(
        [...pos[u]!, ...pos[v]!].map((x) => Math.fround(x)),
      );
    });
  });
  it("keeps every edge in Timeline and Orbit", () => {
    for (const view of ["timeline", "orbit"] as const) {
      const s = buildScene(model, view, layout("rings", model, NOW), act, NOW);
      expect(s.rest).toEqual(model.edges);
      expect(s.edges.length).toBe(model.edges.length * 4);
    }
  });
  it("gives each note and file its freshness level, 0 for the rest", () => {
    const s = buildScene(model, "rings", layout("rings", model, NOW), act, NOW);
    expect(s.fresh).toBeInstanceOf(Uint8Array);
    expect(s.fresh).toHaveLength(model.nodes.length);
    for (const n of model.nodes)
      expect(s.fresh[n.i]).toBe(
        n.kind === "note" || n.kind === "file"
          ? freshLevel(n.updatedAt, NOW)
          : 0,
      );
    // The fixture spans 13 days: the freshest level and a faded one are both there.
    expect(s.fresh.includes(7)).toBe(true);
    expect(s.fresh.includes(4)).toBe(true);
  });
  it("takes the guides, dot scale and group labels from the rings layout", () => {
    const big = buildModel(fixturePayload(NOW, { items: 5000 }));
    const r = ringsLayout(big);
    expect(r.scale).toBeLessThan(1);
    for (const given of [r, undefined, null]) {
      const s = buildScene(big, "rings", r.pos, activity(big, NOW), NOW, given);
      expect(s.guides.rings).toEqual([r.hubR, r.firstR, r.agentR]);
      expect(s.dotScale).toBe(r.scale);
      expect(s.groupLabels).toEqual(r.labels);
    }
  });
  it("has no guide labels in Rings", () => {
    const r = ringsLayout(model);
    const s = buildScene(model, "rings", r.pos, act, NOW, r);
    expect(s.guideLabels).toEqual([]);
    expect(guideLabels("rings", NOW)).toEqual([]);
  });
  it("keeps full-size dots and no group labels outside Rings", () => {
    for (const view of ["timeline", "orbit"] as const) {
      const s = buildScene(model, view, layout("rings", model, NOW), act, NOW);
      expect(s.dotScale).toBe(1);
      expect(s.groupLabels).toEqual([]);
      expect(s.guides.rings).toEqual([]);
    }
    const t = buildScene(
      model,
      "timeline",
      layout("timeline", model, NOW),
      act,
      NOW,
    );
    expect(t.guideLabels).toEqual(guideLabels("timeline", NOW));
    expect(t.guideLabels[0]).toEqual({
      text: "Agent writes by day",
      x: 22,
      y: 30,
      align: "left",
    });
    expect(t.guideLabels).toHaveLength(3 + 14);
    expect(t.guideLabels[t.guideLabels.length - 1]!.text).toBe("Today");
    // Days look as they did: the month on the first column, bare dates after it.
    expect(t.guideLabels.slice(3).map((g) => g.text)).toEqual([
      "10 Nov",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "Today",
    ]);
    expect(t.guideLabels.slice(3).map((g) => [g.x, g.y, g.align])).toEqual(
      Array.from({ length: 14 }, (_, c) => [250 + c * 51 + 22, 410, "centre"]),
    );
    expect(t.guideLabels[2]!.text).toBe("Notes and files by date written");
  });
  it("labels the Timeline on the scale its notes were laid out on", () => {
    const old = buildModel(fixturePayload(NOW, { old: true }));
    const scale = timelineScale(old, NOW);
    expect(scale.unit).toBe("quarter");
    const s = buildScene(
      old,
      "timeline",
      layout("timeline", old, NOW, scale),
      activity(old, NOW),
      NOW,
      null,
      scale,
    );
    const texts = s.guideLabels.map((g) => g.text);
    expect(texts[0]).toBe("Agent writes by quarter");
    expect(texts.slice(3)).toEqual([
      "Q3 2023",
      "Q4 2023",
      "Q1 2024",
      "Q2 2024",
      "Q3 2024",
      "Q4 2024",
      "Q1 2025",
      "Q2 2025",
      "Q3 2025",
      "Q4 2025",
      "Q1 2026",
      "Q2 2026",
      "Q3 2026",
      "Q4 2026",
    ]);
    expect(texts).not.toContain("Today");
    // Without a scale it works out the same one.
    expect(
      buildScene(old, "timeline", layout("timeline", old, NOW), act, NOW)
        .guideLabels,
    ).toEqual(s.guideLabels);
    expect(
      guideLabels("timeline", NOW, { unit: "week", now: NOW })[3]!.text,
    ).toBe("24 Aug");
  });
  it("draws an agent's tick under the column its note was written in", () => {
    const m = buildModel({
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
      nodes: [
        {
          id: "n1",
          kind: "note",
          topic: "A",
          member_id: "m1",
          updated_at: new Date(NOW - 60_000).toISOString(),
          created_at: new Date(Date.UTC(2026, 7, 5)).toISOString(),
          locked: false,
          title: "n1",
          path: "A/n1.md",
          workspace_id: null,
          by_agent: true,
          agent_id: "a1",
          note_id: null,
        },
      ],
      links: [],
      truncated: false,
    });
    const pos = layout("timeline", m, NOW);
    const s = buildScene(m, "timeline", pos, activity(m, NOW), NOW);
    // One note written in August, months as the scale: three columns before this month.
    expect(s.guideLabels[0]!.text).toBe("Agent writes by month");
    const agentY = pos[m.nodes.findIndex((n) => n.kind === "agent")]![1];
    expect(s.ticks).toEqual([[250 + 10 * 51 + 8, agentY]]);
  });
  it("grows the fixture to the asked number of items, ids unique", () => {
    const big = fixturePayload(NOW, { items: 5000 });
    expect(big.nodes.length).toBe(5000);
    expect(new Set(big.nodes.map((n) => n.id)).size).toBe(5000);
    expect(fixturePayload(NOW)).toEqual(payload);
  });
  it("has the timeline axis only in the timeline", () => {
    expect(
      buildScene(model, "timeline", layout("timeline", model, NOW), act, NOW)
        .guides.axis,
    ).not.toBeNull();
    expect(
      buildScene(model, "rings", layout("rings", model, NOW), act, NOW).guides
        .axis,
    ).toBeNull();
  });
});
