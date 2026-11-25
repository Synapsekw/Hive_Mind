import { describe, expect, it, vi } from "vitest";
import { fixturePayload } from "./fixture";
import { buildModel } from "./graph";
import { ariaLabel, ariaLabels } from "./nodeShape";

describe("ariaLabels", () => {
  const model = () => buildModel(fixturePayload(Date.UTC(2026, 10, 23)));

  it("gives each node its aria label", () => {
    const m = model();
    expect(ariaLabels(m)).toEqual(m.nodes.map((n) => ariaLabel(m, n)));
  });

  it("builds the labels once per model, however often the list renders", () => {
    const m = model();
    const build = vi.fn(ariaLabel);
    const a = ariaLabels(m, build);
    const b = ariaLabels(m, build);
    expect(b).toBe(a);
    expect(build).toHaveBeenCalledTimes(m.nodes.length);
    // A new model (a refresh) builds them again.
    const m2 = model();
    ariaLabels(m2, build);
    expect(build).toHaveBeenCalledTimes(m.nodes.length + m2.nodes.length);
  });
});
