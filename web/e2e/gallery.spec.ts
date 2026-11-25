import { writeFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { fixtureGallery, fixtureMore } from "../src/gallery/fixture";
import {
  applyFilters,
  DEFAULT_FILTERS,
  groupBySession,
  scopeCounts,
  toServerFilter,
} from "../src/gallery/filters";
import {
  metaLine,
  sharingText,
  spanText,
  uploadTitle,
} from "../src/gallery/text";
import type {
  Filters,
  GalleryFile,
  GallerySession,
} from "../src/gallery/types";
import { setLook } from "./look";

// The clock of /dev/gallery, so the dates in the expected text are the ones drawn. Without ?more
// the dev page's first page is the whole gallery, so no filter needs the server.
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const DATA = fixtureGallery(NOW);
const MORE = fixtureMore(NOW);
const COUNTS = scopeCounts(DATA.files);
const SESSIONS = new Map<string, GallerySession>(
  DATA.sessions.map((s) => [s.id, s]),
);
const FOLDER = (name: string) => DATA.folders.find((f) => f.name === name)!;
const HARBOUR = FOLDER("Harbour");
const PROPOSALS = FOLDER("Proposals");
const INSPIRATION = FOLDER("Inspiration");
const inFolder = (id: string) =>
  new Set(DATA.files.filter((f) => f.folders.includes(id)).map((f) => f.id));
const shownBy = (over: Partial<Filters>) =>
  applyFilters(
    DATA.files,
    { ...DEFAULT_FILTERS, ...over },
    SESSIONS,
    inFolder,
    NOW,
  );

const file = (name: string): GalleryFile =>
  DATA.files.find((f) => f.name === name)!;
const PHOTO = file("site-photo-north-elevation.png"); // mine, image, session 1, Inspiration
const PROPOSAL = file("Proposal - Harbour Logistics v3.pdf"); // mine, pdf, Proposals, a ref
const DECK = file("Kickoff deck - Harbour Logistics.pptx"); // mine, no note, no viewer
const SOW = file("Statement of work - Northwind.docx"); // mine, private note, no session
const SHEET = file("Pricing sheet 2026.xlsx"); // Ahmed's
const BAY = file("site-photo-loading-bay.jpg"); // Sara's, image

const QUESTION = "Delete this file? This cannot be undone.";
const FOLDER_QUESTION = "Delete this folder? Files stay in the gallery.";

async function open(page: Page, query = "") {
  // Nothing on this screen may use a browser dialog (confirm, alert).
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/gallery${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Gallery" })).toBeVisible();
}

type Call = { name: string; args: unknown[] };
const allCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __galleryCalls?: Call[] }).__galleryCalls ?? [],
  );
const calls = async (page: Page, name: string) =>
  (await allCalls(page)).filter((c) => c.name === name);

/** Every request the page makes that is not a static asset, a script chunk or HMR. */
function watch(page: Page) {
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));
  return () =>
    seen
      .filter(
        (r) =>
          ["document", "fetch", "xhr"].includes(r.resourceType()) &&
          !/\/_next\/|__nextjs|webpack-hmr|\/dev\/sample\./.test(r.url()),
      )
      .map((r) => `${r.method()} ${r.resourceType()} ${r.url()}`);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const main = (page: Page) => page.getByRole("main", { name: "Gallery" });
const cards = (page: Page) => main(page).locator("[data-file]");
const card = (page: Page, f: GalleryFile) =>
  main(page).getByRole("button", { name: new RegExp(`^${escaped(f.name)}`) });
const scope = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Scope" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) });
const folders = (page: Page) => page.getByRole("group", { name: "My folders" });
const folder = (page: Page, name: string) =>
  folders(page).getByRole("button", { name: new RegExp(`^${name} \\d+$`) });
const view = (page: Page, name: string) =>
  page.getByRole("group", { name: "View" }).getByRole("button", { name });
const filterBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Filter by name" });
const chip = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Filters" })
    .getByRole("button", { name: new RegExp(`^${name}\\b`) });
const panel = (page: Page) =>
  page.getByRole("complementary", { name: "File details" });
const viewer = (page: Page) => page.getByRole("dialog");
const uploader = (page: Page) =>
  page.getByRole("dialog", { name: "Upload files" });
const shownIds = (page: Page) =>
  cards(page).evaluateAll((all) =>
    all.map((el) => (el as HTMLElement).dataset.file),
  );

// The default look, and the light theme, which differs the most from it.
const LOOKS = [undefined, "paper"] as const;
const named = (look: string | undefined) => (look ? ` (${look})` : "");

test("the rail marks Gallery as the current page", async ({ page }) => {
  await open(page);
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Gallery" }),
  ).toHaveAttribute("aria-current", "page");
});

test("by session: one group per session, newest first, No session last", async ({
  page,
}) => {
  await open(page);
  await expect(view(page, "By session")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const groups = groupBySession(DATA.files, SESSIONS);
  const sections = main(page).getByRole("region");
  await expect(sections).toHaveCount(groups.length);
  for (const [i, g] of groups.entries()) {
    const section = sections.nth(i);
    const title = g.session?.title ?? "No session";
    await expect(section.getByRole("heading", { level: 3 })).toHaveText(title);
    await expect(
      section
        .getByRole("list", { name: `Files from ${title}` })
        .locator("[data-file]"),
    ).toHaveCount(g.files.length);
    await expect(section).toContainText(
      `${g.files.length} ${g.files.length === 1 ? "file" : "files"}`,
    );
    if (!g.session) continue;
    await expect(section).toContainText(g.session.agent);
    await expect(section).toContainText(spanText(g.session, NOW));
    const link = section.getByRole("link", { name: "Session note" });
    if (g.session.note)
      await expect(link).toHaveAttribute(
        "href",
        `/vault?note=${g.session.note.id}`,
      );
    else await expect(link).toHaveCount(0);
    if (!g.session.ended_at) await expect(section).toContainText("open");
  }
  expect(groups.at(-1)!.session).toBeNull();
});

test("scopes, folders, the view switch and the name filter make no request", async ({
  page,
}) => {
  await open(page);
  const requests = watch(page);
  await expect(scope(page, "All files")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(scope(page, "All files")).toContainText(String(COUNTS.all));
  await expect(scope(page, "Mine")).toContainText(String(COUNTS.mine));
  await expect(scope(page, "Shared with me")).toContainText(
    String(COUNTS.shared),
  );
  await expect(cards(page)).toHaveCount(COUNTS.all);

  await scope(page, "Shared with me").click();
  await expect(cards(page)).toHaveCount(COUNTS.shared);
  await expect(card(page, SHEET)).toBeVisible();
  await expect(card(page, DECK)).toHaveCount(0);
  await scope(page, "Mine").click();
  await expect(cards(page)).toHaveCount(COUNTS.mine);

  // Folders count the loaded files in each.
  await expect(folder(page, "Harbour")).toHaveText(/0$/);
  await expect(folder(page, "Proposals")).toHaveText(/1$/);
  await expect(folder(page, "Inspiration")).toHaveText(/2$/);
  await folder(page, "Inspiration").click();
  await expect(folder(page, "Inspiration")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(scope(page, "Mine")).toHaveAttribute("aria-pressed", "false");
  await expect(cards(page)).toHaveCount(2);
  await scope(page, "All files").click();
  await expect(cards(page)).toHaveCount(COUNTS.all);

  await view(page, "Grid").click();
  await expect(view(page, "Grid")).toHaveAttribute("aria-pressed", "true");
  const grid = main(page).getByRole("list", { name: "Files" });
  await expect(grid.locator("[data-file]")).toHaveCount(COUNTS.all);
  const newest = [...DATA.files]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((f) => f.id);
  expect(await shownIds(page)).toEqual(newest);

  await filterBox(page).fill("  PROPOSAL ");
  await expect(cards(page)).toHaveCount(shownBy({ q: "proposal" }).length);
  await card(page, PROPOSAL).click();
  await expect(panel(page)).toBeVisible();

  await page.waitForTimeout(400);
  expect(requests()).toEqual([]);
  expect(await allCalls(page)).toEqual([]);
});

test("filter chips: Type, Date, Session, Agent and Owner, with × and Clear all", async ({
  page,
}) => {
  await open(page);
  const requests = watch(page);

  await chip(page, "Type").click();
  const types = page.getByRole("group", { name: "Type" });
  await types.getByRole("checkbox", { name: "PDF" }).check();
  await types.getByRole("checkbox", { name: "Images" }).check();
  await page.keyboard.press("Escape");
  await expect(types).toHaveCount(0);
  await expect(chip(page, "Type: PDF, Images")).toBeVisible();
  await expect(cards(page)).toHaveCount(
    shownBy({ kinds: ["pdf", "image"] }).length,
  );
  await page
    .getByRole("group", { name: "Filters" })
    .getByRole("button", { name: "Clear Type" })
    .click();
  await expect(cards(page)).toHaveCount(COUNTS.all);

  await chip(page, "Date").click();
  await page
    .getByRole("group", { name: "Date" })
    .getByRole("radio", { name: "Today" })
    .check();
  await page.keyboard.press("Escape");
  await expect(chip(page, "Date: Today")).toBeVisible();
  await expect(cards(page)).toHaveCount(shownBy({ date: "today" }).length);

  await chip(page, "Session").click();
  const sessionList = page.getByRole("group", { name: "Session" });
  // Loaded sessions, newest first.
  const newestFirst = [...DATA.sessions]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .map((s) => s.title);
  await expect(sessionList.getByRole("button")).toHaveText(newestFirst);
  await sessionList
    .getByRole("button", { name: "Harbour Logistics proposal" })
    .click();
  await expect(chip(page, "Session: Harbour Logistics proposal")).toBeVisible();
  await expect(cards(page)).toHaveCount(
    shownBy({ date: "today", session: DATA.sessions[0]!.id }).length,
  );

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(cards(page)).toHaveCount(COUNTS.all);
  await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);

  await chip(page, "Agent").click();
  await page
    .getByRole("group", { name: "Agent" })
    .getByRole("button", { name: "Ahmed's ChatGPT" })
    .click();
  await expect(cards(page)).toHaveCount(
    shownBy({ agent: "Ahmed's ChatGPT" }).length,
  );
  await page.getByRole("button", { name: "Clear Agent" }).click();

  await chip(page, "Owner").click();
  await page
    .getByRole("group", { name: "Owner" })
    .getByRole("button", { name: "Sara" })
    .click();
  await expect(chip(page, "Owner: Sara")).toBeVisible();
  await expect(cards(page)).toHaveCount(shownBy({ owner: "m-sara" }).length);
  await expect(card(page, BAY)).toBeVisible();

  // Filters that match nothing say so, with a way back.
  await filterBox(page).fill("no such file");
  await expect(main(page)).toContainText("No files match these filters.");
  await main(page)
    .getByRole("status")
    .getByRole("button", { name: "Clear all" })
    .click();
  await expect(cards(page)).toHaveCount(COUNTS.all);
  await expect(filterBox(page)).toHaveValue("");

  await page.waitForTimeout(400);
  expect(requests()).toEqual([]);
  expect(await allCalls(page)).toEqual([]);
});

test("a date range filters by two days", async ({ page }) => {
  await open(page);
  await chip(page, "Date").click();
  const date = page.getByRole("group", { name: "Date" });
  await date.getByRole("radio", { name: "Range" }).check();
  await date.getByLabel("From", { exact: true }).fill("2026-11-20");
  await date.getByLabel("To", { exact: true }).fill("2026-11-21");
  await page.keyboard.press("Escape");
  await expect(chip(page, "Date: 2026-11-20 – 2026-11-21")).toBeVisible();
  await expect(cards(page)).toHaveCount(
    shownBy({ date: "range", from: "2026-11-20", to: "2026-11-21" }).length,
  );
});

test("the address carries the filters and a reload restores them", async ({
  page,
}) => {
  await open(page);
  await view(page, "Grid").click();
  await chip(page, "Type").click();
  await page
    .getByRole("group", { name: "Type" })
    .getByRole("checkbox", { name: "PDF" })
    .check();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dev\/gallery\?view=grid&kinds=pdf$/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(view(page, "Grid")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "Type: PDF")).toBeVisible();
  await expect(cards(page)).toHaveCount(shownBy({ kinds: ["pdf"] }).length);

  await filterBox(page).fill("proposal");
  await expect(page).toHaveURL(/kinds=pdf&q=proposal$/);
  await folder(page, "Proposals").click();
  await expect(page).toHaveURL(new RegExp(`folder=${PROPOSALS.id}`));
  await page.reload({ waitUntil: "networkidle" });
  await expect(folder(page, "Proposals")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(filterBox(page)).toHaveValue("proposal");
  await expect(cards(page)).toHaveCount(1);
});

test("with more files on the server, a chip asks the server once after a pause", async ({
  page,
}) => {
  await open(page, "?more=1");
  await chip(page, "Type").click();
  const types = page.getByRole("group", { name: "Type" });
  await types.getByRole("checkbox", { name: "PDF" }).check();
  await page.keyboard.press("Escape");
  // The older PDF only the server knows about arrives.
  await expect(
    main(page).getByRole("button", { name: /^Quarterly report Q3\.pdf/ }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  const asked = await calls(page, "loadPage");
  expect(asked).toEqual([
    {
      name: "loadPage",
      args: [
        toServerFilter({ ...DEFAULT_FILTERS, kinds: ["pdf"] }, NOW, null),
        null,
      ],
    },
  ]);
  // The name filter is applied in the page: no new call.
  await filterBox(page).fill("quarterly");
  await expect(cards(page)).toHaveCount(1);
  await page.waitForTimeout(400);
  expect(await calls(page, "loadPage")).toHaveLength(1);
  // No Load more while a server filter is on.
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("Load more appends the older files and then goes away", async ({
  page,
}) => {
  await open(page, "?more=1");
  await view(page, "Grid").click();
  const more = page.getByRole("button", { name: "Load more" });
  await more.click();
  await expect(cards(page)).toHaveCount(COUNTS.all + MORE.files.length);
  await expect(more).toHaveCount(0);
  await expect(scope(page, "All files")).toContainText(
    String(COUNTS.all + MORE.files.length),
  );
  expect(await calls(page, "loadPage")).toEqual([
    {
      name: "loadPage",
      args: [toServerFilter(DEFAULT_FILTERS, NOW, null), DATA.next],
    },
  ]);
});

test("a card shows its thumbnail or tile, name, size and sharing word", async ({
  page,
}) => {
  await open(page);
  const own = card(page, PROPOSAL);
  await expect(own).toContainText(PROPOSAL.name);
  await expect(own).toContainText("1.2 MB");
  await expect(own).toContainText(sharingText(PROPOSAL));
  await expect(own).toHaveAttribute("draggable", "true");
  await expect(card(page, PHOTO).locator("img")).toHaveAttribute(
    "src",
    PHOTO.thumb!,
  );
  await expect(card(page, DECK)).toContainText("PPTX");
});

test("selecting a card opens the panel with what is known about the file", async ({
  page,
}) => {
  await open(page);
  await expect(panel(page)).toHaveCount(0);
  const requests = watch(page);
  await card(page, PROPOSAL).click();
  const p = panel(page);
  await expect(p).toBeVisible();
  await expect(card(page, PROPOSAL)).toHaveAttribute("aria-pressed", "true");
  await expect(p.getByRole("heading", { name: PROPOSAL.name })).toBeVisible();
  await expect(p).toContainText(metaLine(PROPOSAL, NOW));
  for (const name of ["Open", "Download", "Add to folder", "Delete"])
    await expect(p.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(p).toContainText(
    "Whoever can read “Harbour Logistics proposal”.",
  );
  await expect(
    p.getByRole("link", { name: "Northwind renewal" }),
  ).toHaveAttribute("href", `/vault?note=${PROPOSAL.refs[0]!.id}`);
  const session = SESSIONS.get(PROPOSAL.session_id!)!;
  await expect(p).toContainText(session.agent);
  await expect(p).toContainText(spanText(session, NOW));
  await expect(p).toContainText("Harbour / Proposals");
  // Nothing is selected: the panel folds away.
  await p.getByRole("button", { name: "Close details" }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(requests()).toEqual([]);
  expect(await allCalls(page)).toEqual([]);
});

test("a colleague's file offers neither Delete nor Change home note", async ({
  page,
}) => {
  await open(page);
  await card(page, SHEET).click();
  const p = panel(page);
  await expect(p).toContainText(`Shared with you by ${SHEET.owner}.`);
  await expect(p.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(p.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: "Change home note" })).toHaveCount(
    0,
  );
  await card(page, SOW).click();
  await expect(p.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(
    p.getByRole("button", { name: "Change home note" }),
  ).toBeVisible();
});

test("Enter or a double-click on a selected card opens the viewer", async ({
  page,
}) => {
  await open(page);
  await card(page, PHOTO).click();
  await expect(viewer(page)).toHaveCount(0);
  await card(page, PHOTO).press("Enter");
  const dialog = page.getByRole("dialog", { name: PHOTO.name });
  await expect(dialog.getByRole("img", { name: PHOTO.name })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  // The screen adds Add to folder to the viewer's bar, and the file's facts beside it.
  await expect(
    dialog.getByRole("button", { name: "Add to folder" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Download" })).toHaveCount(1);
  await expect(dialog).toContainText("Who can read it");
  await page.keyboard.press("Escape");
  await expect(viewer(page)).toHaveCount(0);
  await expect(card(page, PHOTO)).toBeFocused();

  await card(page, PROPOSAL).dblclick();
  await expect(page.getByRole("dialog", { name: PROPOSAL.name })).toBeVisible();
  await page.keyboard.press("Escape");

  // A deck has no viewer: Enter keeps the panel, and there is no Open.
  await card(page, DECK).click();
  await card(page, DECK).press("Enter");
  await expect(viewer(page)).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Open" })).toHaveCount(
    0,
  );
  await expect(panel(page)).toContainText(DECK.name);
});

test("Open in the panel opens the viewer on that file", async ({ page }) => {
  await open(page);
  await card(page, PHOTO).click();
  await panel(page).getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: PHOTO.name })).toBeVisible();
});

test("Download asks the server for that file's link; a failure says so", async ({
  page,
}) => {
  await open(page, "?fail=1");
  await card(page, DECK).click();
  await panel(page).getByRole("button", { name: "Download" }).click();
  await expect(panel(page).getByRole("alert")).toHaveText(
    "Couldn't download the file.",
  );
  expect(await calls(page, "downloadFile")).toEqual([
    { name: "downloadFile", args: [DECK.id] },
  ]);
});

test("Delete asks first, in place; confirming removes the card", async ({
  page,
}) => {
  await open(page);
  await card(page, DECK).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Delete" }).click();
  await expect(p).toContainText(QUESTION);
  await p.getByRole("button", { name: "Cancel" }).click();
  await expect(p).not.toContainText(QUESTION);
  expect(await calls(page, "deleteFile")).toEqual([]);

  await p.getByRole("button", { name: "Delete" }).click();
  await p.getByRole("button", { name: "Delete" }).click();
  await expect(card(page, DECK)).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(COUNTS.all - 1);
  await expect(scope(page, "Mine")).toContainText(String(COUNTS.mine - 1));
  expect(await calls(page, "deleteFile")).toEqual([
    { name: "deleteFile", args: [DECK.id] },
  ]);
});

test("a refused delete keeps the card and says so", async ({ page }) => {
  await open(page, "?fail=1");
  await card(page, DECK).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Delete" }).click();
  await p.getByRole("button", { name: "Delete" }).click();
  await expect(p.getByRole("alert")).toHaveText("Couldn't delete the file.");
  await expect(card(page, DECK)).toBeVisible();
});

test("Add to folder toggles the file in and out of a folder", async ({
  page,
}) => {
  await open(page);
  await card(page, PROPOSAL).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Add to folder" }).click();
  const choices = p.getByRole("group", { name: "Folders" });
  await expect(
    choices.getByRole("checkbox", { name: "Harbour / Proposals" }),
  ).toBeChecked();
  await choices.getByRole("checkbox", { name: "Inspiration" }).check();
  await expect(folder(page, "Inspiration")).toHaveText(/3$/);
  await choices
    .getByRole("checkbox", { name: "Harbour / Proposals" })
    .uncheck();
  await expect(folder(page, "Proposals")).toHaveText(/0$/);
  await page.keyboard.press("Escape");
  const mine = p.getByRole("region", { name: "In my folders" });
  await expect(mine).toContainText("Inspiration");
  await expect(mine).not.toContainText("Proposals");
  expect((await allCalls(page)).filter((c) => /Folder$/.test(c.name))).toEqual([
    { name: "addToFolder", args: [INSPIRATION.id, [PROPOSAL.id]] },
    { name: "removeFromFolder", args: [PROPOSALS.id, PROPOSAL.id] },
  ]);
});

test("dragging a card onto a folder adds it there", async ({ page }) => {
  await open(page);
  await expect(folder(page, "Inspiration")).toHaveText(/2$/);
  await card(page, PROPOSAL).dragTo(folder(page, "Inspiration"));
  await expect(folder(page, "Inspiration")).toHaveText(/3$/);
  expect(await calls(page, "addToFolder")).toEqual([
    { name: "addToFolder", args: [INSPIRATION.id, [PROPOSAL.id]] },
  ]);
  await folder(page, "Inspiration").click();
  await expect(card(page, PROPOSAL)).toBeVisible();
});

test("Change home note picks one of my notes, or none", async ({ page }) => {
  await open(page);
  await card(page, SOW).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Change home note" }).click();
  const find = p.getByRole("combobox", { name: "Find a note" });
  await find.pressSequentially("site", { delay: 30 });
  const option = p.getByRole("option", { name: /^Site visit, 18 November/ });
  await expect(option).toBeVisible();
  // Typed quickly, the search is asked once, for what was typed last.
  expect(await calls(page, "findMyNotes")).toEqual([
    { name: "findMyNotes", args: ["site"] },
  ]);
  await find.press("ArrowDown");
  await find.press("Enter");
  await expect(p).toContainText(
    "Changed. Sharing now follows “Site visit, 18 November”.",
  );
  expect(await calls(page, "setHome")).toEqual([
    { name: "setHome", args: [SOW.id, "00000000-0000-4000-8000-000000000d02"] },
  ]);

  await p.getByRole("button", { name: "Change home note" }).click();
  await p.getByRole("option", { name: "No home note (only you)" }).click();
  expect((await calls(page, "setHome")).at(-1)).toEqual({
    name: "setHome",
    args: [SOW.id, null],
  });
  await expect(p).toContainText("Changed. It has no home note now.");
});

test("a single letter does not search", async ({ page }) => {
  await open(page);
  await card(page, SOW).click();
  await panel(page).getByRole("button", { name: "Change home note" }).click();
  await panel(page).getByRole("combobox", { name: "Find a note" }).fill("s");
  await page.waitForTimeout(500);
  expect(await calls(page, "findMyNotes")).toEqual([]);
});

test("folders: create, sub-folder, rename and delete, all in the page", async ({
  page,
}) => {
  await open(page);
  const side = folders(page);
  // Escape cancels a new folder without asking anything.
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill("Nope");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Folder name" })).toHaveCount(
    0,
  );
  expect(await calls(page, "createFolder")).toEqual([]);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill("Clients");
  await page.keyboard.press("Enter");
  await expect(folder(page, "Clients")).toHaveText(/0$/);

  // Only a top-level folder can hold sub-folders.
  await side.getByRole("button", { name: "More for Proposals" }).click();
  await expect(
    page.getByRole("button", { name: "New sub-folder" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await side.getByRole("button", { name: "More for Harbour" }).click();
  await page.getByRole("button", { name: "New sub-folder" }).click();
  await page.getByRole("textbox", { name: "Folder name" }).fill("Invoices");
  await page.keyboard.press("Enter");
  await expect(folder(page, "Invoices")).toBeVisible();

  await side.getByRole("button", { name: "More for Inspiration" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("textbox", { name: "Folder name" });
  await expect(rename).toHaveValue("Inspiration");
  await rename.fill("Moodboard");
  await page.keyboard.press("Enter");
  await expect(folder(page, "Moodboard")).toHaveText(/2$/);

  await folder(page, "Moodboard").click();
  await side.getByRole("button", { name: "More for Moodboard" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(side).toContainText(FOLDER_QUESTION);
  await side.getByRole("button", { name: "Delete" }).click();
  await expect(folder(page, "Moodboard")).toHaveCount(0);
  // The files stay, and the view goes back to all files.
  await expect(scope(page, "All files")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(cards(page)).toHaveCount(COUNTS.all);

  const writes = (await allCalls(page)).filter((c) => /Folder$/.test(c.name));
  expect(writes.map((c) => c.name)).toEqual([
    "createFolder",
    "createFolder",
    "renameFolder",
    "deleteFolder",
  ]);
  expect(writes[0]!.args).toEqual(["Clients", null]);
  expect(writes[1]!.args).toEqual(["Invoices", HARBOUR.id]);
  expect(writes[2]!.args).toEqual([INSPIRATION.id, "Moodboard"]);
  expect(writes[3]!.args).toEqual([INSPIRATION.id]);
});

test("uploading two files shows their progress and adds them under an upload group", async ({
  page,
}) => {
  await open(page);
  const puts: { url: string; type: string | undefined }[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/dev/upload-sink"))
      puts.push({ url: r.url(), type: r.headers()["content-type"] });
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = uploader(page);
  await expect(dialog).toBeVisible();
  // The browser's own type is not what is sent: the PUT declares mimeFor(stored name). Two
  // files of one name are stored under distinct names, and those are what finishUpload gets.
  await dialog.getByLabel("Choose files").setInputFiles([
    {
      name: "report.pdf",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(2048),
    },
    {
      name: "report.pdf",
      mimeType: "text/plain",
      buffer: Buffer.from("# Hi"),
    },
  ]);
  const rows = dialog
    .getByRole("list", { name: "Files to upload" })
    .getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("report.pdf");
  await expect(rows.nth(0)).toContainText("2 KB");
  await expect(dialog).toContainText("Uploads (private)");
  await dialog.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(rows.nth(0)).toContainText("Uploaded");
  await expect(rows.nth(1)).toContainText("Uploaded");
  await expect(rows.nth(1)).toContainText("report (2).pdf");
  await expect
    .poll(async () => (await calls(page, "endUpload")).length)
    .toBe(1);

  const start = await calls(page, "startUpload");
  expect(start).toEqual([
    {
      name: "startUpload",
      args: [
        {
          files: [
            { name: "report.pdf", size: 2048 },
            { name: "report.pdf", size: 4 },
          ],
          noteId: null,
          folderId: null,
        },
      ],
    },
  ]);
  expect(puts.map((p) => p.type)).toEqual([
    "application/pdf",
    "application/pdf",
  ]);
  expect(
    puts.map((p) => new URL(p.url).searchParams.get("name")).sort(),
  ).toEqual(["report (2).pdf", "report.pdf"]);
  expect(
    (await calls(page, "finishUpload")).map((c) => c.args[1]).sort(),
  ).toEqual(["report (2).pdf", "report.pdf"]);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(uploader(page)).toHaveCount(0);
  const group = main(page).getByRole("region", {
    name: uploadTitle(new Date(NOW).toISOString()),
  });
  await expect(group.locator("[data-file]")).toHaveCount(2);
  await expect(group).toContainText("Browser upload");
  await expect(cards(page)).toHaveCount(COUNTS.all + 2);
});

test("an upload can go to a chosen note and folder", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = uploader(page);
  await dialog
    .getByLabel("Choose files")
    .setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    ]);
  await dialog.getByRole("button", { name: "Change home note" }).click();
  await dialog.getByRole("combobox", { name: "Find a note" }).fill("harbour");
  await dialog
    .getByRole("option", { name: /^Harbour Logistics proposal/ })
    .click();
  await expect(dialog).toContainText("Harbour Logistics proposal");
  await dialog.getByLabel("Folder").selectOption({ label: "Inspiration" });
  await dialog.getByRole("button", { name: "Upload 1 file" }).click();
  await expect(dialog.getByRole("listitem")).toContainText("Uploaded");
  const [start] = await calls(page, "startUpload");
  expect(start!.args[0]).toMatchObject({
    noteId: "00000000-0000-4000-8000-000000000d01",
    folderId: INSPIRATION.id,
  });
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(folder(page, "Inspiration")).toHaveText(/3$/);
});

test("a file over 50 MB is refused in the dialog without a call", async ({
  page,
}, testInfo) => {
  await open(page);
  // Playwright passes buffers up to 50 MB only; a larger file goes by path.
  const huge = testInfo.outputPath("huge.zip");
  writeFileSync(huge, Buffer.alloc(51 * 1024 * 1024));
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = uploader(page);
  await dialog.getByLabel("Choose files").setInputFiles(huge);
  await expect(dialog).toContainText("Too large: 50 MB at most.");
  const upload = dialog.getByRole("button", { name: /^Upload/ });
  await expect(upload).toHaveAttribute("aria-disabled", "true");
  await upload.click({ force: true });
  await page.waitForTimeout(300);
  expect(await allCalls(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(uploader(page)).toHaveCount(0);
});

test("a failed upload can be retried", async ({ page }) => {
  await open(page);
  let refuse = true;
  await page.route("**/dev/upload-sink**", (route) =>
    refuse ? route.fulfill({ status: 500 }) : route.continue(),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = uploader(page);
  await dialog
    .getByLabel("Choose files")
    .setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    ]);
  await dialog.getByRole("button", { name: "Upload 1 file" }).click();
  const row = dialog.getByRole("listitem");
  await expect(row).toContainText("Failed");
  expect(await calls(page, "endUpload")).toEqual([]);
  refuse = false;
  await row.getByRole("button", { name: "Retry" }).click();
  await expect(row).toContainText("Uploaded");
  await expect
    .poll(async () => (await calls(page, "endUpload")).length)
    .toBe(1);
});

test("while the upload is starting, the dialog can be neither finished nor closed", async ({
  page,
}) => {
  await open(page, "?slowstart=1");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = uploader(page);
  await dialog
    .getByLabel("Choose files")
    .setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    ]);
  await dialog.getByRole("button", { name: "Upload 1 file" }).click();
  await expect
    .poll(async () => (await calls(page, "startUpload")).length)
    .toBe(1);
  // The start takes 1.5 s: no Done meanwhile, and Escape and Cancel do not close.
  await expect(dialog.getByRole("button", { name: "Done" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Cancel" }).click({ force: true });
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Done" })).toHaveCount(0);
  await expect(dialog.getByRole("listitem")).toContainText("Uploaded");
  await expect
    .poll(async () => (await calls(page, "endUpload")).length)
    .toBe(1);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(uploader(page)).toHaveCount(0);
  expect(await calls(page, "finishUpload")).toHaveLength(1);
});

test("a file stored but not recorded is recorded again on Retry, without a second PUT", async ({
  page,
}) => {
  await open(page, "?failfinish=1");
  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/dev/upload-sink")) puts++;
  });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = uploader(page);
  await dialog
    .getByLabel("Choose files")
    .setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    ]);
  await dialog.getByRole("button", { name: "Upload 1 file" }).click();
  const row = dialog.getByRole("listitem");
  await expect(row).toContainText("Failed");
  expect(puts).toBe(1);
  expect(await calls(page, "endUpload")).toEqual([]);
  await row.getByRole("button", { name: "Retry" }).click();
  await expect(row).toContainText("Uploaded");
  await expect
    .poll(async () => (await calls(page, "endUpload")).length)
    .toBe(1);
  expect(puts).toBe(1);
  expect(await calls(page, "finishUpload")).toHaveLength(2);
});

test("with older files on the server, a folder asks for all of its files by id", async ({
  page,
}) => {
  await open(page, "?more=1");
  const older = MORE.files.find((f) => f.name === "Quarterly report Q3.pdf")!;
  expect(older.folders).toEqual([HARBOUR.id]);
  await folder(page, "Harbour").click();
  await expect(
    main(page).getByRole("button", { name: /^Quarterly report Q3\.pdf/ }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  expect(await calls(page, "loadPage")).toEqual([
    {
      name: "loadPage",
      args: [
        toServerFilter({ ...DEFAULT_FILTERS, folder: HARBOUR.id }, NOW, [
          older.id,
        ]),
        null,
      ],
    },
  ]);
});

test("files dropped from the computer open the upload dialog with them", async ({
  page,
}) => {
  await open(page);
  await main(page).evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "dropped.csv", { type: "text/csv" }));
    el.dispatchEvent(
      new DragEvent("dragover", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
    el.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(uploader(page)).toBeVisible();
  await expect(uploader(page).getByRole("listitem")).toContainText(
    "dropped.csv",
  );
});

test("with no files the screen says where they come from", async ({ page }) => {
  await open(page, "?empty=1");
  await expect(main(page)).toContainText(
    "No files yet. Files your agents save, and files you upload, appear here.",
  );
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("a thumbnail whose link no longer works falls back to the type tile", async ({
  page,
}) => {
  await open(page, "?stale=1&view=grid");
  const list = main(page).getByRole("list", { name: "Files" });
  const items = list.locator("li");
  for (let i = 0; i < (await items.count()); i++) {
    await items.nth(i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await expect(list.locator("img")).toHaveCount(0);
  await expect(card(page, PHOTO)).toContainText("PNG");
});

for (const look of LOOKS)
  for (const size of [
    { width: 1366, height: 768 },
    // The smallest window the screen has to fit.
    { width: 1100, height: 560 },
  ])
    test(`at ${size.width} x ${size.height} the page does not scroll and the files do${named(look)}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page);
      await card(page, PROPOSAL).click();
      await expect(panel(page)).toBeVisible();
      const fit = await page.evaluate(() => {
        const root = document.documentElement;
        const main = document.querySelector("main")!.getBoundingClientRect();
        const first = document.querySelector("[data-file]")!;
        let box: Element | null = first;
        while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY))
          box = box.parentElement;
        const side = document
          .querySelector('[aria-label="Gallery sidebar"]')!
          .getBoundingClientRect();
        const aside = document
          .querySelector('[aria-label="File details"]')!
          .getBoundingClientRect();
        return {
          pageScrolls:
            root.scrollHeight > window.innerHeight ||
            root.scrollWidth > window.innerWidth,
          mainBottom: main.bottom,
          mainRight: main.right,
          scrolls: !!box && box !== root && box.scrollHeight > box.clientHeight,
          inside: !!box && document.querySelector("main")!.contains(box),
          sideways: !!box && box.scrollWidth > box.clientWidth,
          side: Math.round(side.width),
          panel: Math.round(aside.width),
          panelInside: aside.right <= main.right && aside.bottom <= main.bottom,
        };
      });
      expect(fit.pageScrolls).toBe(false);
      expect(fit.mainBottom).toBeLessThanOrEqual(size.height);
      expect(fit.mainRight).toBeLessThanOrEqual(size.width);
      expect(fit.scrolls).toBe(true);
      expect(fit.inside).toBe(true);
      expect(fit.sideways).toBe(false);
      expect(fit.side).toBe(200);
      expect(fit.panel).toBe(260);
      expect(fit.panelInside).toBe(true);
    });

test("the panel has its own surface and dark text in light mode", async ({
  page,
  context,
}) => {
  await setLook(context, "paper");
  await open(page);
  await card(page, DECK).click();
  const look = await panel(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color };
  });
  expect(look.color).not.toBe("rgb(255, 255, 255)");
});

test("the keyboard reaches every control in order, each with a visible outline", async ({
  page,
}) => {
  await open(page, "?view=grid");
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        name: (
          el.getAttribute("aria-label") ??
          el.querySelector("[title]")?.textContent ??
          el.textContent ??
          ""
        ).trim(),
        outlined:
          cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) >= 2,
      };
    });
  await scope(page, "All files").focus();
  const newest = [...DATA.files].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const expected = [
    /^All files/,
    /^Mine/,
    /^Shared with me/,
    /^Harbour/,
    /^More for Harbour$/,
    /^Proposals/,
    /^More for Proposals$/,
    /^Inspiration/,
    /^More for Inspiration$/,
    /New folder$/,
    /^By session$/,
    /^Grid$/,
    /^Filter by name$/,
    /^Upload$/,
    /^Type/,
    /^Date/,
    /^Session/,
    /^Agent/,
    /^Owner/,
    ...newest.map((f) => new RegExp(`^${escaped(f.name)}`)),
  ];
  for (const [i, want] of expected.entries()) {
    const at = await focused();
    expect(at.name, `stop ${i}`).toMatch(want);
    expect(at.outlined, `outline on ${at.name}`).toBe(true);
    await page.keyboard.press("Tab");
  }

  // The panel comes after the files.
  await card(page, DECK).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "Close details" }).focus();
  const inPanel: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    const at = await focused();
    expect(at.outlined, `outline on ${at.name}`).toBe(true);
    inPanel.push(at.name);
  }
  expect(inPanel).toEqual([
    "Download",
    "Add to folder",
    "Delete",
    "Change home note",
  ]);
});
