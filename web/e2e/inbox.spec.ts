import { expect, test, type Page } from "@playwright/test";
import { fixtureInbox, FIXTURE_BODIES } from "../src/inbox/fixture";
import {
  acceptEffect,
  EMPTY_TEXT,
  NOT_SHARED,
  SEE_LATER,
  vaultHref,
} from "../src/inbox/text";

const DATA = fixtureInbox();
const [OWN, READABLE, ACCEPTED] = DATA.links as [
  (typeof DATA.links)[number],
  (typeof DATA.links)[number],
  (typeof DATA.links)[number],
];
const [HELD, HELD_NO_AGENT] = DATA.held as [
  (typeof DATA.held)[number],
  (typeof DATA.held)[number],
];
/** The ids of the person's own notes: the only ids the opening lines may be asked for. */
const OWN_IDS = Object.keys(FIXTURE_BODIES);
const [B001, B002, B003, , B005] = OWN_IDS as [
  string,
  string,
  string,
  string,
  string,
];

const FAILED = "That didn't work. Try again.";

async function open(page: Page, query = "") {
  // Nothing on this screen may use a browser dialog (confirm, alert).
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/inbox${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Inbox" })).toBeVisible();
}

type Call = { name: string; args: unknown[] };
const allCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __inboxCalls?: Call[] }).__inboxCalls ?? [],
  );
/** The answers given: every call but the reads of opening lines. */
const calls = async (page: Page) =>
  (await allCalls(page)).filter((c) => c.name !== "noteOpening");
const openings = async (page: Page) =>
  (await allCalls(page))
    .filter((c) => c.name === "noteOpening")
    .map((c) => c.args[0] as string);

const main = (page: Page) => page.getByRole("main", { name: "Inbox" });
const heading = (page: Page) => main(page).getByRole("heading", { level: 1 });
const list = (page: Page) =>
  main(page).getByRole("listbox", { name: "Waiting for you" });
const options = (page: Page) => list(page).getByRole("option");
const option = (page: Page, title: string) =>
  options(page).filter({ hasText: title });
const group = (page: Page, name: string) =>
  list(page).getByRole("group", { name });
const detail = (page: Page) =>
  main(page).locator('section[aria-labelledby="inbox-detail-title"]');
const detailHeading = (page: Page) =>
  detail(page).getByRole("heading", { level: 2 });
const button = (page: Page, name: string) =>
  detail(page).getByRole("button", { name, exact: true });
const status = (page: Page) => main(page).locator('[aria-live="polite"]');
const railInbox = (page: Page) =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Inbox/ });

/** The selected option's row id. */
const selectedRow = (page: Page) =>
  list(page)
    .locator('[role="option"][aria-selected="true"]')
    .getAttribute("data-row");

test("the rail marks Inbox as the current page and says how many wait", async ({
  page,
}) => {
  await open(page);
  const link = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Inbox, 5 waiting" });
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(link).toHaveAttribute("href", "/inbox");
});

test("list and detail: both groups with counts; the first link is selected; the detail shows both notes, the effect once and one primary button", async ({
  page,
}) => {
  await open(page);
  await expect(heading(page)).toContainText("Inbox");
  await expect(heading(page)).toContainText("5");
  await expect(main(page)).toContainText("Only you can answer these.");

  await expect(options(page)).toHaveCount(5);
  await expect(
    group(page, "Links to decide").getByRole("heading", { level: 2 }),
  ).toContainText("3");
  await expect(
    group(page, "Held notes").getByRole("heading", { level: 2 }),
  ).toContainText("2");
  await expect(group(page, "Links to decide").getByRole("option")).toHaveCount(
    3,
  );
  await expect(group(page, "Held notes").getByRole("option")).toHaveCount(2);
  await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(
    list(page).locator('[role="option"][aria-selected="true"]'),
  ).toHaveCount(1);
  // No buttons or links inside the rows.
  await expect(list(page).locator("button, a")).toHaveCount(0);

  // The rows: one sentence and one grey line each.
  const own = option(page, OWN.mine.title);
  await expect(own).toContainText(
    `Link ${OWN.mine.title} with a note of Ahmed's you can't see yet`,
  );
  await expect(own).toContainText("Proposed by your agent");
  await expect(own).toContainText("Same client or project");
  const readable = option(page, READABLE.mine.title);
  await expect(readable).toContainText(
    `Link ${READABLE.mine.title} with Sara's “Pricing 2026”`,
  );
  await expect(readable).toContainText("Proposed from Sara's side");
  await expect(option(page, ACCEPTED.mine.title)).toContainText(
    "Ahmed accepted",
  );
  await expect(option(page, HELD.title)).toContainText("Claude");
  await expect(option(page, HELD.title)).toContainText(HELD.path);
  await expect(option(page, HELD_NO_AGENT.title)).toContainText("An agent");

  // The detail: both notes; of theirs only its owner, never a title it may not show.
  await expect(detailHeading(page)).toContainText(OWN.mine.title);
  await expect(detail(page)).toContainText("Your note");
  await expect(detail(page)).toContainText("Ahmed's note");
  await expect(detail(page)).toContainText(NOT_SHARED);
  await expect(detail(page)).toContainText(SEE_LATER);
  await expect(detail(page)).toContainText(OWN.mine.path);
  await expect(
    detail(page).getByRole("link", { name: "Open in vault" }),
  ).toHaveAttribute("href", vaultHref(OWN.mine.workspaceId, OWN.mine.id));

  // What accepting does is said once, in full, beside the decision.
  const effect = page.getByText(acceptEffect(OWN), { exact: true });
  await expect(effect).toHaveCount(1);
  await expect(effect).toBeVisible();
  await expect(effect).toBeInViewport();
  await expect(detail(page)).toContainText(
    "A declined link is final for this pair of notes.",
  );

  // One yellow button on the page. CSS Modules keep the class name inside the hashed one in
  // development.
  const primary = page.locator('main [class*="primary"]:visible');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText("Accept link");
  await expect(primary).toHaveRole("button");
});

test("the opening lines of your note appear; their note shows only its title", async ({
  page,
}) => {
  await open(page);
  await expect(detail(page)).toContainText(
    "Scope: two warehouses in Rotterdam",
  );
  await options(page).first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(option(page, READABLE.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(detail(page)).toContainText("Pricing 2026");
  await expect(detail(page)).toContainText("pricing");
  await expect(detail(page)).not.toContainText(NOT_SHARED);
  await expect(detail(page)).toContainText("Draft terms for the 2027 renewal");
  const asked = await openings(page);
  expect(asked.length).toBeGreaterThan(0);
  for (const id of asked) expect(OWN_IDS).toContain(id);
});

test("↑/↓, Home and End move the selection; each opening is asked for once", async ({
  page,
}) => {
  await open(page);
  await options(page).first().focus();
  expect(await selectedRow(page)).toBe(OWN.id);
  await expect(detail(page)).toContainText("Scope: two warehouses");
  const visits = [READABLE.id, ACCEPTED.id, READABLE.id, OWN.id];
  const keys = ["ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"];
  for (const [i, key] of keys.entries()) {
    await page.keyboard.press(key);
    await expect(
      list(page).locator(`[data-row="${visits[i]}"]`),
    ).toHaveAttribute("aria-selected", "true");
    await expect(list(page).locator(`[data-row="${visits[i]}"]`)).toBeFocused();
  }
  await expect(detail(page)).toContainText("Scope: two warehouses");
  await page.waitForTimeout(300);
  expect((await openings(page)).sort()).toEqual([B001, B002, B003].sort());

  await page.keyboard.press("End");
  await expect(option(page, HELD_NO_AGENT.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(option(page, HELD_NO_AGENT.title)).toBeFocused();
  await expect(detailHeading(page)).toContainText(HELD_NO_AGENT.title);
  await page.keyboard.press("Home");
  await expect(option(page, OWN.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(option(page, OWN.mine.title)).toBeFocused();
  await page.waitForTimeout(300);
  expect((await openings(page)).sort()).toEqual(
    [B001, B002, B003, B005].sort(),
  );

  // A click selects too.
  await option(page, READABLE.mine.title).click();
  await expect(option(page, READABLE.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(detailHeading(page)).toContainText(READABLE.mine.title);
});

test("Accept link answers, removes the row, selects the next and says Link accepted.", async ({
  page,
}) => {
  await open(page);
  await button(page, "Accept link").click();
  await expect(option(page, OWN.mine.title)).toHaveCount(0);
  await expect(options(page)).toHaveCount(4);
  await expect(option(page, READABLE.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(detailHeading(page)).toContainText(READABLE.mine.title);
  await expect(status(page)).toHaveText("Link accepted.");
  await expect(heading(page)).toContainText("4");
  await expect(heading(page)).not.toContainText("5");
  await expect(
    group(page, "Links to decide").getByRole("heading", { level: 2 }),
  ).toContainText("2");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 4 waiting");
  expect(await calls(page)).toEqual([
    { name: "respondToLink", args: [OWN.id, true] },
  ]);
});

test("Decline asks first; Keep restores; the second Decline removes the row", async ({
  page,
}) => {
  await open(page);
  await option(page, READABLE.mine.title).click();
  await expect(detailHeading(page)).toContainText(READABLE.mine.title);
  await button(page, "Decline").click();
  await expect(detail(page)).toContainText("Decline this link?");
  await expect(button(page, "Accept link")).toHaveCount(0);
  // The safe answer has the focus.
  await expect(button(page, "Keep")).toBeFocused();
  expect(await calls(page)).toEqual([]);

  await button(page, "Keep").click();
  await expect(detail(page)).not.toContainText("Decline this link?");
  await expect(button(page, "Accept link")).toBeVisible();
  await expect(button(page, "Decline")).toBeFocused();
  await expect(button(page, "Keep")).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  await expect(options(page)).toHaveCount(5);

  // Escape is Keep too.
  await button(page, "Decline").click();
  await expect(detail(page)).toContainText("Decline this link?");
  await page.keyboard.press("Escape");
  await expect(detail(page)).not.toContainText("Decline this link?");
  await expect(button(page, "Decline")).toBeFocused();

  await button(page, "Decline").click();
  await expect(detail(page)).toContainText("Decline this link?");
  // A confirming press straight after the question is taken as a double click and ignored.
  await button(page, "Decline").click();
  await expect(detail(page)).toContainText("Decline this link?");
  expect(await calls(page)).toEqual([]);
  await page.waitForTimeout(600);
  await button(page, "Decline").click();
  await expect(option(page, READABLE.mine.title)).toHaveCount(0);
  await expect(options(page)).toHaveCount(4);
  await expect(heading(page)).toContainText("4");
  await expect(status(page)).toHaveText("Link declined.");
  // The next link in the group is selected.
  await expect(option(page, ACCEPTED.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await calls(page)).toEqual([
    { name: "respondToLink", args: [READABLE.id, false] },
  ]);
});

test("a held note: Release says Note released.; Open in vault links to the note", async ({
  page,
}) => {
  await open(page);
  await option(page, HELD.title).click();
  await expect(detailHeading(page)).toContainText(HELD.title);
  await expect(detail(page)).toContainText(HELD.path);
  await expect(detail(page)).toContainText("Held from Claude");
  await expect(detail(page)).toContainText(
    "A held note is visible only to you until you release it.",
  );
  await expect(detail(page)).toContainText("Seven new leads this month");
  const href = vaultHref(HELD.workspaceId, HELD.id);
  expect(href).toMatch(/^\/vault\?ws=.+&note=.+$/);
  await expect(
    detail(page).getByRole("link", { name: "Open in vault" }),
  ).toHaveAttribute("href", href);
  await expect(page.locator('main [class*="primary"]:visible')).toHaveText(
    "Release",
  );

  await button(page, "Release").click();
  await expect(option(page, HELD.title)).toHaveCount(0);
  await expect(status(page)).toHaveText("Note released.");
  await expect(group(page, "Held notes").getByRole("option")).toHaveCount(1);
  await expect(heading(page)).toContainText("4");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 4 waiting");
  expect(await calls(page)).toEqual([{ name: "releaseNote", args: [HELD.id] }]);
  await expect(option(page, HELD_NO_AGENT.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The last of a kind takes its group with it; the first of the other group is selected.
  await button(page, "Release").click();
  await expect(group(page, "Held notes")).toHaveCount(0);
  await expect(options(page)).toHaveCount(3);
  await expect(option(page, OWN.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("answering the last item shows All done.", async ({ page }) => {
  await open(page);
  for (const [i, title] of [
    OWN.mine.title,
    READABLE.mine.title,
    ACCEPTED.mine.title,
  ].entries()) {
    await expect(detailHeading(page)).toContainText(title);
    await button(page, "Accept link").click();
    await expect(options(page)).toHaveCount(4 - i);
  }
  for (const [i, title] of [HELD.title, HELD_NO_AGENT.title].entries()) {
    await expect(detailHeading(page)).toContainText(title);
    await button(page, "Release").click();
    await expect(options(page)).toHaveCount(1 - i);
  }
  await expect(detailHeading(page)).toHaveText("All done.");
  await expect(
    detail(page).getByRole("link", { name: "Open the vault" }),
  ).toHaveAttribute("href", "/vault");
  await expect(heading(page)).not.toContainText("1");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox");
});

test("a failed action keeps the item selected and says so", async ({
  page,
}) => {
  await open(page, "?fail=1");
  // A refused read leaves the opening lines out, placeholder and all.
  await expect(detail(page).locator('[class*="lines"]')).toHaveCount(0);
  await expect(detail(page)).not.toContainText("Scope: two warehouses");
  await expect(detailHeading(page)).toContainText(OWN.mine.title);

  await button(page, "Accept link").click();
  await expect(detail(page)).toContainText(FAILED);
  await expect(button(page, "Accept link")).toBeEnabled();
  await expect(options(page)).toHaveCount(5);
  await expect(option(page, OWN.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(heading(page)).toContainText("5");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 5 waiting");
  // Said to a screen reader too, politely.
  await expect(status(page)).toHaveText(FAILED);

  // A refused decline and a refused release keep their items as well.
  await option(page, READABLE.mine.title).click();
  await expect(detail(page)).not.toContainText(FAILED);
  await button(page, "Decline").click();
  // Past the double-click guard.
  await page.waitForTimeout(600);
  await button(page, "Decline").click();
  await expect(detail(page)).toContainText(FAILED);
  await expect(option(page, READABLE.mine.title)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await option(page, HELD.title).click();
  await button(page, "Release").click();
  await expect(detail(page)).toContainText(FAILED);
  await expect(options(page)).toHaveCount(5);
});

test("empty shows Nothing needs you. with Open the vault; above the cap says how many are shown", async ({
  page,
}) => {
  await open(page, "?empty=1");
  await expect(main(page)).toContainText("Nothing needs you.");
  await expect(main(page)).toContainText(EMPTY_TEXT);
  await expect(
    main(page).getByRole("link", { name: "Open the vault" }),
  ).toHaveAttribute("href", "/vault");
  await expect(main(page).getByRole("listbox")).toHaveCount(0);
  await expect(main(page).getByRole("option")).toHaveCount(0);
  await expect(main(page)).not.toContainText("Only you can answer these.");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox");

  await open(page, "?many=1");
  await expect(group(page, "Links to decide")).toContainText(
    "Showing the newest 100 of 140.",
  );
  await expect(group(page, "Held notes")).toContainText(
    "Showing the newest 100 of 120.",
  );
  await expect(heading(page)).toContainText("260");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 260 waiting");
});

test("at 1100 x 560 the page does not scroll and each column scrolls on its own", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  const fit = await page.evaluate(() => {
    const root = document.scrollingElement!;
    const panel = document.querySelector("main")!;
    const scrollBox = (el: Element | null) => {
      let box = el;
      while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY))
        box = box.parentElement;
      return box;
    };
    const list = scrollBox(document.querySelector('[role="listbox"]'));
    const detail = scrollBox(
      document.querySelector('section[aria-labelledby="inbox-detail-title"]'),
    );
    const inside = (box: Element | null) =>
      !!box &&
      box !== root &&
      panel.contains(box) &&
      box.getBoundingClientRect().bottom <=
        panel.getBoundingClientRect().bottom + 0.5;
    return {
      pageScrolls:
        root.scrollHeight > window.innerHeight ||
        root.scrollWidth > window.innerWidth,
      panelBottom: panel.getBoundingClientRect().bottom,
      panelRight: panel.getBoundingClientRect().right,
      apart: !!list && !!detail && list !== detail && !list.contains(detail),
      listInside: inside(list),
      detailInside: inside(detail),
      detailScrolls: !!detail && detail.scrollHeight > detail.clientHeight,
      sideways:
        !!list &&
        !!detail &&
        (list.scrollWidth > list.clientWidth ||
          detail.scrollWidth > detail.clientWidth),
    };
  });
  expect(fit.pageScrolls).toBe(false);
  expect(fit.panelBottom).toBeLessThanOrEqual(560);
  expect(fit.panelRight).toBeLessThanOrEqual(1100);
  expect(fit.apart).toBe(true);
  expect(fit.listInside).toBe(true);
  expect(fit.detailInside).toBe(true);
  expect(fit.detailScrolls).toBe(true);
  expect(fit.sideways).toBe(false);

  // The last row and the decision are reached by scrolling their own column; the page holds.
  const last = option(page, HELD_NO_AGENT.title);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const accept = button(page, "Accept link");
  await accept.scrollIntoViewIfNeeded();
  await expect(accept).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.scrollingElement!.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
});

test("keyboard: Tab reaches the listbox and then Accept link; Enter on Accept link focuses the next item's heading", async ({
  page,
}) => {
  await open(page);
  await heading(page).focus();
  await page.keyboard.press("Tab");
  await expect(options(page).first()).toBeFocused();
  // One stop for the whole list: the selected row.
  await page.keyboard.press("Tab");
  await expect(
    detail(page).getByRole("link", { name: "Open in vault" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const accept = button(page, "Accept link");
  await expect(accept).toBeFocused();
  const outline = await accept.evaluate((el) => {
    const cs = getComputedStyle(el);
    return (
      cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) >= 2
    );
  });
  expect(outline).toBe(true);

  await page.keyboard.press("Enter");
  await expect(option(page, OWN.mine.title)).toHaveCount(0);
  await expect(detailHeading(page)).toContainText(READABLE.mine.title);
  await expect(detailHeading(page)).toBeFocused();
  await expect(status(page)).toHaveText("Link accepted.");

  // When everything is answered, the All done heading takes the focus.
  for (const title of [
    READABLE.mine.title,
    ACCEPTED.mine.title,
    HELD.title,
    HELD_NO_AGENT.title,
  ]) {
    await expect(detailHeading(page)).toContainText(title);
    const pick = title.startsWith("Lead") || title.startsWith("Kickoff");
    await button(page, pick ? "Release" : "Accept link").focus();
    await page.keyboard.press("Enter");
    await expect(option(page, title)).toHaveCount(0);
  }
  await expect(detailHeading(page)).toHaveText("All done.");
  await expect(detailHeading(page)).toBeFocused();
});

for (const width of [390, 700, 1600]) {
  test(`a double click on Decline declines nothing at ${width} wide`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    await option(page, READABLE.mine.title).click();
    const decline = button(page, "Decline");
    await decline.scrollIntoViewIfNeeded();
    const box = await decline.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(await calls(page)).toEqual([]);
    await expect(options(page)).toHaveCount(5);
  });
}
