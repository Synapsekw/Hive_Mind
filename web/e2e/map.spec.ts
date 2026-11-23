import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { fixturePayload, HOSTILE_TITLE } from "../src/map/fixture";
import { setLook } from "./look";

const VIEWS = ["Hive", "Rings", "Topics", "Links", "Timeline", "Orbit"];

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

test("the map opens on the hive", async ({ page }) => {
  await open(page);
  await expect(viewButton(page, "Hive")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Circle", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-view",
    "hive",
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

test("the hive names who is at the hive", async ({ page }) => {
  await open(page);
  const presence = page.getByRole("complementary", { name: "At the hive" });
  await expect(presence).toContainText("Laptop");
  await expect(presence).toContainText("live");
  await expect(presence).toContainText("idle at the entrance");
  // A row reached by keyboard does what hovering it does: the agent's mark becomes hot.
  const row = presence.getByRole("listitem").filter({ hasText: "Laptop" });
  await row.focus();
  await expect(page.locator("[data-map-canvas]")).not.toHaveAttribute(
    "data-hot",
    "",
  );
  await expect(page.locator("[data-map-peek]")).toContainText("Agent");
  await row.blur();
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-hot",
    "",
  );
  // Only in the Hive.
  await viewButton(page, "Rings").click();
  await expect(presence).toHaveCount(0);
});

test("with reduced motion the map does not keep animating", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.waitForTimeout(1200);
  const canvas = page.locator("[data-map-canvas]");
  for (const name of ["Hive", "Rings", "Orbit"]) {
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
  await viewButton(page, "Topics").click();
  await expect(canvas).toHaveAttribute("data-animating", "");
  await expect(canvas).not.toHaveAttribute("data-animating", {
    timeout: 4000,
  });
  // The hidden list followed once the dots landed.
  await expect(
    page.locator('ul[aria-label="Items on the map"][data-view="topics"]'),
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

test("the six views switch in the browser without a request", async ({
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
  const topics = page.getByRole("group", { name: "Topics" });
  await topics.getByRole("button", { name: "DMT" }).click();
  await topics.getByRole("button", { name: "ADNOC" }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
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

test("a topic chip leaves its dots lit and dims the rest", async ({ page }) => {
  await open(page);
  await page
    .getByRole("group", { name: "Topics" })
    .getByRole("button", { name: "DMT" })
    .click();
  const dmt = page.locator('[data-map-dot][data-kind="note"][data-topic="0"]');
  const adnoc = page.locator(
    '[data-map-dot][data-kind="note"][data-topic="1"]',
  );
  await expect(dmt.first()).toHaveAttribute("data-lit", "");
  await expect(adnoc.first()).not.toHaveAttribute("data-lit");
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
  for (const name of ["Rings", "Orbit"]) {
    await viewButton(page, name).click();
    const dots = page.locator("[data-map-dot]");
    const n = await dots.count();
    expect(n).toBeGreaterThan(250);
    counts.push(n);
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
  // One layer of dots at a time: the orbit view does not keep the flat dots mounted.
  expect(counts[1]).toBe(counts[0]);
});

test("the map sits on frosted glass", async ({ page }) => {
  await open(page);
  const blur = await page
    .getByRole("main", { name: "Hive map" })
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
    probe.style.color = "var(--hue-1)";
    document.body.append(probe);
    const hue = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(
      Number,
    );
    probe.remove();
    return { dot: [px[0], px[1], px[2]], hue: hue.slice(0, 3) };
  }, p);
}

test("a topic dot takes the theme's first topic colour", async ({
  page,
  context,
}) => {
  await setLook(context, "aurora.dark.tinted.theme");
  await open(page);
  const theme = await hubAndHue(page);
  expect(theme.dot).toEqual(theme.hue);

  await setLook(context, "aurora.dark.tinted.classic");
  await open(page);
  const classic = await hubAndHue(page);
  expect(classic.dot).toEqual(classic.hue);
  expect(classic.dot).not.toEqual(theme.dot);
});

for (const look of [undefined, "aurora.light.vivid.classic"])
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

test("hovering a dock topic previews it and a click pins it", async ({
  page,
}) => {
  await open(page);
  await viewButton(page, "Rings").click();
  const dmt = page
    .getByRole("group", { name: "Topics" })
    .getByRole("button", { name: /^DMT/ });
  await dmt.hover();
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-preview",
    "topic:0",
  );
  await dmt.click();
  await expect(dmt).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(5, 5);
  await expect(page.locator("[data-map-canvas]")).toHaveAttribute(
    "data-preview",
    "",
  );
  await expect(
    page.locator('[data-map-dot][data-kind="note"][data-topic="1"]').first(),
  ).not.toHaveAttribute("data-lit");
});

test("the side panel shows today, the 14-day line and what needs you", async ({
  page,
}) => {
  await open(page);
  const panel = rail(page);
  await expect(panel).toContainText("Today");
  await expect(panel.locator("svg[data-spark]")).toBeVisible();
  await expect(panel).toContainText("By person");
});
