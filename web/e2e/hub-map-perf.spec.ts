// The hub hover at retina density, rasterised on the GPU as a real browser does. Shadow blur is
// cheap in software (headless Chrome) and costly per draw call on a GPU, so only this setup sees
// a renderer that blurs hundreds of dots one by one. The name ends in map-perf.spec.ts: it runs
// in the perf project, alone.
import { expect, test } from "@playwright/test";
import { framesOf, openBig } from "./frames";

test.use({
  deviceScaleFactor: 2,
  launchOptions: {
    args: [
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    ],
  },
});

test("hovering the biggest hub at 5,000 items stays smooth", async ({
  page,
}) => {
  await openBig(page);
  // The hub with the most links: every one of its items is drawn in front, and its links fire.
  const hubs = page.locator('[data-map-dot][data-kind="hub"]');
  const n = await hubs.count();
  let best = 0;
  let most = -1;
  for (let j = 0; j < n; j++) {
    const t = await hubs.nth(j).getAttribute("data-topic");
    const c = await page.locator(`[data-map-dot][data-topic="${t}"]`).count();
    if (c > most) {
      most = c;
      best = j;
    }
  }
  const { f, p95, longest } = await framesOf(page, () =>
    hubs.nth(best).focus(),
  );
  expect(f.length).toBeGreaterThan(10);
  expect(p95).toBeLessThan(20);
  expect(longest).toBeLessThan(100);
});
