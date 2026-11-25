# The Vault, tidied — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build round 2 of the interface rework: the Vault's top bar with one Add notes menu and a dialog, rows with topics and sharing icons, a note pane with one action row, a summary when no note is open, hidden empty folders, and a folder picker in a narrow card.

**Architecture:** Everything is client-side in `web/src/vault/`, over the data the loader already serves (`VaultData`). New pure functions (`rowTopics`, `isShown`, `withoutTitle`, `overview`, `sharedOverview`) carry the logic and are unit-tested; small new components (`AddNotes`, `PanelDialog`, `NoteMenu`, `TopicPicker`, `Overview`, `ScopePicker`) use them. Popovers reuse `web/src/map/useDismiss.ts`.

**Tech Stack:** Next.js (App Router) client components, React, CSS Modules (`vault.module.css`), Vitest for units, Playwright (`web/e2e/vault.spec.ts`, page `/dev/vault`) for the browser.

**Spec:** `docs/superpowers/specs/2026-11-25-vault-tidy-design.md`. Read the section each task names.

## Global Constraints

- No server, loader, migration or database change. No new request on first paint or on any interaction (spec §10). The browser test "choosing a folder and filtering narrow the list without a request" must keep passing.
- Every colour comes from a theme token (`var(--…)`); `src/vault/no-literals.test.ts` forbids colour literals in `src/vault`.
- Sentences a person reads live in the vault's text modules (`sentences.ts`, `topicText.ts`, `importText.ts`, …) as exported constants or functions, so tests import them.
- Controls: 8 px radius, 1 px hairlines that brighten on hover (move 25% towards the text colour), no drop shadows, no blur; JetBrains Mono 11 px uppercase 0.12em for section labels (`docs/ui-concept.md` §2).
- Writes stay exactly the ones today's `VaultActions` and `ImportActions` make; the database decides. Do not add permission logic.
- Existing browser tests are updated where words, order or the place of a control changed; a test is never deleted just to pass. A test whose premise is gone (for example "two openers side by side") is rewritten to the new rule the spec states.
- Each task runs, before committing: `pnpm --filter @hive-mind/web typecheck`, `pnpm --filter @hive-mind/web lint` (Prettier), `pnpm --filter @hive-mind/web test`, and the browser tests it touched: `cd web && npx playwright test e2e/vault.spec.ts --project=chromium` (check `web/playwright.config.ts` for the project name; if port 3100 is busy with another session's server, wait for it to be free, never kill it).
- Commit identity is pinned by the worktree; commit subjects are lower case after the type prefix (`feat(vault): …`), and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by path only.

## File Structure

| File (all `web/src/vault/` unless given)         | Responsibility                                           | Task    |
| ------------------------------------------------ | -------------------------------------------------------- | ------- |
| `rowTopics.ts` + `rowTopics.test.ts` (new)       | Which topic chips a row shows                            | 1       |
| `tree.ts` + `tree.test.ts`                       | `isShown(node)`: hide empty folders without a rule       | 1       |
| `NoteList.tsx`                                   | Rows: topics, sharing as an icon                         | 1       |
| `Folders.tsx`                                    | Hidden folders, the dot's label, "Held, waiting for you" | 1       |
| `ShareControl.tsx`                               | "Folder sharing: …", "None (each note decides)"          | 1       |
| `withoutTitle.ts` + `withoutTitle.test.ts` (new) | Drop a first heading equal to the title                  | 2       |
| `TopicPicker.tsx` (new)                          | The + Topic popover                                      | 2       |
| `NoteTopics.tsx`                                 | Chips with ×, + Topic                                    | 2       |
| `NoteMenu.tsx` (new)                             | The ⋯ menu: Copy link, Delete note…                      | 2       |
| `Preview.tsx`                                    | The pane's order, meta line, `idle` slot                 | 2       |
| `overview.ts` + `overview.test.ts` (new)         | Counts and lists for the summary                         | 3       |
| `Overview.tsx` (new)                             | The summary when no note is open                         | 3       |
| `AddNotes.tsx` (new)                             | The Add notes button and menu                            | 4       |
| `PanelDialog.tsx` (new)                          | The dialog around the Import, Connect and Attach panels  | 4       |
| `useNarrow.ts` (new)                             | Whether the Vault card is under 1,000 px                 | 5       |
| `ScopePicker.tsx` (new)                          | The list title as a button opening the tree              | 5       |
| `Vault.tsx`                                      | Wiring for all of the above                              | 3, 4, 5 |
| `vault.module.css`                               | Styles                                                   | all     |
| `sentences.ts`, `topicText.ts`, `importText.ts`  | New sentences                                            | all     |
| `web/e2e/vault.spec.ts`                          | Browser tests                                            | all     |
| `docs/ui-concept.md` §4 Vault                    | The described behaviour                                  | 6       |

---

### Task 1: Rows and the left column

Spec §4, §5.1, §5.2.

**Files:**

- Create: `web/src/vault/rowTopics.ts`, `web/src/vault/rowTopics.test.ts`
- Modify: `web/src/vault/tree.ts`, `web/src/vault/tree.test.ts`, `web/src/vault/NoteList.tsx`, `web/src/vault/Folders.tsx`, `web/src/vault/ShareControl.tsx`, `web/src/vault/Vault.tsx` (pass `topics` to `NoteList` only), `web/src/vault/topicText.ts`, `web/src/vault/sentences.ts`, `web/src/vault/vault.module.css`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `VaultTopic`, `VaultNote`, `TreeNode` (existing).
- Produces: `rowTopics(ids: string[], topics: VaultTopic[], max?: number): { shown: VaultTopic[]; more: number }`; `isShown(node: TreeNode): boolean`; `NoteList` gains the prop `topics: VaultTopic[]`; sentence constants `HELD_ROW = "Held, waiting for you"`, `FOLDER_SHARING = "Folder sharing"`, `NO_FOLDER_RULE = "none"`, `NONE_OPTION = "None (each note decides)"` in `sentences.ts`, and `folderSharing(text: string) => \`Folder sharing: ${text}\``.

- [ ] **Step 1: Write the failing unit tests**

`web/src/vault/rowTopics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rowTopics } from "./rowTopics";
import type { VaultTopic } from "./types";

const T = (id: string): VaultTopic => ({
  id,
  kind: "customer",
  name: id.toUpperCase(),
});
const hive = ["a", "b", "c", "d", "e"].map(T);

describe("rowTopics", () => {
  it("shows nothing for a note without topics", () => {
    expect(rowTopics([], hive)).toEqual({ shown: [], more: 0 });
  });
  it("shows up to two, in the note's order", () => {
    expect(rowTopics(["b", "a"], hive)).toEqual({
      shown: [T("b"), T("a")],
      more: 0,
    });
  });
  it("counts the rest", () => {
    expect(rowTopics(["a", "b", "c", "d", "e"], hive)).toEqual({
      shown: [T("a"), T("b")],
      more: 3,
    });
  });
  it("skips ids the hive does not have, and does not count them", () => {
    expect(rowTopics(["x", "a", "y", "b", "c"], hive)).toEqual({
      shown: [T("a"), T("b")],
      more: 1,
    });
  });
});
```

(Check `web/src/topics/types.ts` for a valid `Kind`; use it in `T` if "customer" is not one.)

Append to `web/src/vault/tree.test.ts`:

```ts
import { buildTree, isShown } from "./tree";
// … inside a new describe:
describe("isShown", () => {
  const note = (path: string) => ({ ...BASE_NOTE, id: path, path }); // reuse the file's existing note factory if it has one
  it("hides a folder with no notes and no rule", () => {
    const root = buildTree(
      [note("a/x.md")],
      [{ path: "empty", visibility: null, shared_with: [] }],
    );
    // A folder record with visibility null is no rule.
    expect(isShown(root.children.find((c) => c.path === "empty")!)).toBe(false);
  });
  it("keeps an empty folder that has a rule", () => {
    const root = buildTree(
      [],
      [{ path: "ruled", visibility: "group", shared_with: [] }],
    );
    expect(isShown(root.children[0])).toBe(true);
  });
  it("keeps an empty folder whose child has a rule", () => {
    const root = buildTree(
      [],
      [{ path: "p/c", visibility: "group", shared_with: [] }],
    );
    expect(isShown(root.children[0])).toBe(true);
  });
  it("keeps a folder with notes", () => {
    const root = buildTree([note("a/x.md")], []);
    expect(isShown(root.children[0])).toBe(true);
  });
});
```

Adapt the note factory to the one `tree.test.ts` already uses (read the file first).

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/vault/rowTopics.test.ts src/vault/tree.test.ts`
Expected: FAIL, `rowTopics` and `isShown` are not exported.

- [ ] **Step 3: Implement**

`web/src/vault/rowTopics.ts`:

```ts
// The topic chips a note's row shows: the first `max` of the note's topics the hive still has,
// strongest first, and how many more there are.
import type { VaultTopic } from "./types";

export function rowTopics(ids: string[], topics: VaultTopic[], max = 2) {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const known = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return { shown: known.slice(0, max), more: Math.max(0, known.length - max) };
}
```

In `tree.ts`:

```ts
/** A folder is listed when it holds a note, or when it or a folder under it has a rule. */
export function isShown(node: TreeNode): boolean {
  if (node.count > 0) return true;
  if (node.rule && node.rule.visibility !== null) return true;
  return node.children.some(isShown);
}
```

(A folder record whose visibility is null is "no rule": `folderMark` returns null for it.)

- [ ] **Step 4: Run the unit tests and see them pass**

Run: `cd web && npx vitest run src/vault/rowTopics.test.ts src/vault/tree.test.ts` — PASS.

- [ ] **Step 5: Rows (`NoteList.tsx`)**

Give `Row` the props `topics: VaultTopic[]`. Render:

```tsx
<Link … className={s.row} aria-current={…}>
  <span className={s.rowTop}>
    <span className={s.rowTitle}>{note.title}</span>
    {showMark && mark.kind !== "private" && (
      <span className={s.rowMark} title={markTitle(mark)}>
        <Glyph kind={mark.kind} />
        <span className={s.srOnly}>{markText(mark)}</span>
      </span>
    )}
    {showMark && mark.kind === "private" && <span className={s.srOnly}>Private</span>}
  </span>
  <span className={s.rowMeta}>
    <span>{shortDate(note.updated_at, now)}</span>
    {note.quarantined && <span className={s.tag}>Held</span>}
    {note.by_agent && <span className={s.tag}>Agent</span>}
    {note.access === "link" && <span className={s.tag}>Opened by a link</span>}
    {shown.map((t) => <span key={t.id} className={s.rowTopic}>{t.name}</span>)}
    {more > 0 && <span className={s.rowTopic}>+{more}</span>}
  </span>
</Link>
```

with `const { shown, more } = rowTopics(note.topics, topics);`. `Glyph`, `markText`, `markTitle` come from `MarkTag.tsx`. Topics show on the shared tab's rows too. `NoteList` takes `topics` and passes it on; `Vault.tsx` passes `topics={data.topics}`.

CSS: `.rowTop` a flex row (title grows and is cut with ellipsis, mark at the end); `.rowMeta` one line, `white-space: nowrap; overflow: hidden`; `.rowTopic` a small chip like the existing `.tag` but in `var(--fg2)` with `var(--line)` border, 11.5 px. Remove the now unused `.markText` use in rows only (keep the class: `MarkTag` still uses it).

- [ ] **Step 6: Left column (`Folders.tsx`)**

- Filter children with `isShown`: `node.children.filter(isShown)` both at the root and in `Folder`; `hasChildren` counts shown children only.
- The rule dot: replace `{mark && <MarkTag mark={mark} quiet />}` with a span carrying `title={folderSharing(markText(mark))}` around `<Glyph kind={mark.kind} />` plus `<span className={s.srOnly}>{folderSharing(markText(mark))}</span>`.
- The held row's name: `{HELD_ROW}` with a class `s.heldName` coloured `var(--acc)`; its count also `var(--acc)`.

- [ ] **Step 7: The folder's sharing control (`ShareControl.tsx`)**

For `subject === "folder"`: the button shows `folderSharing(props.mark ? markText(props.mark) : NO_FOLDER_RULE)` and its `aria-label` is the same string; the `none` option's label is `NONE_OPTION`. The note's control is unchanged.

- [ ] **Step 8: Browser tests**

In `web/e2e/vault.spec.ts`:

- Replace every expectation of the text "No rule" with `folderSharing("none")` or `NONE_OPTION` as the place requires (two places today).
- Add tests:

```ts
test("rows show their topics and no sharing words", async ({ page }) => {
  await open(page);
  const row = noteLinks(page).filter({ hasText: "Kickoff notes" });
  await expect(row).toContainText("Harbor Logistics");
  await expect(row.locator("[title]")).toHaveAttribute(
    "title",
    /harbor-logistics/,
  );
  // The words are for screen readers only now: not visible on the row.
  await expect(
    row.getByText("Ahmed, from harbor-logistics", { exact: true }),
  ).toBeHidden();
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
```

Check the fixture (`src/vault/fixture.ts`) for the exact titles, folder names, which folder is empty and which topics a note carries; adjust the names above to the fixture, keeping what each test proves.

- [ ] **Step 9: Run everything for this task**

`pnpm --filter @hive-mind/web typecheck && pnpm --filter @hive-mind/web lint && pnpm --filter @hive-mind/web test`, then `cd web && npx playwright test e2e/vault.spec.ts`. All pass.

- [ ] **Step 10: Commit**

```bash
git add web/src/vault/rowTopics.ts web/src/vault/rowTopics.test.ts web/src/vault/tree.ts web/src/vault/tree.test.ts web/src/vault/NoteList.tsx web/src/vault/Folders.tsx web/src/vault/ShareControl.tsx web/src/vault/Vault.tsx web/src/vault/sentences.ts web/src/vault/topicText.ts web/src/vault/vault.module.css web/e2e/vault.spec.ts
git commit -m "feat(vault): rows show topics and a sharing icon; empty folders hide; folder sharing says so"
```

---

### Task 2: The note pane

Spec §6.

**Files:**

- Create: `web/src/vault/withoutTitle.ts`, `web/src/vault/withoutTitle.test.ts`, `web/src/vault/TopicPicker.tsx`, `web/src/vault/NoteMenu.tsx`
- Modify: `web/src/vault/Preview.tsx`, `web/src/vault/NoteTopics.tsx`, `web/src/vault/Vault.tsx` (the `onCopied` callback only), `web/src/vault/sentences.ts`, `web/src/vault/topicText.ts`, `web/src/vault/vault.module.css`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `useDismiss` from `web/src/map/useDismiss.ts` (signature `useDismiss({ open, root, button, onClose: (refocus: boolean) => void })`); the existing `Ask` component in `Preview.tsx` and `DELETE_QUESTION`.
- Produces: `withoutTitle(body: string, title: string): string`; `Preview` gains props `idle?: ReactNode` (rendered instead of "Choose a note to read it." when no note is open; default keeps today's line) and `onCopied: (ok: boolean) => void`; sentences `LINK_COPIED = "Link copied."`, `LINK_NOT_COPIED = "The link could not be copied."`, `MORE_ACTIONS = "More actions for this note"`, `COPY_LINK = "Copy link"`, `DELETE_ITEM = "Delete note…"`; topic texts `ADD_TOPIC_BUTTON = "+ Topic"`, `FIND_TOPIC = "Find a topic"`, `NO_TOPIC_MATCHES = "No topic matches."`.

- [ ] **Step 1: Failing test for `withoutTitle`**

```ts
import { describe, expect, it } from "vitest";
import { withoutTitle } from "./withoutTitle";

describe("withoutTitle", () => {
  it("drops a first heading equal to the title", () => {
    expect(
      withoutTitle("# Kickoff notes\n\nSample note.", "Kickoff notes"),
    ).toBe("\nSample note.");
  });
  it("ignores case, outer spaces and runs of spaces", () => {
    expect(
      withoutTitle("\n\n#   kickoff  NOTES  \nText", "Kickoff notes"),
    ).toBe("Text");
  });
  it("keeps a heading that differs", () => {
    const b = "# Something else\nText";
    expect(withoutTitle(b, "Kickoff notes")).toBe(b);
  });
  it("keeps a matching heading that is not the first line with text", () => {
    const b = "Intro\n# Kickoff notes";
    expect(withoutTitle(b, "Kickoff notes")).toBe(b);
  });
  it("keeps a level-two heading", () => {
    const b = "## Kickoff notes\nText";
    expect(withoutTitle(b, "Kickoff notes")).toBe(b);
  });
});
```

- [ ] **Step 2: Run it, see it fail.** `cd web && npx vitest run src/vault/withoutTitle.test.ts`

- [ ] **Step 3: Implement**

```ts
// The note's text without a first heading that only repeats its title: the pane shows the
// title already. Only a level-one heading on the first line that has text is dropped.
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function withoutTitle(body: string, title: string): string {
  const m = /^(?:[ \t]*\r?\n)*#[ \t]+([^\n]*?)[ \t]*(?:\r?\n|$)/.exec(body);
  if (!m || norm(m[1]) !== norm(title)) return body;
  return body.slice(m[0].length);
}
```

Run the test: PASS. (If the second case's expected string differs by a leading newline, fix the regex, not the test's intent: the heading line and the blank lines before it go, the rest stays.)

- [ ] **Step 4: `NoteMenu.tsx`**

A button `⋯` (`aria-label={MORE_ACTIONS}`, `aria-expanded`, `aria-controls`) and, when open, a `div role="group"` positioned under it, right-aligned, holding buttons **Copy link** and, when `own`, **Delete note…** whose accessible name is exactly `"Delete note"` (`aria-label="Delete note"`, visible text `DELETE_ITEM`) so existing tests keep finding it. Use `useDismiss` for closing. Props:

```ts
{
  own: boolean;
  href: string; // the note's in-app href
  onCopied: (ok: boolean) => void;
  onDelete: () => void; // asks: the parent shows the delete question
}
```

Copy link: `navigator.clipboard.writeText(new URL(href, location.origin).toString())`, then `onCopied(true)`; a rejection or a missing `navigator.clipboard` → `onCopied(false)`. Close the menu after either item.

- [ ] **Step 5: Delete through the menu (`Preview.tsx`)**

`Ask` today renders its own quiet opener. Give `Ask` an `asking`/`onAsk` controlled mode or a ref method so that `NoteMenu`'s Delete note… opens the question. The question renders in the action row's place (the row is hidden while asking), with today's sentence, Delete/Keep, the half-second guard and outcomes. Keep returns focus to ⋯ (the menu's button). Escape answers Keep as today.

- [ ] **Step 6: `TopicPicker.tsx` and `NoteTopics.tsx`**

`NoteTopics` renders inline in the action row (no heading, no "No topics yet."): for each drawn topic a chip `name` + `<span className={s.chipKind}>{KIND_NAMES[kind]}</span>` + on own notes a `×` button with `aria-label={removeName(name)}` and `data-remove={id}`; removal logic unchanged. When `canAdd`, a button `ADD_TOPIC_BUTTON` opening `TopicPicker`:

```ts
// props
{ remaining: VaultTopic[]; busy: boolean; onPick: (topicId: string) => void; }
```

The picker: a labelled search input (`FIND_TOPIC`, focused on open), then for each kind in `KINDS` with matches a label (mono section style) and its topics as buttons; filter is `name.toLowerCase().includes(q.trim().toLowerCase())`; none → `NO_TOPIC_MATCHES`. Picking calls `add(id)` (today's logic, taking the id instead of the select's value), closes the picker; refusals still show `REFUSED_FULL`/`REFUSED` in the `role="alert"` line. Focus after removing: next chip's ×, else previous, else + Topic (today's rule with `"add"` meaning the + Topic button). Remove the `<select>` and the `ADD`/`ADD_TOPIC` uses; keep the constants only if something else imports them.

- [ ] **Step 7: The pane's order (`Preview.tsx`)**

Inside `<header className={s.head}>`:

1. `<h2 className={s.noteTitle}>{n.title}</h2>`
2. `<p className={s.meta}>{n.path} · changed {longDate(n.updated_at)} · {who}</p>` where `who` is "written by you" / "written by your agent" / "shared by {owner}" / "opened by a link" (put the four phrasings in `sentences.ts`).
3. `<div className={s.actionRow}>`: `ShareControl` (own), `NoteTopics` (inline), `NoteMenu` (pushed to the end with `margin-left: auto`). A colleague's note: chips and `NoteMenu` with Copy link only. Hidden while the delete question is asked; the question renders in its place.
4. Release box (own held) with `margin: 14px 0`.
5. `Linked` unchanged.

Body: `<Markdown body={withoutTitle(open.body, n.title)} />`. Idle: `body = idle ?? <p className={s.empty}>Choose a note to read it.</p>`. `onCopied` comes from `Vault`, which sets `said` to `{ text: ok ? LINK_COPIED : LINK_NOT_COPIED, failed: !ok }`.

- [ ] **Step 8: Browser tests**

- Change the `deleteButton` helper so it opens the menu first:

```ts
const moreButton = (page: Page) =>
  preview(page).getByRole("button", { name: MORE_ACTIONS });
async function askDelete(page: Page) {
  await moreButton(page).click();
  await preview(page).getByRole("button", { name: "Delete note" }).click();
}
```

and replace `deleteButton(page).click()` with `askDelete(page)` throughout; assertions that Delete is visible on own notes become: open ⋯, Delete note is there; on a colleague's note ⋯ has Copy link only. Keyboard test ("Delete follows the sharing control") becomes: Tab from the sharing control reaches the topic ×s, + Topic, then ⋯; Enter opens the menu; Delete note asks; Escape answers Keep and focus is on ⋯.

- Topic tests that used the select: pick through + Topic → picker → topic button.
- Add:

```ts
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
});

test("+ Topic finds and adds a topic; × removes it", async ({ page }) => {
  // open an own note with fewer than five topics (check the fixture), press + Topic,
  // type part of a topic's name, choose it: a chip appears and the calls record addTopic.
  // Then press its ×: the chip goes and the calls record detachTopic.
});
```

Write the third test in full against the fixture (`calls(page)` records actions by name; read how existing topic tests assert calls and copy that).

- [ ] **Step 9: Run all checks for the task** (as Task 1 Step 9). All pass.

- [ ] **Step 10: Commit**

```bash
git add web/src/vault/withoutTitle.ts web/src/vault/withoutTitle.test.ts web/src/vault/TopicPicker.tsx web/src/vault/NoteMenu.tsx web/src/vault/Preview.tsx web/src/vault/NoteTopics.tsx web/src/vault/Vault.tsx web/src/vault/sentences.ts web/src/vault/topicText.ts web/src/vault/vault.module.css web/e2e/vault.spec.ts
git commit -m "feat(vault): the note pane has one action row, a topic picker and a menu, and shows its title once"
```

---

### Task 3: The summary when no note is open

Spec §7.

**Files:**

- Create: `web/src/vault/overview.ts`, `web/src/vault/overview.test.ts`, `web/src/vault/Overview.tsx`
- Modify: `web/src/vault/Vault.tsx`, `web/src/vault/sentences.ts`, `web/src/vault/vault.module.css`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `Preview`'s `idle?: ReactNode` (Task 2), `isShown` (Task 1), `buildTree`, `TreeNode`.
- Produces: `overview(notes: VaultNote[], root: TreeNode, now: number): { notes: number; folders: number; topics: number; today: number; held: number; recent: VaultNote[] }` and `sharedOverview(notes: VaultNote[], members: VaultData["members"]): { notes: number; people: number; newest: VaultNote[] }`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";
import { overview, sharedOverview } from "./overview";
import type { VaultNote } from "./types";

const NOW = Date.UTC(2026, 10, 22, 12);
const n = (
  id: string,
  path: string,
  day: number,
  extra: Partial<VaultNote> = {},
): VaultNote => ({
  id,
  workspace_id: "w",
  member_id: "me",
  path,
  title: id,
  updated_at: new Date(Date.UTC(2026, 10, day, 9)).toISOString(),
  by_agent: false,
  visibility: null,
  shared_with: [],
  quarantined: false,
  effective: "private",
  effective_with: [],
  rule_folder: null,
  access: "own",
  topics: [],
  ...extra,
});

describe("overview", () => {
  const notes = [
    n("a", "x/a.md", 22, { topics: ["t1", "t2"] }),
    n("b", "x/y/b.md", 21, { topics: ["t1"], quarantined: true }),
    n("c", "c.md", 20),
    ...[1, 2, 3, 4, 5].map((d) =>
      n(`o${d}`, "z/o.md".replace("o", `o${d}`), d),
    ),
  ];
  const root = buildTree(notes, [
    { path: "empty", visibility: null, shared_with: [] },
  ]);
  const o = overview(notes, root, NOW);
  it("counts notes, shown folders, distinct topics, today and held", () => {
    expect(o).toMatchObject({
      notes: 8,
      folders: 3,
      topics: 2,
      today: 1,
      held: 1,
    });
  });
  it("lists the six most recently changed, newest first", () => {
    expect(o.recent.map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
      "o5",
      "o4",
      "o3",
    ]);
  });
  it("an empty workspace counts zeros", () => {
    expect(overview([], buildTree([], []), NOW)).toEqual({
      notes: 0,
      folders: 0,
      topics: 0,
      today: 0,
      held: 0,
      recent: [],
    });
  });
});

describe("sharedOverview", () => {
  const members = [
    { id: "m1", display_name: "Ahmed" },
    { id: "m2", display_name: "Sara" },
  ];
  it("counts notes and colleagues and keeps the five newest", () => {
    const notes = [1, 2, 3, 4, 5, 6].map((d) =>
      n(`s${d}`, `s${d}.md`, d, {
        member_id: d % 2 ? "m1" : "m2",
        access: "shared",
      }),
    );
    const s = sharedOverview(notes, members);
    expect(s.notes).toBe(6);
    expect(s.people).toBe(2);
    expect(s.newest.map((x) => x.id)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
  });
});
```

(Folders: `x`, `x/y`, `z` are shown; `empty` is hidden by `isShown`; the root is not counted. Fix the `o` paths so they land in folder `z`: `z/o1.md` … — write them literally if the `replace` trick reads poorly.)

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement `overview.ts`**

```ts
// What the vault says when no note is open: counts and short lists over the loaded notes.
// "Today" is the UTC day of `now`, as the vault's dates are shown in UTC.
import { isShown, type TreeNode } from "./tree";
import type { VaultData, VaultNote } from "./types";

const newestFirst = (a: VaultNote, b: VaultNote) =>
  a.updated_at < b.updated_at
    ? 1
    : a.updated_at > b.updated_at
      ? -1
      : a.id < b.id
        ? -1
        : 1;

function countShown(node: TreeNode): number {
  return node.children
    .filter(isShown)
    .reduce((sum, c) => sum + 1 + countShown(c), 0);
}

export function overview(notes: VaultNote[], root: TreeNode, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    notes: notes.length,
    folders: countShown(root),
    topics: new Set(notes.flatMap((x) => x.topics)).size,
    today: notes.filter((x) => x.updated_at.slice(0, 10) === day).length,
    held: notes.filter((x) => x.quarantined).length,
    recent: [...notes].sort(newestFirst).slice(0, 6),
  };
}

export function sharedOverview(
  notes: VaultNote[],
  _members: VaultData["members"],
) {
  return {
    notes: notes.length,
    people: new Set(notes.map((x) => x.member_id)).size,
    newest: [...notes].sort(newestFirst).slice(0, 5),
  };
}
```

(`updated_at` is ISO from the database; if it is not UTC `Z`-terminated, compare `new Date(x.updated_at).toISOString().slice(0, 10)`.) Drop the unused `members` parameter if lint complains, and update the interface line above to match.

Run the tests: PASS.

- [ ] **Step 4: `Overview.tsx`**

Props:

```ts
{
  kind: "workspace" | "shared";
  name: string;            // the workspace's name, or "Shared with me"
  data: ReturnType<typeof overview> | ReturnType<typeof sharedOverview>;
  hrefFor: (n: VaultNote) => string;
  now: number;
  onReview: () => void;    // workspace only
}
```

Workspace: `<h2>` name; four counts in a row (number large, word under it in `var(--muted)`; sentences `notes`/`folders`/`topics`/`changed today` with singulars "note"/"folder"/"topic"); when `held > 0` a box in the release box's style with `heldSentence(held)` ("1 note is held. Your agents wrote it; nobody else sees it until you release it." / "N notes are held. Your agents wrote them; nobody else sees them until you release them.") and a **Review** button calling `onReview`; then the mono label "Recently changed" and up to six `Link`s (title, short date) in `prefetch={false}` like rows. Shared: `<h2>Shared with me</h2>`, `sharedLine(notes, people)` ("5 notes from 2 colleagues", "1 note from 1 colleague"), label "Newest", up to five links. All sentences in `sentences.ts`. An empty workspace shows the heading and the counts only.

- [ ] **Step 5: Wire it in `Vault.tsx`**

`const summary = useMemo(() => shared ? sharedOverview(data.notes, data.members) : overview(data.notes, tree, now), [data.notes, data.members, tree, now, shared]);` Pass `idle={<Overview … onReview={() => setLocal((l) => ({ ...l, by: "folders", scope: { kind: "held" } }))} />}` to `Preview`. Name: `ownWorkspace?.name ?? data.workspaces.find((w) => w.id === wsId)?.name ?? ""`.

- [ ] **Step 6: Browser tests**

Update the three expectations of "Choose a note to read it." to the summary. Add:

```ts
test("with no note open the vault shows its summary", async ({ page }) => {
  await open(page);
  const pane = preview(page);
  await expect(pane.getByRole("heading", { level: 2 })).toHaveText(
    DATA.workspaces[0].name,
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
      (n) => n.quarantined && n.workspace_id === DATA.workspaces[0].id,
    ).length,
  );
});

test("Shared with me says how many notes from how many colleagues", async ({
  page,
}) => {
  await open(page, "?tab=shared");
  await expect(preview(page)).toContainText(/\d+ notes? from \d+ colleagues?/);
});
```

Adjust to the fixture (which workspace opens first, how its notes are filtered in `DATA`).

- [ ] **Step 7: Run all checks.** All pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/vault/overview.ts web/src/vault/overview.test.ts web/src/vault/Overview.tsx web/src/vault/Vault.tsx web/src/vault/sentences.ts web/src/vault/vault.module.css web/e2e/vault.spec.ts
git commit -m "feat(vault): with no note open the pane sums up the workspace"
```

---

### Task 4: The bar, the Add notes menu and the dialog

Spec §2, §3.

**Files:**

- Create: `web/src/vault/AddNotes.tsx`, `web/src/vault/PanelDialog.tsx`
- Modify: `web/src/vault/Vault.tsx`, `web/src/vault/importText.ts`, `web/src/vault/connectText.ts`, `web/src/vault/attachText.ts` (one-line descriptions), `web/src/vault/vault.module.css`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `useDismiss`; today's `Import`, `Connect`, `Attach` components and `panel`, `panelBusy`, `connectIn`, `closeImport`, `closeConnect`, `closeAttach` in `Vault.tsx`.
- Produces: `AddNotes` props `{ items: { key: "import" | "connect" | "attach"; name: string; line: string }[]; onChoose: (key) => void; buttonRef: RefObject<HTMLButtonElement | null> }`; `PanelDialog` props `{ label: string; busy: boolean; onClose: () => void; children: ReactNode }`; sentences `ADD_NOTES = "Add notes"`, `IMPORT_LINE`, `CONNECT_LINE`, `ATTACH_LINE` (spec §3 table, verbatim).

- [ ] **Step 1: `AddNotes.tsx`**

A button `ADD_NOTES` with a down caret (`aria-expanded`, `aria-controls`), and when open a `div role="group" aria-label={ADD_NOTES}` under it, right-aligned, 300 px wide, holding one button per item: the name (exactly `IMPORT`, `CONNECT`, `ATTACH`, so tests can find them by name) and its line under it in `var(--muted)` 12 px. The button's accessible name must be the item name only: put the line in an element referenced by `aria-describedby`. Choosing calls `onChoose` and closes. Closing via `useDismiss`; focus back on the button.

- [ ] **Step 2: `PanelDialog.tsx`**

```tsx
// The Import, Connect and Attach panels, over the vault: one at a time, focus kept inside.
// Escape and a press on the dimmed card close it only when the panel is not at work.
export function PanelDialog({ label, busy, onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the first focusable inside on open.
    box.current
      ?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      )
      ?.focus();
  }, []);
  return (
    <div
      className={s.dim}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={s.dialog}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (!busy) onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const f = [
            ...box.current!.querySelectorAll<HTMLElement>(
              "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
            ),
          ];
          if (f.length === 0) return;
          const first = f[0],
            last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

The panels already handle their own Escape and focus (`Import` moves focus to its result heading, etc.); read `Import.tsx`, `Connect.tsx`, `Attach.tsx` first and keep their Escape handling from fighting the dialog's: if a panel already closes on Escape, let the dialog's handler skip when `e.defaultPrevented`. `.dim` is `position: absolute; inset: 0` over the Vault card (`main` gets `position: relative`) with a token-based translucent fill (use an existing overlay token if the theme has one; otherwise `color-mix(in srgb, var(--bg) 60%, transparent)`); `.dialog` is about 560 px wide (max `calc(100% - 32px)`), `var(--surface)` background, 1 px `var(--line-hi)` border, 16 px radius, starts 80 px from the card's top, scrolls inside when tall.

- [ ] **Step 3: `Vault.tsx` bar**

The bar: `Tabs`, the filter `label` (now `flex: 1`), then `AddNotes` when `importer && !shared`, with items: import always; connect and attach when `ownWorkspace`. `onChoose("import")` → `setPanel("import")`; `"connect"`/`"attach"` → `setConnectIn(ownWorkspace); setPanel(key)`. Remove the three opener buttons and their refs; every place that focused an opener after closing now focuses the Add notes button (`addRef`). If a close happens while Add notes is gone (shared tab), focus the filter field. The panels render inside `<PanelDialog label={…} busy={panelBusy} onClose={closeX}>` instead of in the flow; label is the panel's current heading text (`IMPORT`, `CONNECT`, `ATTACH`).

- [ ] **Step 4: Browser tests**

Replace the three opener helpers:

```ts
const addNotes = (page: Page) =>
  page.getByRole("button", { name: ADD_NOTES, exact: true });
async function openPanel(page: Page, name: string) {
  await addNotes(page).click();
  await page
    .getByRole("group", { name: ADD_NOTES })
    .getByRole("button", { name, exact: true })
    .click();
}
```

`importButton(page).click()` → `openPanel(page, T.IMPORT)`; same for connect and attach. Assertions on an opener's `aria-expanded`/`aria-disabled` while a panel is open or at work are rewritten to the dialog rule: the dialog is visible (`page.getByRole("dialog", { name })`), Escape and a press on the dim area close it when idle and do nothing while at work, and focus returns to Add notes. Tests whose premise was two panels at once become "one dialog at a time: Add notes is behind the dialog while it is open". "Connect wiki links is offered on one's own workspace, not on Shared with me" becomes: the menu lists Connect on a workspace; Shared with me has no Add notes button. Add:

```ts
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
```

- [ ] **Step 5: Run all checks**, including the whole `e2e/vault.spec.ts` (the import, connect and attach tests are long; all must pass).

- [ ] **Step 6: Commit**

```bash
git add web/src/vault/AddNotes.tsx web/src/vault/PanelDialog.tsx web/src/vault/Vault.tsx web/src/vault/importText.ts web/src/vault/connectText.ts web/src/vault/attachText.ts web/src/vault/vault.module.css web/e2e/vault.spec.ts
git commit -m "feat(vault): one add notes menu in the bar; import, connect and attach open as a dialog"
```

---

### Task 5: The narrow fold

Spec §8.

**Files:**

- Create: `web/src/vault/useNarrow.ts`, `web/src/vault/ScopePicker.tsx`
- Modify: `web/src/vault/Vault.tsx`, `web/src/vault/vault.module.css`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `useDismiss`; the left column's JSX in `Vault.tsx` (the switch plus `TopicList`/`Folders`).
- Produces: `useNarrow(ref: RefObject<HTMLElement | null>, below = 1000): boolean`; `ScopePicker` props `{ title: string; children: ReactNode }` (children: the switch and the list; the picker closes itself when a scope is chosen through a `onChosen` the parent passes into `onScope`).

- [ ] **Step 1: `useNarrow.ts`**

```ts
// Whether an element is narrower than `below` px. The first render says wide; a
// ResizeObserver corrects it at once in the browser.
import { useEffect, useState, type RefObject } from "react";

export function useNarrow(ref: RefObject<HTMLElement | null>, below = 1000) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setNarrow(e.contentRect.width < below),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return narrow;
}
```

- [ ] **Step 2: `ScopePicker.tsx`**

The list header's title as a button: the title text, a down caret, `aria-expanded`, `aria-controls`, accessible name `Choose folder or topic: {title}`. When open, a `div role="group" aria-label="Folders and topics"` under it, 300 px wide, `max-height: 70%` of the card with its own scroll, holding `children`. Closes via `useDismiss` and when the parent signals a choice.

- [ ] **Step 3: `Vault.tsx`**

`const narrow = useNarrow(main);` (the `main` ref already exists on the card). When `narrow && !shared`: do not render the `.folders` column; in the list header render `ScopePicker` with the same switch and list JSX (extract it into a local `const scopeList = …` used in both places), and wrap `onScope` so a choice also closes the picker. `.cols` gets `data-narrow` so CSS drops the folder column's track. Wide again: the column returns, `local.scope` unchanged.

- [ ] **Step 4: Browser tests**

```ts
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
```

The window-size tests at the top of the file (`the vault fits a … window without scrolling`) include 1280 × 620: check whether the card is under 1,000 px there (rail open). If it is, those tests now see the folded layout; keep what they prove (no page scroll, controls reachable) and fix only locators that assumed the folder column. Also check the `fold.spec.ts` and `rail.spec.ts` tests that open the vault still pass.

- [ ] **Step 5: Run all checks.** All pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/vault/useNarrow.ts web/src/vault/ScopePicker.tsx web/src/vault/Vault.tsx web/src/vault/vault.module.css web/e2e/vault.spec.ts
git commit -m "feat(vault): in a narrow card the folder column folds into a picker on the list title"
```

---

### Task 6: The document and the whole run

Spec §13.

**Files:**

- Modify: `docs/ui-concept.md` (§4, the Vault bullet), `web/e2e/vault.spec.ts` only if the full run below finds a gap

- [ ] **Step 1: Update `docs/ui-concept.md` §4 Vault** to describe, in the document's plain style: the bar (tabs, filter, **Add notes** with its three items and where they appear), panels as a dialog, rows (topics, sharing icon), "Folder sharing: …", hidden empty folders, "Held, waiting for you", the note pane's order (meta line, one action row, + Topic picker, ⋯ with Copy link and Delete note…), the title shown once, the summary when no note is open, and the narrow fold at 1,000 px. Replace the sentences these change ("**Import a folder** in the vault's header opens a panel in place", the Add topic select, "a quiet **Delete** after the sharing control", "Under **Linked with**, the open note shows its **Topics**"); keep everything else.

- [ ] **Step 2: Full gates from the repo root**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `cd web && npx playwright test` (the whole suite; wait for port 3100 to be free first). All pass. Then the frame checks are not needed (the map is untouched).

- [ ] **Step 3: Commit**

```bash
git add docs/ui-concept.md
git commit -m "docs(ui): the vault's bar, rows, note pane, summary and narrow fold"
```

---

## Execution DAG

**Dependency graph** (from the Interfaces blocks):

- Task 1 depends on nothing.
- Task 2 depends on nothing.
- Task 3 depends on Task 1 (`isShown`) and Task 2 (`Preview`'s `idle` slot).
- Task 4 depends on nothing.
- Task 5 depends on Task 1 (the left column it moves) and Task 4 (the bar and `Vault.tsx` layout it shares).
- Task 6 depends on Tasks 1–5.

**Parallel batches:**

1. Tasks 1, 2, 4 — independent in logic, but all edit `Vault.tsx`, `vault.module.css` and `e2e/vault.spec.ts`. Run them **one after another in this worktree** (1, 2, 4) to avoid three-way merges in those files; a session with worktree-isolated subagents may run them at once and merge, at the cost of resolving those three files.
2. Task 3 (after 1 and 2).
3. Task 5 (after 1 and 4).
4. Task 6.

Tasks 3 and 5 could run together after batch 1; they again share `Vault.tsx`, so run them in sequence.

**Critical path:** Task 1 → Task 2 → Task 3 → Task 5 → Task 6 when run in sequence; in logic the longest chain is Task 2 → Task 3 → Task 6 (or Task 4 → Task 5 → Task 6).
