import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";
import { Mark } from "./Mark";

describe("Mark", () => {
  it("is hidden from assistive tech and coloured only by theme variables", () => {
    const html = renderToStaticMarkup(<Mark size={18} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width="18"');
    const colours = [...html.matchAll(/(?:stroke|fill)="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(colours.length).toBeGreaterThan(0);
    for (const c of colours.filter((c) => c !== "none"))
      expect(c).toMatch(/^var\(--[a-z0-9-]+\)$/);
    expect(html.match(/data-link=""/g)).toHaveLength(2);
  });
});

describe("Logo", () => {
  it("reads as the words Hive Mind", () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html.replace(/<[^>]+>/g, "")).toBe("Hive Mind");
  });
});
