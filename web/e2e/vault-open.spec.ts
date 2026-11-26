// Opening a note keeps the list: a click asks for that one note, puts it in the address and
// reads nothing else; back and forward open the note the address names.
import { expect, test, type Page } from "@playwright/test";
import { fixtureVault } from "../src/vault/fixture";
import { FROM_VAULT, OPEN_FAILED } from "../src/vault/sentences";

const DATA = fixtureVault(0);
const [FIRST, SECOND] = DATA.notes;

const noteLinks = (page: Page) =>
  page.getByRole("navigation", { name: "Notes" }).getByRole("link");
const title = (page: Page) =>
  page.getByRole("region", { name: "Note" }).getByRole("heading", { level: 2 });
const calls = (page: Page) =>
  page.evaluate(() =>
    (
      (window as unknown as { __vaultCalls?: { name: string }[] })
        .__vaultCalls ?? []
    ).map((c) => c.name),
  );

/** Document loads and router (`_rsc`) reads of the vault page, from now on. */
function pageReads(page: Page) {
  const seen: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!url.pathname.startsWith("/dev/vault")) return;
    if (r.resourceType() === "document" || url.searchParams.has("_rsc"))
      seen.push(`${r.resourceType()} ${r.url()}`);
    else if (r.headers()["rsc"] === "1") seen.push(`rsc ${r.url()}`);
  });
  return seen;
}

test("opening a note reads only that note, and back opens the one before", async ({
  page,
}) => {
  await page.goto(`/dev/vault?note=${FIRST!.id}`, {
    waitUntil: "networkidle",
  });
  await expect(title(page)).toHaveText(FIRST!.title);
  await page.getByRole("searchbox", { name: "Filter notes" }).fill("");
  const reads = pageReads(page);

  await noteLinks(page).filter({ hasText: SECOND!.title }).first().click();
  await expect(title(page)).toHaveText(SECOND!.title);
  await expect(page).toHaveURL(new RegExp(`[?&]note=${SECOND!.id}(&|$)`));
  await expect(
    noteLinks(page).filter({ hasText: SECOND!.title }).first(),
  ).toHaveAttribute("aria-current", "page");
  expect(await calls(page)).toEqual(["openNote"]);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`[?&]note=${FIRST!.id}(&|$)`));
  await expect(title(page)).toHaveText(FIRST!.title);

  await page.goForward();
  await expect(title(page)).toHaveText(SECOND!.title);

  await page.waitForTimeout(300);
  expect(reads).toEqual([]);
});

test("a click with a modifier is the browser's, not the screen's", async ({
  page,
  context,
}) => {
  await page.goto(`/dev/vault?note=${FIRST!.id}`, {
    waitUntil: "networkidle",
  });
  const opened = context.waitForEvent("page");
  await noteLinks(page)
    .filter({ hasText: SECOND!.title })
    .first()
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).searchParams.get("note")).toBe(SECOND!.id);
  // The page itself still shows the first note and asked for nothing.
  await expect(title(page)).toHaveText(FIRST!.title);
  expect(await calls(page)).toEqual([]);
});

test("a note that cannot be opened says so and keeps the one shown", async ({
  page,
}) => {
  await page.goto(`/dev/vault?failopen=1&note=${FIRST!.id}`, {
    waitUntil: "networkidle",
  });
  await noteLinks(page).filter({ hasText: SECOND!.title }).first().click();
  await expect(page.getByText(OPEN_FAILED)).toBeVisible();
  await expect(title(page)).toHaveText(FIRST!.title);
});

test("a cold load of a note's address renders it on the server", async ({
  page,
}) => {
  await page.goto(`/dev/vault?note=${SECOND!.id}`, {
    waitUntil: "networkidle",
  });
  await expect(title(page)).toHaveText(SECOND!.title);
  expect(await calls(page)).toEqual([]);
});

test("a note row out of view takes the room of one in view", async ({
  page,
}) => {
  await page.goto("/dev/vault", { waitUntil: "networkidle" });
  const rows = noteLinks(page);
  expect(
    await rows.first().evaluate((el) => getComputedStyle(el).contentVisibility),
  ).toBe("auto");
  const heights = await rows.evaluateAll((els) =>
    els.map((el) => ({
      h: el.getBoundingClientRect().height,
      seen: el.getBoundingClientRect().top < window.innerHeight,
    })),
  );
  // The list is longer than the window: some rows are drawn, some are not.
  expect(heights.some((r) => r.seen)).toBe(true);
  expect(heights.some((r) => !r.seen)).toBe(true);
  const drawn = heights.find((r) => r.seen)!.h;
  for (const r of heights) expect(Math.abs(r.h - drawn)).toBeLessThanOrEqual(1);
});

test("a linked note opens in place, and a colleague's on Shared with me", async ({
  page,
}) => {
  const from = DATA.notes.find((n) => {
    const o = fixtureVault(0, { note: n.id }).open;
    return o && "note" in o && o.links.some((l) => !l.mine);
  })!;
  const o = fixtureVault(0, { note: from.id }).open as {
    links: { title: string; mine: boolean; note_id: string }[];
  };
  const to = o.links.find((l) => !l.mine)!;
  await page.goto(`/dev/vault?note=${from.id}`, { waitUntil: "networkidle" });
  await page
    .getByRole("region", { name: "Linked with" })
    .getByRole("link", { name: new RegExp(to.title) })
    .click();
  await expect(title(page)).toHaveText(to.title);
  await expect(page).toHaveURL(new RegExp(`[?&]note=${to.note_id}(&|$)`));
  expect(await calls(page)).toEqual(["openNote"]);
  // The server reads the address again and picks the note's tab.
  await expect(
    page
      .getByRole("navigation", { name: "Workspaces" })
      .getByRole("link", { name: "Shared with me" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(title(page)).toHaveText(to.title);
});

test("a note a vault keeps says where it is from and offers no edit of its words or path", async ({
  page,
}) => {
  const kept = DATA.notes.find((n) => n.fromVault)!;
  await page.goto(`/dev/vault?note=${kept.id}`, { waitUntil: "networkidle" });
  const note = page.getByRole("region", { name: "Note" });
  await expect(title(page)).toHaveText(kept.title);
  await expect(note).toContainText(FROM_VAULT);
  await expect(note).toContainText("from your vault on your Mac");
  await note
    .getByRole("button", { name: "More actions for this note" })
    .click();
  const theirs = fixtureVault(0, { tab: "shared" }).notes.find(
    (n) => n.fromVault && n.member_id !== DATA.me,
  )!;
  await page.goto(`/dev/vault?note=${theirs.id}&tab=shared`, {
    waitUntil: "networkidle",
  });
  await expect(title(page)).toHaveText(theirs.title);
  await expect(note).not.toContainText("from your vault");
  await page.goto(`/dev/vault?note=${kept.id}`, { waitUntil: "networkidle" });
  await note
    .getByRole("button", { name: "More actions for this note" })
    .click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  expect(items.join(" ")).not.toMatch(/rename|move|edit|path/i);
});
