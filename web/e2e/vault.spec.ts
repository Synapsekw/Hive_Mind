import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  fixturePreview,
  fixtureVault,
  GROUP_FOLDER,
  HOSTILE_NOTE_ID,
} from "../src/vault/fixture";
import {
  DELETE_FAILED,
  DELETE_QUESTION,
  DELETED,
  folderSentence,
  keepLinkName,
  LINKED_WITH,
  noteSentence,
  UNLINK_FAILED,
  UNLINK_GROUP,
  unlinkName,
  unlinkQuestion,
} from "../src/vault/sentences";
import * as T from "../src/vault/importText";
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

// The default look, and a light, vivid one whose glass and type differ the most from it.
const LOOKS = [undefined, "aurora.light.vivid.classic"] as const;
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

test("the vault sits on frosted glass", async ({ page }) => {
  await open(page, `?note=${README}`);
  const blur = await page
    .getByRole("main", { name: "Vault" })
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return (
        cs.backdropFilter ||
        cs.getPropertyValue("-webkit-backdrop-filter") ||
        ""
      );
    });
  expect(blur).toContain("blur(30px)");
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
  await setLook(context, "aurora.light.vivid.classic");
  await open(page, `?note=${README}`);
  await page.getByRole("button", { name: /^Sharing: / }).click();
  const look = await noteControl(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, background: cs.backgroundColor };
  });
  expect(look.color).not.toBe("rgb(255, 255, 255)");
  expect(look.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(look.background).not.toBe("transparent");
  // A reset scope: the light card's text tokens, not the chrome's white.
  await expect(noteControl(page)).toHaveAttribute("data-scope", "reset");
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
  await expect(control.getByRole("radio", { name: "No rule" })).toBeVisible();
  expect(await calls(page)).toEqual([
    { name: "preview", args: [DATA.workspaces[0]!.id, GROUP_FOLDER] },
  ]);
});

test("a note under a folder rule offers Same as folder", async ({ page }) => {
  await open(page, `?note=${idOf("Client list")}`);
  await page.getByRole("button", { name: /^Sharing: / }).click();
  await expect(
    noteControl(page).getByRole("radio", { name: "Same as folder" }),
  ).toBeChecked();
  await expect(
    noteControl(page).getByRole("radio", { name: "No rule" }),
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
  await expect(preview).toContainText("Opened by a link");
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
      await folders(page)
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
  await deleteButton(page).click();
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await page.waitForTimeout(600);
  await deleteButton(page).click();
}

test("your own note has Delete, a held one too; a colleague's has none", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await expect(deleteButton(page)).toBeVisible();
  await expect(deleteButton(page)).toHaveText("Delete");
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);

  await open(page, `?note=${HELD}`);
  await expect(
    preview(page).getByRole("button", { name: "Release" }),
  ).toBeVisible();
  await expect(deleteButton(page)).toBeVisible();

  await open(page, "?tab=shared");
  await noteLinks(page).filter({ hasText: "Site visit" }).click();
  await expect(openTitle(page, "Site visit")).toBeVisible();
  await expect(preview(page).getByRole("button")).toHaveCount(0);
  // Opened by a link: the link can be ended, the note cannot be deleted or shared.
  await noteLinks(page).filter({ hasText: "Pricing options" }).click();
  await expect(openTitle(page, "Pricing options")).toBeVisible();
  await expect(deleteButton(page)).toHaveCount(0);
  await expect(preview(page).getByRole("button")).toHaveCount(1);
  await expect(preview(page).getByRole("button")).toHaveText("Unlink");
});

test("Delete asks first; Keep puts everything back", async ({ page }) => {
  await open(page, `?note=${README}`);
  await deleteButton(page).click();
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await expect(deleteButton(page)).toHaveCount(1);
  await expect(deleteButton(page)).toHaveText("Delete");
  await expect(keepButton(page)).toHaveText("Keep");
  // The safe answer holds the focus.
  await expect(keepButton(page)).toBeFocused();

  await keepButton(page).click();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(keepButton(page)).toHaveCount(0);
  await expect(deleteButton(page)).toBeFocused();
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
    await deleteButton(page).click();
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
    await deleteButton(page).click();
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => (window as unknown as { __hits: string[] }).__hits,
      ),
    ).toEqual(["page: Delete note", "question: Delete note"]);
    expect(await calls(page)).toEqual([]);
    await expect(preview(page)).toContainText(DELETE_QUESTION);
    await expect(openTitle(page, "Readme")).toBeVisible();
  });
}

test("a burst of presses on the question's Delete deletes nothing; a later one deletes", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await deleteButton(page).click();
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
  await deleteButton(page).click();
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
  await expect(preview(page)).toContainText("Choose a note to read it.");
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
  await expect(deleteButton(page)).toBeFocused();
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
  await expect(preview(page)).toContainText("Choose a note to read it.");
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
  await expect(preview(page)).toContainText("Choose a note to read it.");
  await expect(noteLinks(page).first()).toBeFocused();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(noteLinks(page)).toHaveCount(DATA.notes.length - 2);
  await expect(noteLinks(page).first()).toBeFocused();
});

test("by keyboard: Delete follows the sharing control; Escape answers Keep", async ({
  page,
}) => {
  await open(page, `?note=${README}`);
  await page.getByRole("button", { name: /^Sharing: / }).focus();
  await page.keyboard.press("Tab");
  await expect(deleteButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await expect(keepButton(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(deleteButton(page)).toBeFocused();

  // Delete comes before Keep; Enter on it after the guard deletes.
  await page.keyboard.press("Enter");
  await expect(keepButton(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(deleteButton(page)).toBeFocused();
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText(DELETED);
  expect(await calls(page)).toEqual([{ name: "deleteNote", args: [README] }]);
});

test("opening another note closes a pending question", async ({ page }) => {
  await open(page, `?note=${README}`);
  await deleteButton(page).click();
  await expect(preview(page)).toContainText(DELETE_QUESTION);
  await noteLinks(page).filter({ hasText: "Client list" }).click();
  await expect(openTitle(page, "Client list")).toBeVisible();
  await expect(preview(page)).not.toContainText(DELETE_QUESTION);
  await expect(deleteButton(page)).toBeVisible();
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
      await deleteButton(page).click();
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
  // After the sharing control and Delete, before the note's text.
  const order = await page.evaluate(() => {
    const at = (sel: string) => document.querySelector(sel)!;
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const list = at('section[aria-label="Note"] section');
    return [
      before(at('button[aria-label^="Sharing: "]'), list),
      before(at('button[aria-label="Delete note"]'), list),
      before(list, at('section[aria-label="Note"] article > :last-child')),
    ];
  });
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

const importButton = (page: Page) =>
  page.getByRole("button", { name: T.IMPORT, exact: true });
const importPanel = (page: Page) =>
  page.getByRole("region", { name: /Import|Ready/ });
const panelNamed = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

async function pick(page: Page, dir: string) {
  await importButton(page).click();
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

test("the import panel opens in place, and Escape or Close puts the focus back", async ({
  page,
}) => {
  await open(page);
  const urls = watch(page);
  await importButton(page).click();
  const panel = panelNamed(page, T.IMPORT);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: T.IMPORT })).toBeFocused();
  await expect(importButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("button", { name: T.CHOOSE })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(importButton(page)).toBeFocused();
  await importButton(page).click();
  await panel.getByRole("button", { name: /^Close/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(importButton(page)).toBeFocused();
  expect(urls()).toEqual([]);
  expect(await calls(page)).toEqual([]);
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
  await importButton(page).click();
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
  // While it runs: no closing, by Escape, by Close or by the button that opened it.
  await page.keyboard.press("Escape");
  await running
    .getByRole("button", { name: /^Close/ })
    .evaluate((el: HTMLElement) => el.click());
  await importButton(page).evaluate((el: HTMLElement) => el.click());
  await expect(running).toBeVisible();
  expect(
    await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    }),
  ).toBe(true);
  await expect(status).toHaveText(T.progress(50, 60));
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Created 60", { exact: true })).toBeVisible();
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
  await expect(
    done.getByRole("link", { name: T.openWorkspace("Sixty") }),
  ).toBeVisible();
});

test("at 390 px the import panel and its controls stay inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, "?failbatch=1");
  await importButton(page).scrollIntoViewIfNeeded();
  expect(await importButton(page).evaluate(inView)).toBe(true);
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
