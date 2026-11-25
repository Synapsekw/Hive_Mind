import { expect, test, type Page } from "@playwright/test";
import { fixtureGallery } from "../src/gallery/fixture";
import { visibleFiles } from "../src/gallery/filters";
import type { GalleryFile } from "../src/gallery/types";

// The v2 viewer over the dev gallery, with every file opening in the viewer (?every=1). PDFs,
// CSV and Markdown open the samples under web/public/dev.
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const DATA = fixtureGallery(NOW);
const file = (name: string): GalleryFile =>
  DATA.files.find((f) => f.name === name)!;
const PROPOSAL = file("Proposal - Harbour Logistics v3.pdf");
const CSV = file("pricing-tiers.csv"); // Ahmed's: on the All tab
const NOTES = file("meeting-notes.md");
const DECK = file("Kickoff deck - Harbour Logistics.pptx");

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const card = (page: Page, f: GalleryFile) =>
  page
    .getByRole("list", { name: "Files" })
    .getByRole("button", { name: new RegExp(`^${escaped(f.name)}`) });
const viewer = (page: Page, f?: GalleryFile) =>
  f ? page.getByRole("dialog", { name: f.name }) : page.getByRole("dialog");

async function open(page: Page, query = "") {
  // Nothing in a file may reach a browser dialog (alert, confirm).
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/gallery?every=1${query}`, {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("main", { name: "Gallery" })).toBeVisible();
}

test("a PDF opens with pdf.js: pages, a page strip, PageDown and zoom", async ({
  page,
}) => {
  await open(page);
  await card(page, PROPOSAL).click();
  const dialog = viewer(page, PROPOSAL);
  const strip = dialog.getByRole("navigation", { name: "Pages" });
  await expect(strip.getByRole("button")).toHaveCount(2);
  await expect(strip).toHaveAttribute("data-pages", "2");
  await expect(dialog.getByTestId("pdf-pages")).toHaveText("2");
  await expect(dialog.getByTestId("pdf-current")).toHaveText("1");
  // Never a frame or an embed: only canvases drawn by pdf.js.
  await expect(dialog.locator("iframe, embed, object")).toHaveCount(0);
  const column = dialog.getByRole("document", { name: PROPOSAL.name });
  const firstPage = column.locator('[data-page="1"] canvas');
  // The page has been drawn: its canvas holds pixels that are not all one colour.
  await expect
    .poll(() =>
      firstPage.evaluate((c: HTMLCanvasElement) => {
        if (c.width === 0) return false;
        const ctx = c.getContext("2d")!;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 4; i < d.length; i += 4)
          if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2])
            return true;
        return false;
      }),
    )
    .toBe(true);

  await page.keyboard.press("PageDown");
  await expect(dialog.getByTestId("pdf-current")).toHaveText("2");
  await expect(strip.getByRole("button", { name: "Page 2" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.keyboard.press("PageUp");
  await expect(dialog.getByTestId("pdf-current")).toHaveText("1");
  // PageDown moved pages, not files.
  await expect(viewer(page, PROPOSAL)).toBeVisible();

  const width = () =>
    firstPage.evaluate((c) => c.getBoundingClientRect().width);
  const before = await width();
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(width).toBeGreaterThan(before * 1.1);
  await dialog.getByRole("button", { name: /reset to 100%/ }).click();
  await expect.poll(width).toBeCloseTo(before, 0);
});

test("a CSV opens as a table of text cells", async ({ page }) => {
  await open(page);
  await page
    .getByRole("group", { name: "Show" })
    .getByRole("button", { name: /^All\b/ })
    .click();
  await card(page, CSV).click();
  const table = viewer(page, CSV).getByRole("table");
  await expect(table.getByRole("columnheader").first()).toHaveText("tier");
  await expect(table.getByRole("cell", { name: "1,690" })).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(3);
});

test("Markdown opens as plain text and nothing in it runs", async ({
  page,
}) => {
  await open(page);
  await card(page, NOTES).click();
  const dialog = viewer(page, NOTES);
  const text = dialog.locator("pre");
  await expect(text).toContainText("<script>alert(1)</script> stays text");
  await expect(text).toContainText("# Flight log");
  await expect(dialog.locator("script")).toHaveCount(0);
  await expect(dialog.locator("h1")).toHaveCount(0);
});

test("a 'PDF' that is really a web page shows the tile and Download", async ({
  page,
}) => {
  await open(page, "&mislabel=1");
  await card(page, PROPOSAL).click();
  const dialog = viewer(page, PROPOSAL);
  await expect(dialog).toContainText(
    "No preview yet for this kind of file. Download to open it.",
  );
  await expect(dialog.locator("canvas, iframe, img")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Download" })).toHaveCount(
    // The viewer's own, the tile's, and the v1 screen's action row (Task 8 drops that one).
    3,
  );
  await expect(page.getByText("mislabelled page")).toHaveCount(0);
  expect(await page.evaluate(() => document.title)).not.toBe("pwned");
});

test("the arrows move through the view; Escape returns to the card", async ({
  page,
}) => {
  await open(page);
  const mine = visibleFiles(DATA.files, "mine", "");
  await card(page, mine[0]!).click();
  await expect(viewer(page, mine[0]!)).toBeVisible();
  await expect(viewer(page)).toContainText(`1 of ${mine.length} in view`);
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page, mine[1]!)).toBeVisible();
  await expect(viewer(page)).toContainText(`2 of ${mine.length} in view`);
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page, mine[2]!)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer(page, mine[1]!)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
  await expect(card(page, mine[1]!)).toBeFocused();
});

test("a deck shows its tile with Download and no canvas", async ({ page }) => {
  await open(page);
  await card(page, DECK).click();
  const dialog = viewer(page, DECK);
  await expect(dialog).toContainText(
    "No preview yet for this kind of file. Download to open it.",
  );
  await expect(dialog.locator("canvas, iframe, img")).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window.__galleryCalls ?? []).filter((c) => c.name === "openFile"),
  );
  // A kind with no preview is not even asked for a link.
  expect(calls).toEqual([]);
  await dialog.getByRole("button", { name: "Download" }).last().click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__galleryCalls ?? []).filter((c) => c.name === "downloadFile"),
      ),
    )
    .toEqual([{ name: "downloadFile", args: [DECK.id] }]);
});
