import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  fixturePreview,
  fixtureVault,
  GROUP_FOLDER,
  HOSTILE_NOTE_ID,
} from "../src/vault/fixture";
import {
  COPY_LINK,
  DELETE_FAILED,
  DELETE_QUESTION,
  DELETED,
  folderSentence,
  folderSharing,
  keepLinkName,
  LINK_COPIED,
  LINK_NOT_COPIED,
  LINKED_WITH,
  MORE_ACTIONS,
  NONE_OPTION,
  noteSentence,
  OPENED_BY_LINK,
  UNLINK_FAILED,
  UNLINK_GROUP,
  unlinkName,
  unlinkQuestion,
} from "../src/vault/sentences";
import * as A from "../src/vault/attachText";
import * as P from "../src/vault/topicText";
import * as C from "../src/vault/connectText";
import * as T from "../src/vault/importText";
import { ADD_NOTES } from "../src/vault/importText";
import { setLook } from "./look";

// The fixture's content does not depend on `now`, only its dates do.
const DATA = fixtureVault(0);
const idOf = (title: string) => DATA.notes.find((n) => n.title === title)!.id;
const README = idOf("Readme");
const HELD = idOf("Workshop transcript, raw");

async function open(page: Page, query = "") {
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto(`/dev/vault${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Vault" })).toBeVisible();
}

const calls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __vaultCalls?: unknown[] }).__vaultCalls ?? [],
  );

const noteLinks = (page: Page) =>
  page.getByRole("navigation", { name: "Notes" }).getByRole("link");

const folders = (page: Page) =>
  page.getByRole("navigation", { name: "Folders" });

const noteControl = (page: Page) =>
  page.getByRole("group", { name: "Who can read this note" });

function watch(page: Page) {
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));
  return () =>
    seen
      .filter((r) => ["document", "fetch", "xhr"].includes(r.resourceType()))
      .map((r) => `${r.resourceType()} ${r.url()}`);
}

// The default look, and the light theme, which differs the most from it.
const LOOKS = [undefined, "paper"] as const;
const named = (look: string | undefined) => (look ? ` (${look})` : "");

for (const look of LOOKS)
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 1000 },
    { width: 1366, height: 768 },
    { width: 1280, height: 620 },
  ]) {
    test(`the vault fits a ${size.width} x ${size.height} window without scrolling${named(look)}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page, `?note=${HOSTILE_NOTE_ID}`);
      const fit = await page.evaluate(() => {
        const main = document.querySelector("main")!.getBoundingClientRect();
        const root = document.documentElement;
        return {
          pageScrolls:
            root.scrollHeight > window.innerHeight ||
            root.scrollWidth > window.innerWidth,
          panelBottom: main.bottom,
          panelRight: main.right,
        };
      });
      expect(fit.pageScrolls).toBe(false);
      expect(fit.panelBottom).toBeLessThanOrEqual(size.height);
      expect(fit.panelRight).toBeLessThanOrEqual(size.width);
    });
  }

test("in a narrow card the folders fold into the list title", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await open(page);
  await expect(folders(page)).toHaveCount(0);
  const picker = page.getByRole("button", { name: /^Choose folder or topic/ });
  await picker.click();
  await page
    .getByRole("group", { name: "Folders and topics" })
    .getByRole("button", { name: /^decisions\b/ })
    .click();
  await expect(
    page.getByRole("group", { name: "Folders and topics" }),
  ).toHaveCount(0);
  await expect(picker).toHaveAccessibleName(/decisions/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    folders(page).getByRole("button", { name: /^decisions\b/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the vault is a solid card with no blur", async ({ page }) => {
  await open(page, `?note=${README}`);
  const flat = await page
    .getByRole("main", { name: "Vault" })
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        blur:
          cs.backdropFilter || cs.getPropertyValue("-webkit-backdrop-filter"),
        background: cs.backgroundColor,
      };
    });
  expect(flat.blur === "" || flat.blur === "none").toBe(true);
  expect(flat.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("no control in the vault is a pill", async ({ page }) => {
  await open(page, `?note=${HELD}`);
  // Open the note control so its options, people and buttons are drawn too.
  await page.getByRole("button", { name: /^Sharing: / }).click();
  await noteControl(page)
    .getByRole("radio", { name: "Specific people" })
    .check();
  const pills = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((e) =>
        getComputedStyle(e).borderRadius.split(" ").includes("999px"),
      )
      .map((e) => e.outerHTML.slice(0, 100)),
  );
  expect(pills).toEqual([]);
});

test("in light mode the open control has dark text on a surface of its own", async ({
  page,
  context,
}) => {
  await setLook(context, "paper");
  await open(page, `?note=${README}`);
  await page.getByRole("button", { name: /^Sharing: / }).click();
  const look = await noteControl(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor };
  });
  expect(look.color).not.toBe("rgb(255, 255, 255)");
  expect(look.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(look.background).not.toBe("transparent");
});

test("choosing a folder and filtering narrow the list without a request", async ({
  page,
}) => {
  await open(page);
  const all = DATA.notes.length;
  await expect(noteLinks(page)).toHaveCount(all);
  const requests = watch(page);

  await folders(page)
    .getByRole("button", { name: /^decisions\b/ })
    .click();
  await expect(noteLinks(page)).toHaveCount(
    DATA.notes.filter((n) => n.path.startsWith("decisions/")).length,
  );
  await expect(
    folders(page).getByRole("button", { name: /^decisions\b/ }),
  ).toHaveAttribute("aria-pressed", "true");

  await folders(page)
    .getByRole("button", { name: /^All notes\b/ })
    .click();
  await page.getByRole("searchbox", { name: "Filter notes" }).fill("brief");
  await expect(noteLinks(page)).toHaveCount(2);

  await page.waitForTimeout(400);
  expect(requests()).toEqual([]);
});

test("the folder and the filter survive choosing a note", async ({ page }) => {
  await open(page);
  await folders(page)
    .getByRole("button", { name: /^research\b/ })
    .click();
  await page.getByRole("searchbox", { name: "Filter notes" }).fill("guide");
  await noteLinks(page).first().click();
  await expect(page).toHaveURL(/note=/);
  await expect(
    page.getByRole("region", { name: "Note" }).getByRole("heading", {
      name: "Interview guide",
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Filter notes" }),
  ).toHaveValue("guide");
  await expect(
    folders(page).getByRole("button", { name: /^research\b/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(noteLinks(page)).toHaveCount(1);
});

test("a hostile note renders as text", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page, `?note=${HOSTILE_NOTE_ID}`);
  const preview = page.getByRole("region", { name: "Note" });
  await expect(preview.getByRole("table")).toBeVisible();
  await expect(
    preview.getByRole("heading", { level: 1, name: "Vendor call" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("heading", { level: 2, name: "Quote" }),
  ).toBeVisible();

  // Next's own payload scripts carry the body as data; no script element may *be* the note's.
  const injected = await page.evaluate(
    () =>
      [...document.querySelectorAll("script")].filter(
        (s) => s.textContent?.trim() === "alert(1)",
      ).length,
  );
  expect(injected).toBe(0);
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(preview.getByRole("link", { name: "pixel" })).toBeVisible();
  const external = preview.getByRole("link", { name: "vendor site" });
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  // An image inside a link stays one link: no anchor inside an anchor.
  await expect(preview.locator("a a")).toHaveCount(0);
  const badge = preview.getByRole("link", { name: /badge/ });
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveAttribute("href", "https://example.com/project");
  await page.waitForTimeout(300);
  expect(requests.filter((u) => u.includes("example.invalid"))).toEqual([]);
  expect(
    errors.filter((e) => /hydrat|cannot be a descendant/i.test(e)),
  ).toEqual([]);
});

test("the note control writes nothing until Save", async ({ page }) => {
  await open(page, `?note=${README}`);
  const pill = page.getByRole("button", { name: /^Sharing: / });
  await pill.click();
  await expect(noteControl(page)).toBeVisible();
  await expect(
    noteControl(page).getByRole("radio", { checked: true }),
  ).toBeFocused();

  await noteControl(page)
    .getByRole("radio", { name: "Everyone in Synapse" })
    .check();
  await expect(noteControl(page)).toContainText(
    noteSentence({
      choice: { visibility: "group", shared_with: [] },
      hive: "Synapse",
      hiveSize: 3,
      names: [],
      folderRule: null,
    }),
  );
  expect(await calls(page)).toEqual([]);

  await noteControl(page).getByRole("button", { name: "Cancel" }).click();
  await expect(noteControl(page)).toHaveCount(0);
  await expect(pill).toBeFocused();
  expect(await calls(page)).toEqual([]);

  await pill.click();
  await page.keyboard.press("Escape");
  await expect(noteControl(page)).toHaveCount(0);
  await expect(pill).toBeFocused();

  await pill.click();
  await noteControl(page)
    .getByRole("radio", { name: "Everyone in Synapse" })
    .check();
  await noteControl(page).getByRole("button", { name: "Save" }).click();
  await expect(noteControl(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([
    {
      name: "saveNote",
      args: [README, { visibility: "group", shared_with: [] }],
    },
  ]);
});

test("Specific people with nobody ticked cannot be saved", async ({ page }) => {
  await open(page, `?note=${README}`);
  await page.getByRole("button", { name: /^Sharing: / }).click();
  await noteControl(page)
    .getByRole("radio", { name: "Specific people" })
    .check();
  const save = noteControl(page).getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  // Everyone except me is offered.
  await expect(noteControl(page).getByRole("checkbox")).toHaveCount(2);
  await noteControl(page).getByRole("checkbox", { name: "Sara" }).check();
  await expect(save).toBeEnabled();
  await expect(noteControl(page)).toContainText(
    "Sara will be able to read this note.",
  );
});

test("the folder control shows the database's exact counts", async ({
  page,
}) => {
  await open(page);
  await folders(page)
    .getByRole("button", { name: new RegExp(`^${GROUP_FOLDER}\\b`) })
    .click();
  await page.getByRole("button", { name: /^Folder sharing: / }).click();
  const control = page.getByRole("group", {
    name: `Who can read ${GROUP_FOLDER}`,
  });
  await expect(control).toContainText(
    folderSentence({
      folder: GROUP_FOLDER,
      choice: { visibility: "group", shared_with: [] },
      hive: "Synapse",
      hiveSize: 3,
      names: [],
      preview: fixturePreview(DATA, GROUP_FOLDER),
    }),
  );
  await expect(control.getByRole("radio", { name: NONE_OPTION })).toBeVisible();
  expect(await calls(page)).toEqual([
    { name: "preview", args: [DATA.workspaces[0]!.id, GROUP_FOLDER] },
  ]);
});

test("rows show their topics and no sharing words", async ({ page }) => {
  await open(page);
  const row = noteLinks(page).filter({ hasText: "Kickoff notes" });
  await expect(row).toContainText("Harbor Logistics");
  await expect(row.locator("[title]")).toHaveAttribute(
    "title",
    /harbor-logistics/,
  );
  // The words are for screen readers only now: present, but clipped to a point.
  const words = row.getByText("Ahmed, from harbor-logistics", { exact: true });
  await expect(words).toHaveCount(1);
  const box = await words.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
});

test("a row with many topics shows two and a count", async ({ page }) => {
  await open(page);
  const row = noteLinks(page).filter({ hasText: "Scope and assumptions" });
  await expect(row).toContainText("Harbor Logistics");
  await expect(row).toContainText("Route optimisation");
  await expect(row).toContainText("+3");
});

test("an empty folder without a rule is not listed", async ({ page }) => {
  await open(page);
  await expect(
    folders(page).getByRole("button", { name: /^archive\b/ }),
  ).toHaveCount(0);
  await expect(
    folders(page).getByRole("button", { name: /^clients\b/ }),
  ).toBeVisible();
});

test("a folder's sharing reads Folder sharing", async ({ page }) => {
  await open(page);
  await folders(page)
    .getByRole("button", { name: /^decisions\b/ })
    .click();
  await expect(
    page.getByRole("button", { name: folderSharing("none") }),
  ).toBeVisible();
});

test("the held row says it waits for you", async ({ page }) => {
  await open(page);
  await expect(
    folders(page).getByRole("button", { name: /^Held, waiting for you/ }),
  ).toBeVisible();
});

test("a note under a folder rule offers Same as folder", async ({ page }) => {
  await open(page, `?note=${idOf("Client list")}`);
  await page.getByRole("button", { name: /^Sharing: / }).click();
  await expect(
    noteControl(page).getByRole("radio", { name: "Same as folder" }),
  ).toBeChecked();
  await expect(
    noteControl(page).getByRole("radio", { name: NONE_OPTION }),
  ).toHaveCount(0);
});

test("a refused change keeps the control open", async ({ page }) => {
  await open(page, `?fail=1&note=${README}`);
  await page.getByRole("button", { name: /^Sharing: / }).click();
  await noteControl(page)
    .getByRole("radio", { name: "Everyone in Synapse" })
    .check();
  await noteControl(page).getByRole("button", { name: "Save" }).click();
  await expect(noteControl(page)).toContainText("That change was refused.");
  await expect(noteControl(page)).toBeVisible();
});

test("a folder that cannot be counted cannot be saved", async ({ page }) => {
  await open(page, "?fail=1");
  await folders(page)
    .getByRole("button", { name: new RegExp(`^${GROUP_FOLDER}\\b`) })
    .click();
  await page.getByRole("button", { name: /^Folder sharing: / }).click();
  const control = page.getByRole("group", {
    name: `Who can read ${GROUP_FOLDER}`,
  });
  await expect(control).toContainText(
    "Couldn't count the notes in this folder.",
  );
  await control.getByRole("radio", { name: "Private" }).check();
  await expect(control.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("held notes are listed and can be released", async ({ page }) => {
  await open(page, `?note=${HELD}`);
  await folders(page)
    .getByRole("button", { name: /^Held\b/ })
    .click();
  await expect(noteLinks(page)).toHaveCount(
    DATA.notes.filter((n) => n.quarantined).length,
  );
  const preview = page.getByRole("region", { name: "Note" });
  await expect(preview).toContainText(
    "This note was written by a self-hosted agent.",
  );
  await preview.getByRole("button", { name: "Release" }).click();
  expect(await calls(page)).toEqual([{ name: "release", args: [HELD] }]);
});

test("the shared tab groups colleagues' notes and offers no control", async ({
  page,
}) => {
  await open(page, "?tab=shared");
  await expect(
    page.getByRole("link", { name: "Shared with me" }),
  ).toHaveAttribute("aria-current", "page");
  const list = page.getByRole("navigation", { name: "Notes" });
  await expect(list.getByRole("heading", { name: "Ahmed" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Sara" })).toBeVisible();
  await expect(
    list.getByRole("link", { name: /Pricing options/ }),
  ).toContainText("Opened by a link");
  await expect(
    list.getByRole("link", { name: /Site visit/ }),
  ).not.toContainText("Opened by a link");
  await list.getByRole("link", { name: /Pricing options/ }).click();
  const preview = page.getByRole("region", { name: "Note" });
  await expect(preview).toContainText(OPENED_BY_LINK);
  await expect(page.getByRole("button", { name: /^Sharing: / })).toHaveCount(0);
});

for (const look of LOOKS)
  for (const size of [
    { width: 1280, height: 620 },
    // The shortest window that still keeps the columns side by side.
    { width: 1100, height: 560 },
  ])
    test(`at ${size.width} x ${size.height} an open folder control keeps Save and the list reachable${named(look)}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page);
      // With the rail open the card here is narrow: the folders are in the list title's picker.
      const picker = page.getByRole("button", {
        name: /^Choose folder or topic/,
      });
      const scopes = (await picker.count())
        ? (await picker.click(),
          page.getByRole("group", { name: "Folders and topics" }))
        : folders(page);
      await scopes
        .getByRole("button", { name: new RegExp(`^${GROUP_FOLDER}\\b`) })
        .click();
      await page.getByRole("button", { name: /^Folder sharing: / }).click();
      const control = page.getByRole("group", {
        name: `Who can read ${GROUP_FOLDER}`,
      });
      // The tallest state: Specific people with everyone ticked, so the sentence is longest.
      await control.getByRole("radio", { name: "Specific people" }).check();
      for (const box of await control.getByRole("checkbox").all())
        await box.check();
      await expect(control).toContainText(
        "Ahmed and Sara will be able to read",
      );

      // Seen and clickable: its centre is inside the window and nothing (a sticky header, a
      // clipping box) covers it there.
      const inView = (el: Element) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (r.height === 0 || y < 0 || y > window.innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
      };

      for (const name of ["Save", "Cancel"]) {
        const button = control.getByRole("button", { name });
        await button.scrollIntoViewIfNeeded();
        expect(await button.evaluate(inView)).toBe(true);
      }
      await expect(control.getByRole("button", { name: "Save" })).toBeEnabled();

      const last = noteLinks(page).last();
      await last.scrollIntoViewIfNeeded();
      expect(await last.evaluate(inView)).toBe(true);

      const pageScrolls = await page.evaluate(
        () =>
          document.documentElement.scrollHeight > window.innerHeight ||
          document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(pageScrolls).toBe(false);
    });

test("an unknown note says it isn't available", async ({ page }) => {
  await open(page, "?note=00000000-0000-4000-8000-ffffffffffff");
  await expect(page.getByRole("region", { name: "Note" })).toContainText(
    "That note isn't available.",
  );
});

// ------- deleting a note

const OPERATIONS = DATA.workspaces.find((w) => w.name === "Operations")!;
const OPERATIONS_DATA = fixtureVault(0, { ws: OPERATIONS.id });
const EXPENSES = OPERATIONS_DATA.notes.find((n) => n.title === "Expenses")!.id;
const CLIENT_LIST = idOf("Client list");

const preview = (page: Page) => page.getByRole("region", { name: "Note" });
const deleteButton = (page: Page) =>
  preview(page).getByRole("button", { name: "Delete note" });
const moreButton = (page: Page) =>
  preview(page).getByRole("button", { name: MORE_ACTIONS });
/** Opens ⋯ and presses Delete note…: the question is asked. */
async function askDelete(page: Page) {
  await moreButton(page).click();
  await preview(page).getByRole("button", { name: "Delete note" }).click();
}
const keepButton = (page: Page) =>
  preview(page).getByRole("button", { name: "Keep note" });
const question = (page: Page) =>
  preview(page).getByRole("group", { name: "Delete this note" });
/** The line that says how the last delete went. */
const status = (page: Page) =>
  page.getByRole("main", { name: "Vault" }).getByRole("status");
const dismissButton = (page: Page) =>
  page.getByRole("button", { name: "Dismiss message" });
const openTitle = (page: Page, name: string) =>
  preview(page).getByRole("heading", { name, level: 2 });
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Workspaces" }).getByRole("link", {
    name,
  });
const inList = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.tagName === "A" &&
      !!document.activeElement.closest('nav[aria-label="Notes"]'),
  );

/** Asks, waits out the guard and answers Delete. */
async function confirmDelete(page: Page) {
  await askDelete(page);
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await page.waitForTimeout(600);
  await deleteButton(page).click();
}

test("your own note has Delete in its menu, a held one too; a colleague's has none", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  // Not on the row: in the ⋯ menu.
  await expect(deleteButton(page)).toHaveCount(0);
  await moreButton(page).click();
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(deleteButton(page)).toBeVisible();
  await expect(deleteButton(page)).toHaveText("Delete note…");
  await expect(
    preview(page).getByRole("button", { name: COPY_LINK }),
  ).toBeVisible();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);

  await open(page, `?note=${HELD}`);
  await expect(
    preview(page).getByRole("button", { name: "Release" }),
  ).toBeVisible();
  await moreButton(page).click();
  await expect(deleteButton(page)).toBeVisible();

  await open(page, "?tab=shared");
  await noteLinks(page).filter({ hasText: "Site visit" }).click();
  await expect(openTitle(page, "Site visit")).toBeVisible();
  // A colleague's note: ⋯ alone, holding Copy link only.
  await expect(preview(page).getByRole("button")).toHaveCount(1);
  await moreButton(page).click();
  await expect(preview(page).getByRole("button")).toHaveText(["⋯", COPY_LINK]);
  await expect(deleteButton(page)).toHaveCount(0);
  // Opened by a link: the link can be ended, the note cannot be deleted or shared.
  await noteLinks(page).filter({ hasText: "Pricing options" }).click();
  await expect(openTitle(page, "Pricing options")).toBeVisible();
  await expect(preview(page).getByRole("button")).toHaveText(["⋯", "Unlink"]);
  await moreButton(page).click();
  await expect(deleteButton(page)).toHaveCount(0);
  await expect(
    preview(page).getByRole("button", { name: COPY_LINK }),
  ).toBeVisible();
});

test("Delete asks first; Keep puts everything back", async ({ page }) => {
  await open(page, `?note=${README}`);
  await askDelete(page);
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await expect(deleteButton(page)).toHaveCount(1);
  await expect(deleteButton(page)).toHaveText("Delete");
  await expect(keepButton(page)).toHaveText("Keep");
  // The safe answer holds the focus; the action row is hidden while it is asked.
  await expect(keepButton(page)).toBeFocused();
  await expect(moreButton(page)).toBeHidden();

  await keepButton(page).click();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(keepButton(page)).toHaveCount(0);
  await expect(moreButton(page)).toBeFocused();
  await expect(page.getByRole("button", { name: /^Sharing: / })).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length);
  await expect(status(page)).toHaveText("");
  expect(await calls(page)).toEqual([]);
});

for (const width of [390, 700, 1600]) {
  test(`a second press that lands on the question's Delete deletes nothing at ${width} wide`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, `?note=${README}`);
    // The card rises in on load; measure it at rest.
    await page
      .locator("main")
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    // Where the question's Delete will be: ask once, measure, answer Keep.
    await askDelete(page);
    await expect(keepButton(page)).toBeFocused();
    const box = await deleteButton(page).boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await keepButton(page).click();
    await expect(keepButton(page)).toHaveCount(0);
    await page.waitForTimeout(600);

    // What each press lands on.
    await page.evaluate(() => {
      const w = window as unknown as { __hits: string[] };
      w.__hits = [];
      document.addEventListener(
        "click",
        (e) => {
          const button = (e.target as Element).closest("button");
          const asked = button?.closest('[aria-label="Delete this note"]');
          w.__hits.push(
            `${asked ? "question" : "page"}: ${button?.getAttribute("aria-label")}`,
          );
        },
        true,
      );
    });
    // Ask, and press again at once where the question's Delete has just appeared.
    await askDelete(page);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => (window as unknown as { __hits: string[] }).__hits,
      ),
    ).toEqual([
      `page: ${MORE_ACTIONS}`,
      "page: Delete note",
      "question: Delete note",
    ]);
    expect(await calls(page)).toEqual([]);
    await expect(preview(page)).toContainText(DELETE_QUESTION);
    await expect(openTitle(page, "Readme")).toBeVisible();
  });
}

test("a burst of presses on the question's Delete deletes nothing; a later one deletes", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await askDelete(page);
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  const box = await deleteButton(page).boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  // The burst lasts longer than the guard: each press is too soon after the one before.
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(140);
  }
  expect(await calls(page)).toEqual([]);
  await page.waitForTimeout(600);
  expect(await calls(page)).toEqual([]);
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await expect(openTitle(page, "Readme")).toBeVisible();

  await page.mouse.click(x, y);
  await expect(status(page)).toHaveText(DELETED);
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
  await expect(noteLinks(page).filter({ hasText: "Readme" })).toHaveCount(0);
});

test("a second, deliberate Delete removes the note", async ({ page }) => {
  await open(page, `?note=${README}`);
  await askDelete(page);
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  // Past the double-click guard.
  await page.waitForTimeout(600);
  // Two activations in one go: the second finds the delete already running.
  await deleteButton(page).evaluate((el: HTMLElement) => {
    el.click();
    el.click();
  });
  await expect(status(page)).toHaveText(DELETED);
  await expect(status(page)).toBeVisible();
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
  // The note is closed and out of the list.
  await expect(page).not.toHaveURL(/note=/);
  await expect(preview(page).getByRole("heading", { level: 2 })).toHaveText(
    DATA.workspaces[0]!.name,
  );
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 1);
  await expect(noteLinks(page).filter({ hasText: "Readme" })).toHaveCount(0);
  expect(await inList(page)).toBe(true);
  // It stays so once the page has re-read itself.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/note=/);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 1);
  expect(await inList(page)).toBe(true);
  await expect(status(page)).toHaveText(DELETED);
  await expect(status(page)).toBeVisible();
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
});

test("the line that says a note was deleted stays until it is dismissed", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETED);
  await page.waitForLoadState("networkidle");
  // Choosing a folder and filtering leave it.
  await folders(page)
    .getByRole("button", { name: /^clients\b/ })
    .click();
  await expect(status(page)).toBeVisible();
  await dismissButton(page).click();
  await expect(status(page)).toHaveText("");
  await expect(status(page)).toBeHidden();
  await expect(dismissButton(page)).toHaveCount(0);
  // The focus is on a real control, not lost with the button.
  expect(await inList(page)).toBe(true);
});

test("the line that says a note was deleted goes when another note is opened", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETED);
  await expect(status(page)).toBeVisible();
  await noteLinks(page).filter({ hasText: "Client list" }).click();
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(status(page)).toHaveText("");
  await expect(status(page)).toBeHidden();
});

test("deleting a note opened by a bare link stays in that note's workspace", async ({
  page,
}) => {
  // As the map and the gallery link a note: no workspace in the address.
  await open(page, `?note=${EXPENSES}`);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-current", "page");
  await expect(noteLinks(page)).toHaveCount(OPERATIONS_DATA.notes.length);
  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETED);
  await expect(page).not.toHaveURL(/note=/);
  await expect(page).toHaveURL(new RegExp(`[?&]ws=${OPERATIONS.id}(&|$)`));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(tab(page, "Operations")).toHaveAttribute("aria-current", "page");
  await expect(noteLinks(page)).toHaveCount(OPERATIONS_DATA.notes.length - 1);
  await expect(noteLinks(page).filter({ hasText: "Expenses" })).toHaveCount(0);
  expect(await inList(page)).toBe(true);
});

test("a refused delete says so, keeps the note and closes the question", async ({
  page,
}) => {
  await open(page, `?fail=1&note=${README}`);
  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETE_FAILED);
  await expect(status(page)).toBeVisible();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(keepButton(page)).toHaveCount(0);
  await expect(moreButton(page)).toBeFocused();
  await expect(openTitle(page, "Readme")).toBeVisible();
  await expect(page).toHaveURL(/note=/);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length);
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
  // It is said once, and stays through the re-read.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(DELETE_FAILED)).toHaveCount(1);
  await expect(status(page)).toBeVisible();
});

test("while a delete runs, neither answer nor Escape does anything", async ({
  page,
}) => {
  await open(page, `?slow=1&note=${README}`);
  await confirmDelete(page);
  await expect(question(page)).toHaveAttribute("aria-busy", "true");
  await expect(deleteButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(keepButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(deleteButton(page)).toBeFocused();

  await keepButton(page).evaluate((el: HTMLElement) => el.click());
  await page.keyboard.press("Escape");
  await deleteButton(page).evaluate((el: HTMLElement) => el.click());
  // Still asked, still running, still one request.
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await expect(question(page)).toHaveAttribute("aria-busy", "true");
  await expect(openTitle(page, "Readme")).toBeVisible();
  await expect(status(page)).toHaveText("");
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);

  await expect(status(page)).toHaveText(DELETED);
  await expect(noteLinks(page).filter({ hasText: "Readme" })).toHaveCount(0);
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
});

test("a note opened while a delete runs stays open", async ({ page }) => {
  await open(page, `?slow=1&note=${README}`);
  await confirmDelete(page);
  // The other note arrives only after the delete has answered: until then the address still
  // names the note being deleted.
  await page.route(
    (url) => url.searchParams.get("note") === CLIENT_LIST,
    async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    },
  );
  await noteLinks(page).filter({ hasText: "Client list" }).click();
  await expect(status(page)).toHaveText(DELETED);
  await expect(page).toHaveURL(new RegExp(`note=${README}`));

  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`note=${CLIENT_LIST}`));
  await expect(noteLinks(page).filter({ hasText: "Readme" })).toHaveCount(0);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 1);
  // It stays so once the page has re-read itself.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`note=${CLIENT_LIST}`));
  await expect(
    noteLinks(page).filter({ hasText: "Client list" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 1);
  await expect(status(page)).toHaveText(DELETED);
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
});

test("a delete refused after another note was opened says so beside that note", async ({
  page,
}) => {
  await open(page, `?fail=1&slow=1&note=${README}`);
  await confirmDelete(page);
  await noteLinks(page).filter({ hasText: "Client list" }).click();
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(status(page)).toHaveText("");

  await expect(status(page)).toHaveText(DELETE_FAILED);
  await expect(status(page)).toBeVisible();
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(noteLinks(page).filter({ hasText: "Readme" })).toHaveCount(1);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(status(page)).toHaveText(DELETE_FAILED);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length);
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
});

test("deleting the only note a filter lists leaves the empty list and a focused tab", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await page.getByRole("searchbox", { name: "Filter notes" }).fill("Readme");
  await expect(noteLinks(page)).toHaveCount(1);
  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETED);
  await expect(noteLinks(page)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Notes" })).toContainText(
    "No notes match the filter.",
  );
  await expect(preview(page).getByRole("heading", { level: 2 })).toHaveText(
    DATA.workspaces[0]!.name,
  );
  await expect(tab(page, "Consulting")).toBeFocused();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(tab(page, "Consulting")).toBeFocused();
  await expect(
    page.getByRole("searchbox", { name: "Filter notes" }),
  ).toHaveValue("Readme");
});

test("deleting the last held note goes back to all notes", async ({ page }) => {
  const held = DATA.notes.filter((n) => n.quarantined);
  expect(held).toHaveLength(2);
  await open(page, `?note=${HELD}`);
  const heldButton = folders(page).getByRole("button", { name: /^Held\b/ });
  await heldButton.click();
  await expect(noteLinks(page)).toHaveCount(2);

  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETED);
  // The other held note is the one left, and has the focus.
  await expect(noteLinks(page)).toHaveCount(1);
  await expect(noteLinks(page)).toBeFocused();
  await page.keyboard.press("Enter");
  const other = held.find((n) => n.id !== HELD)!;
  await expect(openTitle(page, other.title)).toBeVisible();

  await confirmDelete(page);
  await expect(status(page)).toHaveText(DELETED);
  // Nothing is held any more: "Held" is gone and the list is all notes again.
  await expect(heldButton).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "All notes", level: 2 }),
  ).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 2);
  await expect(preview(page).getByRole("heading", { level: 2 })).toHaveText(
    DATA.workspaces[0]!.name,
  );
  await expect(noteLinks(page).first()).toBeFocused();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 2);
  await expect(noteLinks(page).first()).toBeFocused();
});

test("by keyboard: the topics and ⋯ follow the sharing control; Delete note asks; Escape answers Keep", async ({
  page,
}) => {
  // A note with two topics: Tab goes sharing, ×, ×, + Topic, ⋯.
  await open(page, `?note=${INTERVIEW_1}`);
  await page.getByRole("button", { name: /^Sharing: / }).focus();
  await page.keyboard.press("Tab");
  await expect(removeButton(page, "Harbor Logistics")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(removeButton(page, "Route optimisation")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(addTopicButton(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(moreButton(page)).toBeFocused();
  // Enter opens the menu; Tab reaches Copy link, then Delete note…, which asks.
  await page.keyboard.press("Enter");
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(
    preview(page).getByRole("button", { name: COPY_LINK }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(deleteButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await expect(keepButton(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(moreButton(page)).toBeFocused();
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");

  // Delete comes before Keep; Enter on it after the guard deletes.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(deleteButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(keepButton(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(deleteButton(page)).toBeFocused();
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(DELETED);
  expect(await calls(page)).toEqual([
    { name: "deleteNote", args: [INTERVIEW_1] },
  ]);
});

test("opening another note closes a pending question", async ({ page }) => {
  await open(page, `?note=${README}`);
  await askDelete(page);
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await noteLinks(page).filter({ hasText: "Client list" }).click();
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(moreButton(page)).toBeVisible();
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");
  // And it is not waiting when the first note is opened again.
  await noteLinks(page).filter({ hasText: "Readme" }).click();
  await expect(openTitle(page, "Readme")).toBeVisible();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  expect(await calls(page)).toEqual([]);
});

const inView = (el: Element) => {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (r.height === 0 || y < 0 || y > window.innerHeight) return false;
  if (r.left < 0 || r.right > window.innerWidth) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
};
const scrolls = (page: Page) =>
  page.evaluate(() => ({
    down: document.documentElement.scrollHeight > window.innerHeight,
    across: document.documentElement.scrollWidth > window.innerWidth,
  }));

for (const look of LOOKS)
  for (const size of [
    { width: 1100, height: 560 },
    { width: 390, height: 800 },
  ]) {
    test(`at ${size.width} x ${size.height} the delete question keeps both answers reachable${named(look)}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      // A held note: the tallest header, with the release box under the question.
      await open(page, `?note=${HELD}`);
      await askDelete(page);
      await expect(preview(page)).toContainText(DELETE_QUESTION);
      for (const button of [deleteButton(page), keepButton(page)]) {
        await button.scrollIntoViewIfNeeded();
        expect(await button.evaluate(inView)).toBe(true);
      }
      const page_ = await scrolls(page);
      expect(page_.across).toBe(false);
      // Side by side the page is one window tall; stacked, it scrolls down only.
      if (size.width >= 1100) expect(page_.down).toBe(false);
    });

    for (const fail of [false, true])
      test(`at ${size.width} x ${size.height} a ${fail ? "refused" : "done"} delete is said in view, without scrolling the page${named(look)}`, async ({
        page,
        context,
      }) => {
        if (look) await setLook(context, look);
        await page.setViewportSize(size);
        await open(page, `?${fail ? "fail=1&" : ""}note=${HELD}`);
        await confirmDelete(page);
        await expect(status(page)).toHaveText(fail ? DELETE_FAILED : DELETED);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(300);
        // Seen without scrolling, and so is the way to dismiss it.
        expect(await status(page).evaluate(inView)).toBe(true);
        expect(await dismissButton(page).evaluate(inView)).toBe(true);
        const page_ = await scrolls(page);
        expect(page_.across).toBe(false);
        if (size.width >= 1100) expect(page_.down).toBe(false);
      });
  }

// ---- The note pane: the title once, and Copy link ----

test("the open note shows its title once", async ({ page }) => {
  await open(page, `?note=${README}`);
  await expect(
    preview(page).getByRole("heading", { name: "Readme" }),
  ).toHaveCount(1);
});

test("Copy link says it copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page, `?note=${README}`);
  await moreButton(page).click();
  await preview(page).getByRole("button", { name: COPY_LINK }).click();
  await expect(status(page)).toHaveText(LINK_COPIED);
  // The note's absolute address, and the menu is closed.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).searchParams.get("note")).toBe(README);
  await expect(moreButton(page)).toHaveAttribute("aria-expanded", "false");
  expect(await calls(page)).toEqual([]);
});

test("Copy link says so when the browser refuses", async ({ page }) => {
  await open(page, `?note=${README}`);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("refused")) },
    });
  });
  await moreButton(page).click();
  await preview(page).getByRole("button", { name: COPY_LINK }).click();
  await expect(status(page)).toHaveText(LINK_NOT_COPIED);
});

// ---- Linked with, and Unlink ----

const SHARED_DATA = fixtureVault(0, { tab: "shared" });
const FINDINGS = idOf("Findings draft");
const CALL_NOTES = idOf("Call notes");
const PRICING = SHARED_DATA.notes.find(
  (n) => n.title === "Pricing options",
)!.id;
const linksOf = (note: string) => {
  const opened = fixtureVault(0, { note }).open;
  if (!opened || !("note" in opened)) throw new Error(note);
  return opened.links;
};
const [WITH_SARA, WITH_MINE] = linksOf(FINDINGS).map((l) => l.id) as [
  string,
  string,
];
const ASK_SARA = unlinkQuestion({ own: false, owner: "Sara" });
const ASK_OWN = unlinkQuestion({ own: true, owner: "Danijel" });

const linked = (page: Page) =>
  preview(page).getByRole("region", { name: LINKED_WITH });
const linkedRows = (page: Page) => linked(page).getByRole("listitem");
const unlinkButton = (page: Page, title: string) =>
  linked(page).getByRole("button", { name: unlinkName(title), exact: true });
const keepLink = (page: Page, title: string) =>
  linked(page).getByRole("button", { name: keepLinkName(title), exact: true });
const unlinkQuestions = (page: Page) =>
  linked(page).getByRole("group", { name: UNLINK_GROUP });

/** Asks, waits out the guard and answers Unlink. */
async function confirmUnlink(page: Page, title: string, sentence: string) {
  await unlinkButton(page, title).click();
  await expect(unlinkQuestions(page)).toContainText(sentence);
  await page.waitForTimeout(600);
  await unlinkButton(page, title).click();
}

test("an open note lists the notes it is linked with, under the sharing control", async ({
  page,
}) => {
  await open(page, `?note=${FINDINGS}`);
  await expect(
    linked(page).getByRole("heading", { name: LINKED_WITH }),
  ).toBeVisible();
  await expect(linkedRows(page)).toHaveCount(2);
  // The other note's title and its owner; one's own note says "You".
  const sara = linkedRows(page).nth(0);
  await expect(sara.getByRole("link")).toContainText("Pricing options");
  await expect(sara.getByRole("link")).toContainText("Sara");
  await expect(sara.getByRole("link")).toHaveAttribute(
    "href",
    `/dev/vault?note=${PRICING}`,
  );
  const own = linkedRows(page).nth(1);
  await expect(own.getByRole("link")).toContainText("Call notes");
  await expect(own.getByRole("link")).toContainText("You");
  await expect(own.getByRole("link")).toHaveAttribute(
    "href",
    `/dev/vault?note=${CALL_NOTES}`,
  );
  for (const title of ["Pricing options", "Call notes"])
    await expect(unlinkButton(page, title)).toHaveText("Unlink");
  // After the action row (the sharing control and ⋯), before the note's text.
  const order = await page.evaluate(
    ([linkedWith, more]) => {
      const at = (sel: string) => document.querySelector(sel)!;
      const before = (a: Element, b: Element) =>
        !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const list = at(
        `section[aria-label="Note"] section[aria-label="${linkedWith}"]`,
      );
      return [
        before(at('button[aria-label^="Sharing: "]'), list),
        before(at(`button[aria-label="${more}"]`), list),
        before(list, at('section[aria-label="Note"] article > :last-child')),
      ];
    },
    [LINKED_WITH, MORE_ACTIONS] as const,
  );
  expect(order).toEqual([true, true, true]);
  expect(await calls(page)).toEqual([]);
});

test("a note with no links has no Linked with heading", async ({ page }) => {
  await open(page, `?note=${README}`);
  await expect(openTitle(page, "Readme")).toBeVisible();
  await expect(linked(page)).toHaveCount(0);
  await expect(preview(page).getByText(LINKED_WITH)).toHaveCount(0);
  await expect(
    preview(page).getByRole("button", { name: /^Unlink/ }),
  ).toHaveCount(0);
});

test("a linked note's title opens that note in the vault", async ({ page }) => {
  await open(page, `?note=${FINDINGS}`);
  await linked(page)
    .getByRole("link", { name: /Call notes/ })
    .click();
  await expect(openTitle(page, "Call notes")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`note=${CALL_NOTES}`));
  // The same link, from its other side.
  await expect(linkedRows(page)).toHaveCount(1);
  await expect(linkedRows(page).getByRole("link")).toContainText(
    "Findings draft",
  );

  // A colleague's note opens on the shared tab.
  await open(page, `?note=${FINDINGS}`);
  await linked(page)
    .getByRole("link", { name: /Pricing options/ })
    .click();
  await expect(openTitle(page, "Pricing options")).toBeVisible();
  await expect(tab(page, "Shared with me")).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("Unlink asks first and names the colleague; Keep puts everything back", async ({
  page,
}) => {
  await open(page, `?note=${FINDINGS}`);
  await unlinkButton(page, "Pricing options").click();
  await expect(unlinkQuestions(page)).toHaveCount(1);
  await expect(unlinkQuestions(page)).toContainText(ASK_SARA);
  await expect(unlinkQuestions(page)).toContainText("You and Sara");
  await expect(unlinkButton(page, "Pricing options")).toHaveCount(1);
  await expect(unlinkButton(page, "Pricing options")).toHaveText("Unlink");
  await expect(keepLink(page, "Pricing options")).toHaveText("Keep");
  // The safe answer holds the focus.
  await expect(keepLink(page, "Pricing options")).toBeFocused();

  await keepLink(page, "Pricing options").click();
  await expect(unlinkQuestions(page)).toHaveCount(0);
  await expect(unlinkButton(page, "Pricing options")).toBeFocused();
  await expect(linkedRows(page)).toHaveCount(2);
  await expect(status(page)).toHaveText("");
  expect(await calls(page)).toEqual([]);
});

test("two notes of one's own are asked about plainly", async ({ page }) => {
  await open(page, `?note=${FINDINGS}`);
  await unlinkButton(page, "Call notes").click();
  await expect(unlinkQuestions(page)).toContainText(ASK_OWN);
  await expect(preview(page)).not.toContainText("cannot be linked again");
  await keepLink(page, "Call notes").click();

  // From the other side it is still two notes of one's own.
  await open(page, `?note=${CALL_NOTES}`);
  await unlinkButton(page, "Findings draft").click();
  await expect(unlinkQuestions(page)).toContainText(ASK_OWN);
});

test("by keyboard: Unlink asks, Escape answers Keep", async ({ page }) => {
  await open(page, `?note=${FINDINGS}`);
  await unlinkButton(page, "Pricing options").focus();
  await page.keyboard.press("Enter");
  await expect(unlinkQuestions(page)).toContainText(ASK_SARA);
  await expect(keepLink(page, "Pricing options")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(unlinkQuestions(page)).toHaveCount(0);
  await expect(unlinkButton(page, "Pricing options")).toBeFocused();
  // Unlink comes before Keep.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await expect(unlinkButton(page, "Pricing options")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(linkedRows(page)).toHaveCount(2);
  expect(await calls(page)).toEqual([]);
});

test("a second press that lands on the question's Unlink ends nothing", async ({
  page,
}) => {
  await open(page, `?note=${FINDINGS}`);
  await unlinkButton(page, "Call notes").click();
  // At once, as the second half of a double click would.
  await unlinkButton(page, "Call notes").click();
  await expect(unlinkQuestions(page)).toContainText(ASK_OWN);
  await expect(linkedRows(page)).toHaveCount(2);
  expect(await calls(page)).toEqual([]);
});

test("a second, deliberate Unlink removes the row and leaves the other", async ({
  page,
}) => {
  await open(page, `?note=${FINDINGS}`);
  await confirmUnlink(page, "Pricing options", ASK_SARA);
  await expect(linkedRows(page)).toHaveCount(1);
  await expect(linkedRows(page).getByRole("link")).toContainText("Call notes");
  await expect(unlinkQuestions(page)).toHaveCount(0);
  await expect(openTitle(page, "Findings draft")).toBeVisible();
  await expect(status(page)).toHaveText("");
  expect(await calls(page)).toEqual([{ name: "unlink", args: [WITH_SARA] }]);
  // The focus is not lost with the row: it is on the open note in the list.
  await expect(
    noteLinks(page).filter({ hasText: "Findings draft" }),
  ).toBeFocused();

  // The last link gone, the heading goes too.
  await confirmUnlink(page, "Call notes", ASK_OWN);
  await expect(linked(page)).toHaveCount(0);
  await expect(preview(page).getByText(LINKED_WITH)).toHaveCount(0);
  await expect(openTitle(page, "Findings draft")).toBeVisible();
  expect(await calls(page)).toEqual([
    { name: "unlink", args: [WITH_SARA] },
    { name: "unlink", args: [WITH_MINE] },
  ]);
});

test("a refused unlink says so, keeps the row and closes the question", async ({
  page,
}) => {
  await open(page, `?fail=1&note=${FINDINGS}`);
  await confirmUnlink(page, "Pricing options", ASK_SARA);
  await expect(status(page)).toHaveText(UNLINK_FAILED);
  await expect(status(page)).toBeVisible();
  await expect(unlinkQuestions(page)).toHaveCount(0);
  await expect(unlinkButton(page, "Pricing options")).toBeFocused();
  await expect(linkedRows(page)).toHaveCount(2);
  expect(await calls(page)).toEqual([{ name: "unlink", args: [WITH_SARA] }]);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(UNLINK_FAILED)).toHaveCount(1);
});

test("while an unlink runs, neither answer nor Escape does anything", async ({
  page,
}) => {
  await open(page, `?slow=1&note=${FINDINGS}`);
  await confirmUnlink(page, "Pricing options", ASK_SARA);
  await expect(unlinkQuestions(page)).toHaveAttribute("aria-busy", "true");
  await expect(unlinkButton(page, "Pricing options")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(keepLink(page, "Pricing options")).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await keepLink(page, "Pricing options").evaluate((el: HTMLElement) =>
    el.click(),
  );
  await page.keyboard.press("Escape");
  await unlinkButton(page, "Pricing options").evaluate((el: HTMLElement) =>
    el.click(),
  );
  // Still asked, still running, still one request.
  await expect(unlinkQuestions(page)).toHaveAttribute("aria-busy", "true");
  await expect(linkedRows(page)).toHaveCount(2);
  expect(await calls(page)).toEqual([{ name: "unlink", args: [WITH_SARA] }]);

  await expect(linkedRows(page)).toHaveCount(1);
  expect(await calls(page)).toEqual([{ name: "unlink", args: [WITH_SARA] }]);
});

test("unlinking a colleague's note read only through the link names its owner, and the note is gone", async ({
  page,
}) => {
  await open(page, `?note=${PRICING}`);
  await expect(openTitle(page, "Pricing options")).toBeVisible();
  await expect(linkedRows(page)).toHaveCount(1);
  await expect(linkedRows(page).getByRole("link")).toContainText(
    "Findings draft",
  );
  await expect(linkedRows(page).getByRole("link")).toContainText("You");
  await confirmUnlink(page, "Findings draft", ASK_SARA);
  await expect(preview(page)).toContainText("That note isn't available.");
  await expect(linked(page)).toHaveCount(0);
  await expect(
    noteLinks(page).filter({ hasText: "Pricing options" }),
  ).toHaveCount(0);
  expect(await calls(page)).toEqual([{ name: "unlink", args: [WITH_SARA] }]);
});

test("opening another note closes a pending unlink question", async ({
  page,
}) => {
  await open(page, `?note=${FINDINGS}`);
  await unlinkButton(page, "Call notes").click();
  await expect(unlinkQuestions(page)).toHaveCount(1);
  await noteLinks(page).filter({ hasText: "Client list" }).click();
  await expect(openTitle(page, "Client list")).toBeVisible();
  await noteLinks(page).filter({ hasText: "Findings draft" }).click();
  await expect(openTitle(page, "Findings draft")).toBeVisible();
  await expect(linkedRows(page)).toHaveCount(2);
  await expect(unlinkQuestions(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([]);
});

for (const look of LOOKS)
  for (const size of [
    { width: 1100, height: 560 },
    { width: 390, height: 800 },
  ]) {
    test(`at ${size.width} x ${size.height} the unlink question keeps both answers reachable${named(look)}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page, `?note=${FINDINGS}`);
      await unlinkButton(page, "Pricing options").click();
      await expect(unlinkQuestions(page)).toContainText(ASK_SARA);
      for (const button of [
        unlinkButton(page, "Pricing options"),
        keepLink(page, "Pricing options"),
        unlinkButton(page, "Call notes"),
      ]) {
        await button.scrollIntoViewIfNeeded();
        expect(await button.evaluate(inView)).toBe(true);
      }
      const page_ = await scrolls(page);
      expect(page_.across).toBe(false);
      if (size.width >= 1100) expect(page_.down).toBe(false);
    });
  }

// ---- Import a folder ----

/** Builds a folder of files under this test's output directory and answers its path. */
function folder(name: string, files: Record<string, string | number>) {
  const dir = test.info().outputPath(name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(
      join(dir, path),
      typeof content === "number" ? Buffer.alloc(content, "a") : content,
    );
  }
  return dir;
}

/** `n` small notes, n001.md onwards, so path order is the order they are sent in. */
const many = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `n${String(i + 1).padStart(4, "0")}.md`,
      `note ${i + 1}`,
    ]),
  );

const addNotes = (page: Page) =>
  page.getByRole("button", { name: ADD_NOTES, exact: true });
async function openPanel(page: Page, name: string) {
  await addNotes(page).click();
  await page
    .getByRole("group", { name: ADD_NOTES })
    .getByRole("button", { name, exact: true })
    .click();
}
const dialogNamed = (page: Page, name: string) =>
  page.getByRole("dialog", { name });
/** A press on the dimmed card, above the dialog, where nothing but the dim is. */
async function pressDim(page: Page) {
  const box = (await page.getByRole("main", { name: "Vault" }).boundingBox())!;
  await page.mouse.click(box.x + 6, box.y + 40);
}
/** Whether something else is drawn over the middle of `el`: it cannot be pressed. */
const covered = (el: Element) => {
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return top !== el && !el.contains(top);
};
const filterField = (page: Page) =>
  page.getByRole("searchbox", { name: "Filter notes" });
const importPanel = (page: Page) =>
  page.getByRole("region", { name: /Import|Ready/ });
const panelNamed = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

async function pick(page: Page, dir: string) {
  await openPanel(page, T.IMPORT);
  await page.getByLabel(T.FOLDER_INPUT).setInputFiles(dir);
}

type ImportCall = {
  name: string;
  args: [string, { path: string; title: string; body: string }[]] | [string];
};
const importCalls = async (page: Page) =>
  ((await calls(page)) as ImportCall[]).filter(
    (c) => c.name === "createWorkspace" || c.name === "importBatch",
  );
const sentPaths = async (page: Page) =>
  (await importCalls(page))
    .filter((c) => c.name === "importBatch")
    .map((c) => (c.args[1] as { path: string }[]).map((n) => n.path));

const MIXED = {
  "a.md": "# A",
  "sub/b.md": "---\ntitle: B\n---\nbody",
  "sub/Loud.MD": "upper case",
  "img.png": "not a note",
  "sub/paper.pdf": "not a note",
  ".trash/old.md": "hidden",
  "big.md": 1_000_001,
};

test("the bar has the filter and Add notes; Shared with me has no Add notes", async ({
  page,
}) => {
  await open(page);
  await expect(addNotes(page)).toBeVisible();
  await addNotes(page).click();
  const menu = page.getByRole("group", { name: ADD_NOTES });
  await expect(menu.getByRole("button")).toHaveText([
    new RegExp(T.IMPORT),
    new RegExp(C.CONNECT),
    new RegExp(A.ATTACH),
  ]);
  await page.keyboard.press("Escape");
  await expect(addNotes(page)).toBeFocused();
  await open(page, "?tab=shared");
  await expect(addNotes(page)).toHaveCount(0);
});

test("the import opens as a dialog and Escape returns to Add notes", async ({
  page,
}) => {
  await open(page);
  await openPanel(page, T.IMPORT);
  await expect(page.getByRole("dialog", { name: T.IMPORT })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
});

test("each menu item is named by its name and described by its line", async ({
  page,
}) => {
  await open(page);
  await addNotes(page).click();
  await expect(addNotes(page)).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("group", { name: ADD_NOTES });
  await expect(addNotes(page)).toHaveAttribute(
    "aria-controls",
    (await menu.getAttribute("id"))!,
  );
  for (const [name, line] of [
    [T.IMPORT, T.IMPORT_LINE],
    [C.CONNECT, C.CONNECT_LINE],
    [A.ATTACH, A.ATTACH_LINE],
  ] as const) {
    const item = menu.getByRole("button", { name, exact: true });
    await expect(item).toHaveAccessibleDescription(line);
  }
  // A press outside closes it.
  await page
    .getByRole("main", { name: "Vault" })
    .click({ position: { x: 6, y: 6 } });
  await expect(menu).toHaveCount(0);
  await expect(addNotes(page)).toHaveAttribute("aria-expanded", "false");
});

test("the import panel opens in a dialog; Escape, Close or a press on the dimmed card put the focus back on Add notes", async ({
  page,
}) => {
  await open(page);
  const urls = watch(page);
  await openPanel(page, T.IMPORT);
  const panel = panelNamed(page, T.IMPORT);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: T.IMPORT })).toBeFocused();
  const dialog = dialogNamed(page, T.IMPORT);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(panel.getByRole("button", { name: T.CHOOSE })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
  await openPanel(page, T.IMPORT);
  await panel.getByRole("button", { name: /^Close/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
  await openPanel(page, T.IMPORT);
  await expect(dialog).toBeVisible();
  await pressDim(page);
  await expect(dialog).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
  expect(urls()).toEqual([]);
  expect(await calls(page)).toEqual([]);
});

test("Tab stays inside the dialog", async ({ page }) => {
  await open(page);
  await openPanel(page, T.IMPORT);
  const dialog = dialogNamed(page, T.IMPORT);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
});

test("the summary counts the notes and what is left out, before anything is sent", async ({
  page,
}) => {
  await open(page);
  await pick(page, folder("Field notes", MIXED));
  const panel = panelNamed(page, T.READY);
  await expect(panel.getByRole("heading", { name: T.READY })).toBeFocused();
  await expect(panel.getByText(T.found(3))).toBeVisible();
  await expect(panel.getByText(T.otherSkipped(2))).toBeVisible();
  await expect(panel.getByText(T.hiddenSkipped(1))).toBeVisible();
  await expect(panel.getByText(T.tooLargeSkipped(1))).toBeVisible();
  await expect(
    panel.getByRole("region", { name: T.SKIPPED_PATHS }).getByRole("listitem"),
  ).toHaveText(["big.md"]);
  expect(await calls(page)).toEqual([]);
});

test("a new workspace is named after the folder; only the markdown notes are sent", async ({
  page,
}) => {
  await open(page);
  await pick(page, folder("Field notes", MIXED));
  const panel = importPanel(page);
  await expect(
    panel.getByRole("radio", { name: T.NEW_WORKSPACE }),
  ).toBeChecked();
  await expect(panel.getByLabel(T.WORKSPACE_NAME)).toHaveValue("Field notes");
  await panel.getByRole("button", { name: T.START, exact: true }).click();

  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByRole("heading", { name: T.FINISHED })).toBeFocused();
  await expect(done.getByText("Created 3", { exact: true })).toBeVisible();
  await expect(done.getByText("Updated 0", { exact: true })).toBeVisible();
  await expect(done.getByText("Unchanged 0", { exact: true })).toBeVisible();
  await expect(done.getByText("Skipped 1", { exact: true })).toBeVisible();
  await expect(done.getByText("Failed 0", { exact: true })).toBeVisible();
  await expect(
    done.getByRole("region", { name: T.SKIPPED_PATHS }).getByRole("listitem"),
  ).toHaveText(["big.md"]);

  const made = await importCalls(page);
  expect(made[0]).toEqual({ name: "createWorkspace", args: ["Field notes"] });
  expect(made.slice(1).map((c) => [c.name, c.args[0]])).toEqual([
    ["importBatch", "imported-1"],
  ]);
  expect((await sentPaths(page)).flat().sort()).toEqual(
    ["a.md", "sub/Loud.MD", "sub/b.md"].sort(),
  );

  // The new workspace has a tab, and the panel opens it.
  const link = done.getByRole("link", { name: T.openWorkspace("Field notes") });
  await expect(link).toHaveAttribute("href", "/dev/vault?ws=imported-1");
  await expect(
    page
      .getByRole("navigation", { name: "Workspaces" })
      .getByRole("link", { name: "Field notes" }),
  ).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\?ws=imported-1$/);
  await expect(done).toHaveCount(0);
});

test("importing into an existing workspace makes none; a second import changes nothing", async ({
  page,
}) => {
  await open(page);
  const dir = folder("Field notes", { "a.md": "A", "b/c.md": "C" });
  await pick(page, dir);
  const panel = importPanel(page);
  await panel.getByRole("radio", { name: T.EXISTING_WORKSPACE }).check();
  const select = panel.getByLabel(T.WORKSPACE, { exact: true });
  // The open workspace is offered first.
  await expect(select).toHaveValue(DATA.workspaces[0]!.id);
  await select.selectOption({ label: "Operations" });
  await panel.getByRole("button", { name: T.START, exact: true }).click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 2", { exact: true })).toBeVisible();
  const operations = DATA.workspaces[1]!.id;
  expect((await importCalls(page)).map((c) => [c.name, c.args[0]])).toEqual([
    ["importBatch", operations],
  ]);
  await expect(
    done.getByRole("link", { name: T.openWorkspace("Operations") }),
  ).toHaveAttribute("href", `/dev/vault?ws=${operations}`);

  // Again, the same folder into the same workspace.
  await page.getByLabel(T.FOLDER_INPUT).setInputFiles(dir);
  await panel.getByRole("radio", { name: T.EXISTING_WORKSPACE }).check();
  await panel.getByLabel(T.WORKSPACE, { exact: true }).selectOption({
    label: "Operations",
  });
  await panel.getByRole("button", { name: T.START, exact: true }).click();
  await expect(done.getByText("Unchanged 2", { exact: true })).toBeVisible();
  await expect(done.getByText("Created 0", { exact: true })).toBeVisible();
});

test("each note travels with its dates; importing again with only a date corrected counts as updated", async ({
  page,
}) => {
  await open(page);
  const dir = folder("Journal", {
    "field.md": "---\ndate: 2024-03-14\n---\nA",
    "2022-05-06 standup.md": "B",
    "plain.md": "C",
  });
  // The files' own time, which is all `plain.md` has to go by.
  const touch = (name: string, iso: string) =>
    utimesSync(join(dir, name), new Date(iso), new Date(iso));
  const FIRST = "2025-01-02T03:04:05.000Z";
  for (const name of ["field.md", "2022-05-06 standup.md", "plain.md"])
    touch(name, FIRST);

  const run = async () => {
    const panel = importPanel(page);
    await panel.getByRole("radio", { name: T.EXISTING_WORKSPACE }).check();
    await panel.getByLabel(T.WORKSPACE, { exact: true }).selectOption({
      label: "Operations",
    });
    await panel.getByRole("button", { name: T.START, exact: true }).click();
  };
  const sentDates = async () => {
    const batches = (await importCalls(page)).filter(
      (c) => c.name === "importBatch",
    );
    const notes = batches.at(-1)!.args[1] as {
      path: string;
      written_at?: string;
      modified_at?: string;
    }[];
    return Object.fromEntries(
      notes.map((n) => [n.path, [n.written_at, n.modified_at]]),
    );
  };

  await pick(page, dir);
  await run();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 3", { exact: true })).toBeVisible();
  // A field first, then the file's name, then the file's time; a day alone is noon UTC.
  expect(await sentDates()).toEqual({
    "field.md": ["2024-03-14T12:00:00.000Z", FIRST],
    "2022-05-06 standup.md": ["2022-05-06T12:00:00.000Z", FIRST],
    "plain.md": [FIRST, FIRST],
  });

  // The same folder again, the text of every note as it was: two files have another time.
  const SECOND = "2025-02-03T04:05:06.000Z";
  touch("field.md", SECOND);
  touch("plain.md", SECOND);
  await page.getByLabel(T.FOLDER_INPUT).setInputFiles(dir);
  await run();
  await expect(done.getByText("Updated 2", { exact: true })).toBeVisible();
  await expect(done.getByText("Unchanged 1", { exact: true })).toBeVisible();
  await expect(done.getByText("Created 0", { exact: true })).toBeVisible();
  await expect(done.getByText("Failed 0", { exact: true })).toBeVisible();
  expect(await sentDates()).toEqual({
    "field.md": ["2024-03-14T12:00:00.000Z", SECOND],
    "2022-05-06 standup.md": ["2022-05-06T12:00:00.000Z", FIRST],
    "plain.md": [SECOND, SECOND],
  });
});

test("a name that is empty or too long is refused before anything is asked", async ({
  page,
}) => {
  await open(page);
  await pick(page, folder("Field notes", { "a.md": "A" }));
  const panel = importPanel(page);
  const name = panel.getByLabel(T.WORKSPACE_NAME);
  const start = panel.getByRole("button", { name: T.START, exact: true });
  for (const bad of ["", "   ", "x".repeat(61)]) {
    await name.fill(bad);
    await start.click();
    await expect(panel.getByRole("alert")).toHaveText(T.NAME_PROBLEM);
    await expect(name).toHaveAttribute("aria-invalid", "true");
  }
  expect(await calls(page)).toEqual([]);
  // Typing takes the line away; 60 characters, spaces around them aside, is a name.
  await name.fill(` ${"x".repeat(60)} `);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await start.click();
  await expect(panelNamed(page, T.FINISHED)).toBeVisible();
  expect((await importCalls(page))[0]).toEqual({
    name: "createWorkspace",
    args: ["x".repeat(60)],
  });
});

for (const [flag, line] of [
  ["taken", T.NAME_TAKEN],
  ["limit", T.WORKSPACE_LIMIT],
  ["fail", T.WORKSPACE_FAILED],
] as const)
  test(`a workspace that cannot be made (${flag}) says why and imports nothing`, async ({
    page,
  }) => {
    await open(page, `?${flag}=1`);
    await pick(page, folder("Field notes", { "a.md": "A" }));
    const panel = importPanel(page);
    await panel.getByRole("button", { name: T.START, exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText(line);
    await expect(panel.getByLabel(T.WORKSPACE_NAME)).toHaveValue("Field notes");
    expect((await importCalls(page)).map((c) => c.name)).toEqual([
      "createWorkspace",
    ]);
    // The panel can be closed again.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

test("a folder of more than 2,000 notes is refused; 2,000 is not", async ({
  page,
}) => {
  await open(page);
  const dir = folder("Big", many(2001));
  await pick(page, dir);
  const panel = importPanel(page);
  await expect(panel.getByRole("alert")).toHaveText(T.TOO_MANY);
  await expect(
    panel.getByRole("button", { name: T.START, exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByRole("radiogroup")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: T.CHOOSE_ANOTHER }),
  ).toBeVisible();
  rmSync(join(dir, "n2001.md"));
  await page.getByLabel(T.FOLDER_INPUT).setInputFiles(dir);
  await expect(panel.getByText(T.found(2000))).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: T.START, exact: true }),
  ).toBeVisible();
  expect(await calls(page)).toEqual([]);
});

test("a folder without notes says so and offers no import", async ({
  page,
}) => {
  await open(page);
  await pick(page, folder("Pictures", { "a.png": "x", ".git/config": "x" }));
  const panel = importPanel(page);
  await expect(panel.getByRole("alert")).toHaveText(T.NO_NOTES);
  await expect(
    panel.getByRole("button", { name: T.START, exact: true }),
  ).toHaveCount(0);
});

test("a browser that gives no folder paths is told so plainly", async ({
  page,
}) => {
  await open(page);
  await openPanel(page, T.IMPORT);
  // Loose files have no path inside a folder, as in a browser without folder picking.
  await page.getByLabel(T.FOLDER_INPUT).evaluate((el) => {
    el.removeAttribute("webkitdirectory");
  });
  await page
    .getByLabel(T.FOLDER_INPUT)
    .setInputFiles([
      { name: "a.md", mimeType: "text/markdown", buffer: Buffer.from("A") },
    ]);
  await expect(panelNamed(page, T.IMPORT).getByRole("alert")).toHaveText(
    T.UNSUPPORTED,
  );
  expect(await calls(page)).toEqual([]);
});

test("notes go a batch at a time, in order, with the progress said; leaving asks first", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await pick(page, folder("Sixty", many(60)));
  const panel = importPanel(page);
  await panel.getByRole("button", { name: T.START, exact: true }).click();
  const running = panelNamed(page, T.RUNNING);
  const status = running.getByRole("status");
  await expect(status).toHaveText(T.progress(0, 60));
  await expect(status).toHaveText(T.progress(25, 60));
  // While it runs: no closing, by Escape, by Close or by a press on the dimmed card.
  await page.keyboard.press("Escape");
  await running
    .getByRole("button", { name: /^Close/ })
    .evaluate((el: HTMLElement) => el.click());
  await pressDim(page);
  await expect(running).toBeVisible();
  await expect(dialogNamed(page, T.IMPORT)).toBeVisible();
  expect(
    await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(true);
  await expect(status).toHaveText(T.progress(50, 60));
  // The last batch, then the wiki links: three slow steps more.
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 60", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const sent = await sentPaths(page);
  expect(sent.map((b) => b.length)).toEqual([25, 25, 10]);
  expect(sent.flat()).toEqual(Object.keys(many(60)));
  // Once it is over, leaving asks nothing.
  expect(
    await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(false);
});

test("a refused batch fails its notes and the import goes on", async ({
  page,
}) => {
  await open(page, "?failbatch=2");
  await pick(page, folder("Sixty", many(60)));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 35", { exact: true })).toBeVisible();
  await expect(done.getByText("Failed 25", { exact: true })).toBeVisible();
  const failed = done
    .getByRole("region", { name: T.FAILED_PATHS })
    .getByRole("listitem");
  await expect(failed).toHaveCount(25);
  await expect(failed.first()).toHaveText("n0026.md");
  await expect(failed.last()).toHaveText("n0050.md");
  expect((await sentPaths(page)).length).toBe(3);
});

test("three refused batches in a row stop the import; the list of failures is cut at 50", async ({
  page,
}) => {
  await open(page, "?failbatch=all");
  await pick(page, folder("Hundred", many(100)));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.STOPPED);
  await expect(done.getByRole("heading", { name: T.STOPPED })).toBeFocused();
  await expect(done.getByRole("alert")).toHaveText(T.HALTED);
  await expect(done.getByText("Failed 75", { exact: true })).toBeVisible();
  await expect(done.getByText(T.notSent(25))).toBeVisible();
  const failed = done
    .getByRole("region", { name: T.FAILED_PATHS })
    .getByRole("listitem");
  await expect(failed).toHaveCount(51);
  await expect(failed.last()).toHaveText(T.andMore(25));
  expect((await sentPaths(page)).length).toBe(3);
});

test("Stop ends the import after the batch on its way; what was saved stays", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await pick(page, folder("Sixty", many(60)));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const running = panelNamed(page, T.RUNNING);
  await expect(running.getByRole("status")).toHaveText(T.progress(0, 60));
  await running.getByRole("button", { name: T.STOP, exact: true }).click();
  await expect(
    running.getByRole("button", { name: T.STOPPING }),
  ).toHaveAttribute("aria-disabled", "true");
  const done = panelNamed(page, T.STOPPED);
  await expect(done.getByText("Created 25", { exact: true })).toBeVisible();
  await expect(done.getByText(T.notSent(35))).toBeVisible();
  await expect(done.getByRole("alert")).toHaveCount(0);
  expect((await sentPaths(page)).map((b) => b.length)).toEqual([25]);
  // A stopped import does not go on to the wiki links.
  await expect(done.getByText(/Links made/)).toHaveCount(0);
  await expect(done.getByText(C.AFTER_IMPORT_UNFINISHED)).toHaveCount(0);
  expect(
    ((await calls(page)) as { name: string }[]).filter(
      (c) => c.name === "connect",
    ),
  ).toEqual([]);
  await expect(
    done.getByRole("link", { name: T.openWorkspace("Sixty") }),
  ).toBeVisible();
});

test("at 390 px the import panel and its controls stay inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, "?failbatch=1");
  await addNotes(page).scrollIntoViewIfNeeded();
  expect(await addNotes(page).evaluate(inView)).toBe(true);
  await pick(
    page,
    folder("A folder with quite a long name", {
      ...many(30),
      "a/very/deeply/nested/folder/with-a-long-file-name-that-must-wrap-in-a-narrow-window.md":
        "x",
    }),
  );
  const panel = importPanel(page);
  for (const control of [
    panel.getByRole("radio", { name: T.NEW_WORKSPACE }),
    panel.getByRole("radio", { name: T.EXISTING_WORKSPACE }),
    panel.getByLabel(T.WORKSPACE_NAME),
    panel.getByRole("button", { name: T.START, exact: true }),
    panel.getByRole("button", { name: T.CHOOSE_ANOTHER }),
    panel.getByRole("button", { name: /^Close/ }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect((await scrolls(page)).across).toBe(false);
  await panel.getByRole("button", { name: T.START, exact: true }).click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Failed 25", { exact: true })).toBeVisible();
  const link = done.getByRole("link", { name: /^Open / });
  await link.scrollIntoViewIfNeeded();
  expect(await link.evaluate(inView)).toBe(true);
  expect((await scrolls(page)).across).toBe(false);
  const box = (await done.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

// ---- Connect wiki links ----

const connectCalls = async (page: Page) =>
  ((await calls(page)) as { name: string; args: unknown[] }[])
    .filter((c) => c.name === "connect")
    .map((c) => c.args);
const leavingAsks = (page: Page) =>
  page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

/**
 * What a screen reader needs of a panel, checked by hand (the project carries no axe): the
 * region is named by an element that exists, every control in it has a name, no id is used
 * twice, and nothing on the page points at an element that is not there.
 */
const nameless = (page: Page, id: string) =>
  page.evaluate((panelId) => {
    const problems: string[] = [];
    const panel = document.getElementById(panelId);
    if (!panel) return [`no #${panelId}`];
    const named = (el: Element) => {
      const by = el.getAttribute("aria-labelledby");
      const text = by
        ? by
            .split(/\s+/)
            .map((i) => document.getElementById(i)?.textContent ?? "")
            .join(" ")
        : (el.getAttribute("aria-label") ?? el.textContent ?? "");
      return text.trim().length > 0;
    };
    if (!panel.getAttribute("aria-labelledby") || !named(panel))
      problems.push("the region has no name");
    for (const el of panel.querySelectorAll(
      "button, a, progress, h2, [role]",
    )) {
      if (el.getAttribute("role") === "status") continue;
      if (!named(el)) problems.push(`no name: ${el.outerHTML.slice(0, 80)}`);
    }
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    for (const i of new Set(ids))
      if (ids.filter((x) => x === i).length > 1)
        problems.push(`id twice: ${i}`);
    for (const el of document.querySelectorAll(
      "[aria-controls], [aria-labelledby], [aria-describedby]",
    ))
      for (const attr of [
        "aria-controls",
        "aria-labelledby",
        "aria-describedby",
      ])
        for (const i of (el.getAttribute(attr) ?? "").split(/\s+/))
          if (i && !document.getElementById(i))
            problems.push(`${attr} points at nothing: ${i}`);
    return problems;
  }, id);

test("after the last batch the import connects the wiki links and counts them", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await pick(page, folder("Field notes", { "a.md": "[[b]]", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const connecting = panelNamed(page, C.CONNECTING);
  await expect(
    connecting.getByRole("heading", { name: C.CONNECTING }),
  ).toBeFocused();
  await expect(connecting).toHaveAttribute("aria-busy", "true");
  await expect(connecting.getByRole("status")).toHaveText(
    C.connectProgress(40, 90),
  );
  // Still at work: no closing, and leaving asks first.
  await page.keyboard.press("Escape");
  await connecting
    .getByRole("button", { name: /^Close/ })
    .evaluate((el: HTMLElement) => el.click());
  await pressDim(page);
  await expect(connecting).toBeVisible();
  await expect(dialogNamed(page, T.IMPORT)).toBeVisible();
  expect(await leavingAsks(page)).toBe(true);

  // Connecting, then attaching, each take three slow steps: the end is a good while off.
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByRole("heading", { name: T.FINISHED })).toBeFocused({
    timeout: 15_000,
  });
  await expect(done.getByText("Created 2", { exact: true })).toBeVisible();
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible();
  await expect(
    done.getByText("Already linked 6", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Pointing at no note 3", { exact: true }),
  ).toBeVisible();
  await expect(done.getByText(/Could not be saved/)).toHaveCount(0);
  await expect(done.getByText(C.AFTER_IMPORT_UNFINISHED)).toHaveCount(0);
  expect(await leavingAsks(page)).toBe(false);
  // The whole workspace, from the start, after the notes were sent.
  expect(await connectCalls(page)).toEqual([
    ["imported-1", null],
    ["imported-1", "40"],
    ["imported-1", "80"],
  ]);
  const names = ((await calls(page)) as { name: string }[]).map((c) => c.name);
  expect(names.indexOf("connect")).toBeGreaterThan(
    names.lastIndexOf("importBatch"),
  );
});

test("Stop pressed during the last batch ends the import without connecting", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await pick(page, folder("Two", { "a.md": "[[b]]", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  // The only batch is on its way: every note will have been answered when it comes back.
  const running = panelNamed(page, T.RUNNING);
  await expect(running.getByRole("status")).toHaveText(T.progress(0, 2));
  await running.getByRole("button", { name: T.STOP, exact: true }).click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 2", { exact: true })).toBeVisible();
  await expect(panelNamed(page, C.CONNECTING)).toHaveCount(0);
  await expect(done.getByText(/Links made/)).toHaveCount(0);
  await expect(done.getByText(C.AFTER_IMPORT_UNFINISHED)).toHaveCount(0);
  await expect(done.getByText(/not sent/)).toHaveCount(0);
  expect(await connectCalls(page)).toEqual([]);
});

test("closing a connect dialog on Shared with me, which has no Add notes, puts the focus on the filter", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await openPanel(page, C.CONNECT);
  await panelNamed(page, C.CONNECT)
    .getByRole("button", { name: C.START, exact: true })
    .click();
  const running = panelNamed(page, C.CONNECTING);
  await expect(running).toBeVisible();
  // Another tab while the run is in flight (the dialog covers the tabs; the address can still
  // change, as by Back): the panel stays, Add notes does not.
  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("link", { name: "Shared with me" })
    .evaluate((el: HTMLElement) => el.click());
  await expect(page).toHaveURL(/tab=shared/);
  await expect(addNotes(page)).toHaveCount(0);
  const done = panelNamed(page, C.CONNECTED);
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await done.getByRole("button", { name: T.CLOSE, exact: true }).click();
  await expect(done).toHaveCount(0);
  await expect(filterField(page)).toBeFocused();
});

test("an import whose every batch was refused connects nothing", async ({
  page,
}) => {
  await open(page, "?failbatch=all");
  await pick(page, folder("Two", { "a.md": "A", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Failed 2", { exact: true })).toBeVisible();
  await expect(done.getByText(/Links made/)).toHaveCount(0);
  expect(await connectCalls(page)).toEqual([]);
});

test("an import whose links could not be connected says where to finish", async ({
  page,
}) => {
  await open(page, "?failconnect=all");
  await pick(page, folder("Two", { "a.md": "A", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  // The notes are in: the import itself finished.
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 2", { exact: true })).toBeVisible();
  await expect(done.getByText("Links made 0", { exact: true })).toBeVisible();
  await expect(done.getByText(C.AFTER_IMPORT_UNFINISHED)).toBeVisible();
  await expect(done.getByRole("alert")).toHaveCount(0);
  expect(await connectCalls(page)).toEqual([
    ["imported-1", null],
    ["imported-1", null],
    ["imported-1", null],
  ]);
});

test("the menu lists Connect wiki links on a workspace; Shared with me has no Add notes", async ({
  page,
}) => {
  await open(page);
  await addNotes(page).click();
  await expect(
    page
      .getByRole("group", { name: ADD_NOTES })
      .getByRole("button", { name: C.CONNECT, exact: true }),
  ).toBeVisible();
  await page.goto("/dev/vault?tab=shared", { waitUntil: "networkidle" });
  await expect(addNotes(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: C.CONNECT, exact: true }),
  ).toHaveCount(0);
});

test("the connect panel: Start, progress, counts; it cannot be closed while it runs", async ({
  page,
}) => {
  await open(page, "?slow=1");
  const urls = watch(page);
  await openPanel(page, C.CONNECT);
  const ready = panelNamed(page, C.CONNECT);
  await expect(ready.getByRole("heading", { name: C.CONNECT })).toBeFocused();
  const dialog = dialogNamed(page, C.CONNECT);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#vault-connect")).toBeVisible();
  await expect(ready.getByText(C.CONNECT_INTRO)).toBeVisible();
  await expect(
    ready.getByText(DATA.workspaces[0]!.name, { exact: true }),
  ).toBeVisible();
  expect(await nameless(page, "vault-connect")).toEqual([]);
  // Nothing is asked until Start.
  expect(await calls(page)).toEqual([]);
  expect(urls()).toEqual([]);

  await ready.getByRole("button", { name: C.START, exact: true }).click();
  const running = panelNamed(page, C.CONNECTING);
  await expect(
    running.getByRole("heading", { name: C.CONNECTING }),
  ).toBeFocused();
  await expect(running).toHaveAttribute("aria-busy", "true");
  const status = running.getByRole("status");
  await expect(status).toHaveText(C.connectProgress(40, 90));
  // While it runs: no closing, by Escape, by Close or by a press on the dimmed card.
  await page.keyboard.press("Escape");
  await running
    .getByRole("button", { name: /^Close/ })
    .evaluate((el: HTMLElement) => el.click());
  await pressDim(page);
  await expect(running).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(panelNamed(page, T.IMPORT)).toHaveCount(0);
  expect(await leavingAsks(page)).toBe(true);
  await expect(status).toHaveText(C.connectProgress(80, 90));

  const done = panelNamed(page, C.CONNECTED);
  await expect(done.getByRole("heading", { name: C.CONNECTED })).toBeFocused();
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible();
  await expect(
    done.getByText("Already linked 6", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Pointing at no note 3", { exact: true }),
  ).toBeVisible();
  await expect(done.getByText(/Could not be saved/)).toHaveCount(0);
  await expect(done.getByRole("alert")).toHaveCount(0);
  expect(await nameless(page, "vault-connect")).toEqual([]);
  expect(await leavingAsks(page)).toBe(false);
  const ws = DATA.workspaces[0]!.id;
  expect(await calls(page)).toEqual([
    { name: "connect", args: [ws, null] },
    { name: "connect", args: [ws, "40"] },
    { name: "connect", args: [ws, "80"] },
  ]);

  // Close, by the button under the counts, by the one in the corner, by Escape, and by a press
  // on the dimmed card.
  await done.getByRole("button", { name: T.CLOSE, exact: true }).click();
  await expect(done).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
  await expect(addNotes(page)).toHaveAttribute("aria-expanded", "false");
  await openPanel(page, C.CONNECT);
  await ready.getByRole("button", { name: /^Close:/ }).click();
  await expect(ready).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
  await openPanel(page, C.CONNECT);
  await expect(ready.getByRole("heading", { name: C.CONNECT })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ready).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
  await openPanel(page, C.CONNECT);
  await pressDim(page);
  await expect(ready).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
});

test("Stop ends connecting after the step on its way, with the counts so far", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await openPanel(page, C.CONNECT);
  await panelNamed(page, C.CONNECT)
    .getByRole("button", { name: C.START, exact: true })
    .click();
  const running = panelNamed(page, C.CONNECTING);
  await running.getByRole("button", { name: T.STOP, exact: true }).click();
  await expect(
    running.getByRole("button", { name: T.STOPPING }),
  ).toHaveAttribute("aria-disabled", "true");
  const done = panelNamed(page, C.CONNECT_STOPPED);
  await expect(
    done.getByRole("heading", { name: C.CONNECT_STOPPED }),
  ).toBeFocused();
  await expect(done.getByText("Links made 7", { exact: true })).toBeVisible();
  await expect(
    done.getByText("Already linked 2", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Pointing at no note 1", { exact: true }),
  ).toBeVisible();
  await expect(done.getByRole("alert")).toHaveCount(0);
  expect((await connectCalls(page)).length).toBe(1);
});

test("a refused step is tried again from where it was", async ({ page }) => {
  await open(page, "?failconnect=2");
  await openPanel(page, C.CONNECT);
  await panelNamed(page, C.CONNECT)
    .getByRole("button", { name: C.START, exact: true })
    .click();
  const done = panelNamed(page, C.CONNECTED);
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible();
  expect((await connectCalls(page)).map((a) => a[1])).toEqual([
    null,
    "40",
    "40",
    "80",
  ]);
});

test("three refused steps in a row stop connecting and say so", async ({
  page,
}) => {
  await open(page, "?failconnect=all");
  await openPanel(page, C.CONNECT);
  await panelNamed(page, C.CONNECT)
    .getByRole("button", { name: C.START, exact: true })
    .click();
  const done = panelNamed(page, C.CONNECT_STOPPED);
  await expect(
    done.getByRole("heading", { name: C.CONNECT_STOPPED }),
  ).toBeFocused();
  await expect(done.getByRole("alert")).toHaveText(C.CONNECT_HALTED);
  await expect(done.getByText("Links made 0", { exact: true })).toBeVisible();
  expect((await connectCalls(page)).length).toBe(3);
  expect(await nameless(page, "vault-connect")).toEqual([]);
});

test("one dialog at a time: Add notes is behind the dialog while it is open; an import at work stays", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await openPanel(page, C.CONNECT);
  await expect(dialogNamed(page, C.CONNECT)).toBeVisible();
  expect(await addNotes(page).evaluate(covered)).toBe(true);
  await page.keyboard.press("Escape");
  expect(await addNotes(page).evaluate(covered)).toBe(false);
  await openPanel(page, T.IMPORT);
  await expect(panelNamed(page, T.IMPORT)).toBeVisible();
  await expect(panelNamed(page, C.CONNECT)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await addNotes(page).evaluate(covered)).toBe(true);

  // An import at work: neither Escape nor a press on the dimmed card closes it.
  await page
    .getByLabel(T.FOLDER_INPUT)
    .setInputFiles(folder("Thirty", many(30)));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const running = panelNamed(page, T.RUNNING);
  await expect(running).toBeVisible();
  await page.keyboard.press("Escape");
  await pressDim(page);
  await expect(running).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await addNotes(page).evaluate(covered)).toBe(true);
  await expect(panelNamed(page, C.CONNECT)).toHaveCount(0);
});

test("attach is the menu's third item: each item opens its own dialog, one at a time, and one at work stays", async ({
  page,
}) => {
  await open(page, "?slow=1");
  for (const [name, other] of [
    [A.ATTACH, C.CONNECT],
    [C.CONNECT, A.ATTACH],
    [T.IMPORT, A.ATTACH],
    [A.ATTACH, T.IMPORT],
  ] as const) {
    await openPanel(page, name);
    await expect(dialogNamed(page, name)).toBeVisible();
    await expect(panelNamed(page, name)).toBeVisible();
    await expect(panelNamed(page, other)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(addNotes(page)).toBeFocused();
  }

  // An import at work: nothing closes it, so no other panel can be opened.
  await openPanel(page, T.IMPORT);
  await page
    .getByLabel(T.FOLDER_INPUT)
    .setInputFiles(folder("Thirty", many(30)));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const running = panelNamed(page, T.RUNNING);
  await expect(running).toBeVisible();
  await page.keyboard.press("Escape");
  await pressDim(page);
  await expect(running).toBeVisible();
  expect(await addNotes(page).evaluate(covered)).toBe(true);
  await expect(panelNamed(page, A.ATTACH)).toHaveCount(0);
  await expect(panelNamed(page, C.CONNECT)).toHaveCount(0);
});

test("the attach panel at work: it cannot be closed, leaving asks, and it ends by itself with its counts", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await openPanel(page, A.ATTACH);
  const ready = panelNamed(page, A.ATTACH);
  await ready.getByRole("button", { name: A.START, exact: true }).click();
  const running = panelNamed(page, A.ATTACHING);
  await expect(
    running.getByRole("heading", { name: A.ATTACHING }),
  ).toBeFocused();
  await expect(running).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Escape");
  await running
    .getByRole("button", { name: /^Close/ })
    .evaluate((el: HTMLElement) => el.click());
  await pressDim(page);
  await expect(running).toBeVisible();
  await expect(dialogNamed(page, A.ATTACH)).toBeVisible();
  await expect(panelNamed(page, T.IMPORT)).toHaveCount(0);
  await expect(panelNamed(page, C.CONNECT)).toHaveCount(0);
  expect(await leavingAsks(page)).toBe(true);

  // Nothing above depends on which step is in flight: the run ends by itself.
  const done = panelNamed(page, A.ATTACHED);
  await expect(done.getByRole("heading", { name: A.ATTACHED })).toBeFocused({
    timeout: 15_000,
  });
  await expect(
    done.getByText("Attached to a topic 54", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Already attached 18", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Notes with no topic 18", { exact: true }),
  ).toBeVisible();
  await expect(done.getByRole("alert")).toHaveCount(0);
  expect((await attachCalls(page)).length).toBe(3);
  expect(await leavingAsks(page)).toBe(false);
  // Its work over, a press on the dimmed card closes it.
  await pressDim(page);
  await expect(done).toHaveCount(0);
  await expect(addNotes(page)).toBeFocused();
});

test("Stop in the attach panel keeps the counts so far", async ({ page }) => {
  await open(page, "?slow=1");
  await openPanel(page, A.ATTACH);
  await panelNamed(page, A.ATTACH)
    .getByRole("button", { name: A.START, exact: true })
    .click();
  const running = panelNamed(page, A.ATTACHING);
  await expect(running.getByRole("status")).toHaveText(
    A.attachProgress(40, 90),
  );
  // Nothing between the wait and the click: the step on its way is the second.
  await running.getByRole("button", { name: T.STOP, exact: true }).click();
  await expect(
    running.getByRole("button", { name: T.STOPPING }),
  ).toHaveAttribute("aria-disabled", "true");
  const done = panelNamed(page, A.ATTACH_STOPPED);
  await expect(
    done.getByRole("heading", { name: A.ATTACH_STOPPED }),
  ).toBeFocused({ timeout: 15_000 });
  await expect(
    done.getByText("Attached to a topic 48", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Already attached 16", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Notes with no topic 16", { exact: true }),
  ).toBeVisible();
  await expect(done.getByRole("alert")).toHaveCount(0);
  expect((await attachCalls(page)).length).toBe(2);
  expect(await leavingAsks(page)).toBe(false);
});

test("Stop during the import's attaching stage keeps the notes and links and says where to finish", async ({
  page,
}) => {
  await open(page, "?slow=1");
  await pick(page, folder("Field notes", { "a.md": "[[b]]", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const attaching = panelNamed(page, A.ATTACHING);
  await expect(
    attaching.getByRole("heading", { name: A.ATTACHING }),
  ).toBeFocused({ timeout: 15_000 });
  await expect(attaching).toHaveAttribute("aria-busy", "true");
  await expect(attaching.getByRole("status")).toHaveText(
    A.attachProgress(40, 90),
  );
  await attaching.getByRole("button", { name: T.STOP, exact: true }).click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 2", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible();
  await expect(done.getByText(A.AFTER_IMPORT_UNFINISHED)).toBeVisible();
  expect((await attachCalls(page)).length).toBe(2);
  expect(await leavingAsks(page)).toBe(false);
});

test("opening another workspace closes a connect panel that is not running", async ({
  page,
}) => {
  await open(page);
  await openPanel(page, C.CONNECT);
  await expect(panelNamed(page, C.CONNECT)).toBeVisible();
  // The dialog covers the tabs; the address can still change, as by Back.
  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("link", { name: "Operations" })
    .evaluate((el: HTMLElement) => el.click());
  await expect(page).toHaveURL(/\?ws=/);
  await expect(panelNamed(page, C.CONNECT)).toHaveCount(0);
  await openPanel(page, C.CONNECT);
  await expect(
    panelNamed(page, C.CONNECT).getByText("Operations", { exact: true }),
  ).toBeVisible();
});

test("at 390 px Add notes, its menu and the connect dialog stay inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await addNotes(page).scrollIntoViewIfNeeded();
  expect(await addNotes(page).evaluate(inView)).toBe(true);
  await addNotes(page).click();
  const menu = page.getByRole("group", { name: ADD_NOTES });
  const inside = (await menu.boundingBox())!;
  expect(inside.x).toBeGreaterThanOrEqual(0);
  expect(inside.x + inside.width).toBeLessThanOrEqual(390);
  await menu.getByRole("button", { name: C.CONNECT, exact: true }).click();
  const ready = panelNamed(page, C.CONNECT);
  const start = ready.getByRole("button", { name: C.START, exact: true });
  await start.scrollIntoViewIfNeeded();
  expect(await start.evaluate(inView)).toBe(true);
  const box = (await ready.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect((await scrolls(page)).across).toBe(false);
});

// ---- Attach topics ----

const attachCalls = async (page: Page) =>
  ((await calls(page)) as { name: string; args: unknown[] }[])
    .filter((c) => c.name === "attach")
    .map((c) => c.args);

test("after connecting the wiki links the import attaches topics and counts them", async ({
  page,
}) => {
  await open(page);
  await pick(page, folder("Field notes", { "a.md": "[[b]]", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible();
  await expect(
    done.getByText("Attached to a topic 54", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Already attached 18", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Notes with no topic 18", { exact: true }),
  ).toBeVisible();
  await expect(done.getByText(A.AFTER_IMPORT_UNFINISHED)).toHaveCount(0);
  expect(await attachCalls(page)).toEqual([
    ["imported-1", null],
    ["imported-1", "40"],
    ["imported-1", "80"],
  ]);
  const names = ((await calls(page)) as { name: string }[]).map((c) => c.name);
  expect(names.indexOf("attach")).toBeGreaterThan(names.lastIndexOf("connect"));
});

test("an import into a hive with no topics says where topics come from", async ({
  page,
}) => {
  await open(page, "?notopics=1");
  await pick(page, folder("Field notes", { "a.md": "A" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText(A.NO_TOPICS)).toBeVisible();
  await expect(done.getByText(/Attached to a topic/)).toHaveCount(0);
  expect(await attachCalls(page)).toEqual([["imported-1", null]]);
});

test("an import whose topics could not be attached says where to finish", async ({
  page,
}) => {
  await open(page, "?failattach=all");
  await pick(page, folder("Field notes", { "a.md": "A" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText(A.AFTER_IMPORT_UNFINISHED)).toBeVisible();
  expect(await attachCalls(page)).toHaveLength(3);
});

test("Attach topics on one's own workspace: one sentence, Start, progress, then the counts", async ({
  page,
}) => {
  await open(page);
  await expect(addNotes(page)).toHaveAttribute("aria-expanded", "false");
  await openPanel(page, A.ATTACH);
  const panel = panelNamed(page, A.ATTACH);
  await expect(panel.getByRole("heading", { name: A.ATTACH })).toBeFocused();
  await expect(panel.getByText(A.ATTACH_INTRO)).toBeVisible();
  expect(await nameless(page, "vault-attach")).toEqual([]);
  await panel.getByRole("button", { name: A.START, exact: true }).click();
  const done = panelNamed(page, A.ATTACHED);
  await expect(done.getByRole("heading", { name: A.ATTACHED })).toBeFocused();
  await expect(
    done.getByText("Attached to a topic 54", { exact: true }),
  ).toBeVisible();
  await done.getByRole("button", { name: "Close", exact: true }).click();
  await expect(addNotes(page)).toBeFocused();
  // Not on "Shared with me": there is no Add notes there.
  await page.getByRole("link", { name: "Shared with me" }).click();
  await expect(page).toHaveURL(/tab=shared/);
  await expect(addNotes(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: A.ATTACH, exact: true }),
  ).toHaveCount(0);
});

// ---- Topics: browsing by topic, and a note's topics ----

const topicId = (name: string) => DATA.topics.find((x) => x.name === name)!.id;
const KICKOFF = idOf("Kickoff notes");
const SCOPE = idOf("Scope and assumptions");
const INTERVIEW_1 = idOf("Interview summary 1");
const SHARED_SITE_VISIT = SHARED_DATA.notes.find(
  (n) => n.title === "Site visit",
)!.id;
const SHARED_REPORTING = SHARED_DATA.notes.find(
  (n) => n.title === "Decision: reporting format",
)!.id;

const switchGroup = (page: Page) => page.getByRole("group", { name: P.SWITCH });
const topicNav = (page: Page) =>
  page.getByRole("navigation", { name: P.BY_TOPICS });
const topicsSection = (page: Page) =>
  preview(page).getByRole("region", { name: P.TOPICS_HEADING });
const chips = (page: Page) => topicsSection(page).getByRole("listitem");
const removeButton = (page: Page, name: string) =>
  topicsSection(page).getByRole("button", { name: P.removeName(name) });
const addTopicButton = (page: Page) =>
  topicsSection(page).getByRole("button", {
    name: P.ADD_TOPIC_BUTTON,
    exact: true,
  });
const picker = (page: Page) =>
  topicsSection(page).getByRole("group", { name: P.ADD_TOPIC });
const findTopic = (page: Page) =>
  picker(page).getByRole("searchbox", { name: P.FIND_TOPIC });
/** The picker's topic buttons, in order. */
const pickable = (page: Page) => picker(page).getByRole("button");
/** Opens + Topic and chooses the topic called `name`. */
async function pickTopic(page: Page, name: string) {
  await addTopicButton(page).click();
  await picker(page).getByRole("button", { name, exact: true }).click();
}
const listHeading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true });
const chipNames = (page: Page) =>
  chips(page).evaluateAll((els) =>
    els.map((el) => el.firstElementChild?.textContent ?? ""),
  );

test("the switch browses notes by topic, with no request", async ({ page }) => {
  await open(page);
  const requests = watch(page);
  const all = DATA.notes.length;
  const withTopics = DATA.notes.filter((n) => n.topics.length > 0).length;

  await expect(
    switchGroup(page).getByRole("button", { name: P.BY_FOLDERS }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    switchGroup(page).getByRole("button", { name: P.BY_TOPICS }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(folders(page)).toBeVisible();

  await switchGroup(page).getByRole("button", { name: P.BY_TOPICS }).click();
  await expect(folders(page)).toHaveCount(0);
  const nav = topicNav(page);
  await expect(
    nav.getByRole("button", { name: new RegExp(`^${P.ALL_NOTES} ${all}$`) }),
  ).toHaveAttribute("aria-pressed", "true");
  // The kinds that carry a note, in kind order, each closed, with its count.
  const kinds = nav.getByRole("button", { expanded: false });
  await expect(kinds).toHaveText([
    "Customers5",
    "Partners2",
    "Vendors2",
    "Solutions2",
    "Subjects3",
  ]);
  await expect(
    nav.getByRole("button", { name: `${P.NO_TOPIC} ${all - withTopics}` }),
  ).toBeVisible();
  await expect(
    nav.getByRole("button", { name: /^Harbor Logistics/ }),
  ).toHaveCount(0);

  await nav.getByRole("button", { name: /^Customers/ }).click();
  await expect(nav.getByRole("button", { name: /^Customers/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    nav.getByRole("button", { name: /^Harbor Logistics/ }),
  ).toHaveText("Harbor Logistics3");
  await expect(
    nav.getByRole("button", { name: /^Northfield Foods/ }),
  ).toHaveText("Northfield Foods2");

  await nav.getByRole("button", { name: /^Harbor Logistics/ }).click();
  await expect(
    nav.getByRole("button", { name: /^Harbor Logistics/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(listHeading(page, "Harbor Logistics")).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(3);
  await expect(
    noteLinks(page).filter({ hasText: "Scope and assumptions" }),
  ).toHaveCount(1);

  await nav.getByRole("button", { name: /^No topic/ }).click();
  await expect(listHeading(page, P.NO_TOPIC)).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(all - withTopics);

  await switchGroup(page).getByRole("button", { name: P.BY_FOLDERS }).click();
  await expect(
    folders(page).getByRole("button", { name: /^All notes/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(listHeading(page, "All notes")).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(all);

  await page.waitForTimeout(400);
  expect(requests()).toEqual([]);
});

test("the topic and the switch survive choosing a note", async ({ page }) => {
  await open(page);
  await switchGroup(page).getByRole("button", { name: P.BY_TOPICS }).click();
  const nav = topicNav(page);
  await nav.getByRole("button", { name: /^Customers/ }).click();
  await nav.getByRole("button", { name: /^Harbor Logistics/ }).click();
  await noteLinks(page).filter({ hasText: "Kickoff notes" }).click();
  await expect(page).toHaveURL(/note=/);
  await expect(
    switchGroup(page).getByRole("button", { name: P.BY_TOPICS }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(noteLinks(page)).toHaveCount(3);
  await expect(listHeading(page, "Harbor Logistics")).toBeVisible();

  await expect(
    nav.getByRole("button", { name: /^Harbor Logistics/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the kinds open and close without a request, and the text filter narrows a topic", async ({
  page,
}) => {
  await open(page);
  const requests = watch(page);
  await switchGroup(page).getByRole("button", { name: P.BY_TOPICS }).click();
  const nav = topicNav(page);
  await nav.getByRole("button", { name: /^Subjects/ }).click();
  await nav.getByRole("button", { name: /^Pricing/ }).click();
  await expect(noteLinks(page)).toHaveCount(3);
  await page.getByRole("searchbox", { name: "Filter notes" }).fill("workshop");
  await expect(noteLinks(page)).toHaveCount(1);
  await nav.getByRole("button", { name: /^Subjects/ }).click();
  await expect(nav.getByRole("button", { name: /^Pricing/ })).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(requests()).toEqual([]);
});

test("a note's chips are its topics in order, with their kind", async ({
  page,
}) => {
  await open(page, `?note=${SCOPE}`);
  // Inline in the action row: no heading of their own.
  await expect(topicsSection(page).getByRole("heading")).toHaveCount(0);
  expect(await chipNames(page)).toEqual([
    "Harbor Logistics",
    "Route optimisation",
    "Pricing",
    "Bluewater Partners",
    "Survey Kit Co",
  ]);
  await expect(chips(page).first()).toContainText("Customers");
  await expect(chips(page).nth(1)).toContainText("Solutions");
  await expect(chips(page).nth(2)).toContainText("Subjects");
  await expect(chips(page).nth(3)).toContainText("Partners");
  await expect(chips(page).nth(4)).toContainText("Vendors");
  // Five topics: × on each, no + Topic.
  await expect(
    topicsSection(page).getByRole("button", { name: /^Remove / }),
  ).toHaveCount(5);
  await expect(
    topicsSection(page)
      .getByRole("button", { name: /^Remove / })
      .first(),
  ).toHaveText("×");
  await expect(addTopicButton(page)).toHaveCount(0);
  // The chips follow the sharing control, and ⋯ follows them, in one row.
  const order = await page
    .getByRole("button", { name: /^Sharing: / })
    .evaluate((pill, label) => {
      const section = pill
        .closest("header")
        ?.querySelector(`section[aria-label="${label}"]`);
      return {
        sameRow: !!section?.parentElement?.contains(pill),
        after: !!(
          section &&
          pill.compareDocumentPosition(section) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ),
      };
    }, P.TOPICS_HEADING);
  expect(order).toEqual({ sameRow: true, after: true });
  const section = await topicsSection(page).boundingBox();
  const more = await moreButton(page).boundingBox();
  expect(more!.x).toBeGreaterThan(section!.x);
});

test("Remove takes a topic off at once, says so and records one call", async ({
  page,
}) => {
  await open(page, `?note=${INTERVIEW_1}`);
  expect(await chipNames(page)).toEqual([
    "Harbor Logistics",
    "Route optimisation",
  ]);
  await removeButton(page, "Harbor Logistics").click();
  await expect(status(page)).toHaveText(P.removed("Harbor Logistics"));
  expect(await chipNames(page)).toEqual(["Route optimisation"]);
  // The focus lands on the next chip's ×.
  await expect(removeButton(page, "Route optimisation")).toBeFocused();
  expect(await calls(page)).toEqual([
    {
      name: "detachTopic",
      args: [INTERVIEW_1, topicId("Harbor Logistics")],
    },
  ]);
  // The last one: no chip is left, and no words say so; + Topic takes the focus.
  await removeButton(page, "Route optimisation").click();
  await expect(status(page)).toHaveText(P.removed("Route optimisation"));
  await expect(chips(page)).toHaveCount(0);
  await expect(topicsSection(page)).not.toContainText("No topics");
  await expect(addTopicButton(page)).toBeFocused();
  expect(await calls(page)).toHaveLength(2);
});

test("removing the last chip of several moves the focus to the one before", async ({
  page,
}) => {
  await open(page, `?note=${SCOPE}`);
  await removeButton(page, "Survey Kit Co").click();
  await expect(status(page)).toHaveText(P.removed("Survey Kit Co"));
  await expect(removeButton(page, "Bluewater Partners")).toBeFocused();
  // Under five now, + Topic is there, and its picker offers the removed topic.
  await expect(addTopicButton(page)).toBeVisible();
  await addTopicButton(page).click();
  await expect(pickable(page)).toHaveText([
    "Northfield Foods",
    "Survey Kit Co",
  ]);
});

test("+ Topic offers the topics the note does not carry, by kind, and adds the chosen one", async ({
  page,
}) => {
  await open(page, `?note=${KICKOFF}`);
  const requests = watch(page);
  expect(await chipNames(page)).toEqual(["Harbor Logistics"]);
  await expect(picker(page)).toHaveCount(0);
  await addTopicButton(page).click();
  await expect(addTopicButton(page)).toHaveAttribute("aria-expanded", "true");
  // The search field takes the focus.
  await expect(findTopic(page)).toBeFocused();
  const kinds = picker(page).getByRole("group");
  await expect(kinds).toHaveCount(5);
  expect(
    await kinds.evaluateAll((els) =>
      els.map((e) => e.firstElementChild?.textContent ?? ""),
    ),
  ).toEqual(["Customers", "Partners", "Vendors", "Solutions", "Subjects"]);
  await expect(pickable(page)).toHaveText([
    "Northfield Foods",
    "Bluewater Partners",
    "Survey Kit Co",
    "Route optimisation",
    "Pricing",
  ]);
  // Opening it is client state only.
  expect(requests()).toEqual([]);
  await picker(page).getByRole("button", { name: "Pricing" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(addTopicButton(page)).toBeFocused();
  await expect(status(page)).toHaveText(P.added("Pricing"));
  expect(await chipNames(page)).toEqual(["Harbor Logistics", "Pricing"]);
  expect(await calls(page)).toEqual([
    { name: "addTopic", args: [KICKOFF, topicId("Pricing")] },
  ]);
  await addTopicButton(page).click();
  await expect(pickable(page)).toHaveCount(4);
});

test("the topic picker filters by its text, says when nothing matches and closes with Escape", async ({
  page,
}) => {
  await open(page, `?note=${KICKOFF}`);
  await addTopicButton(page).click();
  await findTopic(page).fill("  sURVEY ");
  await expect(pickable(page)).toHaveText(["Survey Kit Co"]);
  await expect(picker(page).getByRole("group")).toHaveCount(1);
  await findTopic(page).fill("zzz");
  await expect(pickable(page)).toHaveCount(0);
  await expect(picker(page)).toContainText(P.NO_TOPIC_MATCHES);
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(addTopicButton(page)).toBeFocused();
  await expect(addTopicButton(page)).toHaveAttribute("aria-expanded", "false");
  expect(await calls(page)).toEqual([]);
});

test("a refused add or remove says so and leaves the chips as they were", async ({
  page,
}) => {
  await open(page, `?fail=1&note=${KICKOFF}`);
  await pickTopic(page, "Northfield Foods");
  await expect(topicsSection(page).getByRole("alert")).toHaveText(P.REFUSED);
  expect(await chipNames(page)).toEqual(["Harbor Logistics"]);
  await removeButton(page, "Harbor Logistics").click();
  await expect(topicsSection(page).getByRole("alert")).toHaveText(P.REFUSED);
  expect(await chipNames(page)).toEqual(["Harbor Logistics"]);
  await expect(removeButton(page, "Harbor Logistics")).toBeFocused();
  await expect(status(page)).toHaveText("");
  expect(await calls(page)).toHaveLength(2);
});

test("while a change runs, another press does nothing", async ({ page }) => {
  await open(page, `?slow=1&note=${INTERVIEW_1}`);
  await removeButton(page, "Harbor Logistics").click();
  await expect(removeButton(page, "Route optimisation")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await removeButton(page, "Route optimisation").evaluate((el: HTMLElement) =>
    el.click(),
  );
  await removeButton(page, "Harbor Logistics").evaluate((el: HTMLElement) =>
    el.click(),
  );
  await expect(status(page)).toHaveText(P.removed("Harbor Logistics"));
  expect(await chipNames(page)).toEqual(["Route optimisation"]);
  expect(await calls(page)).toEqual([
    {
      name: "detachTopic",
      args: [INTERVIEW_1, topicId("Harbor Logistics")],
    },
  ]);
});

test("a colleague's note shows its chips and nothing to change", async ({
  page,
}) => {
  await open(page, `?tab=shared&note=${SHARED_SITE_VISIT}`);
  expect(await chipNames(page)).toEqual(["Harbor Logistics"]);
  // Chips without ×, and no + Topic.
  await expect(topicsSection(page).getByRole("button")).toHaveCount(0);
  await expect(addTopicButton(page)).toHaveCount(0);
  // And no switch, as there is no folder column.
  await expect(switchGroup(page)).toHaveCount(0);
  // Without topics there is no section at all.
  await open(page, `?tab=shared&note=${SHARED_REPORTING}`);
  await expect(topicsSection(page)).toHaveCount(0);
});

test("a note with no topics of one's own offers to add one", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  // No chips and no words for their absence: + Topic alone.
  await expect(chips(page)).toHaveCount(0);
  await expect(topicsSection(page)).toHaveText(P.ADD_TOPIC_BUTTON);
  await addTopicButton(page).click();
  await expect(pickable(page)).toHaveCount(DATA.topics.length);
});

test("+ Topic finds and adds a topic; × removes it", async ({ page }) => {
  // Kickoff notes carries one topic (Harbor Logistics), so + Topic is offered.
  await open(page, `?note=${KICKOFF}`);
  expect(await chipNames(page)).toEqual(["Harbor Logistics"]);
  await addTopicButton(page).click();
  await findTopic(page).fill("route");
  await expect(pickable(page)).toHaveText(["Route optimisation"]);
  await pickable(page).first().click();
  await expect(status(page)).toHaveText(P.added("Route optimisation"));
  expect(await chipNames(page)).toEqual([
    "Harbor Logistics",
    "Route optimisation",
  ]);
  await expect(chips(page).nth(1)).toContainText("Solutions");
  expect(await calls(page)).toEqual([
    { name: "addTopic", args: [KICKOFF, topicId("Route optimisation")] },
  ]);

  await removeButton(page, "Route optimisation").click();
  await expect(status(page)).toHaveText(P.removed("Route optimisation"));
  expect(await chipNames(page)).toEqual(["Harbor Logistics"]);
  expect(await calls(page)).toEqual([
    { name: "addTopic", args: [KICKOFF, topicId("Route optimisation")] },
    {
      name: "detachTopic",
      args: [KICKOFF, topicId("Route optimisation")],
    },
  ]);
});

test("by keyboard: the switch, a kind, a topic and the chips are reached by Tab and worked by Enter or Space", async ({
  page,
}) => {
  await open(page);
  const nav = topicNav(page);
  await switchGroup(page).getByRole("button", { name: P.BY_FOLDERS }).focus();
  await page.keyboard.press("Tab");
  await expect(
    switchGroup(page).getByRole("button", { name: P.BY_TOPICS }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    switchGroup(page).getByRole("button", { name: P.BY_TOPICS }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("button", { name: /^All notes/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("button", { name: /^Customers/ })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(nav.getByRole("button", { name: /^Customers/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.keyboard.press("Tab");
  await expect(
    nav.getByRole("button", { name: /^Harbor Logistics/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(listHeading(page, "Harbor Logistics")).toBeVisible();
  await expect(noteLinks(page)).toHaveCount(3);

  // The chips: ×, ×, + Topic; Space opens the picker on its search field, Tab reaches the
  // first topic and Space adds it.
  await page.goto(`/dev/vault?note=${INTERVIEW_1}`, {
    waitUntil: "networkidle",
  });
  await removeButton(page, "Harbor Logistics").focus();
  await page.keyboard.press("Tab");
  await expect(removeButton(page, "Route optimisation")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(addTopicButton(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(findTopic(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    picker(page).getByRole("button", { name: "Northfield Foods" }),
  ).toBeFocused();
  await page.keyboard.press("Space");
  await expect(status(page)).toHaveText(P.added("Northfield Foods"));
  await removeButton(page, "Harbor Logistics").focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(P.removed("Harbor Logistics"));
  await expect(removeButton(page, "Route optimisation")).toBeFocused();
});

test("at 390 px the column and the chips stay inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, `?note=${SCOPE}`);
  // Narrow: the switch and the topic list are in the list title's picker.
  const pick = page.getByRole("button", { name: /^Choose folder or topic/ });
  await pick.click();
  await switchGroup(page).getByRole("button", { name: P.BY_TOPICS }).click();
  const nav = topicNav(page);
  await nav.getByRole("button", { name: /^Customers/ }).click();
  for (const control of [
    switchGroup(page),
    nav.getByRole("button", { name: /^Customers/ }),
    nav.getByRole("button", { name: /^Harbor Logistics/ }),
    nav.getByRole("button", { name: /^No topic/ }),
    ...(await chips(page).all()),
    ...(await topicsSection(page).getByRole("button").all()),
  ]) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect((await scrolls(page)).across).toBe(false);
  await page.keyboard.press("Escape");
  await removeButton(page, "Survey Kit Co").click();
  await expect(status(page)).toHaveText(P.removed("Survey Kit Co"));
  await addTopicButton(page).click();
  for (const control of [
    addTopicButton(page),
    findTopic(page),
    ...(await pickable(page).all()),
  ]) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect((await scrolls(page)).across).toBe(false);
});

test("with no note open the vault shows its summary", async ({ page }) => {
  await open(page);
  const pane = preview(page);
  await expect(pane.getByRole("heading", { level: 2 })).toHaveText(
    DATA.workspaces[0]!.name,
  );
  await expect(pane).toContainText(/\d+\s*notes/);
  await expect(pane.getByRole("link")).toHaveCount(6);
});

test("Review shows the held notes", async ({ page }) => {
  await open(page);
  await preview(page).getByRole("button", { name: "Review" }).click();
  await expect(
    folders(page).getByRole("button", { name: /^Held, waiting for you/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(noteLinks(page)).toHaveCount(
    DATA.notes.filter(
      (n) => n.quarantined && n.workspace_id === DATA.workspaces[0]!.id,
    ).length,
  );
});

test("Shared with me says how many notes from how many colleagues", async ({
  page,
}) => {
  await open(page, "?tab=shared");
  await expect(preview(page)).toContainText(/\d+ notes? from \d+ colleagues?/);
});
