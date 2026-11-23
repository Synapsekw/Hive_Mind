// web/src/map/hive.test.ts
import { describe, expect, it } from "vitest";
import { fixturePayload } from "./fixture";
import { buildModel } from "./graph";
import {
  gridRadiusFor,
  hexDist,
  hiveComb,
  honey,
  markState,
  nextCell,
  HIVE_MIN_RADIUS,
} from "./hive";
import type { MapModel } from "./types";

const NOW = Date.UTC(2026, 10, 23, 14, 0);
const payload = fixturePayload(NOW);
const model = buildModel(payload);
const lastUsed = new Map(
  payload.agents.map((a) => [a.id, a.last_used_at] as const),
);
const comb = hiveComb(model, NOW, lastUsed);

const items = (m: MapModel) =>
  m.nodes.filter((n) => n.kind === "note" || n.kind === "file");

describe("hiveComb", () => {
  it("is deterministic for a model", () => {
    expect(hiveComb(model, NOW, lastUsed)).toEqual(comb);
  });

  it("puts the index on the centre cell", () => {
    const centre = comb.cells.find((c) => c.q === 0 && c.r === 0)!;
    expect(centre.kind).toBe("root");
    expect(comb.pos[0]).toEqual([500, 380]);
  });

  it("gives every hub, note and file its own cell", () => {
    const placed = comb.cells.filter((c) => c.node !== null).map((c) => c.node);
    expect(new Set(placed).size).toBe(placed.length);
    for (const n of model.nodes)
      if (n.kind !== "agent") expect(placed).toContain(n.i);
  });

  it("keeps each item inside its own topic's territory, and territories contiguous", () => {
    for (const c of comb.cells)
      if (c.node !== null && c.kind !== "root")
        expect(c.topic).toBe(model.nodes[c.node]!.topic);
    for (let t = 0; t < model.topics.length; t++) {
      const mine = comb.cells.filter((c) => c.topic === t);
      const seen = new Set([`${mine[0]!.q},${mine[0]!.r}`]);
      const queue = [mine[0]!];
      while (queue.length) {
        const c = queue.pop()!;
        for (const o of mine)
          if (
            !seen.has(`${o.q},${o.r}`) &&
            hexDist([c.q, c.r], [o.q, o.r]) === 1
          ) {
            seen.add(`${o.q},${o.r}`);
            queue.push(o);
          }
      }
      expect(seen.size).toBe(mine.length);
    }
  });

  it("stays inside the 1000 x 760 box", () => {
    for (const [x, y] of comb.pos) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1000);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(760);
    }
  });

  it("marks a locked item's cell as capped", () => {
    const locked = items(model).find((n) => n.locked)!;
    expect(comb.cells.find((c) => c.node === locked.i)!.capped).toBe(true);
  });
});

describe("grid size", () => {
  it("is at least the minimum radius", () => {
    expect(gridRadiusFor(10)).toBe(HIVE_MIN_RADIUS);
  });
  it("grows to hold 5,000 items with 15% headroom", () => {
    const R = gridRadiusFor(5000);
    expect(3 * R * R + 3 * R + 1).toBeGreaterThanOrEqual(5750);
    const r = R - 1;
    expect(3 * r * r + 3 * r + 1).toBeLessThan(5750);
  });
});

describe("honey", () => {
  it("is full for a fresh item and fades to a floor", () => {
    expect(honey(0)).toBeCloseTo(0.5);
    expect(honey(336)).toBeCloseTo(0.5 * Math.exp(-1));
    expect(honey(100_000)).toBe(0.06);
  });
});

describe("agent marks", () => {
  it("derives live, today and idle from last use", () => {
    expect(markState(new Date(NOW - 10 * 60_000).toISOString(), NOW)).toBe(
      "live",
    );
    expect(markState(new Date(NOW - 5 * 3_600_000).toISOString(), NOW)).toBe(
      "today",
    );
    expect(markState(new Date(NOW - 3 * 86_400_000).toISOString(), NOW)).toBe(
      "idle",
    );
    expect(markState(null, NOW)).toBe("idle");
  });

  it("puts live and today marks on their own member's cell, idle ones at the entrance", () => {
    for (const m of comb.marks) {
      const agent = model.nodes[m.node]!;
      if (m.state === "idle") {
        expect(m.at).toBeNull();
        expect(Math.abs(m.pos[1] - comb.entrance[1])).toBeLessThan(1);
      } else {
        expect(model.nodes[m.at!]!.member).toBe(agent.member);
      }
    }
  });

  it("moves a live mark at most three cells, to its own member's item", () => {
    const live = comb.marks.find((m) => m.state === "live")!;
    for (const pick of [0, 0.3, 0.7, 0.99]) {
      const next = nextCell(comb, model, live, NOW, pick);
      if (next === null) continue;
      expect(model.nodes[next]!.member).toBe(model.nodes[live.node]!.member);
      expect(
        hexDist(comb.axial.get(next)!, comb.axial.get(live.at!)!),
      ).toBeLessThanOrEqual(3);
      expect(next).not.toBe(live.at);
    }
    expect(
      [0, 0.3, 0.7, 0.99].some(
        (pick) => nextCell(comb, model, live, NOW, pick) !== null,
      ),
    ).toBe(true);
  });
});
