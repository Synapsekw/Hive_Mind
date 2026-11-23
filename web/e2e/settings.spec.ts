import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureSettings } from "../src/settings/fixture";
import { MCP_COMMAND, envLine } from "../src/settings/text";

const DATA = fixtureSettings();
const [CLAUDE_CODE, LOCAL, OLD] = DATA.agents as [
  (typeof DATA.agents)[number],
  (typeof DATA.agents)[number],
  (typeof DATA.agents)[number],
];
const [MAIN, DRA] = DATA.workspaces as [
  (typeof DATA.workspaces)[number],
  (typeof DATA.workspaces)[number],
];

/** The dev page's stand-in token; the database has never seen it. */
const TOKEN = "hive_devtoken0000000000000000000000000000";
const FAILED = "That didn't work. Try again.";
const WARNING =
  "This token is shown once. Copy it now; it cannot be shown again.";

async function open(page: Page, query = "", strict = true) {
  // Nothing on this screen may use a browser dialog (confirm, alert). Only the test of the
  // leave-the-page question passes `strict` false and answers that dialog itself.
  if (strict)
    page.on("dialog", (d) => {
      throw new Error(`unexpected dialog: ${d.message()}`);
    });
  await page.goto(`/dev/settings${query}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("main", { name: "Settings" })).toBeVisible();
}

type Call = { name: string; args: unknown[] };
const calls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __settingsCalls?: Call[] }).__settingsCalls ?? [],
  );

const main = (page: Page) => page.getByRole("main", { name: "Settings" });
const section = (page: Page, name: string) =>
  main(page).getByRole("region", { name });
const rows = (page: Page, name: string) =>
  main(page).getByRole("list", { name }).getByRole("listitem");
const agentRow = (page: Page, name: string) =>
  rows(page, "Agents").filter({ hasText: name });
const memberRow = (page: Page, name: string) =>
  rows(page, "Members").filter({ hasText: name });
const connect = (page: Page) =>
  main(page).getByRole("button", { name: "Connect an agent" });
const connectForm = (page: Page) =>
  main(page).getByRole("form", { name: "Connect an agent" });
const addButton = (page: Page) =>
  main(page).getByRole("button", { name: "Add a member" });
const addForm = (page: Page) =>
  main(page).getByRole("form", { name: "Add a member" });
const dialog = (page: Page) => page.getByRole("dialog");
const live = (page: Page) => main(page).locator('[aria-live="polite"]');
const revokeButton = (row: Locator) =>
  row.getByRole("button", { name: /^Revoke/ });

/** Fills the connect form and presses Create. */
async function create(page: Page, name = "Desk agent") {
  await connect(page).click();
  const form = connectForm(page);
  await form.getByLabel("Name", { exact: true }).fill(name);
  await form.getByLabel("Workspace").selectOption({ label: DRA.name });
  await form.getByLabel("Provider").selectOption("ChatGPT");
  await form.getByRole("radio", { name: /^Self-hosted/ }).check();
  await form.getByRole("button", { name: "Create" }).click();
}

const stored = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify([
      { ...localStorage },
      { ...sessionStorage },
      location.href,
      history.state,
      document.cookie,
      (window as unknown as { __settingsCalls?: unknown }).__settingsCalls ??
        null,
    ]),
  );

test("the rail marks Settings; both sections show; a revoked agent comes last, says so and cannot be revoked", async ({
  page,
}) => {
  await open(page);
  const link = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" });
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(link).toHaveAttribute("href", "/settings");

  await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(
    "Settings",
  );
  await expect(main(page)).toContainText("Synapse");
  await expect(section(page, "Agents")).toContainText(
    "An agent writes into one workspace as you. It can never change sharing, accept links or delete notes.",
  );
  await expect(section(page, "Members")).toBeVisible();

  // Active agents first, the newest on top; then the one that no longer works.
  await expect(rows(page, "Agents")).toHaveCount(3);
  await expect(rows(page, "Agents").nth(0)).toContainText(LOCAL.name);
  await expect(rows(page, "Agents").nth(1)).toContainText(CLAUDE_CODE.name);
  await expect(rows(page, "Agents").nth(2)).toContainText(OLD.name);

  const used = agentRow(page, "Connected 18 Nov");
  await expect(used).toContainText("Claude Code");
  await expect(used).toContainText(MAIN.name);
  await expect(used).toContainText("Vendor-hosted");
  await expect(used).toContainText("Last used 23 Nov");
  await expect(revokeButton(used)).toBeVisible();

  const local = agentRow(page, LOCAL.name);
  await expect(local).toContainText("Other");
  await expect(local).toContainText(DRA.name);
  await expect(local).toContainText("Self-hosted, notes held for release");
  await expect(local).toContainText("Connected 21 Nov");
  await expect(local).toContainText("Never used");

  const old = agentRow(page, OLD.name);
  await expect(old.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(old).toContainText("Connected 2 Oct");
  await expect(old.getByRole("button")).toHaveCount(0);

  await expect(rows(page, "Members")).toHaveCount(3);
  await expect(memberRow(page, "Danijel")).toContainText("Owner");
  await expect(
    memberRow(page, "Danijel").getByText("you", { exact: true }),
  ).toBeVisible();
  await expect(memberRow(page, "Sara")).toContainText("Member");

  // With no agents the section says what to do.
  await open(page, "?none=1");
  await expect(rows(page, "Agents")).toHaveCount(0);
  await expect(section(page, "Agents")).toContainText("No agents yet.");
  await expect(connect(page)).toBeVisible();
});

test("Connect an agent: a name and a workspace are needed; a valid form calls createAgent with the four values", async ({
  page,
}) => {
  await open(page);
  await connect(page).click();
  const form = connectForm(page);
  const name = form.getByLabel("Name", { exact: true });
  await expect(name).toBeFocused();
  // Two workspaces: none is chosen for the person.
  const workspace = form.getByLabel("Workspace");
  await expect(workspace).toHaveValue("");
  await expect(workspace.locator("option:checked")).toHaveText(
    "Choose a workspace",
  );
  await expect(form.getByLabel("Provider")).toHaveValue("Claude");
  await expect(form.getByLabel("Provider").locator("option")).toHaveText([
    "Claude",
    "ChatGPT",
    "Claude Code",
    "Codex CLI",
    "Other",
  ]);
  await expect(
    form.getByRole("radio", { name: /^Vendor-hosted/ }),
  ).toBeChecked();
  await expect(form).toContainText(
    "For Claude, ChatGPT and other agents run by their vendor. Notes are saved at once.",
  );
  await expect(form).toContainText(
    "For open-source or local agents. Its notes are held until you release them.",
  );

  // No name.
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toContainText("Give the agent a name.");
  await expect(name).toBeFocused();
  // Only spaces.
  await name.fill("   ");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toContainText("Give the agent a name.");
  // Too long.
  await name.fill("a".repeat(61));
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toContainText("Keep the name to 60 characters or fewer.");
  // A name, and still no workspace.
  await name.fill("  Desk agent ");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toContainText("Choose a workspace.");
  await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page)).toEqual([]);

  // Cancel closes the form and gives the focus back; the next one starts empty.
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await expect(connect(page)).toBeFocused();
  await connect(page).click();
  await expect(name).toHaveValue("");
  await expect(form).not.toContainText("Choose a workspace.");

  await name.fill("  Desk agent ");
  await workspace.selectOption({ label: DRA.name });
  await form.getByLabel("Provider").selectOption("ChatGPT");
  await form.getByRole("radio", { name: /^Self-hosted/ }).check();
  await form.getByRole("button", { name: "Create" }).click();
  await expect(dialog(page)).toBeVisible();
  expect(await calls(page)).toEqual([
    {
      name: "createAgent",
      args: [
        {
          name: "Desk agent",
          workspaceId: DRA.id,
          provider: "ChatGPT",
          trustTier: "self_hosted",
        },
      ],
    },
  ]);
});

test("the token dialog: shown once, not closed by Escape or a click outside; Copy copies; Done closes and the token is gone", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await create(page);

  const box = dialog(page);
  await expect(box).toBeVisible();
  await expect(box).toHaveAttribute("aria-modal", "true");
  await expect(box).toHaveAccessibleName(/Desk agent/);
  await expect(box).toContainText(WARNING);
  const field = box.getByLabel("Token");
  await expect(field).toHaveValue(TOKEN);
  await expect(field).toHaveAttribute("readonly", "");
  await expect(field).toHaveAttribute("autocomplete", "off");
  await expect(field).toHaveAttribute("spellcheck", "false");
  await expect(box).toContainText("What to do with it");
  await expect(box).toContainText(envLine(TOKEN));
  await expect(box).toContainText(MCP_COMMAND);
  await expect(box).toContainText(
    "Then give the agent the instruction file from docs/agent-integration.md, section 5.",
  );
  // The focus starts on the heading, never on a button a held Enter would press.
  await expect(box.getByRole("heading", { level: 2 })).toBeFocused();
  // The page behind cannot be reached.
  expect(
    await page.evaluate(
      () => document.querySelector("main")?.closest("[inert]") !== null,
    ),
  ).toBe(true);

  // It cannot be lost by accident.
  await page.keyboard.press("Escape");
  await expect(box).toBeVisible();
  await page.mouse.click(6, 6);
  await expect(box).toBeVisible();
  const size = page.viewportSize()!;
  await page.mouse.click(size.width - 6, size.height - 6);
  await expect(box).toBeVisible();
  await expect(field).toHaveValue(TOKEN);

  await box.getByRole("button", { name: "Copy" }).click();
  await expect(box.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TOKEN);
  // "Copied" is said for two seconds.
  await expect(box.getByRole("button", { name: "Copy" })).toBeVisible({
    timeout: 4000,
  });

  await box.getByRole("button", { name: "Done" }).click();
  await expect(box).toHaveCount(0);
  await expect(connect(page)).toBeFocused();
  await expect(rows(page, "Agents")).toHaveCount(4);
  const made = agentRow(page, "Desk agent");
  await expect(made).toContainText("ChatGPT");
  await expect(made).toContainText(DRA.name);
  await expect(made).toContainText("Self-hosted, notes held for release");
  await expect(made).toContainText("Never used");
  await expect(connectForm(page)).toHaveCount(0);
  expect(await page.content()).not.toContain(TOKEN);
  expect(
    await page.evaluate(() => document.documentElement.outerHTML),
  ).not.toContain("hive_devtoken");
});

test("the token never reaches localStorage, sessionStorage, the address, a cookie or the recorded calls", async ({
  page,
}) => {
  await open(page);
  expect(await stored(page)).not.toContain(TOKEN);
  await create(page);
  await expect(dialog(page)).toBeVisible();
  expect(await stored(page)).not.toContain(TOKEN);
  expect(page.url()).not.toContain(TOKEN);
  // Outside the dialog nothing carries it, not even an attribute.
  expect(
    await page.evaluate(() => {
      const copy = document.documentElement.cloneNode(true) as HTMLElement;
      copy.querySelector('[role="dialog"]')?.remove();
      return copy.outerHTML;
    }),
  ).not.toContain(TOKEN);

  await dialog(page).getByRole("button", { name: "Copy" }).click();
  expect(await stored(page)).not.toContain(TOKEN);
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await stored(page)).not.toContain(TOKEN);
  expect(page.url()).not.toContain(TOKEN);
  expect(await calls(page)).toHaveLength(1);
});

test("Revoke asks first with the agent's name; Keep restores; a double click revokes nothing; the second press revokes", async ({
  page,
}) => {
  await open(page);
  const target = agentRow(page, LOCAL.name);
  await revokeButton(target).click();
  await expect(target).toContainText(`Revoke ${LOCAL.name}?`);
  await expect(target).toContainText("It stops working within the hour.");
  // The safe answer has the focus.
  await expect(target.getByRole("button", { name: "Keep" })).toBeFocused();
  expect(await calls(page)).toEqual([]);

  await target.getByRole("button", { name: "Keep" }).click();
  await expect(target).not.toContainText(`Revoke ${LOCAL.name}?`);
  await expect(target.getByRole("button", { name: "Keep" })).toHaveCount(0);
  await expect(revokeButton(target)).toBeFocused();

  // Escape is Keep.
  await revokeButton(target).click();
  await expect(target).toContainText(`Revoke ${LOCAL.name}?`);
  await page.keyboard.press("Escape");
  await expect(target).not.toContainText(`Revoke ${LOCAL.name}?`);
  await expect(revokeButton(target)).toBeFocused();
  expect(await calls(page)).toEqual([]);

  // One question at a time: asking about another agent closes this one.
  await revokeButton(target).click();
  const other = agentRow(page, "Connected 18 Nov");
  await revokeButton(other).click();
  await expect(other).toContainText(`Revoke ${CLAUDE_CODE.name}?`);
  await expect(target).not.toContainText(`Revoke ${LOCAL.name}?`);
  await other.getByRole("button", { name: "Keep" }).click();

  await revokeButton(target).click();
  // A confirming press straight after the question is taken as a double click and ignored.
  // Keep this assertion: it is the one that exercises the 500 ms guard. The double clicks by
  // coordinates further down land on Keep or on the question's text, never on this button.
  await target.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(target).toContainText(`Revoke ${LOCAL.name}?`);
  expect(await calls(page)).toEqual([]);
  await page.waitForTimeout(600);
  await target.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(target.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(target.getByRole("button")).toHaveCount(0);
  expect(await calls(page)).toEqual([
    { name: "revokeAgent", args: [LOCAL.id] },
  ]);
  // It joins the ones that no longer work, under the active one.
  await expect(rows(page, "Agents").nth(0)).toContainText("Connected 18 Nov");
  await expect(rows(page, "Agents")).toHaveCount(3);

  // By coordinates, where a real double click lands, narrow and wide.
  for (const width of [390, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const row = agentRow(page, LOCAL.name);
    const box = await revokeButton(row).boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(await calls(page)).toEqual([]);
    await expect(row.getByText("Revoked", { exact: true })).toHaveCount(0);
  }
});

test("a failed create says so in the form and shows no dialog; a failed revoke keeps the row and says so", async ({
  page,
}) => {
  await open(page, "?fail=1");
  await create(page);
  const form = connectForm(page);
  await expect(form).toContainText(FAILED);
  await expect(live(page)).toHaveText(FAILED);
  await expect(dialog(page)).toHaveCount(0);
  // What was typed is still there for another try.
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue(
    "Desk agent",
  );
  await expect(rows(page, "Agents")).toHaveCount(3);
  await form.getByRole("button", { name: "Cancel" }).click();

  const target = agentRow(page, LOCAL.name);
  await revokeButton(target).click();
  await page.waitForTimeout(600);
  await target.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(target).toContainText(FAILED);
  await expect(target.getByText("Revoked", { exact: true })).toHaveCount(0);
  await expect(revokeButton(target)).toBeVisible();
  await expect(live(page)).toHaveText(FAILED);
  await expect(rows(page, "Agents").nth(0)).toContainText(LOCAL.name);

  // Adding a member fails the same way.
  await addButton(page).click();
  await addForm(page).getByLabel("Email").fill("mira@example.com");
  await addForm(page).getByLabel("Display name").fill("Mira");
  await addForm(page).getByRole("button", { name: "Add" }).click();
  await expect(addForm(page)).toContainText(FAILED);
  await expect(rows(page, "Members")).toHaveCount(3);
});

test("a member who is not the owner sees the members and no way to add one", async ({
  page,
}) => {
  await open(page, "?member=1");
  await expect(rows(page, "Members")).toHaveCount(3);
  await expect(addButton(page)).toHaveCount(0);
  await expect(addForm(page)).toHaveCount(0);
  await expect(
    memberRow(page, "Ahmed").getByText("you", { exact: true }),
  ).toBeVisible();
  await expect(
    memberRow(page, "Danijel").getByText("you", { exact: true }),
  ).toHaveCount(0);
  await expect(memberRow(page, "Danijel")).toContainText("Owner");
  // Their own agents are still theirs to manage.
  await expect(connect(page)).toBeVisible();
});

test("Add a member: a bad email is refused with no call; success adds the row; each refusal says why", async ({
  page,
}) => {
  await open(page);
  await addButton(page).click();
  const form = addForm(page);
  await expect(form).toContainText(
    "They need an account already. Inviting someone new comes later.",
  );
  const email = form.getByLabel("Email");
  const name = form.getByLabel("Display name");
  await expect(email).toBeFocused();

  for (const bad of ["", "mira", "mira@@example.com", "mi ra@example.com"]) {
    await email.fill(bad);
    await name.fill("Mira");
    await form.getByRole("button", { name: "Add" }).click();
    await expect(form).toContainText("Enter an email address.");
    await expect(email).toBeFocused();
  }
  await email.fill("mira@example.com");
  await name.fill("  ");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(form).toContainText("Give them a display name.");
  expect(await calls(page)).toEqual([]);

  // Opening the other form closes this one: one at a time.
  await connect(page).click();
  await expect(form).toHaveCount(0);
  await expect(connectForm(page)).toBeVisible();
  await addButton(page).click();
  await expect(connectForm(page)).toHaveCount(0);
  await expect(email).toHaveValue("");

  await email.fill(" mira@example.com ");
  await name.fill(" Mira ");
  await form.getByRole("button", { name: "Add" }).click();
  await expect(rows(page, "Members")).toHaveCount(4);
  await expect(memberRow(page, "Mira")).toContainText("Member");
  expect(await calls(page)).toEqual([
    { name: "addMember", args: ["mira@example.com", "Mira"] },
  ]);
  // The form is put away, and the next one starts empty.
  await expect(form).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();
  await expect(live(page)).toHaveText("Mira added.");
  await addButton(page).click();
  await expect(email).toHaveValue("");
  await expect(name).toHaveValue("");

  for (const [reason, said] of [
    ["no-account", "Nobody with that email has an account yet."],
    ["already-member", "That person is already a member."],
  ] as const) {
    await open(page, `?reason=${reason}`);
    await addButton(page).click();
    await addForm(page).getByLabel("Email").fill("mira@example.com");
    await addForm(page).getByLabel("Display name").fill("Mira");
    await addForm(page).getByRole("button", { name: "Add" }).click();
    await expect(addForm(page)).toContainText(said);
    await expect(live(page)).toHaveText(said);
    await expect(rows(page, "Members")).toHaveCount(3);
    await expect(addForm(page).getByLabel("Email")).toHaveValue(
      "mira@example.com",
    );
  }
});

test("at 1100 x 560 the page does not scroll; the keyboard reaches every control and the dialog holds the focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  const fits = () =>
    page.evaluate(() => {
      const root = document.scrollingElement!;
      const panel = document.querySelector("main")!;
      return {
        pageScrolls:
          root.scrollHeight > window.innerHeight ||
          root.scrollWidth > window.innerWidth,
        panelBottom: panel.getBoundingClientRect().bottom,
        panelRight: panel.getBoundingClientRect().right,
      };
    });
  const scrolls = () =>
    page.evaluate(() => {
      const panel = document.querySelector("main")!;
      const list = document.querySelector('ul[aria-label="Members"]')!;
      let box: Element | null = list;
      while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY))
        box = box.parentElement;
      return {
        inside: !!box && panel.contains(box),
        scrolls: !!box && box.scrollHeight > box.clientHeight,
        sideways: !!box && box.scrollWidth > box.clientWidth,
      };
    });
  expect(await fits()).toEqual({
    pageScrolls: false,
    panelBottom: expect.any(Number),
    panelRight: expect.any(Number),
  });
  expect((await fits()).panelBottom).toBeLessThanOrEqual(560);
  expect((await fits()).panelRight).toBeLessThanOrEqual(1100);
  expect((await scrolls()).inside).toBe(true);
  expect((await scrolls()).sideways).toBe(false);

  // From the heading, Tab walks the card: Connect, each Revoke, Add a member.
  await main(page).getByRole("heading", { level: 1 }).focus();
  await page.keyboard.press("Tab");
  await expect(connect(page)).toBeFocused();
  const outline = await connect(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return (
      cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) >= 2
    );
  });
  expect(outline).toBe(true);
  await page.keyboard.press("Tab");
  await expect(revokeButton(agentRow(page, LOCAL.name))).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(revokeButton(agentRow(page, "Connected 18 Nov"))).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(addButton(page)).toBeFocused();
  await expect(addButton(page)).toBeInViewport();

  // The connect form, by keyboard alone.
  await connect(page).focus();
  await page.keyboard.press("Enter");
  const form = connectForm(page);
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await page.keyboard.type("Desk agent");
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Workspace")).toBeFocused();
  await form.getByLabel("Workspace").selectOption({ label: MAIN.name });
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Provider")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    form.getByRole("radio", { name: /^Vendor-hosted/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(form.getByRole("radio", { name: /^Self-hosted/ })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Create" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Cancel" })).toBeFocused();
  // With the form open the card is longer than the window: it scrolls, the page does not.
  expect((await scrolls()).scrolls).toBe(true);
  expect((await fits()).pageScrolls).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");

  const box = dialog(page);
  await expect(box).toBeVisible();
  await expect(box.getByRole("heading", { level: 2 })).toBeFocused();
  // The whole dialog is inside the window, Done included.
  await expect(box.getByRole("button", { name: "Done" })).toBeInViewport();
  expect((await fits()).pageScrolls).toBe(false);
  const inside = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  // From the heading, Tab walks the token, Copy and Done, and turns round.
  await page.keyboard.press("Tab");
  await expect(box.getByLabel("Token")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(box.getByRole("button", { name: "Copy" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(box.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(box.getByLabel("Token")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(box.getByRole("button", { name: "Done" })).toBeFocused();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }
  await box.getByRole("button", { name: "Done" }).focus();
  await page.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  await expect(connect(page)).toBeFocused();
  expect(await calls(page)).toEqual([
    {
      name: "createAgent",
      args: [
        {
          name: "Desk agent",
          workspaceId: MAIN.id,
          provider: "Claude",
          trustTier: "self_hosted",
        },
      ],
    },
  ]);
});

/** Counts the page's history moves from now on, so a test can wait for one to land. */
async function countMoves(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __moves?: number };
    w.__moves = 0;
    window.addEventListener("popstate", () => {
      w.__moves = (w.__moves ?? 0) + 1;
    });
  });
}
const moved = (page: Page, times: number) =>
  page.waitForFunction(
    (n) => ((window as unknown as { __moves?: number }).__moves ?? 0) >= n,
    times,
  );

test("with the token dialog open, Back keeps the page, the dialog and the token; after Done one Back leaves as before", async ({
  page,
}) => {
  // Somewhere to go back to.
  await page.goto("/login", { waitUntil: "networkidle" });
  await open(page);
  await create(page);
  const box = dialog(page);
  await expect(box).toBeVisible();
  await countMoves(page);

  for (let press = 1; press <= 3; press++) {
    await page.goBack();
    await moved(page, press);
    await expect(page).toHaveURL(/\/dev\/settings$/);
    await expect(box).toBeVisible();
    await expect(box.getByLabel("Token")).toHaveValue(TOKEN);
  }
  // What holds the page in place carries nothing of the token.
  expect(await stored(page)).not.toContain("hive_devtoken");

  await box.getByRole("button", { name: "Done" }).click();
  await expect(box).toHaveCount(0);
  // Done takes the extra history entry away again.
  await moved(page, 4);
  await expect(page).toHaveURL(/\/dev\/settings$/);
  await expect(main(page)).toBeVisible();
  await expect(rows(page, "Agents")).toHaveCount(4);
  await expect(agentRow(page, "Desk agent")).toContainText("Never used");
  await expect(connect(page)).toBeFocused();
  expect(await page.content()).not.toContain("hive_devtoken");

  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
});

test("with the token dialog open, a reload asks first and the token stays; after Done nothing asks", async ({
  page,
}) => {
  await open(page, "", false);
  await create(page);
  const box = dialog(page);
  await expect(box).toBeVisible();

  const asked = page.waitForEvent("dialog", { timeout: 5000 });
  // Staying cancels the reload, so its promise only ends by its own timeout.
  const reload = page.reload({ timeout: 3000 }).catch(() => null);
  const question = await asked;
  expect(question.type()).toBe("beforeunload");
  await question.dismiss();
  await reload;
  await expect(box).toBeVisible();
  await expect(box.getByLabel("Token")).toHaveValue(TOKEN);

  await countMoves(page);
  await box.getByRole("button", { name: "Done" }).click();
  await expect(box).toHaveCount(0);
  await moved(page, 1);
  let again = false;
  page.on("dialog", (d) => {
    again = true;
    void d.dismiss();
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(main(page)).toBeVisible();
  expect(again).toBe(false);
});

test("an Enter held or pressed again after submitting never copies the token; a press on Copy does", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText("EMPTY"));

  await connect(page).click();
  const form = connectForm(page);
  await form.getByLabel("Workspace").selectOption({ label: DRA.name });
  const name = form.getByLabel("Name", { exact: true });
  await name.fill("Desk agent");
  await name.press("Enter");
  await page.waitForTimeout(350);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  const box = dialog(page);
  await expect(box).toBeVisible();
  await expect(box.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(box.getByRole("button", { name: "Copied" })).toHaveCount(0);
  expect(await clipboard()).toBe("EMPTY");

  // A key still held when the focus reaches Copy repeats there, and copies nothing.
  const copy = box.locator("[data-copy]");
  await page.keyboard.down("Enter");
  await copy.focus();
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await page.waitForTimeout(100);
  await expect(copy).toHaveText("Copy");
  expect(await clipboard()).toBe("EMPTY");

  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await clipboard()).toBe(TOKEN);
  // So does one deliberate Enter on it.
  await page.evaluate(() => navigator.clipboard.writeText("EMPTY"));
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect.poll(clipboard).toBe(TOKEN);
});

test("while an agent is being created the page is inert: a rail link does nothing, leaving asks first, and the dialog then appears", async ({
  page,
}) => {
  const inert = () =>
    page.evaluate(
      () => document.querySelector("main")?.closest("[inert]") !== null,
    );
  const asksBeforeLeaving = () =>
    page.evaluate(() => {
      const leaving = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leaving);
      return leaving.defaultPrevented;
    });

  await open(page, "?slow=1");
  expect(await inert()).toBe(false);
  expect(await asksBeforeLeaving()).toBe(false);
  const link = page
    .getByRole("navigation", { name: "Main" })
    .locator('a[href="/vault"]');
  const at = await link.boundingBox();
  expect(at).not.toBeNull();

  await create(page);
  expect(await inert()).toBe(true);
  expect(await asksBeforeLeaving()).toBe(true);
  await page.mouse.click(at!.x + at!.width / 2, at!.y + at!.height / 2);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/dev\/settings\?slow=1$/);
  await expect(dialog(page)).toHaveCount(0);

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel("Token")).toHaveValue(TOKEN);
  await expect(page).toHaveURL(/\/dev\/settings\?slow=1$/);
  expect(await calls(page)).toHaveLength(1);
});

test("a slow create that is refused gives the page back, with the focus in the form", async ({
  page,
}) => {
  const inert = () =>
    page.evaluate(
      () => document.querySelector("main")?.closest("[inert]") !== null,
    );
  const asksBeforeLeaving = () =>
    page.evaluate(() => {
      const leaving = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leaving);
      return leaving.defaultPrevented;
    });
  await open(page, "?slow=1&fail=1");
  await create(page);
  expect(await inert()).toBe(true);
  const form = connectForm(page);
  await expect(form).toContainText(FAILED);
  expect(await inert()).toBe(false);
  expect(await asksBeforeLeaving()).toBe(false);
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue(
    "Desk agent",
  );
});
