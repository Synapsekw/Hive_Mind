# Inbox and Settings, tidied: design

Date: 2026-11-25. Status: approved from clickable mocks (Inbox layout "B · List and detail",
Settings layout "B · Tabs in the top bar", then "yes" to the design). Round 3 of four: round 1
was the map's controls (`2026-11-24-map-chrome-design.md`) and round 2 the Vault
(`2026-11-25-vault-tidy-design.md`). The Gallery, planned for this round, waits until the
unmerged `task/gallery-v2` branch lands, because that branch rebuilds the same screen. Round 4 is
the shell.

## 1. What changes

A look at both screens in their states (Inbox: full, empty, many, 1,100 px; Settings: owner,
member, no agents, many, 1,100 px) found these problems:

- **Inbox.**
  - The same explanation repeats on every row.
  - Up to five yellow buttons sit on one screen.
  - The link sentence is hard to read.
  - The content stops near 1,040 px, with the hint floating loose.
  - Held notes are a second copy of what the Vault shows, without the note's text.
  - The empty state is one bare line.
- **Settings.**
  - Six sections in one long scroll.
  - Inline forms push the content down.
  - Button weights are inconsistent.
  - Topics are squeezed into a 330 px column, and Find topics is cramped.
  - Every row has a destructive button.
  - Revoked agents clutter the list.
  - Members and invitations are separate lists.
  - The hive name is small.

After this change:

1. **The Inbox is a list and a detail pane.** The list holds one short row per item. The detail
   pane shows the selected item: both notes side by side, the explanation once and the one
   decision.
2. **Settings is tabs in the top bar**, one section at a time at full width. Rare and destructive
   actions move into dialogs and ⋯ menus.

**Not in this round, and not to be touched:**

- What any action does, and the server actions' rules, except the one new read action in 2.6.
- The loaders' queries and their bounds.
- The token dialog's content.
- The rules for deleting a workspace or a hive.
- Who may do what (owner and member).
- The database and its migrations.
- The rail, the shell, the Gallery, the Vault and the map.

## 2. Inbox

### 2.1 The top bar

One row inside the Inbox card:

- **Left:** the title "Inbox" and the count (`inboxCount`, today's number).
- **Right:** a quiet line, "Only you can answer these." This replaces the loose hint.

### 2.2 The list

The list is the left column: about 440 px at 1,440 px wide, 380 px between 1,000 and 1,280 px. It
has two groups, each with a heading and its total. Today's order of the rows is kept.

- **Links to decide · N.** Each row is a button with:
  - **One sentence**, `linkLine(item)`:
    - "Link <your title> with <Name>'s “<their title>”" when the title is known.
    - "Link <your title> with a note of <Name>'s you can't see yet" when it is not.
    - The person's own title is emphasised.
  - **One grey line:** `proposer(item)` · `tierReason(item.tier)` · the date.
  - **A tag** "<Name> accepted", only when `theyAccepted`.
- **Held notes · N.** Each row is a button with:
  - **The title.**
  - **One grey line:** the agent's name (or "An agent") · the date · the path.

Rows have no action buttons. The selected row is marked (`aria-current="true"` and the theme's
selection surface). When the totals are above the loaded rows, today's "and N more" line stays
under its group.

**Selection.**

- On load, the first link is selected, or the first held note when there are no links.
- ↑ and ↓ move the selection inside the list. Enter or a click selects a row.
- The selection is client state.

### 2.3 The detail pane: a link

From the top:

1. **A label:** "Proposed by your agent" or "Proposed from <Name>'s side" · the reason · the date.
2. **Two boxes side by side**, with ⇄ between them:
   - **"Your note":** the title, the folder path, and the opening lines (2.6). A link "Open in
     vault" (`vaultHref`).
   - **"<Name>'s note":** the title when it is known, with the topic. When it is not known, "Not
     shared with you", and under it "You will see it once you both accept." Never their note's
     text, path or id: the data rule of `inbox/types.ts` stands.
3. **One sentence**, `acceptEffect(item)` (today's words).
4. **Accept link** (the page's only primary button) and **Decline** (outlined). Under them a
   quiet "A declined link is final for this pair of notes."
5. **Decline asks first**, as today: the row gives way to `declineQuestion()` with **Decline** and
   **Keep**. Keep returns, with focus on Decline.

### 2.4 The detail pane: a held note

From the top:

- The title, the path, and "Held from <agent> · <date>".
- The opening lines (2.6).
- One sentence on what Release does: today's held-note sentence, moved here from the list heading.
- **Release** (primary) and **Open in vault** (quiet link).

### 2.5 After an answer

When an answer succeeds:

- The item leaves the list.
- The next item in the same group is selected, or else the first item of the other group.
- The page's status line says today's words: "Link accepted.", "Link declined." or "Note
  released."
- With nothing left, the detail pane says "All done." with "Open the vault".

When an answer fails, today's failure line shows in the detail pane, and the item stays selected.
There is no Undo.

**Empty** (nothing loaded and both totals 0): the whole card shows one block instead of the
columns:

- The heading "Nothing needs you."
- One sentence: "Link proposals between your notes and a colleague's, and notes your self-hosted
  agents hold for you, wait here."
- The button "Open the vault".

### 2.6 The opening lines

When an item is selected, the detail pane asks for that note's opening lines through one new
server action, `noteOpening(id: string): Promise<Opening>`, in `app/inbox/actions.ts`:

- `Opening = { ok: true; text: string } | { ok: false }`.
- It signs in as the session's person, like the other inbox actions, and checks that `id` is a
  UUID before any query.
- It runs one query: `notes.select("body").eq("id", id).limit(1)`. That is a primary-key read, and
  row-level security decides whether the person may read it.
- It returns `openingOf(body)`.

`openingOf(body)` is a pure function in `inbox/text.ts`:

- It drops front matter and headings.
- It joins the first non-empty lines.
- It cuts at 280 characters on a word boundary and adds "…".
- It returns "" for an empty body.

The pane renders the result as plain text (never Markdown or HTML). The answer is cached per id
for the page's life, so moving back to an item asks nothing. While waiting, the pane shows the
title and path at once, with the lines area holding its height. On `{ ok: false }` or an empty
text, the lines area is left out.

The action is only ever called with ids of the person's own notes (`mine.id` or a held note's
id). Their note's id is never on the page.

### 2.7 Narrow

Below 1,000 px of card width:

- The list takes the whole card.
- Selecting an item shows the detail pane full width, with a "← Inbox" button at its top.
- That button, or Escape, returns to the list with focus on the item's row.

The width check reuses the Vault's `useNarrow` hook.

## 3. Settings

### 3.1 The top bar

One row inside the Settings card:

- **Left:** the hive's name in the title size, a quiet "· Settings".
- **Then the tabs:** Agents, Workspaces, Topics, People, Hive, each followed by its count:
  - Agents: active agents.
  - Workspaces: the number of workspaces.
  - Topics: the number of topics.
  - People: members plus open invitations.
  - Hive: no count.
- A member sees no Topics tab and no Hive tab, as today a member has neither section.

The tabs are a `role="tablist"` with arrow-key movement. The chosen tab is kept in the URL as
`?tab=agents|workspaces|topics|people|hive`, written with `history.replaceState` (no navigation,
no server round trip). A reload or a link opens that tab. A missing or unknown value opens Agents,
and so do `topics` and `hive` for a member.

**At most one primary (yellow) button** shows per tab.

### 3.2 Agents

- The tab heading has today's note and, at its right, **Connect an agent** (primary).
- Connect an agent opens a dialog holding today's connect form, unchanged: Name, Workspace,
  Provider, and the two trust tiers shown as two cards with `tierHelp`. The buttons are
  **Cancel** and **Create**. On success, the dialog closes and today's token dialog opens.
- **Rows:**
  - The name.
  - One grey line: the provider · the tier (`tierText`) · the workspace · last used.
  - A ⋯ menu at the right with **Revoke…**. Revoke… asks today's question inline in the row.
- **Revoked and expired agents** fold under "▸ N revoked or expired" below the active ones. The
  fold is closed by default and keeps `sortAgents`' order.
- **With no agents:** one block with today's empty sentence and Connect an agent.

### 3.3 Workspaces

- **Rows:**
  - The name.
  - One grey line: `workspaceNotes`.
  - A ⋯ menu with **Delete workspace…**, which asks `workspaceQuestion` with today's Delete and
    Keep and today's refusals (`workspaceFailure`).
- **The only workspace** shows `ONLY_WORKSPACE` in place of the menu.
- `WORKSPACES_NOTE` sits under the tab heading.

### 3.4 Topics

The heading row has:

- A search field "Find a topic", which filters by name on the client.
- **Find topics in my notes** (outlined). It opens a dialog holding today's
  suggestion list, with these changes:
  - The list scrolls inside the dialog.
  - The count reads "N of M ticked".
  - The save button reads "Save N topics" and is disabled at 0.
  - The flow and its server calls stay as today.

Under the heading row:

- **Chips for the eight kinds**, each with its count, and "All" first. One chip is chosen at a
  time; the choice is client state.
- **The topics** in a grid of columns across the full width, each with its note count.
- A ⋯ menu on each topic with **Delete topic…**, which asks today's question.
- While the hive is being deleted, there is no Find topics and no ⋯, as today.
- The tab is the owner's only: a member has no Topics tab (3.1).

### 3.5 People

One list, members first and then open invitations:

- **A member row:** the name, Owner or Member, and a "You" tag on the person's own row.
- **An invitation row:**
  - The name, with an "Invited" tag.
  - One grey line: the email · invited <date> · expires <date>.
  - For an owner, a ⋯ menu with **Send again** and **Revoke invitation**.
  - Today's `unsent` and failure lines stay on the row.

For an owner, **Invite someone** (primary) opens a dialog holding today's invite form (Name,
Email, `INVITE_HELP`). It has **Cancel** and **Invite**. On success it closes, and today's
`inviteNotice` shows as the tab's status line.

A member sees members only, as today.

### 3.6 Hive (owner only)

- The heading `DELETE_TITLE`.
- `deletionCounts` (or `DELETE_UNCOUNTED`).
- A red-outlined box with **Delete hive…**. It opens a dialog holding today's typed-name check
  (`DELETE_FIELD`, `deleteHint`, `DELETE_HELP`), with **Keep the hive** and **Delete hive**
  (danger).
- While deletion is pending, the box shows `DELETED_ON` <date>, `CLOSING_HELP` and **Cancel
  deletion** instead.

### 3.7 Dialogs and menus

**Dialogs** reuse the Vault's `PanelDialog`:

- `role="dialog"`, `aria-modal`, labelled by the dialog's heading.
- Focus trapped inside.
- Escape, Cancel or a press on the dim closes the dialog, with focus back on the opener.
- A dialog does not close while its write is in flight.

**⋯ menus** use `useDismiss`, so opening one closes any other popover. Each ⋯ button is named for
its row ("Actions for <name>").

## 4. Code shape

| File                                                     | Change                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `inbox/Inbox.tsx`                                        | Becomes the bar plus `InboxList` and `InboxDetail`, the selection, the fold and wiring |
| `inbox/InboxList.tsx` (new)                              | Section 2.2                                                                            |
| `inbox/InboxDetail.tsx` (new)                            | Sections 2.3 to 2.5                                                                    |
| `inbox/text.ts`                                          | `linkLine`, `openingOf`, the empty and "All done." sentences                           |
| `inbox/types.ts`                                         | `Opening`; `InboxActions.noteOpening`                                                  |
| `app/inbox/actions.ts`, `app/inbox/write.ts`             | `noteOpening` and its `openingIn(db, id)`                                              |
| `app/inbox/page.tsx`, `app/dev/inbox/*`                  | Pass `noteOpening`; the dev fixture answers from fixture bodies                        |
| `settings/Settings.tsx`                                  | The bar, the tabs and the URL; each tab moves to its own file                          |
| `settings/AgentsTab.tsx` (new)                           | Section 3.2                                                                            |
| `settings/WorkspacesTab.tsx` (new)                       | Section 3.3                                                                            |
| `settings/Topics.tsx`                                    | Section 3.4 (search, chips, grid, the dialog)                                          |
| `settings/PeopleTab.tsx` (new)                           | Section 3.5                                                                            |
| `settings/HiveTab.tsx` (new)                             | Section 3.6 (today's `DeleteHive`)                                                     |
| `settings/RowMenu.tsx` (new)                             | The ⋯ menu of 3.7, shared by the settings tabs                                         |
| `settings/text.ts`, `settings/topicsText.ts`             | Tab names, `tabFromParam`, fold and count sentences                                    |
| `inbox/inbox.module.css`, `settings/settings.module.css` | Styles, theme tokens only                                                              |

`PanelDialog` and `useNarrow` are imported from the Vault where they live today. If either needs
a prop to serve here, the prop is added there, and the Vault's behaviour stays the same. Every
sentence a person reads lives in a text module, as `no-literals.test.ts` requires.

## 5. Performance and data

**First paint** is unchanged. `load-inbox.ts` (at most 100 rows) and `load-settings.ts` are not
touched.

**Interactions:**

- **Settings tabs, the topic search and the kind chips:** client state over the loaded data, so
  **0 server round trips**. The URL write is `replaceState`.
- **The Inbox selection, ↑/↓ and the fold:** client state, so **0 round trips**, except for 2.6.
- **2.6:** **one** bounded read per newly selected item. It is a single-row primary-key lookup on
  `notes.id` that returns at most 280 characters, and it is cached per id.

**Writes** are the same as today (accept, decline, release; create and revoke agent; delete
workspace; find, save and delete topics; invite, send again and revoke invitation; request and
cancel hive deletion), each followed by today's refresh.

**Data rule:** the colleague's note contributes only `memberName`, `topic` and `title | null`, as
today.

## 6. Accessibility

- **Inbox list:** a `role="listbox"` with options, ↑/↓, Home and End. The detail pane is a
  labelled region. The "← Inbox" button returns focus to the row.
- **Settings tabs:** follow the WAI-ARIA tabs pattern: `tablist`, `tab` and `tabpanel`, roving
  tabindex, ←/→, Home and End.
- **⋯ buttons:** have `aria-expanded` and `aria-controls`, and are named per row.
- **Dialogs:** as in 3.7.
- **Status lines:** stay `aria-live="polite"`.

## 7. Tests

**Unit (Vitest):**

- `linkLine`: known title, unknown title, the person's title emphasised.
- `openingOf`: front matter dropped, headings dropped, the 280 cut on a word boundary with "…",
  an empty body.
- `tabFromParam`: each tab, unknown, missing, `topics` and `hive` for a member.
- The fold sentence: singular and plural.
- `openingIn`: a non-UUID is refused before any query, the query shape, `{ ok: false }` on a
  database error.

**Browser (Playwright, `/dev/inbox` and `/dev/settings`):**

- **Inbox:**
  - The list and the detail pane show, with the first link selected.
  - The explanation is shown once.
  - There is one primary button.
  - ↑/↓ moves the selection.
  - The opening lines appear for your note.
  - Their note shows "Not shared with you" when its title is unknown.
  - Accept selects the next item and says "Link accepted."
  - Decline asks, and Keep returns.
  - A held note: Release says "Note released."
  - The last answer shows "All done."
  - `?empty=1` shows "Nothing needs you."
  - `?fail=1` shows the failure line and keeps the item.
  - At 900 px, the list alone shows, and "← Inbox" returns.
- **Settings:**
  - The tabs show with counts, and `?tab=topics` opens Topics.
  - The arrow keys move between tabs.
  - Connect an agent opens the dialog, Escape closes it with focus returned, and Create shows the
    token dialog.
  - ⋯ → Revoke… asks.
  - Revoked agents are folded.
  - Workspaces: ⋯ → Delete workspace… asks, and the only workspace shows its line.
  - Topics: search and chips filter, and Find topics opens the dialog.
  - People: invitations sit in the list with "Invited", and ⋯ → Send again works.
  - The Hive dialog's Delete hive is disabled until the name is typed.
  - `?member=1`: no Topics tab, no Hive tab, no Invite someone.
  - `?none=1` shows the agents' empty block.

Existing Inbox and Settings tests are updated where the words or the order changed, never deleted
to pass.

## 8. Documents

`docs/ui-concept.md`, the Inbox and Settings sections, are rewritten to describe the list and
detail, the tabs, the dialogs and the ⋯ menus, replacing what they change.

## 9. Independent units (for the plan)

Inbox and Settings share no files and no state, so they run as two parallel tracks.

**Inbox track:**

- (i1) The text helpers (`linkLine`, `openingOf`) and the `noteOpening` action with
  `openingIn`. First.
- (i2) `InboxList`, `InboxDetail`, the selection and the empty and "All done." states. After i1.
- (i3) The narrow fold. After i2.

**Settings track:**

- (s1) The tab bar, the URL and `RowMenu`. First.
- (s2a) Agents, (s2b) Workspaces, (s2c) Topics, (s2d) People and Hive. Each after s1, and
  parallel to one another, since each owns its own file.

**Last:**

- (t) Browser tests and `docs/ui-concept.md`, after both tracks.
