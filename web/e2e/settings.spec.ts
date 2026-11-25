import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureSettings } from "../src/settings/fixture";
import {
  CONNECT_TITLE,
  DELETE_WORKSPACE_ITEM,
  INVITATIONS_NOTE,
  INVITE_HELP,
  MCP_COMMAND,
  REVOKE_ITEM,
  envLine,
  foldedAgents,
  inviteNotice,
} from "../src/settings/text";

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
const [LENA, MARKO] = DATA.invitations as [
  (typeof DATA.invitations)[number],
  (typeof DATA.invitations)[number],
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

/** Opens a Settings tab by its name (each name is followed by its count). */
async function openTab(
  page: Page,
  name: "Agents" | "Workspaces" | "Topics" | "People" | "Hive",
) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}
const tabOf = (page: Page, name: string) =>
  page.getByRole("tab", { name: new RegExp(`^${name}`) });

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
const connectDialog = (page: Page) =>
  page.getByRole("dialog", { name: CONNECT_TITLE });
/** The agents that no longer work, folded under the active ones. */
const fold = (page: Page) => section(page, "Agents").locator("details");
const foldSummary = (page: Page) => fold(page).locator("summary");
const offRow = (page: Page, name: string) =>
  rows(page, "Revoked or expired agents").filter({ hasText: name });
/** An agent row's ⋯ button. */
const moreButton = (row: Locator) =>
  row.getByRole("button", { name: /^Actions for/ });
/** Opens an agent's ⋯ menu and picks Revoke…, which asks the question in the row. */
async function askRevoke(row: Locator) {
  await moreButton(row).click();
  await row.getByRole("button", { name: REVOKE_ITEM }).click();
}
const inviteButton = (page: Page) =>
  main(page).getByRole("button", { name: "Invite a member" });
const inviteForm = (page: Page) =>
  main(page).getByRole("form", { name: "Invite a member" });
const invitationRow = (page: Page, name: string) =>
  rows(page, "Invitations").filter({ hasText: name });
const notice = (page: Page) => main(page).getByRole("status");

/** Opens the invite form, fills it and presses Invite. */
async function invite(page: Page, email = "mira@example.com", name = "Mira") {
  await inviteButton(page).click();
  const form = inviteForm(page);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Display name").fill(name);
  await form.getByRole("button", { name: "Invite", exact: true }).click();
}
/** The token dialog: every dialog but the connect form's. */
const dialog = (page: Page) =>
  page
    .getByRole("dialog")
    .filter({ hasNot: page.getByRole("form", { name: CONNECT_TITLE }) });
const live = (page: Page) => main(page).locator('[aria-live="polite"]');
const revokeButton = (row: Locator) =>
  row.getByRole("button", { name: /^Revoke/ });
const sendAgain = (row: Locator) =>
  row.getByRole("button", { name: /^Send again/ });
const WAIT = "Sent a moment ago. Wait two minutes and try again.";
const LIMIT =
  "This address has had as many invitation emails as allowed. Try again tomorrow.";

/** Fills the connect form and presses Create. */
async function create(page: Page, name = "Desk agent") {
  await connect(page).click();
  await expect(connectDialog(page)).toBeVisible();
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

test("the rail marks Settings; the tabs show with counts; Agents is open; revoked agents are folded under '1 revoked or expired agent' and have no menu", async ({
  page,
}) => {
  await open(page);
  const link = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" });
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(link).toHaveAttribute("href", "/settings");

  await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(
    "Synapse · Settings",
  );
  // The tabs, each with its count: active agents, workspaces, topics, members with the open
  // invitations; the Hive tab has none.
  const tablist = main(page).getByRole("tablist", {
    name: "Settings sections",
  });
  await expect(tablist.getByRole("tab")).toHaveText([
    "Agents 2",
    "Workspaces 2",
    `Topics ${DATA.topics.length}`,
    "People 5",
    "Hive",
  ]);
  await expect(tabOf(page, "Agents")).toHaveAttribute("aria-selected", "true");
  await expect(tabOf(page, "People")).toHaveAttribute("aria-selected", "false");
  await expect(main(page).getByRole("tabpanel")).toHaveCount(1);
  await expect(main(page).getByRole("tabpanel")).toHaveAccessibleName(
    /^Agents/,
  );
  await expect(section(page, "Agents")).toContainText(
    "An agent writes into one workspace as you. It can never change sharing, accept links or delete notes.",
  );
  // The other tabs' sections are in the page, hidden.
  await expect(section(page, "Members")).toHaveCount(0);

  // The heading counts the active agents, as the tab does.
  await expect(section(page, "Agents").getByRole("heading")).toHaveText(
    /^Agents\s*2$/,
  );
  // The active agents, the newest on top.
  await expect(rows(page, "Agents")).toHaveCount(2);
  await expect(rows(page, "Agents").nth(0)).toContainText(LOCAL.name);
  await expect(rows(page, "Agents").nth(1)).toContainText(CLAUDE_CODE.name);

  // One grey line each: provider, tier, workspace, last used; and a ⋯ menu.
  const used = agentRow(page, CLAUDE_CODE.name);
  await expect(used.locator("p").nth(1).locator("span")).toHaveText([
    "Claude Code",
    "Vendor-hosted",
    MAIN.name,
    "Last used 23 Nov",
  ]);
  await expect(used).not.toContainText("Connected");
  await expect(moreButton(used)).toHaveAccessibleName(
    `Actions for ${CLAUDE_CODE.name}`,
  );
  await moreButton(used).click();
  await expect(used.getByRole("button", { name: REVOKE_ITEM })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(used.getByRole("button", { name: REVOKE_ITEM })).toHaveCount(0);

  const local = agentRow(page, LOCAL.name);
  await expect(local.locator("p").nth(1).locator("span")).toHaveText([
    "Other",
    "Self-hosted, notes held for release",
    DRA.name,
    "Never used",
  ]);

  // The one that no longer works is folded away, closed, below the active ones.
  await expect(foldSummary(page)).toHaveText(foldedAgents(1));
  await expect(foldSummary(page)).toHaveText("1 revoked or expired agent");
  await expect(fold(page)).not.toHaveAttribute("open");
  await expect(offRow(page, OLD.name)).toBeHidden();
  await foldSummary(page).click();
  const old = offRow(page, OLD.name);
  await expect(old).toBeVisible();
  await expect(old.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(old).toContainText("Last used 30 Oct");
  await expect(old.getByRole("button")).toHaveCount(0);

  await openTab(page, "People");
  await expect(section(page, "Members")).toBeVisible();
  await expect(section(page, "Agents")).toHaveCount(0);
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
  // The form is in a dialog of its own, headed with its name.
  await expect(connectDialog(page)).toBeVisible();
  await expect(connectDialog(page)).toHaveAttribute("aria-modal", "true");
  const form = connectForm(page);
  await expect(form.getByRole("heading", { level: 2 })).toHaveText(
    "Connect an agent",
  );
  await expect(form.getByRole("button")).toHaveText(["Cancel", "Create"]);
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

  // Cancel closes the dialog and gives the focus back; the next one starts empty.
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(connectDialog(page)).toHaveCount(0);
  await expect(connect(page)).toBeFocused();
  // So does Escape.
  await connect(page).click();
  await expect(connectDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(connectDialog(page)).toHaveCount(0);
  await expect(connect(page)).toBeFocused();
  await connect(page).click();
  await expect(name).toHaveValue("");
  await expect(form).not.toContainText("Choose a workspace.");

  await name.fill("  Desk agent ");
  await workspace.selectOption({ label: DRA.name });
  await form.getByLabel("Provider").selectOption("ChatGPT");
  await form.getByRole("radio", { name: /^Self-hosted/ }).check();
  await form.getByRole("button", { name: "Create" }).click();
  // On success the connect dialog closes and the token dialog opens.
  await expect(dialog(page)).toBeVisible();
  await expect(connectDialog(page)).toHaveCount(0);
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
  await expect(rows(page, "Agents")).toHaveCount(3);
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
  // The ⋯ menu holds Revoke…, which asks the question in the row in place of the menu.
  await askRevoke(target);
  await expect(target).toContainText(`Revoke ${LOCAL.name}?`);
  await expect(target).toContainText("It stops working within the hour.");
  await expect(moreButton(target)).toHaveCount(0);
  // The safe answer has the focus.
  await expect(target.getByRole("button", { name: "Keep" })).toBeFocused();
  expect(await calls(page)).toEqual([]);

  await target.getByRole("button", { name: "Keep" }).click();
  await expect(target).not.toContainText(`Revoke ${LOCAL.name}?`);
  await expect(target.getByRole("button", { name: "Keep" })).toHaveCount(0);
  await expect(moreButton(target)).toBeFocused();

  // Escape is Keep.
  await askRevoke(target);
  await expect(target).toContainText(`Revoke ${LOCAL.name}?`);
  await page.keyboard.press("Escape");
  await expect(target).not.toContainText(`Revoke ${LOCAL.name}?`);
  await expect(moreButton(target)).toBeFocused();
  expect(await calls(page)).toEqual([]);

  // One question at a time: asking about another agent closes this one.
  await askRevoke(target);
  const other = agentRow(page, CLAUDE_CODE.name);
  await askRevoke(other);
  await expect(other).toContainText(`Revoke ${CLAUDE_CODE.name}?`);
  await expect(target).not.toContainText(`Revoke ${LOCAL.name}?`);
  await other.getByRole("button", { name: "Keep" }).click();

  await askRevoke(target);
  // A confirming press straight after the question is taken as a double click and ignored.
  // Keep this assertion: it is the one that exercises the 500 ms guard. The double clicks by
  // coordinates further down land on the ⋯ button, which only opens and closes its menu.
  await target.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(target).toContainText(`Revoke ${LOCAL.name}?`);
  expect(await calls(page)).toEqual([]);
  await page.waitForTimeout(600);
  await target.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(live(page)).toHaveText(`${LOCAL.name} revoked.`);
  expect(await calls(page)).toEqual([
    { name: "revokeAgent", args: [LOCAL.id] },
  ]);
  // It joins the ones that no longer work, folded under the active one; the fold has the focus.
  await expect(rows(page, "Agents")).toHaveCount(1);
  await expect(rows(page, "Agents").nth(0)).toContainText(CLAUDE_CODE.name);
  await expect(foldSummary(page)).toHaveText(foldedAgents(2));
  await expect(foldSummary(page)).toBeFocused();
  await foldSummary(page).click();
  const gone = offRow(page, LOCAL.name);
  await expect(gone.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(gone.getByRole("button")).toHaveCount(0);

  // By coordinates, where a real double click lands, narrow and wide.
  for (const width of [390, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const row = agentRow(page, LOCAL.name);
    const box = await moreButton(row).boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
    expect(await calls(page)).toEqual([]);
    await expect(row.getByText("Revoked", { exact: true })).toHaveCount(0);
    await expect(row).not.toContainText(`Revoke ${LOCAL.name}?`);
  }
});

test("the Agents tab shows one primary button", async ({ page }) => {
  await open(page);
  const primaries = () =>
    page.evaluate(() => {
      const panel = document.getElementById("panel-agents")!;
      const yellow = getComputedStyle(
        document.querySelector('[data-open="connect"]')!,
      ).backgroundColor;
      return [...panel.querySelectorAll("button")].filter(
        (b) =>
          b.getClientRects().length > 0 &&
          getComputedStyle(b).backgroundColor === yellow,
      ).length;
    });
  expect(await primaries()).toBe(1);
  // With a question open, and with the fold open, still one.
  await askRevoke(agentRow(page, LOCAL.name));
  await foldSummary(page).click();
  expect(await primaries()).toBe(1);
  // With no agents, the one is Connect an agent.
  await open(page, "?none=1");
  expect(await primaries()).toBe(1);
  await expect(connect(page)).toBeVisible();
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
  await expect(rows(page, "Agents")).toHaveCount(2);
  await form.getByRole("button", { name: "Cancel" }).click();

  const target = agentRow(page, LOCAL.name);
  await askRevoke(target);
  await page.waitForTimeout(600);
  await target.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(target).toContainText(FAILED);
  await expect(target.getByText("Revoked", { exact: true })).toHaveCount(0);
  // The question closes and the focus is back on the row's ⋯.
  await expect(moreButton(target)).toBeFocused();
  await expect(live(page)).toHaveText(FAILED);
  await expect(rows(page, "Agents").nth(0)).toContainText(LOCAL.name);
});

test("Invite a member: the form says what will happen; a bad email or an empty name is refused with no call", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "People");
  await inviteButton(page).click();
  const form = inviteForm(page);
  await expect(form).toContainText(INVITE_HELP);
  const email = form.getByLabel("Email");
  const name = form.getByLabel("Display name");
  const send = form.getByRole("button", { name: "Invite", exact: true });
  await expect(email).toBeFocused();

  for (const bad of ["", "mira", "mira@@example.com", "mi ra@example.com"]) {
    await email.fill(bad);
    await name.fill("Mira");
    await send.click();
    await expect(form).toContainText("Enter an email address.");
    await expect(email).toBeFocused();
  }
  await email.fill("mira@example.com");
  await name.fill("  ");
  await send.click();
  await expect(form).toContainText("Give them a display name.");
  await expect(name).toBeFocused();
  await name.fill("M".repeat(61));
  await send.click();
  await expect(form).toContainText("Keep the name to 60 characters or fewer.");
  expect(await calls(page)).toEqual([]);

  // Opening the other form, on the Agents tab, closes this one: one at a time. The connect
  // dialog covers the card, so it is put away before the tabs can be reached again.
  await openTab(page, "Agents");
  await connect(page).click();
  await expect(form).toHaveCount(0);
  await expect(connectForm(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(connectDialog(page)).toHaveCount(0);
  await openTab(page, "People");
  await inviteButton(page).click();
  await expect(connectForm(page)).toHaveCount(0);
  await expect(email).toHaveValue("");
  // Escape puts the form away.
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(inviteButton(page)).toBeFocused();
  expect(await calls(page)).toEqual([]);
});

test("inviting never adds a member; when the email could not be sent the notice says to use Send again", async ({
  page,
}) => {
  await open(page, "?unsent=1");
  await openTab(page, "People");
  await invite(page, " mira@example.com ", " Mira ");
  expect(await calls(page)).toEqual([
    { name: "inviteMember", args: ["mira@example.com", "Mira"] },
  ]);
  await expect(inviteForm(page)).toHaveCount(0);
  await expect(inviteButton(page)).toBeFocused();
  // Nobody joined: the invitation is saved and waits for the person to press Join.
  await expect(rows(page, "Members")).toHaveCount(3);
  await expect(rows(page, "Invitations")).toHaveCount(3);
  await expect(notice(page)).toHaveText(
    "Invitation saved, but the email could not be sent. Wait two minutes, then use Send again.",
  );
  await expect(main(page)).not.toContainText("added");

  // Send again on that invitation sends it, and the notice that it was not sent goes.
  const mira = invitationRow(page, "Mira");
  await sendAgain(mira).click();
  await expect(live(page)).toHaveText("Invitation for Mira sent again.");
  await expect(notice(page)).toBeEmpty();
  await expect(rows(page, "Invitations")).toHaveCount(3);
  // The next form starts empty.
  await inviteButton(page).click();
  await expect(inviteForm(page).getByLabel("Email")).toHaveValue("");
  await expect(inviteForm(page).getByLabel("Display name")).toHaveValue("");
});

test("inviting someone: the invitation is listed with its dates; the notice says where it was sent and stays until Dismiss", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "People");
  // The two that were already open, the newest first.
  await expect(rows(page, "Invitations")).toHaveCount(2);
  await expect(section(page, "Invitations")).toContainText(INVITATIONS_NOTE);
  await expect(rows(page, "Invitations").nth(0)).toContainText(LENA.name);
  const lena = invitationRow(page, LENA.name);
  await expect(lena).toContainText(LENA.email);
  await expect(lena).toContainText("Invited 22 Nov");
  await expect(lena).toContainText("Expires 6 Dec");
  await expect(invitationRow(page, MARKO.name)).toContainText("Expires 4 Dec");
  await expect(notice(page)).toBeEmpty();

  await invite(page, " mira@example.com ", " Mira ");
  expect(await calls(page)).toEqual([
    { name: "inviteMember", args: ["mira@example.com", "Mira"] },
  ]);
  await expect(inviteForm(page)).toHaveCount(0);
  await expect(rows(page, "Members")).toHaveCount(3);
  await expect(rows(page, "Invitations")).toHaveCount(3);
  const mira = invitationRow(page, "Mira");
  await expect(mira).toContainText("mira@example.com");
  await expect(mira).toContainText("Invited 23 Nov");
  await expect(mira).toContainText("Expires 7 Dec");

  const said = inviteNotice("mira@example.com", true);
  expect(said).toBe("Invitation sent to mira@example.com.");
  await expect(notice(page)).toHaveText(said);
  await expect(notice(page)).toBeInViewport();
  // Nothing tells the owner to pass an address on by hand any more.
  await expect(main(page).getByRole("button", { name: /^Cop/ })).toHaveCount(0);
  await expect(main(page)).not.toContainText("/login");

  // It stays: another form opened and closed, on another tab, does not take it away, and
  // neither does sending the email again.
  await openTab(page, "Agents");
  await connect(page).click();
  await connectForm(page).getByRole("button", { name: "Cancel" }).click();
  await openTab(page, "People");
  await expect(notice(page)).toHaveText(said);
  await sendAgain(mira).click();
  await expect(live(page)).toHaveText("Invitation for Mira sent again.");
  await expect(notice(page)).toHaveText(said);

  await main(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(notice(page)).toBeEmpty();
  await expect(main(page).getByRole("button", { name: "Dismiss" })).toHaveCount(
    0,
  );
  await expect(main(page)).not.toContainText("Invitation sent to");
  await expect(inviteButton(page)).toBeFocused();
  // The invitation itself is still open.
  await expect(rows(page, "Invitations")).toHaveCount(3);
});

test("a refused invitation says why and keeps the form open with what was typed", async ({
  page,
}) => {
  for (const [query, said] of [
    ["?reason=already-member", "That person is already a member."],
    ["?reason=already-invited", "That email is already invited."],
    ["?reason=too-many", "Too many invitations today. Try again tomorrow."],
    ["?fail=1", FAILED],
  ] as const) {
    await open(page, query);
    await openTab(page, "People");
    await invite(page);
    const form = inviteForm(page);
    await expect(form).toContainText(said);
    await expect(live(page)).toHaveText(said);
    await expect(form.getByLabel("Email")).toHaveValue("mira@example.com");
    await expect(form.getByLabel("Display name")).toHaveValue("Mira");
    await expect(rows(page, "Members")).toHaveCount(3);
    await expect(rows(page, "Invitations")).toHaveCount(2);
    await expect(notice(page)).toBeEmpty();
    expect(await calls(page)).toEqual([
      { name: "inviteMember", args: ["mira@example.com", "Mira"] },
    ]);
  }
});

test("Revoke on an invitation removes it in one step; a refused revoke keeps the row and says so", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "People");
  const lena = invitationRow(page, LENA.name);
  // Each Revoke says whose invitation it is.
  await expect(
    lena.getByRole("button", { name: `Revoke invitation for ${LENA.name}` }),
  ).toBeVisible();
  await expect(
    invitationRow(page, MARKO.name).getByRole("button", {
      name: `Revoke invitation for ${MARKO.name}`,
    }),
  ).toBeVisible();
  await revokeButton(lena).click();
  await expect(rows(page, "Invitations")).toHaveCount(1);
  await expect(lena).toHaveCount(0);
  await expect(invitationRow(page, MARKO.name)).toBeVisible();
  expect(await calls(page)).toEqual([
    { name: "revokeInvitation", args: [LENA.id] },
  ]);
  await expect(live(page)).toHaveText(`Invitation for ${LENA.name} revoked.`);
  await expect(dialog(page)).toHaveCount(0);

  // The last one gone, the section goes with it.
  await revokeButton(invitationRow(page, MARKO.name)).click();
  await expect(section(page, "Invitations")).toHaveCount(0);
  await expect(inviteButton(page)).toBeFocused();

  await open(page, "?fail=1");
  await openTab(page, "People");
  const kept = invitationRow(page, LENA.name);
  await revokeButton(kept).click();
  await expect(kept).toContainText(FAILED);
  await expect(live(page)).toHaveText(FAILED);
  await expect(rows(page, "Invitations")).toHaveCount(2);
  await expect(revokeButton(kept)).toBeFocused();
  expect(await calls(page)).toEqual([
    { name: "revokeInvitation", args: [LENA.id] },
  ]);
});

test("Send again on an invitation sends its email once more in one step; too soon or refused says so in the row", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "People");
  const lena = invitationRow(page, LENA.name);
  // Each Send again says whose invitation it is, and comes before Revoke.
  await expect(
    lena.getByRole("button", { name: `Send again to ${LENA.name}` }),
  ).toHaveText("Send again");
  await expect(
    invitationRow(page, MARKO.name).getByRole("button", {
      name: `Send again to ${MARKO.name}`,
    }),
  ).toBeVisible();
  await expect(lena.getByRole("button")).toHaveText(["Send again", "Revoke"]);
  // It looks like the Revoke beside it: the same quiet button.
  expect(await sendAgain(lena).getAttribute("class")).toBe(
    await revokeButton(lena).getAttribute("class"),
  );

  await sendAgain(lena).click();
  await expect(live(page)).toHaveText(
    `Invitation for ${LENA.name} sent again.`,
  );
  expect(await calls(page)).toEqual([
    { name: "resendInvitation", args: [LENA.id] },
  ]);
  // Nothing moves: the row stays, the focus stays on the button, no notice, no dialog.
  await expect(rows(page, "Invitations")).toHaveCount(2);
  await expect(sendAgain(lena)).toBeFocused();
  await expect(lena).not.toContainText(FAILED);
  await expect(notice(page)).toBeEmpty();
  await expect(dialog(page)).toHaveCount(0);

  // A second press while the first is still under way asks once.
  await open(page, "?tab=people");
  const twice = sendAgain(invitationRow(page, LENA.name));
  await twice.dblclick();
  await expect(live(page)).toHaveText(
    `Invitation for ${LENA.name} sent again.`,
  );
  expect(await calls(page)).toEqual([
    { name: "resendInvitation", args: [LENA.id] },
  ]);

  await open(page, "?limit=1&tab=people");
  const spent = invitationRow(page, LENA.name);
  await sendAgain(spent).click();
  await expect(spent).toContainText(LIMIT);
  await expect(live(page)).toHaveText(LIMIT);
  await expect(rows(page, "Invitations")).toHaveCount(2);

  await open(page, "?wait=1&tab=people");
  const soon = invitationRow(page, LENA.name);
  await sendAgain(soon).click();
  await expect(soon).toContainText(WAIT);
  await expect(live(page)).toHaveText(WAIT);
  await expect(invitationRow(page, MARKO.name)).not.toContainText(WAIT);
  await expect(sendAgain(soon)).toBeFocused();
  await expect(rows(page, "Invitations")).toHaveCount(2);

  await open(page, "?fail=1&tab=people");
  const kept2 = invitationRow(page, LENA.name);
  await sendAgain(kept2).click();
  await expect(kept2).toContainText(FAILED);
  await expect(live(page)).toHaveText(FAILED);
  await expect(rows(page, "Invitations")).toHaveCount(2);
  expect(await calls(page)).toEqual([
    { name: "resendInvitation", args: [LENA.id] },
  ]);
  // Revoking next says its own refusal once, not both.
  await revokeButton(kept2).click();
  await expect(live(page)).toHaveText(FAILED);
  await expect(kept2.getByText(FAILED)).toHaveCount(1);
});

test("revoking the invitation a notice is about takes the notice away too", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "People");
  await invite(page);
  await expect(notice(page)).toContainText("Invitation sent to");
  await revokeButton(invitationRow(page, "Mira")).click();
  await expect(rows(page, "Invitations")).toHaveCount(2);
  await expect(notice(page)).toBeEmpty();
});

test("a member who is not the owner sees the members on the People tab, no invite form and no invitations", async ({
  page,
}) => {
  await open(page, "?member=1");
  await openTab(page, "People");
  await expect(rows(page, "Members")).toHaveCount(3);
  await expect(inviteButton(page)).toHaveCount(0);
  await expect(inviteForm(page)).toHaveCount(0);
  await expect(section(page, "Invitations")).toHaveCount(0);
  await expect(rows(page, "Invitations")).toHaveCount(0);
  await expect(main(page)).not.toContainText("Invitations");
  await expect(main(page)).not.toContainText(LENA.email);
  await expect(notice(page)).toHaveCount(0);
  await expect(
    memberRow(page, "Ahmed").getByText("you", { exact: true }),
  ).toBeVisible();
  await expect(
    memberRow(page, "Danijel").getByText("you", { exact: true }),
  ).toHaveCount(0);
  await expect(memberRow(page, "Danijel")).toContainText("Owner");
  // Their own agents are still theirs to manage.
  await openTab(page, "Agents");
  await expect(connect(page)).toBeVisible();
});

test("at 1100 x 560 with the invite form open, the notice and the invitations, the page does not scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page);
  const measure = () =>
    page.evaluate(() => {
      const root = document.scrollingElement!;
      const panel = document.querySelector("main")!.getBoundingClientRect();
      return {
        pageScrolls:
          root.scrollHeight > window.innerHeight ||
          root.scrollWidth > window.innerWidth,
        inside:
          panel.bottom <= window.innerHeight &&
          panel.right <= window.innerWidth,
        sideways: [...document.querySelectorAll("main *")].some(
          (el) =>
            el.scrollWidth > el.clientWidth + 1 &&
            /auto|scroll/.test(getComputedStyle(el).overflowY),
        ),
      };
    });
  const fine = { pageScrolls: false, inside: true, sideways: false };
  await openTab(page, "People");
  await expect(rows(page, "Invitations")).toHaveCount(2);
  expect(await measure()).toEqual(fine);

  await inviteButton(page).click();
  const form = inviteForm(page);
  // The form opens low in the card and is brought whole into view.
  await expect(form.getByLabel("Email")).toBeInViewport();
  await expect(form.getByRole("button", { name: "Cancel" })).toBeInViewport();
  expect(await measure()).toEqual(fine);

  await form.getByLabel("Email").fill("mira@example.com");
  await form.getByLabel("Display name").fill("Mira");
  await form.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(notice(page)).toContainText("Invitation sent to");
  await inviteButton(page).click();
  await expect(rows(page, "Invitations")).toHaveCount(3);
  expect(await measure()).toEqual(fine);
  // Every invitation's Revoke can be reached inside the card.
  const last = revokeButton(invitationRow(page, MARKO.name));
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await measure()).toEqual(fine);
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
      const list = document.querySelector('ul[aria-label="Agents"]')!;
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

  // From the heading, Tab reaches the open tab, then walks its panel: Connect and each ⋯.
  // Each other tab, once chosen, is followed by its own panel: each workspace's ⋯, the
  // topics' controls, Invite a member, then each invitation's Send again and Revoke.
  await main(page).getByRole("heading", { level: 1 }).focus();
  await page.keyboard.press("Tab");
  await expect(tabOf(page, "Agents")).toBeFocused();
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
  await expect(moreButton(agentRow(page, LOCAL.name))).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(moreButton(agentRow(page, CLAUDE_CODE.name))).toBeFocused();
  // Then the fold of the agents that no longer work.
  await page.keyboard.press("Tab");
  await expect(foldSummary(page)).toBeFocused();
  await openTab(page, "Workspaces");
  await expect(tabOf(page, "Workspaces")).toBeFocused();
  for (const space of [MAIN, DRA]) {
    await page.keyboard.press("Tab");
    await expect(
      main(page).getByRole("button", { name: `Actions for ${space.name}` }),
    ).toBeFocused();
  }
  // Then the Topics tab: the search, Find, the kind chips, and each topic's ⋯ (customers
  // before vendors).
  await openTab(page, "Topics");
  await page.keyboard.press("Tab");
  await expect(
    main(page).getByRole("searchbox", { name: "Find a topic" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    main(page).getByRole("button", { name: "Find topics in my notes" }),
  ).toBeFocused();
  for (const chip of ["All", "Customers", "Vendors"]) {
    await page.keyboard.press("Tab");
    await expect(
      main(page)
        .getByRole("group", { name: "Kinds" })
        .getByRole("button", { name: new RegExp(`^${chip}`) }),
    ).toBeFocused();
  }
  for (const topic of ["Zain", "Terra Drone"]) {
    await page.keyboard.press("Tab");
    await expect(
      main(page).getByRole("button", { name: `Actions for ${topic}` }),
    ).toBeFocused();
  }
  await openTab(page, "People");
  await page.keyboard.press("Tab");
  await expect(inviteButton(page)).toBeFocused();
  await expect(inviteButton(page)).toBeInViewport();
  for (const who of [LENA, MARKO]) {
    await page.keyboard.press("Tab");
    await expect(
      main(page).getByRole("button", { name: `Send again to ${who.name}` }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      main(page).getByRole("button", {
        name: `Revoke invitation for ${who.name}`,
      }),
    ).toBeFocused();
  }

  // The connect form, by keyboard alone.
  await openTab(page, "Agents");
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
  await expect(form.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(form.getByRole("button", { name: "Create" })).toBeFocused();
  // The dialog holds the focus: past Create, Tab turns round to Name, and back.
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(form.getByRole("button", { name: "Create" })).toBeFocused();
  // With the dialog open the page does not scroll, and Create is inside the window.
  expect((await fits()).pageScrolls).toBe(false);
  await expect(form.getByRole("button", { name: "Create" })).toBeInViewport();
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
  await expect(rows(page, "Agents")).toHaveCount(3);
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

// ---- Delete this hive ----

const DELETE_AFTER = "2026-11-30T12:00:00.000Z";
const NOT_THE_NAME = "That is not this hive's name.";
const deleteSection = (page: Page) => section(page, "Delete this hive");
const deleteForm = (page: Page) =>
  main(page).getByRole("form", { name: "Delete this hive" });
const deleteField = (page: Page) =>
  deleteForm(page).getByLabel("Type the hive's name to confirm");
const deleteButton = (page: Page) =>
  deleteForm(page).getByRole("button", { name: "Delete hive" });
const banner = (page: Page) => page.locator("[data-closing]");
const deletionCalls = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem("__hiveDeletionCalls") ?? "[]",
      ) as Call[],
  );
/** The day as this browser writes it for the person. */
const localDay = (page: Page, iso: string) =>
  page.evaluate(
    (v) =>
      new Date(v).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    iso,
  );

test("the owner's last section says what deleting erases, on the Hive tab; a member has no Hive tab", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "Hive");
  const part = deleteSection(page);
  await expect(part).toContainText(
    "Deleting this hive erases 128 notes and 14 files of 3 members.",
  );
  await expect(part).toContainText("For 7 days the hive can only be read");
  // The last section of the card.
  expect(
    await main(page).locator("section").last().getAttribute("aria-labelledby"),
  ).toBe("settings-delete");
  await expect(banner(page)).toHaveCount(0);

  await open(page, "?member=1", false);
  await expect(tabOf(page, "Hive")).toHaveCount(0);
  await expect(deleteSection(page)).toHaveCount(0);
  await expect(deleteForm(page)).toHaveCount(0);
  // A member's own workspaces still offer Delete; the hive's deletion does not show.
  await expect(main(page)).not.toContainText("Delete this hive");
  await expect(main(page)).not.toContainText("Delete hive");
});

test("Delete hive does nothing until the hive's name is typed exactly, and says why", async ({
  page,
}) => {
  await open(page, "?tab=hive");
  const button = deleteButton(page);
  const field = deleteField(page);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleDescription(
    'Delete hive can be pressed once you have typed "Synapse" exactly.',
  );
  await expect(field).toHaveAccessibleDescription(
    'Delete hive can be pressed once you have typed "Synapse" exactly.',
  );
  for (const wrong of ["synapse", "Synapse ", "Synaps", " Synapse"]) {
    await field.fill(wrong);
    await expect(button).toBeDisabled();
    await button.click({ force: true });
    await field.press("Enter");
  }
  expect(await deletionCalls(page)).toEqual([]);
  await field.fill("Synapse");
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute("aria-describedby", /.+/);
  // The button stays in the keyboard's path while it does nothing.
  await field.fill("x");
  await field.press("Tab");
  await expect(button).toBeFocused();
});

test("a refused deletion says why, keeps what was typed and puts the focus back in the field", async ({
  page,
}) => {
  await open(page, "?notname=1&tab=hive");
  await deleteField(page).fill("Synapse");
  await deleteButton(page).click();
  await expect(deleteForm(page).getByText(NOT_THE_NAME)).toBeVisible();
  await expect(live(page)).toHaveText(NOT_THE_NAME);
  await expect(deleteField(page)).toHaveValue("Synapse");
  await expect(deleteField(page)).toBeFocused();
  expect(await deletionCalls(page)).toEqual([
    { name: "requestHiveDeletion", args: ["Synapse"] },
  ]);
  // Typing again takes the line away.
  await deleteField(page).fill("Synapse!");
  await expect(deleteForm(page).getByText(NOT_THE_NAME)).toHaveCount(0);

  await open(page, "?fail=1&tab=hive", false);
  await deleteField(page).fill("Synapse");
  await deleteField(page).press("Enter");
  await expect(deleteForm(page).getByText(FAILED)).toBeVisible();
  await expect(live(page)).toHaveText(FAILED);
  await expect(deleteSection(page)).not.toContainText("will be deleted on");
});

test("Delete hive asks once and loads the page afresh: the banner and Cancel deletion are there; cancelling brings the form back", async ({
  page,
}) => {
  await open(page);
  // Chosen here, the tab is in the address, so the page loaded afresh opens on it again.
  await openTab(page, "Hive");
  await page.evaluate(() => {
    (window as unknown as { __before?: boolean }).__before = true;
  });
  await deleteField(page).fill("Synapse");
  await deleteButton(page).dblclick();
  const part = deleteSection(page);
  await expect(part).toContainText("This hive will be deleted on");
  // A full load: nothing set on the old window is left.
  expect(
    await page.evaluate(
      () => (window as unknown as { __before?: boolean }).__before,
    ),
  ).toBeUndefined();
  expect(await deletionCalls(page)).toEqual([
    { name: "requestHiveDeletion", args: ["Synapse"] },
  ]);
  await expect(deleteForm(page)).toHaveCount(0);
  await expect(banner(page)).toBeVisible();

  await part.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(deleteField(page)).toBeVisible();
  await expect(deleteField(page)).toHaveValue("");
  await expect(banner(page)).toHaveCount(0);
  expect(await deletionCalls(page)).toEqual([
    { name: "requestHiveDeletion", args: ["Synapse"] },
    { name: "cancelHiveDeletion", args: [] },
  ]);
});

test("while the hive is being deleted the section says when it goes, in the person's own date, and offers Cancel deletion", async ({
  page,
}) => {
  await open(page, "?closing=1&tab=hive");
  const part = deleteSection(page);
  const day = await localDay(page, DELETE_AFTER);
  const when = part.locator("time");
  await expect(when).toHaveAttribute("datetime", DELETE_AFTER);
  await expect(when).toHaveText(day);
  await expect(part).toContainText(`This hive will be deleted on ${day}.`);
  await expect(part).toContainText("Until then it can only be read.");
  await expect(part).not.toContainText("128 notes");
  await expect(deleteForm(page)).toHaveCount(0);
  await expect(
    part.getByRole("button", { name: "Cancel deletion" }),
  ).toBeVisible();
  // The banner says the same day, above the rail and the card.
  await expect(banner(page).getByRole("status")).toHaveText(
    `This hive will be deleted on ${day}. Nothing new can be saved.`,
  );
});

test("a refused Cancel deletion says so and the hive stays as it was", async ({
  page,
}) => {
  await open(page, "?closing=1&fail=1&tab=hive");
  const part = deleteSection(page);
  const cancel = part.getByRole("button", { name: "Cancel deletion" });
  await cancel.click();
  await expect(part.getByText(FAILED)).toBeVisible();
  await expect(live(page)).toHaveText(FAILED);
  await expect(part).toContainText("This hive will be deleted on");
  await expect(cancel).toBeEnabled();
  expect(await deletionCalls(page)).toEqual([
    { name: "cancelHiveDeletion", args: [] },
  ]);
});

test("a member of a hive that is being deleted sees the banner, with nothing to press, and no section", async ({
  page,
}) => {
  await open(page, "?closing=1&member=1&tab=hive");
  await expect(banner(page).getByRole("status")).toContainText(
    "Nothing new can be saved.",
  );
  await expect(banner(page).getByRole("button")).toHaveCount(0);
  await expect(deleteSection(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cancel deletion" }),
  ).toHaveCount(0);
});

test("the server and the browser draw the date the same way first: no hydration error", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  await open(page, "?closing=1&tab=hive");
  await expect(deleteSection(page).locator("time")).toHaveText(
    await localDay(page, DELETE_AFTER),
  );
  expect(problems.filter((p) => /hydrat|did not match/i.test(p))).toEqual([]);
  // What the server sent is the fixed form.
  const html = await (await page.request.get("/dev/settings?closing=1")).text();
  expect(html).toContain("30 November 2026");
});

test("with the banner, at 1100 x 560 the page still does not scroll and the card ends inside the window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 });
  await open(page, "?closing=1");
  await expect(banner(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.scrollingElement!;
        const panel = document.querySelector("main")!.getBoundingClientRect();
        const strip = document
          .querySelector("[data-closing]")!
          .getBoundingClientRect();
        const rail = document
          .querySelector('aside[aria-label="Navigation"]')!
          .getBoundingClientRect();
        return {
          pageScrolls:
            root.scrollHeight > window.innerHeight ||
            root.scrollWidth > window.innerWidth,
          inside: panel.bottom <= window.innerHeight,
          bannerOnTop: strip.top === 0 && strip.bottom <= rail.top + 0.5,
          clearOfCard: strip.bottom <= panel.top,
        };
      }),
    )
    .toEqual({
      pageScrolls: false,
      inside: true,
      bannerOnTop: true,
      clearOfCard: true,
    });
  // The section on the Hive tab can still be reached inside the card.
  await openTab(page, "Hive");
  const cancel = deleteSection(page).getByRole("button", {
    name: "Cancel deletion",
  });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.scrollingElement!.scrollHeight > window.innerHeight,
    ),
  ).toBe(false);
});

test("at 390 px the banner and the delete section stay inside the window and cover nothing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "?closing=1");
  const strip = (await banner(page).boundingBox())!;
  const rail = (await page
    .getByRole("complementary", { name: "Navigation" })
    .boundingBox())!;
  const card = (await main(page).boundingBox())!;
  expect(strip.x).toBeGreaterThanOrEqual(0);
  expect(strip.x + strip.width).toBeLessThanOrEqual(390);
  expect(strip.y + strip.height).toBeLessThanOrEqual(rail.y + 0.5);
  expect(strip.y + strip.height).toBeLessThanOrEqual(card.y);
  const press = banner(page).getByRole("button", { name: "Cancel deletion" });
  const b = (await press.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await open(page, "?tab=hive", false);
  await deleteField(page).scrollIntoViewIfNeeded();
  for (const part of [deleteField(page), deleteButton(page)]) {
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

const workspaceRow = (page: Page, name: string) =>
  rows(page, "Workspaces").filter({ hasText: name });
/** Opens a workspace's ⋯ menu and picks Delete workspace…, which asks the question in the row. */
async function askDelete(row: Locator) {
  await moreButton(row).click();
  await row.getByRole("button", { name: DELETE_WORKSPACE_ITEM }).click();
}

test("Workspaces: Delete asks first with the note count; an agent in use refuses it; once revoked the workspace goes", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "Workspaces");
  await expect(rows(page, "Workspaces")).toHaveCount(2);
  const dra = workspaceRow(page, DRA.name);
  await expect(dra).toContainText("25 notes");
  await expect(section(page, "Workspaces")).toContainText(
    "files on your computer are not touched",
  );

  // Asked first; Keep and Escape change nothing.
  await askDelete(dra);
  await expect(dra).toContainText("Delete DRA and its 25 notes?");
  await expect(dra).toContainText("This cannot be undone.");
  await expect(dra.getByRole("button", { name: "Keep" })).toBeFocused();
  await dra.getByRole("button", { name: "Keep" }).click();
  await expect(dra).not.toContainText("Delete DRA and its 25 notes?");
  await expect(moreButton(dra)).toBeFocused();
  await askDelete(dra);
  await page.keyboard.press("Escape");
  await expect(dra).not.toContainText("This cannot be undone.");
  expect(await calls(page)).toEqual([]);

  // Its agent is still in use: refused, and the row says what to do.
  await askDelete(dra);
  await dra.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dra).toContainText("Revoke this workspace's agents first.");
  await expect(rows(page, "Workspaces")).toHaveCount(2);

  await openTab(page, "Agents");
  const local = agentRow(page, LOCAL.name);
  await askRevoke(local);
  await page.waitForTimeout(600);
  await local.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(live(page)).toHaveText(`${LOCAL.name} revoked.`);
  await expect(foldSummary(page)).toHaveText(foldedAgents(2));

  await openTab(page, "Workspaces");
  await askDelete(dra);
  await dra.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(rows(page, "Workspaces")).toHaveCount(1);
  await expect(live(page)).toHaveText("DRA deleted.");
  expect(
    (await calls(page)).filter((c) => c.name === "deleteWorkspace"),
  ).toEqual([
    { name: "deleteWorkspace", args: [DRA.id] },
    { name: "deleteWorkspace", args: [DRA.id] },
  ]);
  // The one that is left cannot go.
  const last = workspaceRow(page, MAIN.name);
  await expect(last).toContainText("Your only workspace");
  await expect(moreButton(last)).toHaveCount(0);
});

test("a failed workspace delete keeps the row and says so; a hive that is being deleted offers no Delete", async ({
  page,
}) => {
  await open(page, "?fail=1&tab=workspaces");
  const dra = workspaceRow(page, DRA.name);
  await askDelete(dra);
  await dra.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dra).toContainText(FAILED);
  await expect(rows(page, "Workspaces")).toHaveCount(2);

  await open(page, "?closing=1&tab=workspaces", false);
  await expect(rows(page, "Workspaces")).toHaveCount(2);
  await expect(moreButton(workspaceRow(page, DRA.name))).toHaveCount(0);
});

// ---- Topics ----

const topics = (page: Page) => section(page, "Topics");
const findTopics = (page: Page) =>
  topics(page).getByRole("button", { name: "Find topics in my notes" });
/** The candidates: a form in the dialog named for them. */
const foundDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Topics found in your notes" });
const foundForm = (page: Page) =>
  foundDialog(page).getByRole("form", { name: "Topics found in your notes" });
const topicGrid = (page: Page) =>
  topics(page).getByRole("list", { name: "Topics" });
const topicCell = (page: Page, name: string) =>
  topicGrid(page).getByRole("listitem").filter({ hasText: name });
const kindChip = (page: Page, name: string) =>
  topics(page)
    .getByRole("group", { name: "Kinds" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
/** Opens a topic's ⋯ menu and picks Delete topic…, which asks the question in the cell. */
async function askDeleteTopic(cell: Locator) {
  await moreButton(cell).click();
  await cell.getByRole("button", { name: "Delete topic…" }).click();
}

test("Topics: the owner finds candidates, new ones only, with subjects unticked; Save adds the ticked ones", async ({
  page,
}) => {
  await open(page);
  await openTab(page, "Topics");
  await expect(topics(page)).toContainText("Zain");
  await expect(topics(page)).toContainText("198 notes");
  await expect(topics(page)).toContainText("No notes yet");

  await findTopics(page).click();
  // The candidates open in a dialog named for them, with their heading focused.
  await expect(foundDialog(page)).toBeVisible();
  const found = foundForm(page);
  await expect(
    found.getByRole("heading", { name: "Topics found in your notes" }),
  ).toBeFocused();
  await expect(found).toContainText("2 of 4 ticked");
  // Zain is there already: only Orbit and the tag are offered.
  const orbit = found.getByRole("checkbox", { name: "Customers: Orbit" });
  const flare = found.getByRole("checkbox", { name: "Subjects: flare-stack" });
  const rovs = found.getByRole("checkbox", {
    name: "Solutions: Underwater ROVs",
  });
  await expect(orbit).toBeChecked();
  await expect(rovs).toBeChecked();
  await expect(flare).not.toBeChecked();
  await expect(
    found.getByRole("checkbox", { name: "Customers: Zain" }),
  ).toHaveCount(0);
  await expect(found).toContainText("tag on 5 notes");
  // A partner named like the saved customer is offered, unticked, and says where it is.
  const zainPartner = found.getByRole("checkbox", {
    name: "Partners: Zain, already under Customers",
  });
  await expect(zainPartner).toBeVisible();
  await expect(zainPartner).not.toBeChecked();
  await expect(
    found.getByRole("listitem").filter({ hasText: "already under Customers" }),
  ).toHaveCount(1);
  // What is saved with a topic is shown, and so is who will see it.
  await expect(found.getByText("also: Orbit Aerospace")).toBeVisible();
  await expect(
    found.getByText(
      "Every member of the hive can see a topic's name and its other names.",
    ),
  ).toBeVisible();

  await found.getByRole("button", { name: "Save 2 topics" }).click();
  await expect(foundDialog(page)).toHaveCount(0);
  await expect(live(page)).toHaveText(
    "2 topics saved. Now open the vault and press Attach topics.",
  );
  // Seen as well as announced, and the focus is on Find, not lost with the form.
  await expect(
    topics(page).getByText(
      "2 topics saved. Now open the vault and press Attach topics.",
    ),
  ).toBeVisible();
  await expect(findTopics(page)).toBeFocused();
  await expect(topicGrid(page)).toContainText("Orbit");
  await expect(kindChip(page, "Customers")).toContainText("2");
  const saves = (await calls(page)).filter((c) => c.name === "saveTopics");
  expect(saves).toEqual([
    {
      name: "saveTopics",
      args: [
        [
          { kind: "client", name: "Orbit", aliases: ["Orbit Aerospace"] },
          { kind: "solution", name: "Underwater ROVs", aliases: [] },
        ],
      ],
    },
  ]);
  // Both of the owner's workspaces were read, from the start.
  expect(
    (await calls(page))
      .filter((c) => c.name === "scanTopics")
      .map((c) => c.args),
  ).toEqual([
    [MAIN.id, null],
    [DRA.id, null],
  ]);
});

test("Topics: Delete, from ⋯, asks first and says the notes stay; a failed read or save says so; a hive being deleted offers no Find and no ⋯", async ({
  page,
}) => {
  await open(page, "?tab=topics");
  const row = topicCell(page, "Terra Drone");
  // Keep puts the question away and the focus back on ⋯.
  await askDeleteTopic(row);
  await expect(row).toContainText("Delete the topic Terra Drone?");
  await expect(row.getByRole("button", { name: "Keep" })).toBeFocused();
  await row.getByRole("button", { name: "Keep" }).click();
  await expect(row).not.toContainText("Delete the topic Terra Drone?");
  await expect(moreButton(row)).toBeFocused();
  await askDeleteTopic(row);
  await expect(row).toContainText("Delete the topic Terra Drone?");
  await expect(row).toContainText(
    "Notes stay. They are no longer under this topic.",
  );
  expect((await calls(page)).filter((c) => c.name === "deleteTopic")).toEqual(
    [],
  );
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(live(page)).toHaveText("Terra Drone deleted.");
  await expect(topics(page).getByText("Terra Drone deleted.")).toBeVisible();

  await open(page, "?fail=1&tab=topics");
  await findTopics(page).click();
  await expect(topics(page)).toContainText(
    "Your notes could not be read. Try again.",
  );
  await expect(foundDialog(page)).toHaveCount(0);

  await open(page, "?closing=1&tab=topics", false);
  await expect(topicGrid(page).getByRole("listitem")).toHaveCount(2);
  await expect(findTopics(page)).toHaveCount(0);
  await expect(moreButton(topicCell(page, "Zain"))).toHaveCount(0);
});

test("Topics: the candidates scroll inside the dialog and Save stays in view", async ({
  page,
}) => {
  await open(page, "?many=1&tab=topics");
  await findTopics(page).click();
  const found = foundForm(page);
  const group = found.getByRole("group", { name: /^Vendors/ });
  const toggle = group.getByRole("button", { name: /^Vendors/ });
  // A long kind still starts folded inside the dialog.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(group).toContainText("40 of 40 ticked");
  await expect(found.getByRole("checkbox")).toHaveCount(0);
  // Save is on screen without scrolling, and says how many it will save.
  const save = found.getByRole("button", { name: "Save 40 topics" });
  await expect(save).toBeInViewport();
  await expect(found).toContainText("40 of 40 ticked");
  // One primary on the tab, the dialog's Save: Find behind the dim is outlined.
  const yellow = await save.evaluate(
    (b) => getComputedStyle(b).backgroundColor,
  );
  expect(
    await page.evaluate(
      (bg) =>
        [
          ...document
            .getElementById("panel-topics")!
            .querySelectorAll("button"),
        ].filter(
          (b) =>
            b.getClientRects().length > 0 &&
            getComputedStyle(b).backgroundColor === bg,
        ).length,
      yellow,
    ),
  ).toBe(1);

  await group.getByRole("button", { name: "Untick all Vendors" }).click();
  await expect(group).toContainText("0 of 40 ticked");
  const none = found.getByRole("button", { name: "Save 0 topics" });
  await expect(none).toHaveAttribute("aria-disabled", "true");
  // Pressed anyway, it saves nothing and the dialog stays.
  await none.dispatchEvent("click");
  await expect(foundDialog(page)).toBeVisible();
  await toggle.click();
  await expect(found.getByRole("checkbox")).toHaveCount(40);
  // The dialog scrolls; the page behind it does not grow a scroll of its own for the list.
  const box = await foundDialog(page).evaluate((el) => ({
    height: el.clientHeight,
    inner: el.scrollHeight,
    scrolls: /auto|scroll/.test(getComputedStyle(el).overflowY),
    bottom: el.getBoundingClientRect().bottom,
  }));
  expect(box.scrolls).toBe(true);
  expect(box.inner).toBeGreaterThan(box.height);
  expect(box.bottom).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );
  await found
    .getByRole("checkbox", { name: "Vendors: Maker 9", exact: true })
    .check();
  await group
    .getByRole("button", { name: "Tick all Vendors", exact: true })
    .click();
  await found
    .getByRole("checkbox", { name: "Vendors: Maker 2", exact: true })
    .uncheck();
  await expect(group).toContainText("39 of 40 ticked");
  const save39 = found.getByRole("button", { name: "Save 39 topics" });
  await expect(save39).toBeInViewport();
  await save39.click();
  await expect(
    topics(page).getByText(
      "39 topics saved. Now open the vault and press Attach topics.",
    ),
  ).toBeVisible();
  const saves = (await calls(page)).filter((c) => c.name === "saveTopics");
  const names = saves.flatMap((c) =>
    (c.args[0] as { name: string }[]).map((p) => p.name),
  );
  expect(names).toHaveLength(39);
  expect(names).not.toContain("Maker 2");
});

test("Topics: search and chips filter the topics without a request; the chips show counts", async ({
  page,
}) => {
  await open(page, "?many=1&tab=topics");
  // Every kind with topics has a chip with its count; All comes first and is chosen.
  const chips = topics(page)
    .getByRole("group", { name: "Kinds" })
    .getByRole("button");
  await expect(chips).toHaveText([
    /^All\s*32$/,
    /^Customers\s*1$/,
    /^Vendors\s*31$/,
  ]);
  await expect(kindChip(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(topicGrid(page).getByRole("listitem")).toHaveCount(32);
  // Under All each topic says its kind.
  await expect(topicCell(page, "Zain")).toContainText("Customers");

  const asked: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (
      /\/_next\/static\/|__nextjs|webpack-hmr|\.(js|css|woff2?|png|svg)(\?|$)/.test(
        url,
      )
    )
      return;
    asked.push(`${r.method()} ${url}`);
  });

  await kindChip(page, "Vendors").click();
  await expect(kindChip(page, "Vendors")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(kindChip(page, "All")).toHaveAttribute("aria-pressed", "false");
  await expect(topicGrid(page).getByRole("listitem")).toHaveCount(31);
  await expect(topicCell(page, "Zain")).toHaveCount(0);
  // One kind chosen: the kind is not repeated on each topic.
  await expect(topicCell(page, "Terra Drone")).not.toContainText("Vendors");

  const search = topics(page).getByRole("searchbox", { name: "Find a topic" });
  await search.fill("  SUPPLIER 1 ");
  // Supplier 1 and 10 to 19.
  await expect(topicGrid(page).getByRole("listitem")).toHaveCount(11);
  await search.fill("zain");
  await expect(topicGrid(page)).toHaveCount(0);
  await expect(topics(page)).toContainText("No topic matches.");
  await kindChip(page, "All").click();
  await expect(topicGrid(page).getByRole("listitem")).toHaveCount(1);
  await expect(topicCell(page, "Zain")).toBeVisible();
  await search.fill("");
  await expect(topicGrid(page).getByRole("listitem")).toHaveCount(32);

  await page.waitForTimeout(300);
  expect(asked).toEqual([]);
  expect(await calls(page)).toEqual([]);
});

test("Topics: an open ⋯ menu is drawn over the cell below it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await open(page, "?many=1&tab=topics");
  const cell = topicCell(page, "Zain");
  await moreButton(cell).click();
  const item = cell.getByRole("button", { name: "Delete topic…" });
  await expect(item).toBeVisible();
  // The point at the item's centre hits the item, not the next cell.
  const hit = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return el === at || el.contains(at);
  });
  expect(hit).toBe(true);
});

test("Topics: a member who is not the owner has no Topics tab", async ({
  page,
}) => {
  await open(page, "?member=1");
  await expect(tabOf(page, "Topics")).toHaveCount(0);
  await expect(topics(page)).toHaveCount(0);
});

test("Topics: Cancel closes the candidates and puts the focus on Find; with nothing new, Find says so where it can be seen", async ({
  page,
}) => {
  await open(page, "?tab=topics");
  await findTopics(page).click();
  const found = foundForm(page);
  await found.getByRole("button", { name: "Cancel" }).click();
  await expect(foundDialog(page)).toHaveCount(0);
  await expect(findTopics(page)).toBeFocused();
  expect((await calls(page)).filter((c) => c.name === "saveTopics")).toEqual(
    [],
  );

  // Tick the subject too and save both: the hive then has everything the notes name.
  await findTopics(page).click();
  await found.getByRole("checkbox", { name: "Subjects: flare-stack" }).check();
  await found
    .getByRole("checkbox", { name: /^Partners: Zain, already under/ })
    .check();
  await found.getByRole("button", { name: "Save 4 topics" }).click();
  await expect(
    topics(page).getByText(
      "4 topics saved. Now open the vault and press Attach topics.",
    ),
  ).toBeVisible();
  await expect(findTopics(page)).toBeFocused();

  await findTopics(page).click();
  const nothing = topics(page).getByText(
    "Nothing new found. Every topic your notes name is already here.",
  );
  await expect(nothing).toBeVisible();
  await expect(found).toHaveCount(0);
  await expect(live(page)).toHaveText(
    "Nothing new found. Every topic your notes name is already here.",
  );
  // The earlier message has given way to this one.
  await expect(topics(page).getByText(/topics saved\./)).toHaveCount(0);
});

// ---- The tabs ----

test("?tab=topics opens Topics; choosing a tab writes ?tab= without a request", async ({
  page,
}) => {
  await open(page, "?tab=topics");
  await expect(tabOf(page, "Topics")).toHaveAttribute("aria-selected", "true");
  await expect(topics(page)).toBeVisible();
  await expect(section(page, "Agents")).toHaveCount(0);

  // From here on nothing is asked of the server: no page, no data, no server action.
  const asked: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (
      /\/_next\/static\/|__nextjs|webpack-hmr|\.(js|css|woff2?|png|svg)(\?|$)/.test(
        url,
      )
    )
      return;
    asked.push(`${r.method()} ${url}`);
  });
  const length = await page.evaluate(() => history.length);
  for (const [name, value] of [
    ["People", "people"],
    ["Hive", "hive"],
    ["Workspaces", "workspaces"],
    ["Agents", "agents"],
  ] as const) {
    await openTab(page, name);
    await expect(tabOf(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`[?&]tab=${value}$`));
  }
  await expect(section(page, "Agents")).toBeVisible();
  // Replaced in place: Back still leaves the page as it would have.
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.waitForTimeout(300);
  expect(asked).toEqual([]);

  // A Find topics under way, or a typed form, survives a switch: the panels stay in the page.
  await openTab(page, "People");
  await inviteButton(page).click();
  await inviteForm(page).getByLabel("Email").fill("mira@example.com");
  await openTab(page, "Topics");
  await openTab(page, "People");
  await expect(inviteForm(page).getByLabel("Email")).toHaveValue(
    "mira@example.com",
  );

  // A reload opens the tab in the address.
  await page.reload({ waitUntil: "networkidle" });
  await expect(tabOf(page, "People")).toHaveAttribute("aria-selected", "true");
  await expect(section(page, "Members")).toBeVisible();
});

test("arrow keys, Home and End move between tabs", async ({ page }) => {
  await open(page);
  const selected = (name: string) =>
    expect(tabOf(page, name)).toHaveAttribute("aria-selected", "true");
  // One tab is in the keyboard's path: the open one.
  await expect(tabOf(page, "Agents")).toHaveAttribute("tabindex", "0");
  await expect(tabOf(page, "Workspaces")).toHaveAttribute("tabindex", "-1");
  await tabOf(page, "Agents").focus();

  await page.keyboard.press("ArrowRight");
  await expect(tabOf(page, "Workspaces")).toBeFocused();
  await selected("Workspaces");
  await expect(section(page, "Workspaces")).toBeVisible();
  await expect(tabOf(page, "Workspaces")).toHaveAttribute("tabindex", "0");
  await expect(tabOf(page, "Agents")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowLeft");
  await expect(tabOf(page, "Agents")).toBeFocused();
  // Round the ends.
  await page.keyboard.press("ArrowLeft");
  await expect(tabOf(page, "Hive")).toBeFocused();
  await selected("Hive");
  await page.keyboard.press("ArrowRight");
  await expect(tabOf(page, "Agents")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabOf(page, "Hive")).toBeFocused();
  await expect(page).toHaveURL(/[?&]tab=hive$/);
  await page.keyboard.press("Home");
  await expect(tabOf(page, "Agents")).toBeFocused();
  await selected("Agents");

  // A member's last tab is People.
  await open(page, "?member=1");
  await tabOf(page, "Agents").focus();
  await page.keyboard.press("End");
  await expect(tabOf(page, "People")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabOf(page, "Agents")).toBeFocused();
});

test("?tab=hive for a member opens Agents", async ({ page }) => {
  for (const asked of ["hive", "topics", "nope"]) {
    await open(page, `?member=1&tab=${asked}`);
    await expect(main(page).getByRole("tablist").getByRole("tab")).toHaveText([
      "Agents 2",
      "Workspaces 2",
      "People 3",
    ]);
    await expect(tabOf(page, "Agents")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(section(page, "Agents")).toBeVisible();
  }
});
