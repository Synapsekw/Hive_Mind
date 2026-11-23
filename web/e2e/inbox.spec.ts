import { expect, test, type Page } from "@playwright/test";
import { fixtureInbox } from "../src/inbox/fixture";
import { acceptEffect, theirNote, vaultHref } from "../src/inbox/text";

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
const calls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __inboxCalls?: Call[] }).__inboxCalls ?? [],
  );

const main = (page: Page) => page.getByRole("main", { name: "Inbox" });
const heading = (page: Page) => main(page).getByRole("heading", { level: 1 });
const section = (page: Page, name: string) =>
  main(page).getByRole("region", { name });
const rows = (page: Page, name: string) =>
  main(page).getByRole("list", { name }).getByRole("listitem");
const row = (page: Page, name: string, title: string) =>
  rows(page, name).filter({ hasText: title });
const linkRow = (page: Page, title: string) =>
  row(page, "Links to decide", title);
const heldRow = (page: Page, title: string) => row(page, "Held notes", title);
const railInbox = (page: Page) =>
  page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /^Inbox/ });

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

test("both sections show with their counts; a private note has no title; the effect is always visible", async ({
  page,
}) => {
  await open(page);
  await expect(heading(page)).toContainText("Inbox");
  await expect(heading(page)).toContainText("5");
  await expect(
    section(page, "Links to decide").getByRole("heading", { level: 2 }),
  ).toContainText("3");
  await expect(
    section(page, "Held notes").getByRole("heading", { level: 2 }),
  ).toContainText("2");
  await expect(rows(page, "Links to decide")).toHaveCount(3);
  await expect(rows(page, "Held notes")).toHaveCount(2);
  await expect(section(page, "Held notes")).toContainText(
    "A held note is visible only to you until you release it.",
  );

  // A note the person may not read: the owner and the topic, never a title.
  const own = linkRow(page, OWN.mine.title);
  await expect(own).toContainText("a private note of Ahmed in clients");
  await expect(own).toContainText(theirNote(OWN));
  await expect(own).not.toContainText('note "');
  await expect(own).toContainText("Proposed by your agent");
  await expect(own).toContainText("Same client or project");
  // One the person may already read carries its title.
  const readable = linkRow(page, READABLE.mine.title);
  await expect(readable).toContainText(`Sara's note "Pricing 2026" in pricing`);
  await expect(readable).toContainText("Proposed from Sara's side");
  await expect(readable).toContainText("Shared topic");

  // Accepting shares the note, so what it does is on the row itself: no hover, no tooltip.
  for (const item of DATA.links) {
    const effect = linkRow(page, item.mine.title).getByText(
      acceptEffect(item),
      { exact: true },
    );
    await expect(effect).toBeVisible();
    await expect(effect).toBeInViewport();
  }
  await expect(linkRow(page, ACCEPTED.mine.title)).toContainText(
    "Ahmed has accepted, so it takes effect at once.",
  );

  // The person's own note opens in the vault.
  await expect(own.getByRole("link", { name: OWN.mine.title })).toHaveAttribute(
    "href",
    vaultHref(OWN.mine.workspaceId, OWN.mine.id),
  );

  await expect(heldRow(page, HELD.title)).toContainText(HELD.path);
  await expect(heldRow(page, HELD.title)).toContainText("Written by Claude");
  await expect(heldRow(page, HELD_NO_AGENT.title)).toContainText(
    HELD_NO_AGENT.path,
  );
});

test("Accept removes the row and the counts drop by one", async ({ page }) => {
  await open(page);
  const target = linkRow(page, OWN.mine.title);
  await target.getByRole("button", { name: "Accept" }).click();
  await expect(target).toHaveCount(0);
  await expect(rows(page, "Links to decide")).toHaveCount(2);
  await expect(heading(page)).toContainText("4");
  await expect(heading(page)).not.toContainText("5");
  await expect(
    section(page, "Links to decide").getByRole("heading", { level: 2 }),
  ).toContainText("2");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 4 waiting");
  expect(await calls(page)).toEqual([
    { name: "respondToLink", args: [OWN.id, true] },
  ]);
});

test("Decline asks first; Keep restores the two buttons; the second Decline removes the row", async ({
  page,
}) => {
  await open(page);
  const target = linkRow(page, READABLE.mine.title);
  await target.getByRole("button", { name: "Decline" }).click();
  await expect(target).toContainText("Decline for good?");
  await expect(target.getByRole("button", { name: "Accept" })).toHaveCount(0);
  // The safe answer has the focus.
  await expect(target.getByRole("button", { name: "Keep" })).toBeFocused();
  expect(await calls(page)).toEqual([]);

  await target.getByRole("button", { name: "Keep" }).click();
  await expect(target).not.toContainText("Decline for good?");
  await expect(target.getByRole("button", { name: "Accept" })).toBeVisible();
  await expect(target.getByRole("button", { name: "Decline" })).toBeFocused();
  await expect(target.getByRole("button", { name: "Keep" })).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
  await expect(rows(page, "Links to decide")).toHaveCount(3);

  await target.getByRole("button", { name: "Decline" }).click();
  await expect(target).toContainText("Decline for good?");
  await target.getByRole("button", { name: "Decline" }).click();
  await expect(target).toHaveCount(0);
  await expect(rows(page, "Links to decide")).toHaveCount(2);
  await expect(heading(page)).toContainText("4");
  expect(await calls(page)).toEqual([
    { name: "respondToLink", args: [READABLE.id, false] },
  ]);
});

test("Release removes the held row; Open in vault links to the note", async ({
  page,
}) => {
  await open(page);
  const target = heldRow(page, HELD.title);
  const href = vaultHref(HELD.workspaceId, HELD.id);
  expect(href).toMatch(/^\/vault\?ws=.+&note=.+$/);
  await expect(
    target.getByRole("link", { name: "Open in vault" }),
  ).toHaveAttribute("href", href);

  await target.getByRole("button", { name: "Release" }).click();
  await expect(target).toHaveCount(0);
  await expect(rows(page, "Held notes")).toHaveCount(1);
  await expect(heading(page)).toContainText("4");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 4 waiting");
  expect(await calls(page)).toEqual([{ name: "releaseNote", args: [HELD.id] }]);

  // The last of a kind takes its section with it.
  await heldRow(page, HELD_NO_AGENT.title)
    .getByRole("button", { name: "Release" })
    .click();
  await expect(section(page, "Held notes")).toHaveCount(0);
  await expect(rows(page, "Links to decide")).toHaveCount(3);
});

test("a failed action keeps the row and says so", async ({ page }) => {
  await open(page, "?fail=1");
  const target = linkRow(page, OWN.mine.title);
  await target.getByRole("button", { name: "Accept" }).click();
  await expect(target).toContainText(FAILED);
  await expect(target.getByRole("button", { name: "Accept" })).toBeEnabled();
  await expect(rows(page, "Links to decide")).toHaveCount(3);
  await expect(heading(page)).toContainText("5");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 5 waiting");
  // Said to a screen reader too, politely.
  await expect(main(page).locator('[aria-live="polite"]')).toHaveText(FAILED);

  // A refused decline and a refused release keep their rows as well.
  const other = linkRow(page, READABLE.mine.title);
  await other.getByRole("button", { name: "Decline" }).click();
  await other.getByRole("button", { name: "Decline" }).click();
  await expect(other).toContainText(FAILED);
  const held = heldRow(page, HELD.title);
  await held.getByRole("button", { name: "Release" }).click();
  await expect(held).toContainText(FAILED);
  await expect(rows(page, "Held notes")).toHaveCount(2);
});

test("empty says nothing needs you; above the cap says how many are shown", async ({
  page,
}) => {
  await open(page, "?empty=1");
  await expect(main(page)).toContainText("Nothing needs you.");
  await expect(main(page).getByRole("listitem")).toHaveCount(0);
  await expect(main(page).getByRole("region")).toHaveCount(0);
  await expect(railInbox(page)).toHaveAccessibleName("Inbox");

  await open(page, "?many=1");
  await expect(section(page, "Links to decide")).toContainText(
    "Showing the newest 100 of 140.",
  );
  await expect(section(page, "Held notes")).toContainText(
    "Showing the newest 100 of 120.",
  );
  await expect(heading(page)).toContainText("260");
  await expect(railInbox(page)).toHaveAccessibleName("Inbox, 260 waiting");
});

test("at 1100 x 560 the page does not scroll and the list does", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  const fit = await page.evaluate(() => {
    const root = document.scrollingElement!;
    const panel = document.querySelector("main")!;
    const list = document.querySelector('ul[aria-label="Links to decide"]')!;
    let box: Element | null = list;
    while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY))
      box = box.parentElement;
    return {
      pageScrolls:
        root.scrollHeight > window.innerHeight ||
        root.scrollWidth > window.innerWidth,
      panelBottom: panel.getBoundingClientRect().bottom,
      panelRight: panel.getBoundingClientRect().right,
      listScrolls: !!box && box !== root && box.scrollHeight > box.clientHeight,
      listInside: !!box && panel.contains(box),
      sideways: !!box && box.scrollWidth > box.clientWidth,
    };
  });
  expect(fit.pageScrolls).toBe(false);
  expect(fit.panelBottom).toBeLessThanOrEqual(560);
  expect(fit.panelRight).toBeLessThanOrEqual(1100);
  expect(fit.listScrolls).toBe(true);
  expect(fit.listInside).toBe(true);
  expect(fit.sideways).toBe(false);

  // The last row's action is reachable by scrolling the list, and the page still holds.
  const release = heldRow(page, HELD_NO_AGENT.title).getByRole("button", {
    name: "Release",
  });
  await release.scrollIntoViewIfNeeded();
  await expect(release).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.scrollingElement!.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
});

test("keyboard: Tab reaches Accept, Enter activates it, focus lands on the next row's first action", async ({
  page,
}) => {
  await open(page);
  const first = linkRow(page, OWN.mine.title);
  await first.getByRole("link", { name: OWN.mine.title }).focus();
  await page.keyboard.press("Tab");
  const accept = first.getByRole("button", { name: "Accept" });
  await expect(accept).toBeFocused();
  const outline = await accept.evaluate((el) => {
    const cs = getComputedStyle(el);
    return (
      cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) >= 2
    );
  });
  expect(outline).toBe(true);

  await page.keyboard.press("Enter");
  await expect(first).toHaveCount(0);
  await expect(
    linkRow(page, READABLE.mine.title).getByRole("button", { name: "Accept" }),
  ).toBeFocused();

  // When the list empties, the heading takes the focus.
  for (const title of [READABLE.mine.title, ACCEPTED.mine.title]) {
    await expect(
      linkRow(page, title).getByRole("button", { name: "Accept" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(linkRow(page, title)).toHaveCount(0);
  }
  for (const title of [HELD.title, HELD_NO_AGENT.title]) {
    await expect(
      heldRow(page, title).getByRole("button", { name: "Release" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(heldRow(page, title)).toHaveCount(0);
  }
  await expect(main(page)).toContainText("Nothing needs you.");
  await expect(heading(page)).toBeFocused();
});
