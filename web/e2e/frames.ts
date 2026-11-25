// Frame-time helpers for the map perf checks (files named *map-perf.spec.ts run alone).
import { expect, test, type Page } from "@playwright/test";

type Frames = { __f: number[]; __run: boolean };

/** Opens the 5,000-item map and waits until it is at rest. */
export async function openBig(page: Page) {
  await page.goto("/dev/map?items=5000", { waitUntil: "networkidle" });
  await expect(
    page.locator(
      '[data-map-dot][data-kind="note"], [data-map-dot][data-kind="file"]',
    ),
  ).toHaveCount(5000);
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-animating",
    { timeout: 10_000 },
  );
}

/**
 * Records every frame while `act` runs and until the canvas has come to rest again; returns the
 * frame times, sorted, without the first two.
 */
export async function framesOf(page: Page, act: () => Promise<void>) {
  const canvas = page.locator("[data-map-canvas]");
  await page.evaluate(() => {
    const w = window as unknown as Frames;
    w.__f = [];
    w.__run = true;
    let last = performance.now();
    const tick = (t: number) => {
      w.__f.push(t - last);
      last = t;
      if (w.__run) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await expect(canvas).toHaveAttribute("data-animating", "");
  await expect(canvas).not.toHaveAttribute("data-animating", {
    timeout: 10_000,
  });
  const f = await page.evaluate(() => {
    const w = window as unknown as Frames;
    w.__run = false;
    return w.__f.slice(2).sort((a, b) => a - b);
  });
  const p95 = f[Math.floor(f.length * 0.95)]!;
  const longest = f[f.length - 1]!;
  console.log(
    `${test.info().title}: ${f.length} frames, p95 ${p95.toFixed(1)} ms, longest ${longest.toFixed(1)} ms`,
  );
  return { f, p95, longest };
}
