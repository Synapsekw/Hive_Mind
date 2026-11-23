import { expect, test, type Page } from "@playwright/test";
import {
  APPROVE,
  ASKS,
  DENY,
  FAILED,
  NO_HIVE,
  NOTHING_TO_APPROVE,
  TITLE,
  WHAT_IT_MAY_DO,
  WORKSPACE,
  returnsTo,
} from "../src/app/oauth/consent/text";

test.use({ viewport: { width: 1366, height: 768 } });

const MAIN = "00000000-0000-4000-8000-000000000b01";
const RESEARCH = "00000000-0000-4000-8000-000000000b03";

async function open(page: Page, query = "") {
  // Nothing on this screen may use a browser dialog.
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/consent${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: TITLE })).toBeVisible();
}

type Call = { decision: string; args: unknown[] };
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __consentCalls?: Call[] }).__consentCalls,
  );

const approve = (page: Page) => page.getByRole("button", { name: APPROVE });
const deny = (page: Page) => page.getByRole("button", { name: DENY });
const picker = (page: Page) => page.getByLabel(WORKSPACE);

test("shows which app asks, where it returns, and what approving allows", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId("app-name")).toHaveText("Claude");
  await expect(page.getByText(ASKS)).toBeVisible();
  await expect(page.getByTestId("returns-to")).toHaveText(
    returnsTo("claude.ai"),
  );
  await expect(page.getByText(WHAT_IT_MAY_DO)).toBeVisible();
  await expect(approve(page)).toBeEnabled();
  await expect(deny(page)).toBeEnabled();
  // The whole window fits without scrolling.
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <=
          document.documentElement.clientHeight &&
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("an app's own name and host are shown as text, never as markup", async ({
  page,
}) => {
  await open(
    page,
    `?app=${encodeURIComponent("<img src=x onerror=alert(1)>")}&host=evil.example`,
  );
  await expect(page.getByTestId("app-name")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.getByTestId("returns-to")).toHaveText(
    returnsTo("evil.example"),
  );
});

test("Main is preselected; Approve sends the chosen workspace and goes to the return address", async ({
  page,
}) => {
  await open(page);
  await expect(picker(page)).toHaveValue(MAIN);
  await picker(page).selectOption({ label: "Research" });
  await expect(picker(page)).toHaveValue(RESEARCH);
  await approve(page).click();
  await page.waitForURL(/state=approved/);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(RESEARCH);
  await expect(page.getByText("Fixture: approved for Research.")).toBeVisible();
});

test("Approve without touching the picker sends Main", async ({ page }) => {
  await open(page);
  await approve(page).click();
  await page.waitForURL(/state=approved/);
  await expect(page.getByText("Fixture: approved for Main.")).toBeVisible();
});

test("Deny goes to the return address and approves nothing", async ({
  page,
}) => {
  await open(page);
  await deny(page).click();
  // Both buttons are off while the answer is on its way.
  await expect(approve(page)).toBeDisabled();
  await page.waitForURL(/state=deny/);
  await expect(page.getByText("Fixture: the app was told no.")).toBeVisible();
});

test("a refused decision shows its line and lets the person try again", async ({
  page,
}) => {
  await open(page, "?state=error");
  await approve(page).click();
  await expect(page.getByText(FAILED)).toBeVisible();
  expect(page.url()).toContain("state=error");
  await expect(approve(page)).toBeEnabled();
  await expect(deny(page)).toBeEnabled();
  await deny(page).click();
  await expect(page.getByText(FAILED)).toBeVisible();
  expect((await calls(page))?.map((c) => c.decision)).toEqual([
    "approve",
    "deny",
  ]);
  // Only the request and the workspace leave the form: no app name, no host.
  expect((await calls(page))?.[0]?.args).toEqual(["dev-authorization", MAIN]);
});

test("the keyboard reaches the picker and both buttons, each with a visible ring", async ({
  page,
}) => {
  await open(page);
  const ring = () =>
    page.evaluate(() => {
      const c = getComputedStyle(document.activeElement!);
      return [c.outlineStyle, c.outlineWidth];
    });
  await page.keyboard.press("Tab");
  await expect(picker(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(approve(page)).toBeFocused();
  expect((await ring())[0]).not.toBe("none");
  expect((await ring())[1]).not.toBe("0px");
  await page.keyboard.press("Tab");
  await expect(deny(page)).toBeFocused();
  expect((await ring())[0]).not.toBe("none");
  await page.keyboard.press("Enter");
  await page.waitForURL(/state=deny/);
});

test("the lines that stand in for the form", async ({ page }) => {
  await open(page, "?state=nohive");
  await expect(page.getByText(NO_HIVE)).toBeVisible();
  await expect(approve(page)).toHaveCount(0);
  await open(page, "?state=none");
  await expect(page.getByText(NOTHING_TO_APPROVE)).toBeVisible();
  await expect(approve(page)).toHaveCount(0);
});
