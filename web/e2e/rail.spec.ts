import { expect, test } from "@playwright/test";

test("the account menu holds appearance, settings and sign out", async ({
  page,
}) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  const account = page.getByRole("button", { name: /^Account/ });
  await account.click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(
    menu.getByRole("menuitem", { name: "Appearance" }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(account).toBeFocused();
});

test("an outside press closes the account menu", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Account/ }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toBeVisible();
  await page
    .getByRole("main", { name: "Hive map" })
    .click({ position: { x: 5, y: 5 } });
  await expect(menu).toBeHidden();
});

test("arrow keys move between the menu items", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Account/ }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(
    menu.getByRole("menuitem", { name: /^Appearance/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
});

test("the agents card opens to one line per agent", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  const card = page.getByRole("button", {
    name: /^Agents, \d+ of \d+ connected/,
  });
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await card.click();
  await expect(card).toHaveAttribute("aria-expanded", "true");
  // The Hive view's "At the hive" panel also names the agent, so look in the rail.
  const rail = page.getByRole("complementary", { name: "Navigation" });
  await expect(rail.getByText("Laptop", { exact: true })).toBeVisible();
});

test("one bar marks the current destination", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  const nav = page.getByRole("navigation", { name: "Main" });
  const bar = nav.locator("span[aria-hidden]").first();
  const link = nav.getByRole("link", { name: "Map" });
  await expect(link).toHaveAttribute("aria-current", "page");
  const [b, l] = await Promise.all([bar.boundingBox(), link.boundingBox()]);
  expect(b).not.toBeNull();
  expect(Math.abs(b!.y + b!.height / 2 - (l!.y + l!.height / 2))).toBeLessThan(
    2,
  );
});
