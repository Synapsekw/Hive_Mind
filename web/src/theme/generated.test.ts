import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderAdjustments, renderCss } from "./css";

// The two files are Vitest file snapshots: `pnpm --filter @hive-mind/web themes` rewrites them;
// a plain run (and CI) fails if the committed files differ from what the engine produces.
describe("generated files", () => {
  it("themes.generated.css is up to date", async () => {
    await expect(renderCss()).toMatchFileSnapshot("./themes.generated.css");
  });

  it("adjustments.generated.txt is up to date", async () => {
    await expect(renderAdjustments()).toMatchFileSnapshot(
      "./adjustments.generated.txt",
    );
  });

  it("the stylesheet is under 15 KB gzipped", () => {
    expect(gzipSync(renderCss()).length).toBeLessThan(15_000);
  });

  it("is deterministic", () => {
    expect(renderCss()).toBe(renderCss());
    expect(renderAdjustments()).toBe(renderAdjustments());
  });

  it("starts with the generated header and the default look on :root", () => {
    const out = renderCss();
    expect(out.startsWith("/*")).toBe(true);
    expect(out).toMatch(/generated/i);
    expect(out.indexOf(":root {")).toBeLessThan(
      out.indexOf('[data-theme="keystone"]'),
    );
    expect(out).toContain(
      '[data-theme="neon"][data-mode="light"][data-reach="vivid"] {',
    );
    expect(out).toContain('[data-mode="light"][data-dots="classic"] {');
    expect(out).toContain(
      '[data-theme="aurora"][data-mode="light"] [data-scope="chrome"] {',
    );
    expect(out).toContain(
      '[data-theme="aurora"][data-mode="light"] [data-scope="reset"] {',
    );
    expect(out).not.toMatch(/NaN|undefined/);
  });
});
