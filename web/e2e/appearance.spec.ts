import { expect, test, type Page, type Request } from "@playwright/test";
import { HOSTILE_TITLE } from "../src/map/fixture";
import { setLook } from "./look";

async function open(page: Page) {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Hive map" })).toBeVisible();
}

const attrs = (page: Page) =>
  page.evaluate(() => ({ ...document.documentElement.dataset }));

const cssVar = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

const lookCookie = async (page: Page) =>
  (await page.context().cookies()).find((c) => c.name === "hive-look")?.value;

const button = (page: Page) =>
  page.getByRole("button", { name: /^Appearance/ });

const panel = (page: Page) => page.locator('[data-scope="reset"]');

const group = (page: Page, name: string) =>
  page.getByRole("radiogroup", { name, exact: true });

/** Every request from now on; the list must stay empty while the look changes. */
function watch(page: Page) {
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));
  return () => seen.map((r) => `${r.resourceType()} ${r.url()}`);
}

test("with no cookie the page has the default look", async ({ page }) => {
  await open(page);
  expect(await attrs(page)).toMatchObject({
    theme: "keystone",
    mode: "dark",
    reach: "tinted",
    dots: "theme",
  });
});

test("the cookie's look is in the first HTML response", async ({
  page,
  context,
}) => {
  await setLook(context, "aurora.light.vivid.classic");
  const res = await page.goto("/dev/map");
  const html = await res!.text();
  const tag = html.match(/<html[^>]*>/)![0];
  for (const [k, v] of [
    ["theme", "aurora"],
    ["mode", "light"],
    ["reach", "vivid"],
    ["dots", "classic"],
  ])
    expect(tag).toContain(`data-${k}="${v}"`);
});

test("a tampered cookie gives the default look and is not echoed", async ({
  page,
  context,
}) => {
  await setLook(context, "<script>alert(1)</script>");
  // The sign-in page: the map's fixture carries a hostile title of its own with alert(1) in it.
  const res = await page.goto("/login");
  const html = await res!.text();
  expect(html).not.toContain("alert(1)");
  expect(html).not.toContain("<script>alert");
  expect(await attrs(page)).toMatchObject({
    theme: "keystone",
    mode: "dark",
    reach: "tinted",
    dots: "theme",
  });
});

test("the panel is closed until its button opens it", async ({ page }) => {
  await open(page);
  await expect(button(page)).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page)).toHaveCount(0);
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-expanded", "true");
  await expect(panel(page)).toBeVisible();
  await expect(page.getByText("Dot colours", { exact: true })).toBeVisible();
  await expect(
    page.getByText("How far the colour reaches", { exact: true }),
  ).toBeVisible();
});

test("each choice applies at once, sets the cookie and makes no request", async ({
  page,
}) => {
  await open(page);
  await button(page).click();
  const before = await cssVar(page, "--brand");
  const requests = watch(page);

  await group(page, "Theme").getByRole("radio", { name: "Aurora" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aurora");
  expect(await cssVar(page, "--brand")).not.toBe(before);
  expect(await lookCookie(page)).toBe("aurora.dark.tinted.theme");

  await group(page, "Mode").getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await group(page, "Dot colours")
    .getByRole("radio", { name: "Classic" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-dots", "classic");
  await group(page, "How far the colour reaches")
    .getByRole("radio", { name: "Vivid" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-reach", "vivid");
  expect(await lookCookie(page)).toBe("aurora.light.vivid.classic");

  await page.waitForTimeout(500);
  expect(requests()).toEqual([]);

  await page.reload({ waitUntil: "networkidle" });
  expect(await attrs(page)).toMatchObject({
    theme: "aurora",
    mode: "light",
    reach: "vivid",
    dots: "classic",
  });
});

test("arrow keys move within a group and Escape returns to the button", async ({
  page,
}) => {
  await open(page);
  await button(page).click();
  const themes = group(page, "Theme");
  const keystone = themes.getByRole("radio", { name: "Keystone" });
  await expect(keystone).toHaveAttribute("aria-checked", "true");
  await expect(keystone).toHaveAttribute("tabindex", "0");
  await keystone.focus();
  await page.keyboard.press("ArrowRight");
  const graphite = themes.getByRole("radio", { name: "Graphite" });
  await expect(graphite).toBeFocused();
  await expect(graphite).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "graphite");
  await page.keyboard.press("ArrowLeft");
  await expect(keystone).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(button(page)).toBeFocused();
  await expect(button(page)).toHaveAttribute("aria-expanded", "false");
});

test("in light mode the popover's text is not white", async ({
  page,
  context,
}) => {
  await setLook(context, "keystone.light.tinted.theme");
  await open(page);
  await button(page).click();
  const color = await panel(page).evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("rgb(255, 255, 255)");
});

test("changing the theme keeps the selected dot", async ({ page }) => {
  await open(page);
  await page.locator('[data-map-dot][aria-label^="<img src=x"]').click();
  const title = page
    .getByRole("complementary", { name: "Details" })
    .getByRole("heading", { level: 2 });
  await expect(title).toHaveText(HOSTILE_TITLE);
  await button(page).click();
  await group(page, "Theme").getByRole("radio", { name: "Sunset" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sunset");
  await expect(title).toHaveText(HOSTILE_TITLE);
});

test("text is set in self-hosted Inter, with no font service", async ({
  page,
}) => {
  const requests = watch(page);
  await open(page);
  const family = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(family).toMatch(/^['"]?[\w ]*inter/i);
  expect(
    requests().filter((r) => /fonts\.(googleapis|gstatic)\.com/.test(r)),
  ).toEqual([]);
});

test("the rail is the chrome scope and marks the current page", async ({
  page,
}) => {
  await open(page);
  const rail = page.getByRole("complementary", { name: "Navigation" });
  await expect(rail).toHaveAttribute("data-scope", "chrome");
  await expect(rail.getByRole("link", { name: "Map" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(rail.getByRole("link", { name: "Vault" })).not.toHaveAttribute(
    "aria-current",
    /.*/,
  );
});

test("a tab that changed its own look still follows another tab's later change", async ({
  page,
  context,
}) => {
  // Both tabs open on the default look.
  await open(page);
  const other = await context.newPage();
  await open(other);
  // This tab picks a theme itself: the attribute is set in place, outside React's render.
  await button(page).click();
  await group(page, "Theme").getByRole("radio", { name: "Aurora" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aurora");
  // The other tab, still holding the default theme, changes the mode and rewrites the cookie.
  await button(other).click();
  await group(other, "Mode").getByRole("radio", { name: "Light" }).click();
  expect(await lookCookie(other)).toBe("keystone.light.tinted.theme");
  await other.close();

  await page.evaluate(() =>
    (
      window as unknown as { nd: { router: { refresh(): void } } }
    ).nd.router.refresh(),
  );
  // The page, the panel and the cookie agree again: every attribute follows the cookie.
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "keystone");
  await expect(
    group(page, "Theme").getByRole("radio", { name: "Keystone" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("a look changed in another tab is followed after a server refresh", async ({
  page,
  context,
}) => {
  await open(page);
  // The other tab, same browser: it changes the theme and the mode, which rewrites the cookie.
  const other = await context.newPage();
  await open(other);
  await button(other).click();
  await group(other, "Theme").getByRole("radio", { name: "Aurora" }).click();
  await group(other, "Mode").getByRole("radio", { name: "Light" }).click();
  expect(await lookCookie(other)).toBe("aurora.light.tinted.theme");
  await other.close();

  // The first tab refreshes from the server, as the map's Refresher does on focus. /dev/map has
  // no Refresher (it needs a session), so call the same router.refresh() through the router
  // Next exposes in development (window.nd).
  await page.evaluate(() =>
    (
      window as unknown as { nd: { router: { refresh(): void } } }
    ).nd.router.refresh(),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aurora");
  await button(page).click();
  await expect(
    group(page, "Theme").getByRole("radio", { name: "Aurora" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    group(page, "Mode").getByRole("radio", { name: "Light" }),
  ).toHaveAttribute("aria-checked", "true");

  // A following change keeps the other tab's fields.
  await group(page, "How far the colour reaches")
    .getByRole("radio", { name: "Vivid" })
    .click();
  expect(await lookCookie(page)).toBe("aurora.light.vivid.theme");
  expect(await attrs(page)).toMatchObject({
    theme: "aurora",
    mode: "light",
    reach: "vivid",
    dots: "theme",
  });
});

test("in forced colours the swatches stay visible and the choice is outlined", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  await button(page).click();
  const style = (name: string) =>
    group(page, "Theme")
      .getByRole("radio", { name })
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          outline: cs.outlineStyle,
          width: parseFloat(cs.outlineWidth),
          image: cs.backgroundImage,
        };
      });
  const chosen = await style("Keystone");
  expect(chosen.outline).not.toBe("none");
  expect(chosen.width).toBeGreaterThan(0);
  expect(chosen.image).toContain("gradient");
  const other = await style("Aurora");
  expect(other.image).toContain("gradient");
  expect(other.outline).toBe("none");
});

/** Relative brightness 0..1 of a computed `rgb(...)` colour. */
const brightness = (rgb: string) => {
  const [r, g, b] = rgb.match(/[\d.]+/g)!.map(Number);
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
};

test("printing in dark mode gives dark text on a light page", async ({
  page,
}) => {
  await open(page);
  const rail = page.getByRole("complementary", { name: "Navigation" });
  const railColour = () => rail.evaluate((el) => getComputedStyle(el).color);
  const screen = await railColour();
  expect(brightness(screen)).toBeGreaterThan(0.7);

  await page.emulateMedia({ media: "print" });
  const printed = await railColour();
  const body = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(printed).not.toBe(screen);
  expect(brightness(printed)).toBeLessThan(0.3);
  expect(brightness(body)).toBeGreaterThan(0.8);
});
