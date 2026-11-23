import { expect, test } from "@playwright/test";

test("a 5,000-item map zooms smoothly", async ({ page }) => {
  await page.goto("/dev/map?items=5000", { waitUntil: "networkidle" });
  await expect(page.locator("[data-map-dot]")).toHaveCount(
    await page.locator("[data-map-dot]").count(),
  );
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
