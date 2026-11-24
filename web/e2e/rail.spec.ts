import { expect, test, type Page } from "@playwright/test";

test("the account popover holds appearance, settings and sign out", async ({
  page,
}) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  const account = page.getByRole("button", { name: /^Account/ });
  await expect(account).toHaveAttribute("aria-expanded", "false");
  await account.click();
  await expect(account).toHaveAttribute("aria-expanded", "true");
  const popover = page.getByRole("group", { name: "Account" });
  await expect(
    popover.getByRole("button", { name: /^Appearance/ }),
  ).toBeVisible();
  await expect(popover.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(popover.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(account).toBeFocused();
});

test("an outside press closes the account popover", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Account/ }).click();
  const popover = page.getByRole("group", { name: "Account" });
  await expect(popover).toBeVisible();
  await page
    .getByRole("main", { name: "Hive map" })
    .click({ position: { x: 5, y: 5 } });
  await expect(popover).toBeHidden();
});

test("tabbing out of the account popover closes it", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  const account = page.getByRole("button", { name: /^Account/ });
  await account.click();
  const popover = page.getByRole("group", { name: "Account" });
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: /^Appearance/ }).focus();
  await page.keyboard.press("Tab"); // Settings
  await page.keyboard.press("Tab"); // Sign out
  await expect(popover.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Tab"); // the account button: still inside
  await expect(account).toBeFocused();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Tab"); // out of the account area
  await expect(popover).toBeHidden();
});

test("the agents card opens to one line per agent", async ({ page }) => {
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  const card = page.getByRole("button", {
    name: /^Agents, \d+ of \d+ connected/,
  });
  await expect(card).toHaveAttribute("aria-expanded", "false");
  await card.click();
  await expect(card).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Laptop", { exact: true })).toBeVisible();
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

// ---- The hive switcher, on /dev/rail: three sample hives and stand-in actions ----

type HiveCall = { name: string; args: unknown[] };
const hiveCalls = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem("__hiveCalls") ?? "[]") as HiveCall[],
  );

const ATLAS = "00000000-0000-4000-8000-0000000000a2";

async function openHives(page: Page, query = "") {
  await page.goto(`/dev/rail${query}`, { waitUntil: "networkidle" });
  const rail = page.getByRole("complementary", { name: "Navigation" });
  const button = rail.getByRole("button", { name: /^Hive: / });
  await button.click();
  const popover = rail.getByRole("group", { name: "Hives" });
  await expect(popover).toBeVisible();
  return { rail, button, popover };
}

async function openNewHive(page: Page, query = "") {
  const opened = await openHives(page, query);
  await opened.popover.getByRole("button", { name: "New hive" }).click();
  const form = opened.popover.getByRole("form", { name: "New hive" });
  await expect(form).toBeVisible();
  return { ...opened, form };
}

test("the hive's name is a button at the top of the rail", async ({ page }) => {
  await page.goto("/dev/rail", { waitUntil: "networkidle" });
  const rail = page.getByRole("complementary", { name: "Navigation" });
  const button = rail.getByRole("button", { name: "Hive: Keystone Studio" });
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Keystone Studio");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const [b, nav] = await Promise.all([
    button.boundingBox(),
    rail.getByRole("navigation", { name: "Main" }).boundingBox(),
  ]);
  expect(b!.y + b!.height).toBeLessThanOrEqual(nav!.y);
});

test("the list shows every hive with the person's role and marks one as current", async ({
  page,
}) => {
  const { button, popover } = await openHives(page);
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const items = popover.getByRole("button");
  await expect(items).toHaveText([
    "Keystone Studioowner",
    "Atlas Researchmember",
    "Night Shiftowner",
    "New hive",
  ]);
  await expect(popover.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(
    popover.getByRole("button", { name: /Keystone Studio/ }),
  ).toHaveAttribute("aria-current", "true");
});

test("choosing another hive switches once and reloads the page", async ({
  page,
}) => {
  const { rail, popover } = await openHives(page);
  await page.evaluate(() => {
    (window as unknown as { __before?: boolean }).__before = true;
  });
  await popover.getByRole("button", { name: /Atlas Research/ }).click();
  await expect(
    rail.getByRole("button", { name: "Hive: Atlas Research" }),
  ).toBeVisible();
  // A full load: nothing set on the old window is left.
  expect(
    await page.evaluate(
      () => (window as unknown as { __before?: boolean }).__before,
    ),
  ).toBeUndefined();
  expect(new URL(page.url()).pathname).toBe("/dev/rail");
  expect(await hiveCalls(page)).toEqual([
    { name: "switchHive", args: [ATLAS] },
  ]);
});

test("choosing the current hive closes the list and switches nothing", async ({
  page,
}) => {
  const { button, popover } = await openHives(page);
  await popover.getByRole("button", { name: /Keystone Studio/ }).click();
  await expect(popover).toBeHidden();
  await expect(button).toBeFocused();
  expect(await hiveCalls(page)).toEqual([]);
});

test("a refused switch says so and stays on the hive", async ({ page }) => {
  const { button, popover } = await openHives(page, "?fail=1");
  await popover.getByRole("button", { name: /Atlas Research/ }).click();
  await expect(popover.getByRole("alert")).toHaveText(
    "That didn't work. Try again.",
  );
  await expect(button).toHaveAccessibleName("Hive: Keystone Studio");
  expect(await hiveCalls(page)).toHaveLength(1);
});

test("New hive opens a form with the person's name filled in and the hive name focused", async ({
  page,
}) => {
  const { form, popover } = await openNewHive(page);
  const name = form.getByRole("textbox", { name: "Hive name" });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("");
  await expect(
    form.getByRole("textbox", { name: "Your name in this hive" }),
  ).toHaveValue("Mara Lind");
  await expect(form.getByRole("button", { name: "Create" })).toBeVisible();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
  await expect(popover.getByRole("button", { name: "New hive" })).toBeFocused();
});

test("a wrong length is refused in the form before anything is asked", async ({
  page,
}) => {
  const { form } = await openNewHive(page);
  const name = form.getByRole("textbox", { name: "Hive name" });
  const yours = form.getByRole("textbox", { name: "Your name in this hive" });
  const create = form.getByRole("button", { name: "Create" });
  const alert = form.getByRole("alert");

  await create.click();
  await expect(alert).toHaveText("A hive name is 1 to 60 characters.");
  await name.fill("a".repeat(61));
  await create.click();
  await expect(alert).toHaveText("A hive name is 1 to 60 characters.");

  await name.fill("Field Notes");
  await yours.fill("   ");
  await create.click();
  await expect(alert).toHaveText("Your name is 1 to 60 characters.");
  await yours.fill("b".repeat(61));
  await create.click();
  await expect(alert).toHaveText("Your name is 1 to 60 characters.");

  expect(await hiveCalls(page)).toEqual([]);
});

for (const [query, line] of [
  ["?reason=name", "A hive name is 1 to 60 characters."],
  ["?reason=display-name", "Your name is 1 to 60 characters."],
  ["?limit=1", "You already own 5 hives."],
  ["?fail=1", "That didn't work. Try again."],
] as const) {
  test(`a new hive refused with ${query} says "${line}"`, async ({ page }) => {
    const { form } = await openNewHive(page, query);
    await form.getByRole("textbox", { name: "Hive name" }).fill("Field Notes");
    const create = form.getByRole("button", { name: "Create" });
    await create.click();
    await expect(form.getByRole("alert")).toHaveText(line);
    // The form is still there to correct, and usable again.
    await expect(create).not.toHaveAttribute("aria-disabled", "true");
    expect(await hiveCalls(page)).toEqual([
      { name: "createHive", args: ["Field Notes", "Mara Lind"] },
    ]);
  });
}

test("while a hive is being created the form does nothing more", async ({
  page,
}) => {
  const { form, popover } = await openNewHive(page, "?slow=1&limit=1");
  await form.getByRole("textbox", { name: "Hive name" }).fill("Field Notes");
  const create = form.getByRole("button", { name: "Create" });
  await create.click();
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await expect(form.getByRole("button", { name: "Cancel" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  // Playwright waits for a control marked disabled; these presses must land while it is.
  await create.click({ force: true });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(popover).toBeVisible();
  await expect(form.getByRole("alert")).toHaveText("You already own 5 hives.");
  expect(await hiveCalls(page)).toHaveLength(1);
});

test("a created hive leads to the home page with a full load; the texts are sent trimmed", async ({
  page,
}) => {
  const { form } = await openNewHive(page);
  await form.getByRole("textbox", { name: "Hive name" }).fill("  Field Notes ");
  await form
    .getByRole("textbox", { name: "Your name in this hive" })
    .fill(" Mara ");
  const home = page.waitForRequest(
    (r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/",
  );
  await page.keyboard.press("Enter");
  await home;
  // The dev server has no session, so "/" may lead on to the sign-in page: let it settle.
  await page.waitForURL((url) => url.pathname !== "/dev/rail");
  await page.waitForLoadState("networkidle");
  expect(await hiveCalls(page)).toEqual([
    { name: "createHive", args: ["Field Notes", "Mara"] },
  ]);
});

test("Escape closes the hive list, and the form, and returns focus to the button", async ({
  page,
}) => {
  const { button, popover } = await openHives(page);
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await button.click();
  await popover.getByRole("button", { name: "New hive" }).click();
  await expect(
    popover.getByRole("textbox", { name: "Hive name" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(button).toBeFocused();
});

test("an outside press closes the hive list", async ({ page }) => {
  const { popover } = await openHives(page);
  await page
    .getByRole("main", { name: "Hive map" })
    .click({ position: { x: 5, y: 5 } });
  await expect(popover).toBeHidden();
});

test("the keyboard walks the button, each hive, New hive and the form in order", async ({
  page,
}) => {
  await page.goto("/dev/rail", { waitUntil: "networkidle" });
  const rail = page.getByRole("complementary", { name: "Navigation" });
  const button = rail.getByRole("button", { name: /^Hive: / });
  await button.focus();
  await page.keyboard.press("Enter");
  const popover = rail.getByRole("group", { name: "Hives" });
  await expect(popover).toBeVisible();
  for (const name of [/Keystone Studio/, /Atlas Research/, /Night Shift/]) {
    await page.keyboard.press("Tab");
    await expect(popover.getByRole("button", { name })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(popover.getByRole("button", { name: "New hive" })).toBeFocused();
  await page.keyboard.press("Enter");
  const form = popover.getByRole("form", { name: "New hive" });
  await expect(form.getByRole("textbox", { name: "Hive name" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    form.getByRole("textbox", { name: "Your name in this hive" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Create" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab"); // the first destination: out of the switcher
  await expect(rail.getByRole("link", { name: "Map" })).toBeFocused();
  await expect(popover).toBeHidden();
});

test("a person in one hive still has the button, their hive and New hive", async ({
  page,
}) => {
  const { button, popover } = await openHives(page, "?one=1");
  await expect(button).toHaveAccessibleName("Hive: Keystone Studio");
  await expect(popover.getByRole("button")).toHaveText([
    "Keystone Studioowner",
    "New hive",
  ]);
  await expect(popover.locator('[aria-current="true"]')).toHaveCount(1);
});

test("without actions the switcher shows the hives, offers no New hive and switches nothing", async ({
  page,
}) => {
  const { popover } = await openHives(page, "?plain=1");
  await expect(popover.getByRole("button")).toHaveCount(3);
  await expect(popover.getByRole("button", { name: "New hive" })).toHaveCount(
    0,
  );
  const other = popover.getByRole("button", { name: /Atlas Research/ });
  await expect(other).toHaveAttribute("aria-disabled", "true");
  await other.click({ force: true });
  await expect(popover).toBeVisible();
  expect(await hiveCalls(page)).toEqual([]);
});

test("at 390 px the hive list and the form stay inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { form, popover, button } = await openNewHive(page);
  for (const part of [button, popover, form]) {
    const box = await part.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(form.getByRole("button", { name: "Cancel" })).toBeInViewport();
});

test("a very long hive name is cut short on the button, not spilled", async ({
  page,
}) => {
  await page.goto("/dev/rail", { waitUntil: "networkidle" });
  const rail = page.getByRole("complementary", { name: "Navigation" });
  const button = rail.getByRole("button", { name: /^Hive: / });
  await button
    .locator("span")
    .first()
    .evaluate((el) => {
      el.textContent = "W".repeat(60);
    });
  const [b, r] = await Promise.all([button.boundingBox(), rail.boundingBox()]);
  expect(b!.x + b!.width).toBeLessThanOrEqual(r!.x + r!.width);
});

test("a person in no hive can start one from the home page's notice", async ({
  page,
}) => {
  await page.goto("/dev/rail?none=1&limit=1", { waitUntil: "networkidle" });
  const main = page.getByRole("main", { name: "Hive map" });
  await expect(
    main.getByText(
      "You're not in a hive yet. Ask its owner to invite you, or start one.",
    ),
  ).toBeVisible();
  // Nobody is signed in to a hive: the rail keeps its plain name.
  await expect(page.getByRole("button", { name: /^Hive: / })).toHaveCount(0);
  await main.getByRole("button", { name: "New hive" }).click();
  const form = main.getByRole("form", { name: "New hive" });
  const name = form.getByRole("textbox", { name: "Hive name" });
  const yours = form.getByRole("textbox", { name: "Your name in this hive" });
  await expect(name).toBeFocused();
  await expect(yours).toHaveValue("");
  await name.fill("Field Notes");
  await yours.fill("Mara");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toHaveText("You already own 5 hives.");
  expect(await hiveCalls(page)).toEqual([
    { name: "createHive", args: ["Field Notes", "Mara"] },
  ]);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(main.getByRole("button", { name: "New hive" })).toBeFocused();
});

test("the no-hive notice without a way to start one is the sentence alone", async ({
  page,
}) => {
  await page.goto("/dev/rail?none=1&plain=1", { waitUntil: "networkidle" });
  const main = page.getByRole("main", { name: "Hive map" });
  await expect(
    main.getByText("You're not in a hive yet. Ask its owner to invite you."),
  ).toBeVisible();
  await expect(main.getByRole("button")).toHaveCount(0);
});
