import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLD,
  FOLD_COOKIE,
  foldKeyIgnored,
  formatFold,
  parseFold,
  QUIET,
  quietTarget,
  type FoldKeyEvent,
} from "./fold";

describe("parseFold", () => {
  it("names the cookie and opens both sides by default", () => {
    expect(FOLD_COOKIE).toBe("hive-fold");
    expect(DEFAULT_FOLD).toEqual({ rail: "open", panel: "open" });
  });

  it("reads a missing, empty or garbage value as open", () => {
    for (const value of [undefined, "", "garbage", "..", "SHUT.SHUT", "x.y"])
      expect(parseFold(value)).toEqual({ rail: "open", panel: "open" });
  });

  it("reads one part as the rail and leaves the panel open", () => {
    expect(parseFold("shut")).toEqual({ rail: "shut", panel: "open" });
  });

  it("reads each part on its own", () => {
    expect(parseFold("shut.open")).toEqual({ rail: "shut", panel: "open" });
    expect(parseFold("open.shut")).toEqual({ rail: "open", panel: "shut" });
    expect(parseFold("shut.shut")).toEqual({ rail: "shut", panel: "shut" });
    expect(parseFold("shut.nope")).toEqual({ rail: "shut", panel: "open" });
  });

  it("ignores a third part", () => {
    expect(parseFold("shut.shut.shut")).toEqual({
      rail: "shut",
      panel: "shut",
    });
    expect(parseFold("open.shut.anything")).toEqual({
      rail: "open",
      panel: "shut",
    });
  });

  it("refuses an overlong value", () => {
    expect(parseFold(`shut.shut.${"x".repeat(200)}`)).toEqual(DEFAULT_FOLD);
  });
});

describe("formatFold", () => {
  it("writes the rail then the panel", () => {
    expect(formatFold({ rail: "open", panel: "shut" })).toBe("open.shut");
    expect(formatFold(DEFAULT_FOLD)).toBe("open.open");
  });

  it("is stable through a parse", () => {
    for (const value of [
      undefined,
      "",
      "garbage",
      "shut",
      "shut.open",
      "open.shut",
      "shut.shut",
      "shut.shut.extra",
    ]) {
      const once = formatFold(parseFold(value));
      expect(formatFold(parseFold(once))).toBe(once);
    }
  });
});

/** A stand-in for an element: `closest` finds an ancestor matching one of these selectors. */
function inside(...selectors: string[]) {
  return {
    closest: (list: string) =>
      list
        .split(",")
        .map((x) => x.trim())
        .some((x) => selectors.includes(x))
        ? {}
        : null,
  };
}

function key(over: Partial<FoldKeyEvent> & { altGraph?: boolean } = {}) {
  const { altGraph = false, ...rest } = over;
  const e: FoldKeyEvent = {
    key: "[",
    repeat: false,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    getModifierState: (k: string) => k === "AltGraph" && altGraph,
    target: inside(),
    ...rest,
  };
  return e;
}

describe("foldKeyIgnored", () => {
  it("lets a plain bracket through", () => {
    expect(foldKeyIgnored(key())).toBe(false);
    expect(foldKeyIgnored(key({ key: "]" }))).toBe(false);
  });

  it("ignores the key with Command held", () => {
    expect(foldKeyIgnored(key({ metaKey: true }))).toBe(true);
  });

  it("ignores the key with Ctrl alone held", () => {
    expect(foldKeyIgnored(key({ ctrlKey: true }))).toBe(true);
  });

  it("lets AltGr through, reported as Ctrl and Alt", () => {
    expect(
      foldKeyIgnored(key({ ctrlKey: true, altKey: true, altGraph: true })),
    ).toBe(false);
  });

  it("ignores Ctrl and Alt that are not AltGr", () => {
    expect(foldKeyIgnored(key({ ctrlKey: true, altKey: true }))).toBe(true);
  });

  it("lets Option through when it types the bracket itself", () => {
    expect(foldKeyIgnored(key({ altKey: true, key: "[" }))).toBe(false);
    expect(foldKeyIgnored(key({ altKey: true, key: "]" }))).toBe(false);
  });

  it("ignores Option when it types another character", () => {
    expect(foldKeyIgnored(key({ altKey: true, key: "“" }))).toBe(true);
  });

  it("ignores a repeat", () => {
    expect(foldKeyIgnored(key({ repeat: true }))).toBe(true);
  });

  it("ignores the key in a field, a popover or a dialog", () => {
    for (const where of [
      "input",
      "textarea",
      "[data-popover]",
      '[role="dialog"]',
      '[role="radiogroup"]',
    ])
      expect(foldKeyIgnored(key({ target: inside(where) }))).toBe(true);
    expect(foldKeyIgnored(key({ target: { isContentEditable: true } }))).toBe(
      true,
    );
  });

  it("lets the key through on the page itself or with no element target", () => {
    expect(foldKeyIgnored(key({ target: inside("button") }))).toBe(false);
    expect(foldKeyIgnored(key({ target: null }))).toBe(false);
  });
});

describe("quietTarget", () => {
  it("names fields, popovers, dialogs and radio groups", () => {
    expect(QUIET).toContain("input");
    expect(QUIET).toContain("[data-popover]");
    expect(QUIET).toContain('[role="dialog"]');
    expect(QUIET).toContain('[role="radiogroup"]');
    expect(quietTarget(inside("select"))).toBe(true);
    expect(quietTarget(inside("a"))).toBe(false);
    expect(quietTarget(undefined)).toBe(false);
  });
});
