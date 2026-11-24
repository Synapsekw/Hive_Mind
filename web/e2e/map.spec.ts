import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { fixturePayload, HOSTILE_TITLE } from "../src/map/fixture";
import { setLook } from "./look";

/**
 * Folds both sides, so the stage is wide enough for the filter bar to show its chips: with the
 * rail and panel open, the bar's cap leaves room for one or two, and the rest give way to "+N".
 */
async function setFold(context: BrowserContext, value: string) {
  await context.addCookies([
    {
      name: "hive-fold",
      value,
      url: "http://localhost:3100",
      sameSite: "Lax",
    },
  ]);
}

const roomForChips = (context: BrowserContext) => setFold(context, "shut.shut");

/** The Today button in the top bar, which opens and closes the side panel. */
const todayButton = (page: Page) =>
  page.getByRole("button", { name: /^Today, \d+ notes? written or changed/ });

const VIEWS = ["Rings", "Timeline", "Orbit"];

async function open(page: Page) {
  page.on("dialog", (d) => {
    throw new Error(`unexpected dialog: ${d.message()}`);
  });
  await page.goto("/dev/map", { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Hive map" })).toBeVisible();
}

const viewButton = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name, exact: true });

const rail = (page: Page) =>
  page.getByRole("complementary", { name: "Details" });

/** Selects a dot the way a keyboard user does: focus its hidden button, press Enter. */
async function pick(page: Page, dot: Locator) {
  await dot.focus();
  await page.keyboard.press("Enter");
}

/** A dot's point on screen, from its box coordinates, with the camera at Fit. */
async function dotPoint(page: Page, dot: Locator) {
  // The hidden list's data-x/data-y follow the canvas once a glide has landed.
  const view = await page
    .locator("[data-map-canvas]")
    .getAttribute("data-view");
  await expect(
    page.locator(`ul[aria-label="Items on the map"][data-view="${view}"]`),
  ).toBeAttached({ timeout: 5000 });
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-animating",
    { timeout: 5000 },
  );
  const canvas = (await page.locator("[data-map-canvas]").boundingBox())!;
  const x = Number(await dot.getAttribute("data-x"));
  const y = Number(await dot.getAttribute("data-y"));
  // At fit (k = 1) the 1000 x 760 box is centred in the canvas.
  const s = Math.min(canvas.width / 1000, canvas.height / 760);
  return {
    x: canvas.x + (canvas.width - 1000 * s) / 2 + x * s,
    y: canvas.y + (canvas.height - 760 * s) / 2 + y * s,
  };
}

const arrangeGroup = (page: Page) =>
  page.getByRole("group", { name: "Arrange by" });

const arrangeButton = (page: Page, name: string) =>
  arrangeGroup(page).getByRole("button", { name, exact: true });

/** The filter bar's open list; its name follows the arrangement (Folders, Clusters, Months, Topics). */
const groups = (page: Page, name = "Folders") =>
  page.getByRole("group", { name, exact: true });

/** A filter bar list's button: its name may carry a ", N chosen" tail. */
const listButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}(\\s|,|$)`) });

/** Opens a filter list and returns its group. */
async function openList(page: Page, name: string) {
  const button = listButton(page, name);
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  const list = groups(page, name);
  await expect(list).toBeVisible();
  return list;
}

const row = (list: Locator, name: string | RegExp) =>
  list.getByRole("checkbox", { name });

const countText = (page: Page) =>
  page.getByRole("status").filter({ hasText: /shown$/ });

/** The notes and files that are lit, counted from the hidden list. */
const litItems = (page: Page) =>
  page.locator(
    '[data-map-dot][data-lit]:is([data-kind="note"], [data-kind="file"])',
  );

/** The topic number of each lit note or file, as a sorted set. */
async function litTopics(page: Page): Promise<string[]> {
  const t = await litItems(page).evaluateAll((els) => [
    ...new Set(els.map((e) => e.getAttribute("data-topic") ?? "")),
  ]);
  return t.sort();
}

/** Every dot's position as one string, to tell whether anything moved. */
const positions = (page: Page) =>
  page
    .locator("[data-map-dot]")
    .evaluateAll((els) =>
      els
        .map((e) => `${e.getAttribute("data-x")},${e.getAttribute("data-y")}`)
        .join(";"),
    );

/** Waits for the canvas to come to rest (no glide running). */
async function settle(page: Page) {
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-animating",
    { timeout: 6000 },
  );
}

test("the map opens on rings", async ({ page }) => {
  await open(page);
  await expect(viewButton(page, "Rings")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Circle", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-view",
    "rings",
  );
});

test("the wheel zooms, a drag pans without selecting, and Fit returns to 100%", async ({
  page,
}) => {
  await open(page);
  const zoom = page.getByRole("group", { name: "Zoom" });
  await expect(zoom).toContainText("100%");
  // A drag that starts on a dot pans; it never selects that dot.
  const hub = page.locator('[data-map-dot][data-kind="hub"]').first();
  const p = await dotPoint(page, hub);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 100, p.y + 50, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-map-dot][aria-pressed="true"]')).toHaveCount(
    0,
  );
  const box = (await page.locator("[data-map-stage]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect(zoom).not.toContainText("100%");
  await zoom.getByRole("button", { name: "Fit" }).click();
  await expect(zoom).toContainText("100%");
});

test("a double-click on a dot zooms in and leaves it selected", async ({
  page,
}) => {
  await open(page);
  await viewButton(page, "Rings").click();
  const hub = page.locator('[data-map-dot][data-kind="hub"]').first();
  const p = await dotPoint(page, hub);
  await page.mouse.dblclick(p.x, p.y);
  await expect(hub).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Zoom" })).not.toContainText(
    "100%",
  );
});

test("an idle map breathes at a calm rate, not every frame", async ({
  page,
}) => {
  await open(page);
  const canvas = page.locator("[data-map-canvas]");
  await expect(canvas).toHaveAttribute("data-ambient", "");
  await expect(canvas).not.toHaveAttribute("data-animating");
});

test("hovering a dot peeks at it and makes it hot", async ({ page }) => {
  await open(page);
  await viewButton(page, "Rings").click();
  const hub = page.locator('[data-map-dot][data-kind="hub"]').first();
  const p = await dotPoint(page, hub);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator("[data-map-peek]")).toBeVisible();
  await expect(page.locator("[data-map-peek]")).toContainText("Topic");
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-hot",
    "",
  );
  await page.mouse.move(5, 5);
  await expect(page.locator("[data-map-peek]")).toBeHidden();
});

test("a locked dot's peek shows only that it is private", async ({ page }) => {
  await open(page);
  await page
    .locator('[data-map-dot][data-kind="note"][data-locked]')
    .first()
    .focus();
  const peek = page.locator("[data-map-peek]");
  await expect(peek).toContainText("Private note");
  await expect(peek).toContainText("Not shared with you");
  const text = (await peek.innerText()).toLowerCase();
  for (const n of fixturePayload(Date.now()).nodes)
    if (n.title !== null) expect(text).not.toContain(n.title.toLowerCase());
});

test("rings at rest names no ring and has no At the hive panel", async ({
  page,
}) => {
  await open(page);
  await settle(page);
  await expect(page.getByLabel("At the hive")).toHaveCount(0);
  await expect(page.getByText("At the hive")).toHaveCount(0);
  // The map panel carries no "Agents" text of its own (the filter bar's Agents row is the one exception).
  const stray = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter(
        (e) =>
          !e.closest("[data-map-overlay]") &&
          [...e.childNodes].some(
            (c) => c.nodeType === 3 && c.textContent?.trim() === "Agents",
          ),
      )
      .map((e) => e.outerHTML.slice(0, 100)),
  );
  expect(stray).toEqual([]);
});

test("the index dot's peek says Groups with a count", async ({ page }) => {
  await open(page);
  await page.locator('[data-map-dot][data-kind="root"]').focus();
  const peek = page.locator("[data-map-peek]");
  await expect(peek).toContainText("Index");
  await expect(peek).toContainText(/Groups\s*10/);
});

test("with reduced motion the map does not keep animating", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.waitForTimeout(1200);
  const canvas = page.locator("[data-map-canvas]");
  for (const name of ["Timeline", "Rings", "Orbit"]) {
    await viewButton(page, name).click();
    await page.waitForTimeout(400);
    await expect(canvas).not.toHaveAttribute("data-animating");
    await expect(canvas).not.toHaveAttribute("data-ambient");
    // Nothing is drawn on its own: no frame in a whole second.
    const frames = await page.evaluate(async () => {
      const proto = CanvasRenderingContext2D.prototype;
      const clear = proto.clearRect;
      let n = 0;
      proto.clearRect = function (...a: Parameters<typeof clear>) {
        if (this.canvas.hasAttribute("data-map-canvas")) n++;
        return clear.apply(this, a);
      };
      await new Promise((r) => setTimeout(r, 1000));
      proto.clearRect = clear;
      return n;
    });
    expect(frames).toBe(0);
  }
});

test("switching views glides the dots, then the map comes to rest", async ({
  page,
}) => {
  await open(page);
  const canvas = page.locator("[data-map-canvas]");
  await expect(canvas).not.toHaveAttribute("data-animating");
  await viewButton(page, "Timeline").click();
  await expect(canvas).toHaveAttribute("data-animating", "");
  await expect(canvas).not.toHaveAttribute("data-animating", {
    timeout: 4000,
  });
  // The hidden list followed once the dots landed.
  await expect(
    page.locator('ul[aria-label="Items on the map"][data-view="timeline"]'),
  ).toBeAttached();
});

test("orbit is drawn on the canvas and turns when dragged", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await viewButton(page, "Orbit").click();
  const canvas = page.locator("[data-map-canvas]");
  await expect(canvas).toHaveAttribute("data-view", "orbit");
  // The dots stay reachable by keyboard in Orbit.
  await expect(page.locator("[data-map-dot]").first()).toBeAttached();
  const before = await canvas.getAttribute("data-ry");
  const box = (await page.locator("[data-map-stage]").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-ry", before ?? "");
});

test("pointing at a dot on the canvas selects it", async ({ page }) => {
  await open(page);
  await viewButton(page, "Rings").click();
  const hub = page.locator('[data-map-dot][data-kind="hub"]').first();
  const p = await dotPoint(page, hub);
  await page.mouse.click(p.x, p.y);
  await expect(hub).toHaveAttribute("aria-pressed", "true");
});

test("the three views switch in the browser without a request", async ({
  page,
}) => {
  await open(page);
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));

  for (const name of VIEWS) {
    await viewButton(page, name).click();
    await expect(viewButton(page, name)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const other of VIEWS.filter((v) => v !== name))
      await expect(viewButton(page, other)).toHaveAttribute(
        "aria-pressed",
        "false",
      );
  }
  await viewButton(page, "Rings").click();
  const topics = await openList(page, "Folders");
  await row(topics, "DMT").click();
  await row(topics, "ADNOC").click();
  await row(await openList(page, "Kind"), "Notes").click();
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await page.waitForTimeout(500);

  const bad = seen.filter(
    (r) =>
      r.url().includes("/rest/") ||
      r.url().includes("/auth/") ||
      ["document", "fetch", "xhr"].includes(r.resourceType()),
  );
  expect(bad.map((r) => `${r.resourceType()} ${r.url()}`)).toEqual([]);
});

test("a locked dot shows only that it is private", async ({ page }) => {
  await open(page);
  const locked = page.locator('[data-map-dot][data-kind="note"][data-locked]');
  await pick(page, locked.first());
  await expect(rail(page)).toContainText("Private note");
  await expect(rail(page)).toContainText("has not shared this");

  const text = (await rail(page).innerText()).toLowerCase();
  const titles = new Set(
    fixturePayload(Date.now())
      .nodes.filter((n) => n.title !== null)
      .map((n) => n.title!.toLowerCase()),
  );
  for (const t of titles) expect(text).not.toContain(t);
});

test("a readable note links to the vault and a locked one does not", async ({
  page,
}) => {
  await open(page);
  const note = fixturePayload(Date.now()).nodes.find(
    (n) => n.title === HOSTILE_TITLE,
  )!;
  await pick(page, page.locator('[data-map-dot][aria-label^="<img src=x"]'));
  await expect(
    rail(page).getByRole("link", { name: "Open in vault" }),
  ).toHaveAttribute("href", `/vault?note=${note.id}`);

  await pick(
    page,
    page.locator('[data-map-dot][data-kind="note"][data-locked]').first(),
  );
  await expect(rail(page)).toContainText("has not shared this");
  await expect(
    rail(page).getByRole("link", { name: "Open in vault" }),
  ).toHaveCount(0);
});

test("a hostile title is shown as text", async ({ page }) => {
  await open(page);
  const dot = page.locator('[data-map-dot][aria-label^="<img src=x"]');
  await expect(dot).toHaveCount(1);
  await pick(page, dot);
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test("every dot is a labelled button", async ({ page }) => {
  await open(page);
  const counts: number[] = [];
  const hubs: number[] = [];
  for (const name of ["Rings", "Orbit"]) {
    await viewButton(page, name).click();
    const dots = page.locator("[data-map-dot]");
    const n = await dots.count();
    expect(n).toBeGreaterThan(250);
    counts.push(await dots.and(page.locator(":not([data-kind=hub])")).count());
    hubs.push(await page.locator('[data-map-dot][data-kind="hub"]').count());
    const bad = await dots.evaluateAll((els) =>
      els
        .filter(
          (e) =>
            e.tagName !== "BUTTON" ||
            (e.getAttribute("aria-label") ?? "").trim() === "",
        )
        .map((e) => e.outerHTML.slice(0, 120)),
    );
    expect(bad).toEqual([]);
  }
  // A hub is named as a group.
  await expect(
    page.locator('[data-map-dot][data-kind="hub"]').first(),
  ).toHaveAttribute("aria-label", /, group$/);
  // One layer of dots at a time: the orbit view does not keep the flat dots mounted. Orbit names
  // at most 8 groups (the rest fold into "Other topics"), Rings up to 12, so only hubs differ.
  expect(counts[1]).toBe(counts[0]);
  expect(hubs).toEqual([10, 8]);
});

test("the map is a solid card with no blur", async ({ page }) => {
  await open(page);
  const flat = await page
    .getByRole("main", { name: "Hive map" })
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

test("no control on the map is a pill", async ({ page }) => {
  await open(page);
  // Select something so the detail panel's buttons and the selected ring are drawn too.
  await pick(page, page.locator('[data-map-dot][aria-label^="<img src=x"]'));
  const pills = await page.evaluate(() =>
    [...document.querySelectorAll("main *, main, aside *")]
      .filter((e) =>
        getComputedStyle(e).borderRadius.split(" ").includes("999px"),
      )
      .map((e) => e.outerHTML.slice(0, 100)),
  );
  expect(pills).toEqual([]);
});

/**
 * The canvas pixel at the centre of topic 0's hub (drawn solid in its topic colour) and the
 * computed --hue-1, both as [r, g, b].
 */
async function hubAndHue(page: Page) {
  await viewButton(page, "Rings").click();
  const hub = page.locator('[data-map-dot][data-kind="hub"][data-topic="0"]');
  const p = await dotPoint(page, hub);
  // The dots glide to the new view first.
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-animating",
    { timeout: 4000 },
  );
  await page.waitForTimeout(100);
  return page.evaluate(({ x, y }) => {
    const canvas =
      document.querySelector<HTMLCanvasElement>("[data-map-canvas]")!;
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    const px = canvas
      .getContext("2d")!
      .getImageData(
        Math.round((x - r.left) * dpr),
        Math.round((y - r.top) * dpr),
        1,
        1,
      ).data;
    const probe = document.createElement("span");
    const rgb = (value: string) => {
      probe.style.color = value;
      return (getComputedStyle(probe).color.match(/[\d.]+/g) ?? [])
        .map(Number)
        .slice(0, 3);
    };
    document.body.append(probe);
    const hue = rgb("var(--hue-1)");
    const brand = rgb("var(--brand)");
    const hub = rgb("var(--hub)");
    probe.remove();
    return { dot: [px[0], px[1], px[2]], hue, brand, hub };
  }, p);
}

test("in Rings a hub takes the theme's hub colour", async ({
  page,
  context,
}) => {
  await setLook(context, "aurora");
  await open(page);
  const aurora = await hubAndHue(page);
  expect(aurora.dot).toEqual(aurora.hub);
  expect(aurora.dot).not.toEqual(aurora.brand);

  await setLook(context, "honey");
  await open(page);
  const honey = await hubAndHue(page);
  expect(honey.dot).toEqual(honey.hub);
  expect(honey.dot).not.toEqual(aurora.dot);
});

for (const look of [undefined, "paper"])
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 1000 },
    { width: 1366, height: 768 },
    { width: 1280, height: 620 },
  ]) {
    test(`the whole screen fits a ${size.width} x ${size.height} window without scrolling${look ? ` (${look})` : ""}`, async ({
      page,
      context,
    }) => {
      if (look) await setLook(context, look);
      await page.setViewportSize(size);
      await open(page);
      for (const name of ["Rings", "Timeline"]) {
        await viewButton(page, name).click();
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
      }
      // Every dot of the map stays inside the panel.
      await viewButton(page, "Rings").click();
      await page.waitForTimeout(1100);
      const dots = await page.evaluate(() => {
        const main = document.querySelector("main")!.getBoundingClientRect();
        const rects = [...document.querySelectorAll("[data-map-dot]")].map(
          (d) => d.getBoundingClientRect(),
        );
        return {
          count: rects.length,
          outside: rects.filter(
            (r) =>
              r.top < main.top ||
              r.bottom > main.bottom ||
              r.left < main.left ||
              r.right > main.right,
          ).length,
        };
      });
      expect(dots.count).toBeGreaterThan(250);
      expect(dots.outside).toBe(0);
    });
  }

test("the side panel shows today, the 14-day line and what needs you", async ({
  page,
}) => {
  await open(page);
  await todayButton(page).click();
  const panel = rail(page);
  await expect(panel).toContainText("Today");
  await expect(panel.locator("svg[data-spark]")).toBeVisible();
  await expect(panel).toContainText("By person");
});

test("a fresh note is drawn in the top colour of the theme's ramp", async ({
  page,
}) => {
  await open(page);
  await settle(page);
  // The hostile note changed two hours ago, so it is at the freshest step of the ramp.
  const dot = page.locator('[data-map-dot][aria-label^="<img src=x"]');
  const p = await dotPoint(page, dot);
  const { px, fresh } = await page.evaluate(({ x, y }) => {
    const canvas =
      document.querySelector<HTMLCanvasElement>("[data-map-canvas]")!;
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    const d = canvas
      .getContext("2d")!
      .getImageData(
        Math.round((x - r.left) * dpr),
        Math.round((y - r.top) * dpr),
        1,
        1,
      ).data;
    const probe = document.createElement("span");
    probe.style.color = "var(--fresh-7)";
    document.body.append(probe);
    const c = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(
      Number,
    );
    probe.remove();
    return { px: [d[0]!, d[1]!, d[2]!], fresh: c.slice(0, 3) };
  }, p);
  // The dot is crisp, so allow only rounding off the exact ramp colour.
  for (let i = 0; i < 3; i++)
    expect(Math.abs(px[i]! - fresh[i]!)).toBeLessThanOrEqual(4);
});

test('"Arrange by" is visible in Rings and absent in Timeline and Orbit', async ({
  page,
}) => {
  await open(page);
  await expect(arrangeGroup(page)).toBeVisible();
  for (const name of ["Folder", "Links", "Time"])
    await expect(arrangeButton(page, name)).toBeVisible();
  await expect(arrangeButton(page, "Folder")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const name of ["Timeline", "Orbit"]) {
    await viewButton(page, name).click();
    await expect(viewButton(page, name)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(arrangeGroup(page)).toHaveCount(0);
    // Timeline and Orbit keep the plain "Topics" heading, and the hubs' kind entry says so too.
    await expect(listButton(page, "Topics")).toBeVisible();
    await expect(listButton(page, "Folders")).toHaveCount(0);
    const kinds = await openList(page, "Kind");
    await expect(row(kinds, "Topics")).toBeVisible();
    await listButton(page, "Kind").click();
  }
  await viewButton(page, "Rings").click();
  const kinds = await openList(page, "Kind");
  await expect(row(kinds, "Groups")).toBeVisible();
});

test("choosing Time regroups by month, moves the dots and sends no request", async ({
  page,
}) => {
  await open(page);
  await settle(page);
  const before = await positions(page);
  const seen: Request[] = [];
  page.on("request", (r) => seen.push(r));

  await arrangeButton(page, "Time").click();
  await expect(arrangeButton(page, "Time")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(listButton(page, "Months")).toBeVisible();
  await expect(listButton(page, "Folders")).toHaveCount(0);
  const months = await openList(page, "Months");
  await expect(months.getByRole("checkbox").first()).toContainText(
    /^Last 2 weeks/,
  );
  await listButton(page, "Months").click();
  await settle(page);
  expect(await positions(page)).not.toEqual(before);

  await arrangeButton(page, "Links").click();
  await expect(listButton(page, "Clusters")).toBeVisible();
  await settle(page);
  await page.waitForTimeout(300);

  const bad = seen.filter(
    (r) =>
      r.url().includes("/rest/") ||
      r.url().includes("/auth/") ||
      ["document", "fetch", "xhr"].includes(r.resourceType()),
  );
  expect(bad.map((r) => `${r.resourceType()} ${r.url()}`)).toEqual([]);
});

test("choosing Links clears a pinned group filter", async ({ page }) => {
  await open(page);
  const dmt = row(await openList(page, "Folders"), /^DMT/);
  await dmt.click();
  await expect(dmt).toHaveAttribute("aria-checked", "true");
  await expect(
    page.locator("[data-map-dot]:not([data-lit])").first(),
  ).toBeAttached();

  await arrangeButton(page, "Links").click();
  await expect(listButton(page, "Clusters")).toBeVisible();
  // The old arrangement's choice is gone: no chip, everything lit.
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  await expect(page.locator("[data-map-dot]:not([data-lit])")).toHaveCount(0);
});

test("a selected dot stays selected when the arrangement changes", async ({
  page,
}) => {
  await open(page);
  await pick(page, page.locator('[data-map-dot][aria-label^="<img src=x"]'));
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  await arrangeButton(page, "Time").click();
  await expect(listButton(page, "Months")).toBeVisible();
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  await expect(
    page.locator('[data-map-dot][aria-label^="<img src=x"]'),
  ).toHaveAttribute("aria-pressed", "true");
});

test("in a group the freshest note sits nearer the centre than the oldest", async ({
  page,
}) => {
  await open(page);
  await settle(page);
  // DMT is the biggest folder, so it is the first sector; its note titles are unique.
  const notes = fixturePayload(Date.now())
    .nodes.filter((n) => n.topic === "DMT" && n.kind === "note" && !n.locked)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const freshest = notes[0]!.title!;
  const oldest = notes[notes.length - 1]!.title!;
  const away = async (title: string) => {
    const dot = page.locator(
      `[data-map-dot][data-kind="note"][data-topic="0"][aria-label="${title}, note, DMT"]`,
    );
    await expect(dot).toHaveCount(1);
    const x = Number(await dot.getAttribute("data-x"));
    const y = Number(await dot.getAttribute("data-y"));
    return Math.hypot(x - 500, y - 380);
  };
  expect(await away(freshest)).toBeLessThan(await away(oldest));
});

test("choosing Rings after Orbit lets the map come to rest on Rings", async ({
  page,
}) => {
  await open(page);
  await viewButton(page, "Orbit").click();
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-view",
    "orbit",
  );
  await viewButton(page, "Rings").click();
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-view",
    "rings",
  );
  await settle(page);
  await expect(
    page.locator('ul[aria-label="Items on the map"][data-view="rings"]'),
  ).toBeAttached();
});

test("the arrange switch comes back after Timeline with its pill under the pressed button", async ({
  page,
}) => {
  await open(page);
  await arrangeButton(page, "Time").click();
  await viewButton(page, "Timeline").click();
  await expect(arrangeGroup(page)).toHaveCount(0);
  await viewButton(page, "Rings").click();
  await expect(arrangeGroup(page)).toBeVisible();
  await expect(arrangeButton(page, "Time")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const pill = arrangeGroup(page).locator("span[aria-hidden]").first();
  await expect
    .poll(
      async () => {
        const [a, b] = await Promise.all([
          pill.boundingBox(),
          arrangeButton(page, "Time").boundingBox(),
        ]);
        if (!a || !b) return Infinity;
        return Math.max(
          Math.abs(a.x - b.x),
          Math.abs(a.x + a.width - (b.x + b.width)),
        );
      },
      { timeout: 4000 },
    )
    .toBeLessThanOrEqual(2);
});

test("the top bar holds its controls at 1280 px with a dot selected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await pick(page, page.locator('[data-map-dot][aria-label^="<img src=x"]'));
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  const bar = page.locator('main[aria-label="Hive map"] > div').first();
  const barBox = (await bar.boundingBox())!;
  const children = await bar.locator("> *").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
  );
  expect(children.length).toBeGreaterThan(2);
  for (const c of children) {
    expect(c.left).toBeGreaterThanOrEqual(barBox.x - 0.5);
    expect(c.right).toBeLessThanOrEqual(barBox.x + barBox.width + 0.5);
  }
  const boxes = [
    await page.getByRole("group", { name: "View" }).boundingBox(),
    await arrangeGroup(page).boundingBox(),
    await page.getByPlaceholder("Search").boundingBox(),
  ];
  boxes.forEach((b) => expect(b).not.toBeNull());
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5;
      expect(apart, `controls ${i} and ${j} overlap`).toBe(true);
    }
});

test("a pinned group's spoke does not stay where Timeline had it", async ({
  page,
}) => {
  await open(page);
  await settle(page);
  const dmt = row(await openList(page, "Folders"), /^DMT/);
  await dmt.click();
  await expect(dmt).toHaveAttribute("aria-checked", "true");
  await listButton(page, "Folders").click();
  await viewButton(page, "Timeline").click();
  await settle(page);
  // Where the index and the pinned group's hub sit in Timeline: the lit spoke between them
  // must not be drawn there once Rings has come to rest.
  const root = page.locator('[data-map-dot][data-kind="root"]');
  const hub = page.locator('[data-map-dot][data-kind="hub"][data-topic="0"]');
  const a = await dotPoint(page, root);
  const b = await dotPoint(page, hub);
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(100);
  await viewButton(page, "Rings").click();
  await settle(page);
  await page.waitForTimeout(300);
  // For each offset across the segment (dotPoint is approximate, so a band either side), the
  // dimmest canvas pixel along it. A line drawn there is lit all along; where nothing is drawn
  // the canvas is clear and the card shows through.
  const { out } = await page.evaluate(
    ({ a, b }) => {
      const canvas =
        document.querySelector<HTMLCanvasElement>("[data-map-canvas]")!;
      const r = canvas.getBoundingClientRect();
      const dpr = canvas.width / r.width;
      const g = canvas.getContext("2d")!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const out: [number, number][] = [];
      for (let o = -150; o <= 150; o += 0.5) {
        let min = 255;
        for (let t = 0.2; t <= 0.81; t += 0.075) {
          const x = a.x + (b.x - a.x) * t + nx * o;
          const y = a.y + (b.y - a.y) * t + ny * o;
          const d = g.getImageData(
            Math.round((x - r.left) * dpr),
            Math.round((y - r.top) * dpr),
            1,
            1,
          ).data;
          min = Math.min(min, d[3]!);
        }
        if (min > 0) out.push([o, min]);
      }
      return { out };
    },
    { a, b },
  );
  expect(out.filter(([, min]) => min > 8)).toEqual([]);
});

// ---- The filter bar ----

test("choosing two folders lights exactly the dots of those two groups and counts them", async ({
  page,
}) => {
  await open(page);
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  const list = await openList(page, "Folders");
  await row(list, "DMT").click();
  await row(list, "ADNOC").click();
  await expect(row(list, "DMT")).toHaveAttribute("aria-checked", "true");
  await expect(row(list, "ADNOC")).toHaveAttribute("aria-checked", "true");

  await expect.poll(() => litTopics(page)).toEqual(["0", "1"]);
  const lit = await litItems(page).count();
  expect(lit).toBeGreaterThan(0);
  // Every unlit note or file belongs to some other folder.
  const outside = await page
    .locator(
      '[data-map-dot]:is([data-kind="note"], [data-kind="file"]):not([data-lit])',
    )
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-topic")));
  expect(outside.length).toBeGreaterThan(0);
  expect(outside.filter((t) => t === "0" || t === "1")).toEqual([]);
  await expect(countText(page)).toHaveText(
    new RegExp(`^${lit} of \\d+ shown$`),
  );
});

test("adding a person narrows the count and keeps only items in the chosen folders", async ({
  page,
}) => {
  await open(page);
  const folders = await openList(page, "Folders");
  await row(folders, "DMT").click();
  await row(folders, "ADNOC").click();
  await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);
  const before = await litItems(page).count();

  const people = await openList(page, "People");
  await row(people, /^Ahmed/).click();
  await expect(row(people, /^Ahmed/)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => litItems(page).count()).toBeLessThan(before);
  const after = await litItems(page).count();
  expect(after).toBeGreaterThan(0);
  for (const t of await litTopics(page)) expect(["0", "1"]).toContain(t);
  await expect(countText(page)).toHaveText(
    new RegExp(`^${after} of \\d+ shown$`),
  );
});

test("each choice is a chip; removing one restores its group and Clear all restores everything", async ({
  page,
  context,
}) => {
  await roomForChips(context);
  await open(page);
  const remove = (name: string) =>
    page.getByRole("button", { name: `Remove ${name}`, exact: true });
  const folders = await openList(page, "Folders");
  await row(folders, "DMT").click();
  await row(folders, "ADNOC").click();
  await expect(remove("DMT")).toBeVisible();
  await expect(remove("ADNOC")).toBeVisible();
  await expect.poll(() => litTopics(page)).toEqual(["0", "1"]);

  await remove("ADNOC").click();
  await expect(remove("ADNOC")).toHaveCount(0);
  await expect(remove("DMT")).toBeVisible();
  await expect.poll(() => litTopics(page)).toEqual(["0"]);
  await remove("DMT").click();
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  await expect(page.locator("[data-map-dot]:not([data-lit])")).toHaveCount(0);

  // Clear all: a folder, a person and some search text, all gone at once.
  const again = await openList(page, "Folders");
  await row(again, "DMT").click();
  await listButton(page, "Folders").click();
  const people = await openList(page, "People");
  await row(people, /^Sara/).click();
  await listButton(page, "People").click();
  await page.getByPlaceholder("Search").fill("a");
  await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  await expect(page.getByPlaceholder("Search")).toHaveValue("");
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
});

test("typing in Search adds a chip and its remove button clears the field", async ({
  page,
  context,
}) => {
  await roomForChips(context);
  await open(page);
  const search = page.getByPlaceholder("Search");
  await search.fill("zzzqx");
  const remove = page.getByRole("button", { name: "Remove “zzzqx”" });
  await expect(remove).toBeVisible();
  await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);
  await remove.click();
  await expect(search).toHaveValue("");
  await expect(remove).toHaveCount(0);
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
});

test("pointing at a row previews it and leaving clears it; so does focusing it", async ({
  page,
}) => {
  await open(page);
  const canvas = page.locator("[data-map-canvas]");
  const list = await openList(page, "Folders");
  const dmt = row(list, "DMT");
  await dmt.hover();
  await expect(canvas).toHaveAttribute("data-preview", "topic:0");
  // Previewing chooses nothing.
  await expect(dmt).toHaveAttribute("aria-checked", "false");
  await page.mouse.move(5, 5);
  await expect(canvas).toHaveAttribute("data-preview", "");

  await dmt.focus();
  await expect(canvas).toHaveAttribute("data-preview", "topic:0");
  await page.keyboard.press("ArrowDown");
  await expect(row(list, "ADNOC")).toBeFocused();
  await expect(canvas).toHaveAttribute("data-preview", "topic:1");
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-preview", "");
});

test("Escape closes a list and returns focus to its button", async ({
  page,
}) => {
  await open(page);
  const list = await openList(page, "Kind");
  await row(list, "Notes").focus();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(listButton(page, "Kind")).toBeFocused();
  await expect(listButton(page, "Kind")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("pressing outside a list closes it", async ({ page }) => {
  await open(page);
  const list = await openList(page, "People");
  // Neutral ground: the card's padding, left of the top bar, which holds no control.
  const card = (await page
    .getByRole("main", { name: "Hive map" })
    .boundingBox())!;
  await page.mouse.click(card.x + 4, card.y + card.height / 2);
  await expect(list).toHaveCount(0);
  await expect(listButton(page, "People")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("tabbing out of a list closes it", async ({ page }) => {
  await open(page);
  const list = await openList(page, "Kind");
  await list.getByRole("checkbox").last().focus();
  await page.keyboard.press("Tab");
  await expect(list).toHaveCount(0);
  await expect(listButton(page, "Kind")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // Focus went on to the next control, not back.
  await expect(listButton(page, "People")).toBeFocused();
});

test("only one list is open at a time", async ({ page }) => {
  await open(page);
  await openList(page, "Kind");
  await listButton(page, "People").click();
  await expect(groups(page, "People")).toBeVisible();
  await expect(groups(page, "Kind")).toHaveCount(0);
});

test("the Legend lists the shapes, and brightness only in Rings", async ({
  page,
}) => {
  await open(page);
  const zoom = page.getByRole("group", { name: "Zoom", exact: true });
  const legend = zoom.getByRole("button", { name: "Legend", exact: true });
  await legend.click();
  const list = groups(page, "Legend");
  await expect(list).toBeVisible();
  for (const text of [
    "Note",
    "File",
    "Not shared with you",
    "Group hub",
    "Agent",
  ])
    await expect(list.getByText(text, { exact: true })).toBeVisible();
  await expect(
    list.getByText("Brighter means changed more recently"),
  ).toBeVisible();
  await legend.click();
  await expect(list).toHaveCount(0);

  await viewButton(page, "Timeline").click();
  await expect(viewButton(page, "Timeline")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await legend.click();
  await expect(list).toBeVisible();
  await expect(list.getByText("Topic hub", { exact: true })).toBeVisible();
  await expect(
    list.getByText("Brighter means changed more recently"),
  ).toHaveCount(0);
});

test("Labels sits in the Zoom group and toggles", async ({ page }) => {
  await open(page);
  const zoom = page.getByRole("group", { name: "Zoom", exact: true });
  const labels = zoom.getByRole("button", { name: "Labels", exact: true });
  await expect(labels).toHaveAttribute("aria-pressed", "true");
  // The stylesheet applied: a real box, and the pressed state reads differently from the rest.
  const box = (await labels.boundingBox())!;
  expect(box.width).toBeGreaterThan(20);
  expect(box.height).toBeGreaterThan(20);
  const colour = () => labels.evaluate((e) => getComputedStyle(e).color);
  const on = await colour();
  await labels.click();
  await expect(labels).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(0, 0);
  await expect.poll(colour).not.toBe(on);
  await labels.click();
  await expect(labels).toHaveAttribute("aria-pressed", "true");
  // The divider before it is drawn.
  const rule = zoom.locator('[aria-hidden="true"][data-zoom-rule]');
  expect((await rule.boundingBox())!.height).toBeGreaterThan(8);
});

test("the Legend opens upward, and Escape or an outside press closes it", async ({
  page,
}) => {
  await open(page);
  const zoom = page.getByRole("group", { name: "Zoom", exact: true });
  const legend = zoom.getByRole("button", { name: "Legend", exact: true });
  await legend.click();
  const list = groups(page, "Legend");
  await expect(list).toBeVisible();
  const pop = (await list.boundingBox())!;
  const z = (await zoom.boundingBox())!;
  expect(pop.y + pop.height).toBeLessThanOrEqual(z.y + 0.5);
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(legend).toBeFocused();
  await legend.click();
  await expect(list).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(list).toHaveCount(0);
});

test("in Timeline and Orbit the group list is named Topics", async ({
  page,
}) => {
  await open(page);
  await expect(listButton(page, "Folders")).toBeVisible();
  for (const name of ["Timeline", "Orbit"]) {
    await viewButton(page, name).click();
    await expect(viewButton(page, name)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(listButton(page, "Topics")).toBeVisible();
    await expect(listButton(page, "Folders")).toHaveCount(0);
  }
});

/** The Timeline's guide texts (axis names, then the 14 column labels), from the canvas. */
async function timelineGuides(page: Page): Promise<string[]> {
  await viewButton(page, "Timeline").click();
  const canvas = page.locator("[data-map-canvas]");
  await expect(canvas).toHaveAttribute("data-view", "timeline");
  await expect(canvas).toHaveAttribute("data-guides", /\|/);
  return ((await canvas.getAttribute("data-guides")) ?? "").split("|");
}

test("recent notes keep the Timeline on days, ending at Today", async ({
  page,
}) => {
  await open(page);
  const guides = await timelineGuides(page);
  expect(guides).toHaveLength(3 + 14);
  expect(guides[0]).toBe("Agent writes by day");
  expect(guides[guides.length - 1]).toBe("Today");
  // The first column carries its month, the ones between are bare dates.
  expect(guides[3]).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  for (const g of guides.slice(4, -1))
    expect(g).toMatch(/^\d{1,2}( [A-Z][a-z]{2})?$/);
  // Rings has no column labels.
  await viewButton(page, "Rings").click();
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-guides",
    "",
  );
});

test("old notes widen the Timeline's scale and spread over its columns", async ({
  page,
}) => {
  const seen: Request[] = [];
  await page.goto("/dev/map?old=1", { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Hive map" })).toBeVisible();
  page.on("request", (r) => seen.push(r));
  const guides = await timelineGuides(page);
  expect(guides).toHaveLength(3 + 14);
  expect(guides).not.toContain("Today");
  expect(guides[0]).toBe("Agent writes by quarter");
  const year = new Date().getUTCFullYear();
  const quarter = Math.floor(new Date().getUTCMonth() / 3) + 1;
  for (const g of guides.slice(3)) expect(g).toMatch(/^Q[1-4] \d{4}$/);
  // The last column is the current quarter.
  expect(guides[guides.length - 1]).toBe(`Q${quarter} ${year}`);

  // The notes sit under many columns, not all under the current one.
  await settle(page);
  await expect(
    page.locator('ul[aria-label="Items on the map"][data-view="timeline"]'),
  ).toBeAttached({ timeout: 5000 });
  const columns = await page
    .locator('[data-map-dot]:is([data-kind="note"], [data-kind="file"])')
    .evaluateAll(
      (els) =>
        new Set(
          els.map((e) =>
            Math.floor((Number(e.getAttribute("data-x")) - 250) / 51),
          ),
        ).size,
    );
  expect(columns).toBeGreaterThan(8);

  // Picking the scale and laying out asked the server for nothing.
  const bad = seen.filter(
    (r) =>
      r.url().includes("/rest/") ||
      r.url().includes("/auth/") ||
      ["document", "fetch", "xhr"].includes(r.resourceType()),
  );
  expect(bad.map((r) => `${r.resourceType()} ${r.url()}`)).toEqual([]);
});

test("a note's peek and the side panel show when it was written and when it changed", async ({
  page,
}) => {
  await open(page);
  const dot = page.locator('[data-map-dot][aria-label^="<img src=x"]');
  await dot.focus();
  const peek = page.locator("[data-map-peek]");
  await expect(peek).toContainText(/Written\s*2 h ago/);
  await expect(peek).toContainText(/Changed\s*2 h ago/);
  await page.keyboard.press("Enter");
  const facts = rail(page).locator("dl");
  await expect(facts).toContainText(/Written\s*\d{1,2} [A-Z][a-z]{2}/);
  await expect(facts).toContainText(/Changed\s*\d{1,2} [A-Z][a-z]{2}/);
});

test("choosing a filter clears the selection", async ({ page }) => {
  await open(page);
  await pick(page, page.locator('[data-map-dot][aria-label^="<img src=x"]'));
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveText(
    HOSTILE_TITLE,
  );
  const kinds = await openList(page, "Kind");
  await row(kinds, "Files").click();
  await expect(page.locator('[data-map-dot][aria-pressed="true"]')).toHaveCount(
    0,
  );
  await expect(rail(page).getByRole("heading", { level: 2 })).toHaveCount(0);
});

test("several choices at once: any within a list, all across lists", async ({
  page,
}) => {
  await open(page);
  const kinds = await openList(page, "Kind");
  await row(kinds, "Notes").click();
  const notes = await litItems(page).count();
  await row(kinds, "Files").click();
  await expect.poll(() => litItems(page).count()).toBeGreaterThan(notes);
  await expect(
    page.locator('[data-map-dot][data-lit][data-kind="hub"]'),
  ).toHaveCount(0);
  // A folder on top of two kinds narrows it: all lists must agree.
  const folders = await openList(page, "Folders");
  await row(folders, "DMT").click();
  await expect.poll(() => litTopics(page)).toEqual(["0"]);
});

test("chips that do not fit give way to a +N chip that counts them", async ({
  page,
  context,
}) => {
  // Wide enough for some chips to show whole, so the test sees chips and "+N" side by side.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setFold(context, "open.open");
  await open(page);
  const folders = await openList(page, "Folders");
  for (const name of ["DMT", "ADNOC", "Hiring", "Emsteel"])
    await row(folders, name).click();
  await listButton(page, "Folders").click();
  const more = page.getByText(/^\+\d+ more$/);
  await expect(more).toBeVisible();
  // The chips shown and the "+N" chip account for every choice, so none is lost from view.
  const shownChips = await page
    .getByRole("button", { name: /^Remove / })
    .count();
  const n = Number((await more.textContent())!.match(/\d+/)![0]);
  expect(shownChips).toBeGreaterThan(0);
  expect(shownChips + n).toBe(4);
  await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);
  await expect(listButton(page, "Folders")).toContainText("4");
});

/** The names of the chips' remove buttons, in order. */
const chipNames = (page: Page) =>
  page
    .getByRole("button", { name: /^Remove / })
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));

test("with both sides open at 1600 px two folders get two chips and no +N", async ({
  page,
  context,
}) => {
  // The project's device sets 1280 x 720; this test is about a 1600 px window.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setFold(context, "open.open");
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-rail", "open");
  await expect(page.locator("html")).toHaveAttribute("data-panel", "open");
  const folders = await openList(page, "Folders");
  await row(folders, "DMT").click();
  await row(folders, "Tower inspections").click();
  await listButton(page, "Folders").click();
  await expect
    .poll(() => chipNames(page))
    .toEqual(["Remove DMT", "Remove Tower inspections"]);
  await expect(page.getByText(/^\+\d+ more$/)).toHaveCount(0);
});

test("at 1280 px with both sides open many choices give way to +N and the bar keeps clear of the zoom control", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await setFold(context, "open.open");
  await open(page);
  const folders = await openList(page, "Folders");
  for (const name of ["DMT", "Tower inspections", "Airspace approvals"])
    await row(folders, name).click();
  await listButton(page, "Folders").click();
  const people = await openList(page, "People");
  await row(people, /^Ahmed/).click();
  await listButton(page, "People").click();
  await expect(page.getByText(/^\+\d+ more$/)).toBeVisible();
  const bar = (await page.locator('[class*="filterBar"]').boundingBox())!;
  const zoom = (await page.getByRole("group", { name: "Zoom" }).boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(zoom.x);
});

test("a group the next view does not have is dropped, not kept for later", async ({
  page,
}) => {
  await open(page);
  // Timeline draws 8 groups; the fixture's 10th folder is not one of them.
  const folders = await openList(page, "Folders");
  await row(folders, "Ops handbook").click();
  await listButton(page, "Folders").click();
  await expect(countText(page)).toHaveText(/^\d+ of \d+ shown$/);
  await viewButton(page, "Timeline").click();
  await expect(viewButton(page, "Timeline")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  await viewButton(page, "Rings").click();
  await expect(viewButton(page, "Rings")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(countText(page)).toHaveText(/^All \d+ shown$/);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});

test("Escape closes a list opened by mouse even when nothing has focus, and keeps the selection", async ({
  page,
}) => {
  await open(page);
  const dot = page.locator('[data-map-dot][aria-label^="<img src=x"]');
  await pick(page, dot);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
  const list = await openList(page, "Kind");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(dot).toHaveAttribute("aria-pressed", "true");
});
