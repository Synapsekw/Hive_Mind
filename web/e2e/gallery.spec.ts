import { expect, test, type Page, type Request } from "@playwright/test";
import { fixtureGallery, fixtureMore } from "../src/gallery/fixture";
import { tabCounts, viewable, visibleFiles } from "../src/gallery/select";
import { metaLine, sharingText } from "../src/gallery/text";
import type { GalleryFile } from "../src/gallery/types";
import { setLook } from "./look";

// The clock of /dev/gallery, so the dates in the expected text are the ones drawn.
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const DATA = fixtureGallery(NOW);
const MORE = fixtureMore(NOW);
const COUNTS = tabCounts(DATA.files);

const file = (name: string): GalleryFile =>
  DATA.files.find((f) => f.name === name)!;
const PHOTO = file("site-photo-north-elevation.png"); // mine, image, through a note
const PROPOSAL = file("Proposal - Harbour Logistics v3.pdf"); // mine, pdf
const DECK = file("Kickoff deck - Harbour Logistics.pptx"); // mine, no note
const SOW = file("Statement of work - Northwind.docx"); // mine, private note
const SCAN = file("Site survey - full scan.pdf"); // mine, too large for the viewer
const TEAM = file("team-photo-offsite.jpeg"); // mine, image, no note
const SHEET = file("Pricing sheet 2026.xlsx"); // Ahmed's
const BAY = file("site-photo-loading-bay.jpg"); // Sara's, image
const DIAGRAM = file("process-diagram.svg"); // Ahmed's, never shown inline

const QUESTION = "Delete this file? This cannot be undone.";

async function open(page: Page, query = "") {
  // Nothing on this screen may use a browser dialog (confirm, alert).
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/gallery${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Gallery" })).toBeVisible();
}

type Call = { name: string; args: unknown[] };
const calls = (page: Page, name: string) =>
  page.evaluate(
    (wanted) =>
      (
        (window as unknown as { __galleryCalls?: Call[] }).__galleryCalls ?? []
      ).filter((c) => c.name === wanted),
    name,
  );

function watch(page: Page) {
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));
  return () =>
    seen
      .filter((r) => ["document", "fetch", "xhr"].includes(r.resourceType()))
      .map((r) => `${r.resourceType()} ${r.url()}`);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const grid = (page: Page) => page.getByRole("list", { name: "Files" });
const cards = (page: Page) => grid(page).getByRole("listitem");
const card = (page: Page, f: GalleryFile) =>
  grid(page).getByRole("button", { name: new RegExp(`^${escaped(f.name)}`) });
const tab = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Show" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) });
const filter = (page: Page) =>
  page.getByRole("searchbox", { name: "Filter files" });
const details = (page: Page, f: GalleryFile) =>
  page.getByRole("group", { name: `Details for ${f.name}` });
const viewer = (page: Page) => page.getByRole("dialog");
const actionsIn = (page: Page, within: ReturnType<typeof viewer>) =>
  within.getByRole("group", { name: "File actions" });

// The default look, and a light, vivid one whose glass and type differ the most from it.
const LOOKS = [undefined, "aurora.light.vivid.classic"] as const;
const named = (look: string | undefined) => (look ? ` (${look})` : "");

test("the rail marks Gallery as the current page", async ({ page }) => {
  await open(page);
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Gallery" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main", { name: "Gallery" })).toBeVisible();
});

test("tabs and the filter change the cards without a request", async ({
  page,
}) => {
  await open(page);
  await expect(tab(page, "Mine")).toHaveAttribute("aria-pressed", "true");
  await expect(tab(page, "Mine")).toContainText(String(COUNTS.mine));
  await expect(tab(page, "Shared with me")).toContainText(
    String(COUNTS.shared),
  );
  await expect(tab(page, "All")).toContainText(String(COUNTS.all));
  await expect(cards(page)).toHaveCount(COUNTS.mine);
  const requests = watch(page);

  await tab(page, "Shared with me").click();
  await expect(tab(page, "Shared with me")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(cards(page)).toHaveCount(COUNTS.shared);
  await expect(card(page, SHEET)).toBeVisible();
  await expect(card(page, DECK)).toHaveCount(0);

  await tab(page, "All").click();
  await expect(cards(page)).toHaveCount(COUNTS.all);

  await filter(page).fill("  PROPOSAL ");
  await expect(cards(page)).toHaveCount(
    visibleFiles(DATA.files, "all", "proposal").length,
  );
  // The counts are of what is loaded, whatever the filter.
  await expect(tab(page, "All")).toContainText(String(COUNTS.all));

  await filter(page).fill("no such file");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("No files match.");

  // Selecting a card that the viewer cannot show is client state too.
  await filter(page).fill("");
  await card(page, SHEET).click();
  await expect(details(page, SHEET)).toBeVisible();

  await page.waitForTimeout(400);
  expect(requests()).toEqual([]);
});

test("a card shows the name, the meta line and the sharing line", async ({
  page,
}) => {
  await open(page);
  const own = card(page, PROPOSAL);
  await expect(own).toContainText(PROPOSAL.name);
  await expect(own).toContainText(metaLine(PROPOSAL, NOW));
  await expect(own).toContainText(sharingText(PROPOSAL));
  await expect(own.getByTitle(PROPOSAL.name)).toBeVisible();
  // My own card does not repeat my name.
  await expect(own.getByText(PROPOSAL.owner, { exact: true })).toHaveCount(0);
  await expect(card(page, DECK)).toContainText("Private");
  // An image small enough has its thumbnail; a larger one has the type tile.
  await expect(card(page, PHOTO).locator("img")).toHaveAttribute(
    "src",
    PHOTO.thumb!,
  );
  await expect(
    card(page, file("floor-plan-level-2.webp")).locator("img"),
  ).toHaveCount(0);

  await tab(page, "Shared with me").click();
  const theirs = card(page, SHEET);
  await expect(theirs).toContainText(metaLine(SHEET, NOW));
  await expect(theirs.getByText(SHEET.owner, { exact: true })).toBeVisible();
  await expect(theirs).toContainText(sharingText(SHEET));
});

test("the sharing line carries a mark as well as words", async ({ page }) => {
  await open(page);
  const mark = (f: GalleryFile) =>
    card(page, f).locator("[data-sharing]").getAttribute("data-sharing");
  expect(await mark(PROPOSAL)).toBe("through-note");
  expect(await mark(DECK)).toBe("private");
  await tab(page, "Shared with me").click();
  expect(await mark(SHEET)).toBe("shared-with-me");
  // Three different shapes, none of them resting on a colour.
  const shape = (f: GalleryFile) =>
    card(page, f)
      .locator("[data-sharing]")
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${cs.backgroundImage}|${cs.backgroundColor === "rgba(0, 0, 0, 0)"}|${cs.borderTopWidth}`;
      });
  const half = await shape(SHEET);
  await tab(page, "Mine").click();
  const shapes = new Set([half, await shape(PROPOSAL), await shape(DECK)]);
  expect(shapes.size).toBe(3);
});

test("an image opens in the viewer; Escape returns to its card", async ({
  page,
}) => {
  await open(page);
  await card(page, PHOTO).click();
  const dialog = page.getByRole("dialog", { name: PHOTO.name });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("img", { name: PHOTO.name })).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  expect(await calls(page, "openFile")).toContainEqual({
    name: "openFile",
    args: [PHOTO.id],
  });

  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
  await expect(card(page, PHOTO)).toBeFocused();

  // The close button does the same.
  await card(page, PHOTO).click();
  await viewer(page).getByRole("button", { name: "Close" }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(card(page, PHOTO)).toBeFocused();
});

test("the arrows move through the files the viewer can show", async ({
  page,
}) => {
  await open(page);
  const shown = visibleFiles(DATA.files, "mine", "").filter(viewable);
  expect(shown[0]!.id).toBe(PHOTO.id);
  expect(shown.map((f) => f.id)).not.toContain(SCAN.id);
  await card(page, PHOTO).click();
  await expect(page.getByRole("dialog", { name: PHOTO.name })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("dialog", { name: shown[1]!.name }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog", { name: PHOTO.name })).toBeVisible();
  // The first file has nothing before it.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog", { name: PHOTO.name })).toBeVisible();
  await expect(
    viewer(page).getByRole("button", { name: "Previous file" }),
  ).toBeDisabled();

  await viewer(page).getByRole("button", { name: "Next file" }).click();
  await viewer(page).getByRole("button", { name: "Next file" }).click();
  await expect(
    page.getByRole("dialog", { name: shown[2]!.name }),
  ).toBeVisible();
  // Closing returns to the card of the file that was on screen.
  await page.keyboard.press("Escape");
  await expect(card(page, shown[2]!)).toBeFocused();
});

test("a PDF is shown from an object URL in a frame", async ({ page }) => {
  await open(page);
  await card(page, PROPOSAL).click();
  const dialog = page.getByRole("dialog", { name: PROPOSAL.name });
  const frame = dialog.locator("iframe");
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute("title", PROPOSAL.name);
  await expect(frame).toHaveAttribute("src", /^blob:/);
  await expect(dialog.locator("img")).toHaveCount(0);
});

test("a file that claims to be a PDF but is a page is not rendered", async ({
  page,
}) => {
  await open(page, "?mislabel=1");
  await card(page, PROPOSAL).click();
  const dialog = page.getByRole("dialog", { name: PROPOSAL.name });
  await expect(dialog).toContainText("This file can't be shown here.");
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(
    actionsIn(page, dialog).getByRole("button", { name: "Download" }),
  ).toBeVisible();
  // Nothing of the page ran or was drawn.
  await expect(page.getByText("mislabelled page")).toHaveCount(0);
  expect(await page.evaluate(() => document.title)).not.toBe("pwned");
});

test("a PDF too large for the viewer opens the details instead", async ({
  page,
}) => {
  await open(page);
  await card(page, SCAN).click();
  await expect(details(page, SCAN)).toBeVisible();
  await expect(
    details(page, SCAN).getByRole("button", { name: "Download" }),
  ).toBeVisible();
  await expect(viewer(page)).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(await calls(page, "openFile")).toEqual([]);
});

test("a deck opens the details: Download, and no viewer", async ({ page }) => {
  await open(page);
  await card(page, DECK).click();
  const box = details(page, DECK);
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("data-scope", "reset");
  await expect(card(page, DECK)).toHaveAttribute("aria-expanded", "true");
  await expect(box).toContainText(DECK.name);
  await expect(box).toContainText(sharingText(DECK));
  await expect(box.getByRole("button", { name: "Download" })).toBeFocused();
  await expect(viewer(page)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect(card(page, DECK)).toBeFocused();

  // An SVG is never an image here: details, not the viewer.
  await tab(page, "All").click();
  await card(page, DIAGRAM).click();
  await expect(details(page, DIAGRAM)).toBeVisible();
  await expect(viewer(page)).toHaveCount(0);
  expect(await calls(page, "openFile")).toEqual([]);
});

test("Download asks the server for that file's link", async ({ page }) => {
  await open(page);
  await card(page, DECK).click();
  await details(page, DECK).getByRole("button", { name: "Download" }).click();
  await expect
    .poll(() => calls(page, "downloadFile"))
    .toEqual([{ name: "downloadFile", args: [DECK.id] }]);

  // The viewer's Download is the same action.
  await page.keyboard.press("Escape");
  await card(page, PHOTO).click();
  await actionsIn(page, viewer(page))
    .getByRole("button", { name: "Download" })
    .click();
  await expect
    .poll(() => calls(page, "downloadFile"))
    .toEqual([
      { name: "downloadFile", args: [DECK.id] },
      { name: "downloadFile", args: [PHOTO.id] },
    ]);
});

test("a download that fails says so", async ({ page }) => {
  await open(page, "?fail=1");
  await card(page, DECK).click();
  await details(page, DECK).getByRole("button", { name: "Download" }).click();
  await expect(details(page, DECK)).toContainText(
    "Couldn't download the file.",
  );
});

test("Delete is not offered on a colleague's file", async ({ page }) => {
  await open(page);
  await tab(page, "Shared with me").click();
  await card(page, SHEET).click();
  await expect(
    details(page, SHEET).getByRole("button", { name: "Download" }),
  ).toBeVisible();
  await expect(
    details(page, SHEET).getByRole("button", { name: "Delete" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await card(page, BAY).click();
  await expect(page.getByRole("dialog", { name: BAY.name })).toBeVisible();
  await expect(
    viewer(page).getByRole("button", { name: "Download" }),
  ).toBeVisible();
  await expect(
    viewer(page).getByRole("button", { name: "Delete" }),
  ).toHaveCount(0);
});

test("Delete asks first, in place; confirming removes the card", async ({
  page,
}) => {
  await open(page);
  await card(page, DECK).click();
  const box = details(page, DECK);
  await box.getByRole("button", { name: "Delete" }).click();
  await expect(box).toContainText(QUESTION);
  // The safe answer has the focus.
  await expect(box.getByRole("button", { name: "Cancel" })).toBeFocused();
  expect(await calls(page, "deleteFile")).toEqual([]);

  await box.getByRole("button", { name: "Cancel" }).click();
  await expect(box).not.toContainText(QUESTION);
  await expect(box.getByRole("button", { name: "Delete" })).toBeFocused();
  await expect(card(page, DECK)).toBeVisible();
  await expect(cards(page)).toHaveCount(COUNTS.mine);
  expect(await calls(page, "deleteFile")).toEqual([]);

  await box.getByRole("button", { name: "Delete" }).click();
  await expect(box).toContainText(QUESTION);
  await box.getByRole("button", { name: "Delete" }).click();
  await expect(card(page, DECK)).toHaveCount(0);
  await expect(box).toHaveCount(0);
  await expect(cards(page)).toHaveCount(COUNTS.mine - 1);
  await expect(tab(page, "Mine")).toContainText(String(COUNTS.mine - 1));
  await expect(tab(page, "All")).toContainText(String(COUNTS.all - 1));
  expect(await calls(page, "deleteFile")).toEqual([
    { name: "deleteFile", args: [DECK.id] },
  ]);
  // The keyboard is not left nowhere: focus lands on a card.
  await expect(grid(page).locator("button:focus")).toHaveCount(1);
});

test("a second press where Delete was lands on Cancel", async ({ page }) => {
  await open(page);
  // With and without a note link in the popover, and in the viewer's row.
  const rows = [
    async () => {
      await card(page, DECK).click();
      return details(page, DECK);
    },
    async () => {
      await card(page, SOW).click();
      return details(page, SOW);
    },
    async () => {
      await card(page, PHOTO).click();
      return actionsIn(page, page.getByRole("dialog", { name: PHOTO.name }));
    },
  ];
  for (const show of rows) {
    const row = await show();
    const box = (await row
      .getByRole("button", { name: "Delete" })
      .boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.click(x, y);
    await expect(row).toContainText(QUESTION);
    await page.mouse.click(x, y);
    await expect(row).not.toContainText(QUESTION);
    await page.keyboard.press("Escape");
  }
  expect(await calls(page, "deleteFile")).toEqual([]);
  await expect(cards(page)).toHaveCount(COUNTS.mine);
});

test("deleting from the viewer closes it and removes the card", async ({
  page,
}) => {
  await open(page);
  await card(page, TEAM).click();
  const row = actionsIn(page, page.getByRole("dialog", { name: TEAM.name }));
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toContainText(QUESTION);
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(card(page, TEAM)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(COUNTS.mine - 1);
  expect(await calls(page, "deleteFile")).toEqual([
    { name: "deleteFile", args: [TEAM.id] },
  ]);
});

test("a refused delete keeps the card and says so", async ({ page }) => {
  await open(page, "?fail=1");
  await card(page, DECK).click();
  const box = details(page, DECK);
  await box.getByRole("button", { name: "Delete" }).click();
  await box.getByRole("button", { name: "Delete" }).click();
  await expect(box).toContainText("Couldn't delete the file.");
  await expect(card(page, DECK)).toBeVisible();
  await expect(cards(page)).toHaveCount(COUNTS.mine);
  await expect(tab(page, "Mine")).toContainText(String(COUNTS.mine));
});

test("an image that cannot be opened says so and shows nothing", async ({
  page,
}) => {
  await open(page, "?fail=1");
  await card(page, PHOTO).click();
  const dialog = page.getByRole("dialog", { name: PHOTO.name });
  await expect(dialog).toContainText("Couldn't open the file.");
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card(page, PHOTO)).toBeFocused();
});

test("a file attached to a readable note links to it in the vault", async ({
  page,
}) => {
  await open(page);
  await card(page, SOW).click();
  await expect(
    details(page, SOW).getByRole("link", { name: "Open note in vault" }),
  ).toHaveAttribute("href", `/vault?note=${SOW.note!.id}`);
  await page.keyboard.press("Escape");

  await card(page, DECK).click();
  await expect(details(page, DECK)).toBeVisible();
  await expect(
    details(page, DECK).getByRole("link", { name: "Open note in vault" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The viewer offers the same link.
  await card(page, PHOTO).click();
  await expect(
    viewer(page).getByRole("link", { name: "Open note in vault" }),
  ).toHaveAttribute("href", `/vault?note=${PHOTO.note!.id}`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: TEAM.name })).toBeVisible();
  await expect(
    viewer(page).getByRole("link", { name: "Open note in vault" }),
  ).toHaveCount(0);
});

test("Load more appends the older files and then goes away", async ({
  page,
}) => {
  await open(page);
  await tab(page, "All").click();
  await expect(cards(page)).toHaveCount(COUNTS.all);
  const more = page.getByRole("button", { name: "Load more" });
  await more.click();
  await expect(cards(page)).toHaveCount(COUNTS.all + MORE.files.length);
  await expect(more).toHaveCount(0);
  await expect(tab(page, "All")).toContainText(
    String(COUNTS.all + MORE.files.length),
  );
  await expect(cards(page).last()).toContainText(MORE.files.at(-1)!.name);
  expect(await calls(page, "loadMore")).toEqual([
    { name: "loadMore", args: [DATA.next] },
  ]);
});

for (const look of LOOKS)
  for (const size of [
    { width: 1366, height: 768 },
    // The smallest window the screen has to fit.
    { width: 1100, height: 560 },
  ])
    test(`at ${size.width} x ${size.height} the page does not scroll and the grid does${named(look)}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page);
      await tab(page, "All").click();
      await expect(cards(page)).toHaveCount(COUNTS.all);

      const fit = () =>
        page.evaluate(() => {
          const main = document.querySelector("main")!.getBoundingClientRect();
          const root = document.documentElement;
          const list = document.querySelector('ul[aria-label="Files"]')!;
          let box: Element | null = list;
          while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY))
            box = box.parentElement;
          return {
            pageScrolls:
              root.scrollHeight > window.innerHeight ||
              root.scrollWidth > window.innerWidth,
            panelBottom: main.bottom,
            panelRight: main.right,
            gridScrolls:
              !!box && box !== root && box.scrollHeight > box.clientHeight,
            gridInside: !!box && document.querySelector("main")!.contains(box),
            sideways: !!box && box.scrollWidth > box.clientWidth,
          };
        });
      const before = await fit();
      expect(before.pageScrolls).toBe(false);
      expect(before.panelBottom).toBeLessThanOrEqual(size.height);
      expect(before.panelRight).toBeLessThanOrEqual(size.width);
      expect(before.gridScrolls).toBe(true);
      expect(before.gridInside).toBe(true);
      expect(before.sideways).toBe(false);

      // The details of a card in the last row are reachable, and still nothing moves the page.
      await card(page, DIAGRAM).click();
      const download = details(page, DIAGRAM).getByRole("button", {
        name: "Download",
      });
      await expect(download).toBeVisible();
      const reachable = await download.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return !!hit && (hit === el || el.contains(hit));
      });
      expect(reachable).toBe(true);
      const after = await fit();
      expect(after.pageScrolls).toBe(false);
      expect(after.sideways).toBe(false);

      // The viewer covers the window exactly.
      await page.keyboard.press("Escape");
      await tab(page, "Mine").click();
      await card(page, PHOTO).click();
      const dialog = page.getByRole("dialog", { name: PHOTO.name });
      await expect(dialog.getByRole("img", { name: PHOTO.name })).toBeVisible();
      // The viewer opens with a short fade and scale; measure it at rest.
      await dialog.evaluate((el) =>
        Promise.all(el.getAnimations().map((a) => a.finished)),
      );
      const cover = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const img = el.querySelector("img")!.getBoundingClientRect();
        const close = [...el.querySelectorAll("button")]
          .find((b) => b.getAttribute("aria-label") === "Close")!
          .getBoundingClientRect();
        return {
          box: [r.left, r.top, r.width, r.height],
          imageInside:
            img.left >= 0 &&
            img.top >= 0 &&
            img.right <= window.innerWidth &&
            img.bottom <= window.innerHeight,
          closeInside: close.right <= window.innerWidth && close.top >= 0,
          pageScrolls:
            document.documentElement.scrollHeight > window.innerHeight ||
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(cover.box).toEqual([0, 0, size.width, size.height]);
      expect(cover.imageInside).toBe(true);
      expect(cover.closeInside).toBe(true);
      expect(cover.pageScrolls).toBe(false);
    });

test("the gallery sits on frosted glass and no control is a pill", async ({
  page,
}) => {
  await open(page);
  const blur = await page
    .getByRole("main", { name: "Gallery" })
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return (
        cs.backdropFilter ||
        cs.getPropertyValue("-webkit-backdrop-filter") ||
        ""
      );
    });
  expect(blur).toContain("blur(30px)");
  await card(page, DECK).click();
  await expect(details(page, DECK)).toBeVisible();
  const pills = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((e) =>
        getComputedStyle(e).borderRadius.split(" ").includes("999px"),
      )
      .map((e) => e.outerHTML.slice(0, 100)),
  );
  expect(pills).toEqual([]);
});

test("in light mode the details have dark text on a surface of their own", async ({
  page,
  context,
}) => {
  await setLook(context, "aurora.light.vivid.classic");
  await open(page);
  await card(page, DECK).click();
  const look = await details(page, DECK).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor };
  });
  expect(look.color).not.toBe("rgb(255, 255, 255)");
  expect(look.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(look.background).not.toBe("transparent");
});

test("the keyboard reaches every control, each with a visible outline", async ({
  page,
}) => {
  await open(page);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        // A card is named by its file name (the type tile before it is decoration).
        name: (
          el.getAttribute("aria-label") ??
          el.querySelector("[title]")?.textContent ??
          el.textContent ??
          ""
        ).trim(),
        outlined:
          cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) >= 2,
        inDialog: !!el.closest('[role="dialog"]'),
      };
    });

  // Tabs, then the filter, then every card in order, then Load more.
  await tab(page, "Mine").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const mine = visibleFiles(DATA.files, "mine", "");
  const expected = [
    /^Mine/,
    /^Shared with me/,
    /^All/,
    /^Filter files$/,
    ...mine.map((f) => new RegExp(`^${escaped(f.name)}`)),
    /^Load more$/,
  ];
  for (const [i, want] of expected.entries()) {
    const at = await focused();
    expect(at.name, `stop ${i}`).toMatch(want);
    expect(at.outlined, `outline on ${at.name}`).toBe(true);
    await page.keyboard.press("Tab");
  }

  // Enter on an image card opens the viewer with the focus on Close.
  await card(page, PHOTO).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: PHOTO.name });
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(dialog.getByRole("img", { name: PHOTO.name })).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const at = await focused();
    expect(at.inDialog, `focus left the dialog at ${at.name}`).toBe(true);
    expect(at.outlined, `outline on ${at.name}`).toBe(true);
    seen.add(at.name);
    await page.keyboard.press(i < 8 ? "Tab" : "Shift+Tab");
  }
  for (const name of ["Close", "Download", "Delete", "Next file"])
    expect([...seen]).toContain(name);

  // The page behind the viewer cannot be reached at all.
  expect(
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return main.inert || !!main.closest("[inert]");
    }),
  ).toBe(true);

  // Enter on a deck opens its details with the focus inside; Tab walks its controls.
  await page.keyboard.press("Escape");
  await card(page, DECK).focus();
  await page.keyboard.press("Enter");
  await expect(
    details(page, DECK).getByRole("button", { name: "Download" }),
  ).toBeFocused();
  expect((await focused()).outlined).toBe(true);
  await page.keyboard.press("Tab");
  expect(await focused()).toMatchObject({ name: "Delete", outlined: true });
});

test("a thumbnail whose link no longer works falls back to the type tile", async ({
  page,
}) => {
  await open(page, "?stale=1");
  await tab(page, "All").click();
  const list = page.getByRole("list", { name: "Files" });
  // A thumbnail fails when it is asked for, and lazy ones are asked for when they come into
  // view: the first card has turned already, the rest turn as the grid is scrolled to them.
  await expect(
    list.locator("li", { hasText: "site-photo-north-elevation.png" }),
  ).not.toContainText("Loading");
  await expect(
    list
      .locator("li", { hasText: "site-photo-north-elevation.png" })
      .locator("img"),
  ).toHaveCount(0);
  // The cards are scrolled to, not the images: an image leaves the page the moment it fails, and
  // scrolling to one that has just left fails the step.
  const items = list.locator("li");
  for (let i = 0; i < (await items.count()); i++) {
    await items.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await expect(list.locator("img")).toHaveCount(0);
  await expect(
    list.locator("li", { hasText: "site-photo-north-elevation.png" }),
  ).toContainText("PNG");
});

test("with no files the screen says where they come from", async ({ page }) => {
  await open(page, "?empty=1");
  await expect(page.getByRole("main")).toContainText(
    "No files yet. Files your agents save appear here.",
  );
  await expect(tab(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});
