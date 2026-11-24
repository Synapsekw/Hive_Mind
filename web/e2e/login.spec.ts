import { expect, test, type Page } from "@playwright/test";
import { setLook } from "./look";

test.use({ viewport: { width: 1366, height: 768 } });

const LOOKS = [undefined, "paper"] as const;

const radius = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).borderRadius);

const noScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight <=
        document.documentElement.clientHeight &&
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
  );

for (const look of LOOKS) {
  const name = look ?? "default look";

  test(`sign-in: fits 1366x768, glass card, 8px controls (${name})`, async ({
    page,
    context,
  }) => {
    if (look) await setLook(context, look);
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Hive Mind", exact: true }),
    ).toBeVisible();
    expect(await noScroll(page)).toBe(true);
    expect(await radius(page, 'input[type="email"]')).toBe("8px");
    expect(await radius(page, 'button[type="submit"]')).toBe("8px");
    const card = page.locator("main > div").first();
    expect(await card.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
      "20px",
    );
    expect((await card.boundingBox())!.width).toBeLessThanOrEqual(360);
  });

  test(`notice: fits 1366x768, message visible, Try again 8px (${name})`, async ({
    page,
    context,
  }) => {
    if (look) await setLook(context, look);
    await page.goto("/dev/notice", { waitUntil: "networkidle" });
    await expect(page.getByText("Couldn't load the hive.")).toBeVisible();
    expect(await noScroll(page)).toBe(true);
    const again = page.getByRole("link", { name: "Try again" });
    await expect(again).toBeVisible();
    expect(await again.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
      "8px",
    );
    // Reach the link by keyboard, so the ring is the :focus-visible one.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await again.evaluate((e) => e === document.activeElement)) break;
    }
    await expect(again).toBeFocused();
    const o = await again.evaluate((e) => {
      const c = getComputedStyle(e);
      return [c.outlineStyle, c.outlineWidth];
    });
    expect(o[0]).not.toBe("none");
    expect(o[1]).not.toBe("0px");
  });
}

test("sign-in: Tab shows a visible outline on each field it reaches", async ({
  page,
}) => {
  await page.goto("/login", { waitUntil: "networkidle" });
  const outlined = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement;
      const c = getComputedStyle(el);
      return {
        tag: el.tagName,
        type: el.type,
        style: c.outlineStyle,
        width: c.outlineWidth,
      };
    });
  await page.keyboard.press("Tab");
  let f = await outlined();
  expect(f).toMatchObject({ tag: "INPUT", type: "email" });
  expect(f.style).not.toBe("none");
  expect(f.width).not.toBe("0px");
  await page.keyboard.press("Tab");
  f = await outlined();
  expect(f).toMatchObject({ tag: "INPUT", type: "password" });
  expect(f.style).not.toBe("none");
  // The buttons are disabled, and skipped by Tab, when web/.env.local is absent; where the
  // project is configured the submit button comes next and shows the same ring.
  const submit = page.locator('button[type="submit"]');
  if (await submit.isEnabled()) {
    await page.keyboard.press("Tab");
    await expect(submit).toBeFocused();
    f = await outlined();
    expect(f.style).not.toBe("none");
    expect(f.width).not.toBe("0px");
  }
});
