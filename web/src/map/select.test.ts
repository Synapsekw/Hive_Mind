import { describe, expect, it } from "vitest";
import { buildModel } from "./graph";
import { lit } from "./select";
import { fixturePayload } from "./fixture";
import type { Filter, MapPayload } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const NONE: Filter = {
  topic: null,
  kind: null,
  member: null,
  q: "",
  sel: null,
};

describe("lit", () => {
  const model = buildModel(fixturePayload(NOW));

  it("lights everything with no filter", () => {
    expect(lit(model, NONE).every(Boolean)).toBe(true);
  });

  it("lights only the chosen topic, root stays lit", () => {
    const on = lit(model, { ...NONE, topic: 2 });
    model.nodes.forEach((n, i) => {
      if (n.kind === "root") expect(on[i]).toBe(true);
      else expect(on[i]).toBe(n.topic === 2);
    });
    expect(on.filter(Boolean).length).toBeGreaterThan(1);
  });

  it("filters by kind and member", () => {
    const me = model.members.find((m) => m.isMe)!;
    const on = lit(model, { ...NONE, kind: "note", member: me.id });
    model.nodes.forEach((n, i) => {
      if (n.kind !== "root")
        expect(on[i]).toBe(n.kind === "note" && n.member === me.id);
    });
  });

  it("lights a selection and its neighbours only", () => {
    const sel = model.nodes.findIndex((n) => n.kind === "hub");
    const on = lit(model, { ...NONE, sel });
    const want = new Set([sel, ...model.nodes[sel]!.nb]);
    model.nodes.forEach((_n, i) => expect(on[i]).toBe(want.has(i)));
  });

  it("matches search on the topic name, case-insensitively", () => {
    const name = model.topics[0]!.name;
    const on = lit(model, { ...NONE, q: `  ${name.toUpperCase()} ` });
    model.nodes.forEach((n, i) => {
      if (n.topic === 0) expect(on[i]).toBe(true);
    });
  });

  it("never matches a locked node on its real title", () => {
    const secret = "Zebra acquisition terms";
    const make = (locked: boolean): MapPayload => {
      const p = fixturePayload(NOW);
      const idx = p.nodes.findIndex((n) => n.locked && n.kind === "note");
      const n = p.nodes[idx]!;
      // The unlocked twin carries the real title; the locked one carries it too, as if leaked.
      p.nodes[idx] = {
        ...n,
        locked,
        title: secret,
        path: "x/zebra.md",
        topic: "Zz",
      };
      return p;
    };
    const q = "zebra";
    const open = buildModel(make(false));
    const closed = buildModel(make(true));
    expect(lit(open, { ...NONE, q }).filter(Boolean).length).toBeGreaterThan(0);
    const on = lit(closed, { ...NONE, q });
    expect(on.filter(Boolean).length).toBe(0);
  });
});
