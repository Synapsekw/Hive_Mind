import { describe, expect, it, vi } from "vitest";
import { FOLDING_ATTR, foldAware, type FoldRoot } from "./foldResize";

function fakeRoot() {
  const attrs = new Set<string>();
  const listeners = new Map<
    string,
    ((e: { propertyName: string }) => void)[]
  >();
  const root: FoldRoot = {
    hasAttribute: (n) => attrs.has(n),
    removeAttribute: (n) => void attrs.delete(n),
    addEventListener: (t, f) =>
      listeners.set(t, [...(listeners.get(t) ?? []), f as never]),
    removeEventListener: (t, f) =>
      listeners.set(
        t,
        (listeners.get(t) ?? []).filter((g) => g !== (f as never)),
      ),
  };
  const fire = (propertyName: string) =>
    (listeners.get("transitionend") ?? []).forEach((f) => f({ propertyName }));
  return { root, attrs, fire, listeners };
}

describe("foldAware", () => {
  it("measures every resize when nothing folds", () => {
    const { root } = fakeRoot();
    const measure = vi.fn();
    const r = foldAware(measure, root);
    r.onResize();
    r.onResize();
    expect(measure).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it("ignores sizes while the shell folds and measures once when the fold ends", () => {
    const { root, attrs, fire } = fakeRoot();
    const measure = vi.fn();
    const r = foldAware(measure, root);
    attrs.add(FOLDING_ATTR);
    for (let k = 0; k < 18; k++) r.onResize();
    expect(measure).not.toHaveBeenCalled();
    // Another property finishing (a label's fade) is not the fold's end.
    fire("opacity");
    expect(measure).not.toHaveBeenCalled();
    fire("flex-basis");
    expect(measure).toHaveBeenCalledTimes(1);
    expect(attrs.has(FOLDING_ATTR)).toBe(false);
    r.onResize();
    expect(measure).toHaveBeenCalledTimes(2);
    r.dispose();
  });

  it("measures once anyway if the fold's transition never ends", () => {
    vi.useFakeTimers();
    try {
      const { root, attrs } = fakeRoot();
      const measure = vi.fn();
      const r = foldAware(measure, root);
      attrs.add(FOLDING_ATTR);
      r.onResize();
      r.onResize();
      vi.advanceTimersByTime(2000);
      expect(measure).toHaveBeenCalledTimes(1);
      r.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops listening once disposed", () => {
    const { root, listeners } = fakeRoot();
    const r = foldAware(() => {}, root);
    expect(listeners.get("transitionend")?.length).toBe(1);
    r.dispose();
    expect(listeners.get("transitionend")?.length).toBe(0);
  });
});
