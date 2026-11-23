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
  noteSentence,
} from "../src/vault/sentences";
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
  for (const title of ["Pricing options", "Site visit"]) {
    await noteLinks(page).filter({ hasText: title }).click();
    await expect(openTitle(page, title)).toBeVisible();
    await expect(preview(page).getByRole("button")).toHaveCount(0);
  }
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
    await page.waitForTimeout(1000);
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
