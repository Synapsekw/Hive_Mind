import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { HOSTILE_TITLE } from "../src/map/fixture";

// The test server's origin; keep in step with the port in playwright.config.ts.
const ORIGIN = "http://localhost:3100";

/** Sets the `hive-fold` cookie (`<rail>.<panel>`) as the fold buttons would. */
async function setFold(context: BrowserContext, fold: string) {
  await context.addCookies([
    { name: "hive-fold", value: fold, url: ORIGIN, sameSite: "Lax" },
  ]);
}

async function open(page: Page, path = "/dev/map") {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("complementary", { name: "Navigation" }),
  ).toBeVisible();
}

const html = (page: Page) => page.locator("html");
const leftRail = (page: Page) =>
  page.getByRole("complementary", { name: "Navigation" });
const rightPanel = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });
const railButton = (page: Page) =>
  page.getByRole("button", { name: /^(Fold|Unfold) navigation$/ });
const panelButton = (page: Page) =>
  page.getByRole("button", { name: /^(Fold|Unfold) details$/ });

/** Waits until a box is about `want` px wide (the fold is a short transition). */
async function widthIs(box: Locator, want: number) {
  await expect
    .poll(
      async () => Math.abs(((await box.boundingBox())?.width ?? 0) - want),
      {
        timeout: 5000,
      },
    )
    .toBeLessThanOrEqual(4);
}

async function settle(page: Page) {
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-animating",
    { timeout: 6000 },
  );
}

const countText = (page: Page) =>
  page.getByRole("status").filter({ hasText: /shown$/ });

// ---- The left rail ----

for (const path of ["/dev/map", "/dev/vault"]) {
  test(`${path}: the fold button folds the left rail to an icon strip and unfolds it`, async ({
    page,
  }) => {
    await open(page, path);
    await expect(html(page)).toHaveAttribute("data-rail", "open");
    const button = page.getByRole("button", { name: "Fold navigation" });
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const full = (await leftRail(page).boundingBox())!.width;
    expect(full).toBeGreaterThan(120);

    await button.click();
    await expect(html(page)).toHaveAttribute("data-rail", "shut");
    await widthIs(leftRail(page), 60);
    const folded = page.getByRole("button", { name: "Unfold navigation" });
    await expect(folded).toHaveAttribute("aria-expanded", "false");

    await folded.click();
    await expect(html(page)).toHaveAttribute("data-rail", "open");
    await widthIs(leftRail(page), full);
    await expect(
      page.getByRole("button", { name: "Fold navigation" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test(`${path}: the [ key folds and unfolds the left rail, and holding it toggles once`, async ({
    page,
  }) => {
    await open(page, path);
    await page.keyboard.press("[");
    await expect(html(page)).toHaveAttribute("data-rail", "shut");
    await widthIs(leftRail(page), 60);
    await page.keyboard.press("[");
    await expect(html(page)).toHaveAttribute("data-rail", "open");

    // Held down: the first keydown folds; the repeats that follow do nothing.
    await page.keyboard.down("[");
    await page.keyboard.down("[");
    await page.keyboard.down("[");
    await page.keyboard.down("[");
    await page.keyboard.up("[");
    await expect(html(page)).toHaveAttribute("data-rail", "shut");
    await page.waitForTimeout(150);
    await expect(html(page)).toHaveAttribute("data-rail", "shut");
  });
}

test("a reload keeps the fold: the server already draws it", async ({
  page,
  context,
}) => {
  await setFold(context, "shut.open");
  const res = await page.request.get("/dev/map");
  const tag = /<html\b[^>]*>/.exec(await res.text())?.[0] ?? "";
  expect(tag).toContain('data-rail="shut"');
  expect(tag).toContain('data-panel="open"');

  // And after a real fold and reload, the browser sends the cookie it wrote.
  await context.clearCookies();
  await open(page);
  await page.getByRole("button", { name: "Fold navigation" }).click();
  await expect(html(page)).toHaveAttribute("data-rail", "shut");
  await page.reload({ waitUntil: "networkidle" });
  await expect(html(page)).toHaveAttribute("data-rail", "shut");
  await widthIs(leftRail(page), 60);
  const cookies = await context.cookies(ORIGIN);
  expect(cookies.find((c) => c.name === "hive-fold")?.value).toBe("shut.open");
});

test("folded, every destination and the account and agents buttons keep their names", async ({
  page,
  context,
}) => {
  await setFold(context, "shut.open");
  await open(page);
  await widthIs(leftRail(page), 60);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Map", "Vault", "Gallery", "Inbox", "Settings"]) {
    const link = nav.getByRole("link", { name: new RegExp(`^${name}`) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleName(new RegExp(`^${name}`));
  }
  await expect(
    leftRail(page).getByRole("button", { name: /^Account/ }),
  ).toBeVisible();
  await expect(
    leftRail(page).getByRole("button", { name: /^Agents, \d+ of \d+ live$/ }),
  ).toBeVisible();
});

test("typing [ in the search field does not fold and lands in the field", async ({
  page,
}) => {
  await open(page);
  const search = page.getByPlaceholder("Search");
  await search.click();
  await page.keyboard.type("a[b]c");
  await expect(search).toHaveValue("a[b]c");
  await expect(html(page)).toHaveAttribute("data-rail", "open");
  await expect(html(page)).toHaveAttribute("data-panel", "open");
});

test("a window narrower than 700 px does not fold and shows no fold button", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await setFold(context, "shut.shut");
  await open(page);
  await expect(railButton(page)).toBeHidden();
  await expect(panelButton(page)).toBeHidden();
  // The rail is not the 60 px strip: it keeps its labels.
  const box = (await leftRail(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(100);
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByText("Vault", { exact: true }),
  ).toBeVisible();
  // The key does nothing here either: the cookie is left as it was.
  await page.keyboard.press("[");
  await page.keyboard.press("]");
  await expect(html(page)).toHaveAttribute("data-rail", "shut");
  await expect(html(page)).toHaveAttribute("data-panel", "shut");
  const box2 = (await leftRail(page).boundingBox())!;
  expect(box2.width).toBeGreaterThan(100);
});

// ---- The right panel ----

test("the fold button and the ] key fold the details panel to a strip and back", async ({
  page,
}) => {
  await open(page);
  await expect(html(page)).toHaveAttribute("data-panel", "open");
  const full = (await rightPanel(page).boundingBox())!.width;
  expect(full).toBeGreaterThan(150);

  await page.getByRole("button", { name: "Fold details" }).click();
  await expect(html(page)).toHaveAttribute("data-panel", "shut");
  await widthIs(rightPanel(page), 52);
  const unfold = page.getByRole("button", { name: "Unfold details" });
  await expect(unfold).toHaveAttribute("aria-expanded", "false");
  await unfold.click();
  await expect(html(page)).toHaveAttribute("data-panel", "open");
  await widthIs(rightPanel(page), full);

  await page.keyboard.press("]");
  await expect(html(page)).toHaveAttribute("data-panel", "shut");
  await widthIs(rightPanel(page), 52);
  await page.keyboard.press("]");
  await expect(html(page)).toHaveAttribute("data-panel", "open");

  // Held down: one toggle.
  await page.keyboard.down("]");
  await page.keyboard.down("]");
  await page.keyboard.down("]");
  await page.keyboard.up("]");
  await expect(html(page)).toHaveAttribute("data-panel", "shut");
  await page.waitForTimeout(150);
  await expect(html(page)).toHaveAttribute("data-panel", "shut");
});

test("] does nothing on a page without a panel", async ({ page }) => {
  await open(page, "/dev/vault");
  await page.keyboard.press("]");
  await expect(html(page)).toHaveAttribute("data-panel", "open");
  await expect(panelButton(page)).toHaveCount(0);
});

test("folded, the strip shows how many need you", async ({ page, context }) => {
  await setFold(context, "open.shut");
  await open(page, "/dev/map?inbox=2");
  await widthIs(rightPanel(page), 52);
  await expect(rightPanel(page).getByText("2 need you")).toBeAttached();
  await expect(rightPanel(page).locator('[class*="stripBadge"]')).toBeVisible();
  await expect(
    rightPanel(page).locator('[class*="stripBadge"] > [aria-hidden="true"]'),
  ).toHaveText("2");
});

test("selecting a dot with the keyboard while folded unfolds the panel on its details", async ({
  page,
  context,
}) => {
  await setFold(context, "open.shut");
  await open(page);
  await widthIs(rightPanel(page), 52);
  const dot = page.locator('[data-map-dot][aria-label^="<img src=x"]');
  await dot.focus();
  await page.keyboard.press("Enter");
  await expect(html(page)).toHaveAttribute("data-panel", "open");
  await expect(rightPanel(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  await expect(
    rightPanel(page).getByRole("heading", { level: 2 }),
  ).toBeVisible();
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});

test("a By person row is a button that adds that person to the filter bar and narrows the count", async ({
  page,
  context,
}) => {
  // The rail folded leaves room for the chip.
  await setFold(context, "shut.open");
  await open(page);
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  const person = rightPanel(page).getByRole("button", { name: /^Ahmed/ });
  await expect(person).toHaveAttribute("aria-pressed", "false");
  await person.click();
  await expect(person).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Remove Ahmed", exact: true }),
  ).toBeVisible();
  await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);

  await person.click();
  await expect(person).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Remove Ahmed", exact: true }),
  ).toHaveCount(0);
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
});

test("folding the panel from a focused By person row ends the preview and keeps focus on the fold button", async ({
  page,
}) => {
  await open(page);
  const canvas = page.locator("[data-map-canvas]");
  const person = rightPanel(page).getByRole("button", { name: /^Ahmed/ });
  await person.focus();
  await expect(canvas).toHaveAttribute("data-preview", /^member:/);
  await page.keyboard.press("]");
  await expect(html(page)).toHaveAttribute("data-panel", "shut");
  await expect(canvas).toHaveAttribute("data-preview", "");
  await expect(
    page.getByRole("button", { name: "Unfold details", exact: true }),
  ).toBeFocused();
});

// ---- Folding keeps the map's view, and nothing collides ----

/** The zoom control's visible number. */
async function zoomPct(page: Page): Promise<number> {
  const text = await page
    .getByRole("group", { name: "Zoom" })
    .locator('[class*="zoomValue"]')
    .textContent();
  return Number.parseInt(text ?? "", 10);
}

test("folding either side keeps a zoomed-in view zoomed in", async ({
  page,
}) => {
  await open(page);
  await settle(page);
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  await zoomIn.click();
  await zoomIn.click();
  await settle(page);
  await expect.poll(() => zoomPct(page)).toBeGreaterThan(100);
  const zoomed = await zoomPct(page);

  for (const [button, box, want, attr, side] of [
    [railButton(page), leftRail(page), 60, "data-rail", "Navigation"],
    [panelButton(page), rightPanel(page), 52, "data-panel", "Details"],
  ] as const) {
    await button.click();
    await expect(html(page)).toHaveAttribute(attr, "shut");
    await widthIs(box, want);
    await settle(page);
    expect(await zoomPct(page), `folded ${side}`).toBeGreaterThan(100);
    await button.click();
    await expect(html(page)).toHaveAttribute(attr, "open");
    await settle(page);
    expect(await zoomPct(page), `unfolded ${side}`).toBeGreaterThan(100);
  }
  // Not a reset to Fit and a zoom back in: the view is where it was.
  expect(Math.abs((await zoomPct(page)) - zoomed)).toBeLessThanOrEqual(1);
});

for (const fold of ["open.open", "shut.open", "open.shut", "shut.shut"]) {
  test(`at 1280 px with ${fold} the filter bar and zoom control do not overlap and the top bar holds`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setFold(context, fold);
    await open(page);
    await settle(page);

    // Give the bar some chips to carry.
    await page.getByRole("button", { name: /^Folders/ }).click();
    const list = page.getByRole("group", { name: "Folders", exact: true });
    await list.getByRole("checkbox", { name: "DMT" }).click();
    await list.getByRole("checkbox", { name: "ADNOC" }).click();
    await page.getByRole("button", { name: /^Folders/ }).click();
    await expect(list).toHaveCount(0);
    await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);

    const filter = page
      .locator("[data-map-overlay]")
      .filter({
        has: page.getByRole("button", { name: "Legend", exact: true }),
      })
      .last();
    const a = (await filter.boundingBox())!;
    const b = (await page.getByRole("group", { name: "Zoom" }).boundingBox())!;
    const apart =
      a.x + a.width <= b.x + 0.5 ||
      b.x + b.width <= a.x + 0.5 ||
      a.y + a.height <= b.y + 0.5 ||
      b.y + b.height <= a.y + 0.5;
    expect(apart, "filter bar and zoom control overlap").toBe(true);

    const bar = page.locator('main[aria-label="Hive map"] > div').first();
    const barBox = (await bar.boundingBox())!;
    const children = await bar.locator("> *").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right };
      }),
    );
    expect(children.length).toBeGreaterThan(2);
    for (const c of children) {
      expect(c.left).toBeGreaterThanOrEqual(barBox.x - 0.5);
      expect(c.right).toBeLessThanOrEqual(barBox.x + barBox.width + 0.5);
    }
    // The page itself does not scroll sideways.
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
}
