import { expect, test, type Page, type Request } from "@playwright/test";
import { fixturePayload, HOSTILE_TITLE } from "../src/map/fixture";
import { setLook } from "./look";

const VIEWS = ["Rings", "Circle", "Topics", "Links", "Timeline", "Orbit"];

async function open(page: Page) {
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Hive map" })).toBeVisible();
}

const viewButton = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name, exact: true });

const rail = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });

test("the six views switch in the browser without a request", async ({
  page,
}) => {
  await open(page);
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));

  for (const name of VIEWS) {
    await viewButton(page, name).click();
    await expect(viewButton(page, name)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const other of VIEWS.filter((v) => v !== name))
      await expect(viewButton(page, other)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
  }
  await viewButton(page, "Rings").click();
  const topics = page.getByRole("group", { name: "Topics" });
  await topics.getByRole("button", { name: "DMT" }).click();
  await topics.getByRole("button", { name: "ADNOC" }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await page.waitForTimeout(500);

  const bad = seen.filter(
    (r) =>
      r.url().includes("/rest/") ||
      r.url().includes("/auth/") ||
      ["document", "fetch", "xhr"].includes(r.resourceType()),
  );
  expect(bad.map((r) => `${r.resourceType()} ${r.url()}`)).toEqual([]);
});

test("a topic chip leaves its dots lit and dims the rest", async ({ page }) => {
  await open(page);
  await page
    .getByRole("group", { name: "Topics" })
    .getByRole("button", { name: "DMT" })
    .click();
  const dmt = page.locator('[data-map-dot][data-kind="note"][data-topic="0"]');
  const adnoc = page.locator(
    '[data-map-dot][data-kind="note"][data-topic="1"]',
  );
  await expect(dmt.first()).toHaveCSS("opacity", "1");
  await expect(adnoc.first()).toHaveCSS("opacity", "0.1");
});

test("a locked dot shows only that it is private", async ({ page }) => {
  await open(page);
  const locked = page.locator('[data-map-dot][data-kind="note"][data-locked]');
  // Rings packs neighbouring dots closer than their 3 px hit padding; pick by keyboard so the
  // test does not depend on which neighbour sits on top at this window size.
  await locked.first().focus();
  await page.keyboard.press("Enter");
  await expect(rail(page)).toContainText("Private note");
  await expect(rail(page)).toContainText("has not shared this");

  const text = (await rail(page).innerText()).toLowerCase();
  const titles = new Set(
    fixturePayload(Date.now())
      .nodes.filter((n) => n.title !== null)
      .map((n) => n.title!.toLowerCase()),
  );
  for (const t of titles) expect(text).not.toContain(t);
});

test("a readable note links to the vault and a locked one does not", async ({
  page,
}) => {
  await open(page);
  const note = fixturePayload(Date.now()).nodes.find(
    (n) => n.title === HOSTILE_TITLE,
  )!;
  await page.locator('[data-map-dot][aria-label^="<img src=x"]').click();
  await expect(
    rail(page).getByRole("link", { name: "Open in vault" }),
  ).toHaveAttribute("href", `/vault?note=${note.id}`);

  await page
    .locator('[data-map-dot][data-kind="note"][data-locked]')
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(rail(page)).toContainText("has not shared this");
  await expect(
    rail(page).getByRole("link", { name: "Open in vault" }),
  ).toHaveCount(0);
});

test("a hostile title is shown as text", async ({ page }) => {
  await open(page);
  const dot = page.locator('[data-map-dot][aria-label^="<img src=x"]');
  await expect(dot).toHaveCount(1);
  await dot.click();
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test("every dot is a labelled button", async ({ page }) => {
  await open(page);
  const counts: number[] = [];
  for (const name of ["Rings", "Orbit"]) {
    await viewButton(page, name).click();
    const dots = page.locator("[data-map-dot]");
    const n = await dots.count();
    expect(n).toBeGreaterThan(250);
    counts.push(n);
    const bad = await dots.evaluateAll((els) =>
      els
        .filter(
          (e) =>
            e.tagName !== "BUTTON" ||
            (e.getAttribute("aria-label") ?? "").trim() === "",
        )
        .map((e) => e.outerHTML.slice(0, 120)),
    );
    expect(bad).toEqual([]);
  }
  // One layer of dots at a time: the orbit view does not keep the flat dots mounted.
  expect(counts[1]).toBe(counts[0]);
});

test("the map sits on frosted glass", async ({ page }) => {
  await open(page);
  const blur = await page
    .getByRole("main", { name: "Hive map" })
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return (
        cs.backdropFilter ||
        cs.getPropertyValue("-webkit-backdrop-filter") ||
        ""
      );
    });
  expect(blur).toContain("blur(30px)");
});

test("no control on the map is a pill", async ({ page }) => {
  await open(page);
  // Select something so the detail panel's buttons and the selected ring are drawn too.
  await page.locator('[data-map-dot][aria-label^="<img src=x"]').click();
  const pills = await page.evaluate(() =>
    [...document.querySelectorAll("main *, main, aside *")]
      .filter((e) =>
        getComputedStyle(e).borderRadius.split(" ").includes("999px"),
      )
      .map((e) => e.outerHTML.slice(0, 100)),
  );
  expect(pills).toEqual([]);
});

/** A topic-0 dot's colour and the computed --hue-1, both as the browser writes rgb(). */
async function dotAndHue(page: Page) {
  return page.evaluate(() => {
    const shape = document.querySelector(
      '[data-map-dot][data-kind="note"][data-topic="0"]:not([data-locked]) > span',
    )!;
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--hue-1)";
    document.body.append(probe);
    const hue = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { dot: getComputedStyle(shape).backgroundColor, hue };
  });
}

test("a topic dot takes the theme's first topic colour", async ({
  page,
  context,
}) => {
  await setLook(context, "aurora.dark.tinted.theme");
  await open(page);
  const theme = await dotAndHue(page);
  expect(theme.dot).toBe(theme.hue);

  await setLook(context, "aurora.dark.tinted.classic");
  await open(page);
  const classic = await dotAndHue(page);
  expect(classic.dot).toBe(classic.hue);
  expect(classic.dot).not.toBe(theme.dot);
});

for (const look of [undefined, "aurora.light.vivid.classic"])
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 1000 },
    { width: 1366, height: 768 },
    { width: 1280, height: 620 },
  ]) {
    test(`the whole screen fits a ${size.width} x ${size.height} window without scrolling${look ? ` (${look})` : ""}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page);
      for (const name of ["Rings", "Timeline"]) {
        await viewButton(page, name).click();
        const fit = await page.evaluate(() => {
          const main = document.querySelector("main")!.getBoundingClientRect();
          const root = document.documentElement;
          return {
            pageScrolls:
              root.scrollHeight > window.innerHeight ||
              root.scrollWidth > window.innerWidth,
            panelBottom: main.bottom,
            panelRight: main.right,
          };
        });
        expect(fit.pageScrolls).toBe(false);
        expect(fit.panelBottom).toBeLessThanOrEqual(size.height);
        expect(fit.panelRight).toBeLessThanOrEqual(size.width);
      }
      // Every dot of the map stays inside the panel.
      await viewButton(page, "Rings").click();
      await page.waitForTimeout(1100);
      const dots = await page.evaluate(() => {
        const main = document.querySelector("main")!.getBoundingClientRect();
        const rects = [...document.querySelectorAll("[data-map-dot]")].map(
          (d) => d.getBoundingClientRect(),
        );
        return {
          count: rects.length,
          outside: rects.filter(
            (r) =>
              r.top < main.top ||
              r.bottom > main.bottom ||
              r.left < main.left ||
              r.right > main.right,
          ).length,
        };
      });
      expect(dots.count).toBeGreaterThan(250);
      expect(dots.outside).toBe(0);
    });
  }
