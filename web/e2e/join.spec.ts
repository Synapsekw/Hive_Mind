import { expect, test, type Page } from "@playwright/test";
import {
  FIXTURE_EMAIL,
  FIXTURE_TOKEN,
  FIXTURE_WAITING,
} from "../src/join/fixture";
import {
  CHECK,
  CONTINUE,
  COULD_NOT_LOAD,
  EXPIRED,
  EXPIRED_NEXT,
  FAILED,
  IN_THIS_BROWSER,
  JOIN,
  NONE,
  NOT_YOU,
  PASSWORD,
  PASSWORD_DIFFERENT,
  PASSWORD_FAILED,
  PASSWORD_LONG,
  PASSWORD_OPTIONAL,
  PASSWORD_REFUSED,
  PASSWORD_SHORT,
  PASSWORD_TITLE,
  REPEAT_PASSWORD,
  SAVE_PASSWORD,
  OPENED,
  SIGNED_IN_AS,
  SIGNED_IN_NOW,
  SIGN_OUT,
  SIGN_OUT_AND_CONTINUE,
  SKIP,
  STAY_AS,
  SWITCHED,
  SWITCH_WARNING,
  TITLE,
  TO_MAP,
  TO_SIGN_IN,
  WAITING,
  invitedBy,
} from "../src/join/text";

test.use({ viewport: { width: 1366, height: 768 } });

async function open(page: Page, query = "") {
  // Nothing on this screen may use a browser dialog.
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/join${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: TITLE })).toBeVisible();
}

type Call = { what: string; args: unknown[] };
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __joinCalls?: Call[] }).__joinCalls,
  );

const joins = (page: Page) => page.getByRole("button", { name: JOIN });
const noScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight <=
        document.documentElement.clientHeight &&
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
  );
const ring = (page: Page) =>
  page.evaluate(() => {
    const c = getComputedStyle(document.activeElement!);
    return [c.outlineStyle, c.outlineWidth];
  });

test("two invitations: each hive, who invited, and its own Join", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("heading", { name: WAITING })).toBeVisible();
  const items = page.getByRole("listitem");
  await expect(items).toHaveCount(2);
  for (const [i, w] of FIXTURE_WAITING.entries()) {
    await expect(items.nth(i).getByTestId("hive-name")).toHaveText(w.hiveName);
    await expect(items.nth(i).getByTestId("invited-by")).toHaveText(
      invitedBy(w.invitedBy),
    );
    await expect(
      items.nth(i).getByRole("button", { name: JOIN }),
    ).toBeEnabled();
  }
  await expect(page.getByText(CHECK)).toBeVisible();
  // The card is the sign-in card, and the whole page fits without scrolling.
  expect(await noScroll(page)).toBe(true);
  const cardEl = page.locator("main > div").first();
  expect(await cardEl.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
    "20px",
  );
  expect(
    await joins(page)
      .first()
      .evaluate((e) => getComputedStyle(e).borderRadius),
  ).toBe("8px");
});

test("Join sends only the invitation's id and goes on to the map", async ({
  page,
}) => {
  await open(page);
  await joins(page).nth(1).click();
  // Every Join is off while the answer is on its way.
  await expect(joins(page).first()).toBeDisabled();
  expect(await calls(page)).toEqual([
    { what: "join", args: [FIXTURE_WAITING[1]!.id] },
  ]);
  await page.waitForURL(/state=joined/);
  await expect(page.getByText(NONE)).toBeVisible();
});

test("a refused Join shows its line and lets the person try again", async ({
  page,
}) => {
  await open(page, "?fail=1");
  await joins(page).first().click();
  await expect(page.getByText(FAILED)).toBeVisible();
  expect(page.url()).toContain("fail=1");
  await expect(joins(page).first()).toBeEnabled();
  await expect(joins(page).nth(1)).toBeEnabled();
});

test("a hive's name and an inviter's name are shown as text, never as markup or a link", async ({
  page,
}) => {
  const hive = "<img src=x onerror=alert(1)>";
  const by = '<a href="https://evil.example">click</a>';
  await open(
    page,
    `?hive=${encodeURIComponent(hive)}&by=${encodeURIComponent(by)}`,
  );
  await expect(page.getByTestId("hive-name").first()).toHaveText(hive);
  await expect(page.getByTestId("invited-by").first()).toHaveText(
    invitedBy(by),
  );
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator("main a")).toHaveCount(0);
  // Neither name is anywhere in an attribute.
  const inAttribute = await page.evaluate(() =>
    [...document.querySelectorAll("main *")].some((el) =>
      [...el.attributes].some(
        (a) => a.value.includes("onerror") || a.value.includes("evil.example"),
      ),
    ),
  );
  expect(inAttribute).toBe(false);
});

test("nothing waiting: the line and the way to the map", async ({ page }) => {
  await open(page, "?state=empty");
  await expect(page.getByText(NONE)).toBeVisible();
  await expect(joins(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: TO_MAP })).toHaveAttribute(
    "href",
    "/",
  );
  expect(await noScroll(page)).toBe(true);
});

test("an expired link: the line, the way forward, and sign-in that returns here", async ({
  page,
}) => {
  await open(page, "?state=expired");
  await expect(page.getByText(EXPIRED, { exact: true })).toBeVisible();
  await expect(page.getByText(EXPIRED_NEXT)).toBeVisible();
  await expect(joins(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: CONTINUE })).toHaveCount(0);
  await expect(page.getByRole("link", { name: TO_SIGN_IN })).toHaveAttribute(
    "href",
    "/login?next=%2Fjoin",
  );
  expect(await noScroll(page)).toBe(true);
});

test("an opened link: nothing is spent until Continue is pressed", async ({
  page,
}) => {
  await open(page, "?state=continue");
  await expect(page.getByText(OPENED)).toBeVisible();
  await expect(joins(page)).toHaveCount(0);
  expect(await calls(page)).toBeUndefined();
  await page.getByRole("button", { name: CONTINUE }).click();
  await expect(page.getByRole("button", { name: CONTINUE })).toBeDisabled();
  expect(await calls(page)).toEqual([
    { what: "continue", args: [FIXTURE_TOKEN, "invite"] },
  ]);
  // On to the list, at an address with no token in it.
  await page.waitForURL((url) => url.pathname === "/dev/join" && !url.search);
  await expect(page.getByRole("heading", { name: WAITING })).toBeVisible();
});

test("a refused Continue ends on the expired line", async ({ page }) => {
  await open(page, "?state=continue&fail=1");
  await page.getByRole("button", { name: CONTINUE }).click();
  await page.waitForURL(/state=expired/);
  await expect(page.getByText(EXPIRED, { exact: true })).toBeVisible();
});

test("the line for invitations that could not be read", async ({ page }) => {
  await open(page, "?state=failed");
  await expect(page.getByText(COULD_NOT_LOAD)).toBeVisible();
  await expect(joins(page)).toHaveCount(0);
});

test("the list and the empty state say who is signed in, with a way out for someone else", async ({
  page,
}) => {
  for (const query of ["", "?state=empty"]) {
    await open(page, query);
    await expect(page.getByTestId("signed-in-as")).toHaveText(FIXTURE_EMAIL);
    await expect(page.getByText(SIGNED_IN_AS)).toBeVisible();
    await expect(page.getByText(NOT_YOU)).toBeVisible();
    const out = page.getByRole("button", { name: SIGN_OUT });
    await expect(out).toBeVisible();
    // The app's own sign-out, by POST, then sign-in and back to this page.
    const form = out.locator("xpath=ancestor::form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "/auth/signout?next=%2Fjoin");
    expect(await noScroll(page)).toBe(true);
  }
});

test("the signed-in address is shown as text, cut nowhere into markup or an attribute", async ({
  page,
}) => {
  const email = '"><img src=x onerror=alert(1)>@evil.example';
  await open(page, `?email=${encodeURIComponent(email)}`);
  await expect(page.getByTestId("signed-in-as")).toHaveText(email);
  await expect(page.locator("main img")).toHaveCount(0);
  const inAttribute = await page.evaluate(() =>
    [...document.querySelectorAll("main *")].some((el) =>
      [...el.attributes].some((a) => a.value.includes("evil.example")),
    ),
  );
  expect(inAttribute).toBe(false);
});

test("no address known: no line and no sign-out; the other states never show one", async ({
  page,
}) => {
  for (const query of ["?email=", "?state=continue", "?state=expired"]) {
    await open(page, query);
    await expect(page.getByTestId("signed-in-as")).toHaveCount(0);
    await expect(page.getByRole("button", { name: SIGN_OUT })).toHaveCount(0);
  }
});

test("Continue while signed in: who is signed in, that this browser is signed out of it, and who is signed in instead", async ({
  page,
}) => {
  await open(
    page,
    `?state=continue&email=${encodeURIComponent(FIXTURE_EMAIL)}`,
  );
  await expect(page.getByTestId("switch-warning")).toHaveText(
    `${SIGNED_IN_NOW} ${FIXTURE_EMAIL} ${IN_THIS_BROWSER} ${SWITCH_WARNING}`,
  );
  // The button says what pressing it does; there is no plain Continue.
  const go = page.getByRole("button", { name: SIGN_OUT_AND_CONTINUE });
  await expect(go).toBeVisible();
  await expect(
    page.getByRole("button", { name: CONTINUE, exact: true }),
  ).toHaveCount(0);
  // The warning stands above the button it is about.
  const warning = (await page.getByTestId("switch-warning").boundingBox())!;
  const button = (await go.boundingBox())!;
  expect(warning.y + warning.height).toBeLessThanOrEqual(button.y);
  // The way out leaves the link unused: a plain link to the map, with no token in it.
  const stay = page.getByRole("link", { name: `${STAY_AS} ${FIXTURE_EMAIL}` });
  await expect(stay).toHaveAttribute("href", "/");
  expect((await stay.boundingBox())!.y).toBeGreaterThanOrEqual(
    button.y + button.height,
  );
  expect(await calls(page)).toBeUndefined();
  expect(await noScroll(page)).toBe(true);

  // Tab order: the button, then the way out.
  await page.keyboard.press("Tab");
  await expect(go).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(stay).toBeFocused();
  expect((await ring(page))[0]).not.toBe("none");

  await go.click();
  await page.waitForURL((url) => url.pathname === "/dev/join" && !url.search);
  await expect(page.getByRole("heading", { name: WAITING })).toBeVisible();

  const email = '"><img src=x onerror=alert(1)>@evil.example';
  await open(page, `?state=continue&email=${encodeURIComponent(email)}`);
  await expect(page.getByTestId("signed-in-now")).toHaveText(email);
  await expect(page.getByTestId("stay")).toHaveText(`${STAY_AS} ${email}`);
  await expect(page.getByTestId("stay")).toHaveAttribute("href", "/");
  await expect(page.locator("main img")).toHaveCount(0);
});

test("Continue with nobody signed in carries no warning and its plain label", async ({
  page,
}) => {
  await open(page, "?state=continue");
  await expect(page.getByTestId("switch-warning")).toHaveCount(0);
  await expect(page.getByTestId("stay")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: CONTINUE, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: SIGN_OUT_AND_CONTINUE }),
  ).toHaveCount(0);
});

test("after a switch the list says so, above who is signed in now", async ({
  page,
}) => {
  for (const query of ["?switched=1", "?state=empty&switched=1"]) {
    await open(page, query);
    await expect(page.getByTestId("switched")).toHaveText(SWITCHED);
    const notice = (await page.getByTestId("switched").boundingBox())!;
    const who = (await page.getByTestId("signed-in-as").boundingBox())!;
    expect(notice.y + notice.height).toBeLessThanOrEqual(who.y);
    expect(await noScroll(page)).toBe(true);
  }
  await open(page);
  await expect(page.getByTestId("switched")).toHaveCount(0);
});

test("the keyboard reaches each Join in turn, with a visible ring, and Enter joins", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("Tab");
  await expect(joins(page).first()).toBeFocused();
  expect((await ring(page))[0]).not.toBe("none");
  expect((await ring(page))[1]).not.toBe("0px");
  await page.keyboard.press("Tab");
  await expect(joins(page).nth(1)).toBeFocused();
  expect((await ring(page))[0]).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: SIGN_OUT })).toBeFocused();
  expect((await ring(page))[0]).not.toBe("none");
  expect((await ring(page))[1]).not.toBe("0px");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await page.waitForURL(/state=joined/);
});

test("the keyboard reaches Continue and the links, each with a visible ring", async ({
  page,
}) => {
  await open(page, "?state=continue");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: CONTINUE })).toBeFocused();
  expect((await ring(page))[0]).not.toBe("none");
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname === "/dev/join" && !url.search);

  await open(page, "?state=expired");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: TO_SIGN_IN })).toBeFocused();
  expect((await ring(page))[0]).not.toBe("none");
  expect((await ring(page))[1]).not.toBe("0px");
});

// The optional password step after a new person joins.

async function openPassword(page: Page, query = "") {
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/join?state=password${query}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("main", { name: PASSWORD_TITLE })).toBeVisible();
}

const first = (page: Page) => page.getByLabel(PASSWORD, { exact: true });
const second = (page: Page) => page.getByLabel(REPEAT_PASSWORD);
const save = (page: Page) => page.getByRole("button", { name: SAVE_PASSWORD });
const skip = (page: Page) => page.getByRole("button", { name: SKIP });
const GOOD = "correct horse battery";

test("Join leads a new person on to the password step, and anyone else to the map", async ({
  page,
}) => {
  await open(page, "?new=1");
  await joins(page).first().click();
  await page.waitForURL(/state=password/);
  await expect(
    page.getByRole("heading", { name: PASSWORD_TITLE }),
  ).toBeVisible();
  await open(page);
  await joins(page).first().click();
  await page.waitForURL(/state=joined/);
});

test("the password step: heading, the optional line, two labelled fields, Save and Skip", async ({
  page,
}) => {
  await openPassword(page);
  await expect(
    page.getByRole("heading", { name: PASSWORD_TITLE }),
  ).toBeVisible();
  await expect(page.getByText(PASSWORD_OPTIONAL)).toBeVisible();
  for (const field of [first(page), second(page)]) {
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveAttribute("autocomplete", "new-password");
    await expect(field).toHaveValue("");
  }
  await expect(save(page)).toBeEnabled();
  await expect(skip(page)).toBeEnabled();
  expect(await noScroll(page)).toBe(true);
  const cardEl = page.locator("main > div").first();
  expect(await cardEl.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
    "20px",
  );
});

test("the rules are said in plain words before anything is sent", async ({
  page,
}) => {
  await openPassword(page);
  await save(page).click();
  await expect(page.getByText(PASSWORD_SHORT)).toBeVisible();
  await first(page).fill("short");
  await second(page).fill("short");
  await save(page).click();
  await expect(page.getByText(PASSWORD_SHORT)).toBeVisible();
  await first(page).fill("a".repeat(73));
  await second(page).fill("a".repeat(73));
  await save(page).click();
  await expect(page.getByText(PASSWORD_LONG)).toBeVisible();
  await first(page).fill(GOOD);
  await second(page).fill(`${GOOD}!`);
  await save(page).click();
  await expect(page.getByText(PASSWORD_DIFFERENT)).toBeVisible();
  await expect(first(page)).toHaveAttribute("aria-invalid", "true");
  // Nothing left the page.
  expect(await calls(page)).toBeUndefined();
  expect(page.url()).toContain("state=password");
});

test("Save sends the two fields once and goes on to the map", async ({
  page,
}) => {
  await openPassword(page);
  await first(page).fill(GOOD);
  await second(page).fill(GOOD);
  await save(page).click();
  await expect(save(page)).toBeDisabled();
  await expect(skip(page)).toBeDisabled();
  const sent = await calls(page);
  expect(sent).toEqual([
    { what: "save", args: ["password", "repeat", "username"] },
  ]);
  // The fixture records which fields were sent, never what was typed.
  expect(JSON.stringify(sent)).not.toContain(GOOD);
  await page.waitForURL(/state=joined/);
  expect(page.url()).not.toContain(encodeURIComponent(GOOD));
});

for (const [reason, line] of [
  ["refused", PASSWORD_REFUSED],
  ["failed", PASSWORD_FAILED],
] as const) {
  test(`a password the server answers "${reason}": its line, empty fields, and another try`, async ({
    page,
  }) => {
    await openPassword(page, `&reason=${reason}`);
    await first(page).fill(GOOD);
    await second(page).fill(GOOD);
    await save(page).click();
    await expect(page.getByText(line)).toBeVisible();
    expect(page.url()).toContain("state=password");
    await expect(first(page)).toHaveValue("");
    await expect(second(page)).toHaveValue("");
    await expect(first(page)).toBeFocused();
    await expect(save(page)).toBeEnabled();
    await expect(skip(page)).toBeEnabled();
    // What was typed is nowhere on the page.
    expect(await page.content()).not.toContain(GOOD);
  });
}

test("Skip for now sets nothing and goes on to the map", async ({ page }) => {
  await openPassword(page);
  await first(page).fill(GOOD);
  await skip(page).click();
  expect(await calls(page)).toEqual([{ what: "skip", args: [] }]);
  await page.waitForURL(/state=joined/);
});

test("the keyboard goes Password, Repeat, Save, Skip, each with a visible ring; Enter saves", async ({
  page,
}) => {
  await openPassword(page);
  for (const target of [first(page), second(page), save(page), skip(page)]) {
    await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    expect((await ring(page))[0]).not.toBe("none");
    expect((await ring(page))[1]).not.toBe("0px");
  }
  await page.keyboard.press("Enter");
  await page.waitForURL(/state=joined/);
  expect(await page.evaluate(() => window.location.search)).toBe(
    "?state=joined",
  );

  await openPassword(page);
  await first(page).fill(GOOD);
  await second(page).fill(GOOD);
  await page.keyboard.press("Enter");
  await page.waitForURL(/state=joined/);
});
