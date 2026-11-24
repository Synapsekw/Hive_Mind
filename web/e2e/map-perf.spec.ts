import { expect, test, type Page } from "@playwright/test";

type Frames = { __f: number[]; __run: boolean };

test("a 5,000-item map zooms smoothly", async ({ page }) => {
  await page.goto("/dev/map?items=5000", { waitUntil: "networkidle" });
  await expect(
    page.locator(
      '[data-map-dot][data-kind="note"], [data-map-dot][data-kind="file"]',
    ),
  ).toHaveCount(5000);
  const box = (await page.locator("[data-map-stage]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    (window as unknown as { __f: number[] }).__f = [];
    let last = performance.now();
    const tick = (t: number) => {
      (window as unknown as { __f: number[] }).__f.push(t - last);
      last = t;
      if ((window as unknown as { __f: number[] }).__f.length < 600)
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, i < 10 ? -60 : 60);
    await page.waitForTimeout(50);
  }
  const f = await page.evaluate(() =>
    (window as unknown as { __f: number[] }).__f.slice(5).sort((a, b) => a - b),
  );
  expect(f[Math.floor(f.length * 0.95)]).toBeLessThan(34);
});

/** Opens the 5,000-item map and waits until it is at rest. */
async function openBig(page: Page) {
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
async function framesOf(page: Page, act: () => Promise<void>) {
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

test("switching the arrangement at 5,000 items stays smooth", async ({
  page,
}) => {
  await openBig(page);
  // Every frame from the click until the glide has landed.
  const { f, p95, longest } = await framesOf(page, () =>
    page
      .getByRole("group", { name: "Arrange by" })
      .getByRole("button", { name: "Time", exact: true })
      .click(),
  );
  expect(f.length).toBeGreaterThan(10);
  expect(p95).toBeLessThan(34);
  // A freeze at the click is one long frame, which the p95 alone does not see.
  expect(longest).toBeLessThan(1000);
});

test("switching Rings to Timeline at 5,000 items stays smooth", async ({
  page,
}) => {
  await openBig(page);
  const { f, p95, longest } = await framesOf(page, () =>
    page
      .getByRole("group", { name: "View" })
      .getByRole("button", { name: "Timeline", exact: true })
      .click(),
  );
  expect(f.length).toBeGreaterThan(10);
  expect(p95).toBeLessThan(34);
  expect(longest).toBeLessThan(1000);
});
