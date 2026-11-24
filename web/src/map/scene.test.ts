import { describe, expect, it } from "vitest";
import { fixturePayload } from "./fixture";
import { activity, buildModel } from "./graph";
import { freshLevel } from "./freshness";
import { layout, ringsLayout } from "./layouts";
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
    // The fixture spans 20 days: both ends of the scale are there.
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
