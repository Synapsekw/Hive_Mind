import { describe, expect, it } from "vitest";
import { fixturePayload } from "./fixture";
import { activity, buildModel } from "./graph";
import { layout } from "./layouts";
import { buildScene } from "./scene";

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
    expect(s.edges.length).toBe(model.edges.length * 4);
    expect(s.guides.rings).toEqual([143, 228, 272]);
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
