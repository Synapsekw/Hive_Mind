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

const account = (page: Page) => page.getByRole("button", { name: /^Account/ });

const menu = (page: Page) => page.getByRole("group", { name: "Account" });

/** The Appearance row inside the account popover. */
const button = (page: Page) =>
  menu(page).getByRole("button", { name: /^Appearance/ });

/** The panel proper: the Theme radiogroup inside the menu. */
const panel = (page: Page) =>
  page.getByRole("radiogroup", { name: "Theme", exact: true });

/** Opens the account popover, then the Appearance panel inside it. */
async function openPanel(page: Page) {
  await account(page).click();
  await button(page).click();
}

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
  expect(await attrs(page)).toMatchObject({ theme: "honey", mode: "dark" });
  expect(await attrs(page)).not.toHaveProperty("reach");
  expect(await attrs(page)).not.toHaveProperty("dots");
});

test("the cookie's look is in the first HTML response", async ({
  page,
  context,
}) => {
  await setLook(context, "paper");
  const res = await page.goto("/dev/map");
  const html = await res!.text();
  const tag = html.match(/<html[^>]*>/)![0];
  for (const [k, v] of [
    ["theme", "paper"],
    ["mode", "light"],
  ])
    expect(tag).toContain(`data-${k}="${v}"`);
  expect(tag).not.toContain("data-reach");
  expect(tag).not.toContain("data-dots");
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
  expect(await attrs(page)).toMatchObject({ theme: "honey", mode: "dark" });
  expect(await attrs(page)).not.toHaveProperty("reach");
  expect(await attrs(page)).not.toHaveProperty("dots");
});

test("the panel is closed until its button opens it", async ({ page }) => {
  await open(page);
  await account(page).click();
  await expect(button(page)).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page)).toHaveCount(0);
  await button(page).click();
  await expect(button(page)).toHaveAttribute("aria-expanded", "true");
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("radio")).toHaveCount(8);
});

test("each choice applies at once, sets the cookie and makes no request", async ({
  page,
}) => {
  await open(page);
  await openPanel(page);
  const before = await cssVar(page, "--brand");
  const requests = watch(page);

  await group(page, "Theme").getByRole("radio", { name: "Aurora" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aurora");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  expect(await cssVar(page, "--brand")).not.toBe(before);
  expect(await lookCookie(page)).toBe("aurora");

  await group(page, "Theme").getByRole("radio", { name: "Paper" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  expect(await lookCookie(page)).toBe("paper");

  await page.waitForTimeout(500);
  expect(requests()).toEqual([]);

  await page.reload({ waitUntil: "networkidle" });
  expect(await attrs(page)).toMatchObject({
    theme: "paper",
    mode: "light",
  });
});

test("arrow keys move within a group and Escape returns to the account button", async ({
  page,
}) => {
  await open(page);
  await openPanel(page);
  const themes = group(page, "Theme");
  const honey = themes.getByRole("radio", { name: "Honey" });
  await expect(honey).toHaveAttribute("aria-checked", "true");
  await expect(honey).toHaveAttribute("tabindex", "0");
  await honey.focus();
  await page.keyboard.press("ArrowRight");
  const abyss = themes.getByRole("radio", { name: "Abyss" });
  await expect(abyss).toBeFocused();
  await expect(abyss).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyss");
  await page.keyboard.press("ArrowLeft");
  await expect(honey).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await expect(account(page)).toBeFocused();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
});

test("in light mode the popover's text is not white", async ({
  page,
  context,
}) => {
  await setLook(context, "paper");
  await open(page);
  await openPanel(page);
  const color = await panel(page).evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe("rgb(255, 255, 255)");
});

test("changing the theme keeps the selected dot", async ({ page }) => {
  await open(page);
  // The dot buttons are a visually hidden list over the canvas: select by keyboard.
  await page.locator('[data-map-dot][aria-label^="<img src=x"]').focus();
  await page.keyboard.press("Enter");
  const title = page
    .getByRole("complementary", { name: "Details" })
    .getByRole("heading", { level: 2 });
  await expect(title).toHaveText(HOSTILE_TITLE);
  await openPanel(page);
  await group(page, "Theme").getByRole("radio", { name: "Ember" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ember");
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

test("the rail marks the current page", async ({ page }) => {
  await open(page);
  const rail = page.getByRole("complementary", { name: "Navigation" });
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
  await openPanel(page);
  await group(page, "Theme").getByRole("radio", { name: "Aurora" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "aurora");
  // The other tab, still holding the default theme, picks Paper and rewrites the cookie.
  await openPanel(other);
  await group(other, "Theme").getByRole("radio", { name: "Paper" }).click();
  expect(await lookCookie(other)).toBe("paper");
  await other.close();

  await page.evaluate(() =>
    (
      window as unknown as { nd: { router: { refresh(): void } } }
    ).nd.router.refresh(),
  );
  // The page, the panel and the cookie agree again: every attribute follows the cookie.
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(
    group(page, "Theme").getByRole("radio", { name: "Paper" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("a look changed in another tab is followed after a server refresh", async ({
  page,
  context,
}) => {
  await open(page);
  // The other tab, same browser: it picks Paper, which rewrites the cookie.
  const other = await context.newPage();
  await open(other);
  await openPanel(other);
  await group(other, "Theme").getByRole("radio", { name: "Paper" }).click();
  expect(await lookCookie(other)).toBe("paper");
  await other.close();

  // The first tab refreshes from the server, as the map's Refresher does on focus. /dev/map has
  // no Refresher (it needs a session), so call the same router.refresh() through the router
  // Next exposes in development (window.nd).
  await page.evaluate(() =>
    (
      window as unknown as { nd: { router: { refresh(): void } } }
    ).nd.router.refresh(),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await openPanel(page);
  await expect(
    group(page, "Theme").getByRole("radio", { name: "Paper" }),
  ).toHaveAttribute("aria-checked", "true");

  // A following change replaces the other tab's choice.
  await group(page, "Theme").getByRole("radio", { name: "Ember" }).click();
  expect(await lookCookie(page)).toBe("ember");
  expect(await attrs(page)).toMatchObject({ theme: "ember", mode: "dark" });
});

test("in forced colours the swatches stay visible and the choice is outlined", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page);
  await openPanel(page);
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
  const chosen = await style("Honey");
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
