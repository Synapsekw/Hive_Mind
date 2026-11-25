import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderCss } from "./css";

// A Vitest file snapshot: `pnpm --filter @hive-mind/web themes` rewrites it; a plain run (and
// CI) fails if the committed file differs from what the engine produces.
describe("generated files", () => {
  it("themes.generated.css is up to date", async () => {
    await expect(renderCss()).toMatchFileSnapshot("./themes.generated.css");
  });

  it("the stylesheet is under 4 KB gzipped", () => {
    expect(gzipSync(renderCss()).length).toBeLessThan(4_000);
  });

  it("is deterministic", () => {
    expect(renderCss()).toBe(renderCss());
  });

  it("starts with the generated header, the default on :root, then a block per theme", () => {
    const out = renderCss();
    expect(out.startsWith("/*")).toBe(true);
    expect(out).toMatch(/generated/i);
    expect(out.indexOf(":root {")).toBeLessThan(
      out.indexOf('[data-theme="honey"] {'),
    );
    expect(out.match(/\[data-theme="/g)).toHaveLength(8);
    expect(out).toContain('[data-theme="paper"] {\n  color-scheme: light;');
    expect(out).not.toMatch(/data-mode|data-reach|data-dots|data-scope/);
    expect(out).not.toMatch(/NaN|undefined/);
  });
});
