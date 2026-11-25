# The Vault, tidied: design

Date: 2026-11-25. Status: approved from a clickable mock (layout "A · Three columns, tidied", then
"ok" to the design). Round 2 of four; round 1 was the map's controls
(`2026-11-24-map-chrome-design.md`), rounds 3 and 4 (Inbox, Settings and Gallery; the shell) get
their own specs.

## 1. What changes

A look at the Vault in nine states (empty, note open, held note, topics, folder chosen, filter,
import, shared with me, 1,100 px) found twelve problems. After this change:

1. **The top bar** holds the workspace tabs, the filter field and one **Add notes** menu. The
   three rare actions no longer sit beside the filter as three full buttons.
2. **The import, wiki-link and topic panels open as a dialog** over the Vault instead of pushing
   the columns down.
3. **Rows** show topics and drop the repeated sharing words; sharing is an icon.
4. **The folder's sharing control** reads "Folder sharing: …" instead of "No rule".
5. **The note pane** shows the title once and puts sharing, topics and the rare actions on one row.
6. **With no note open** the pane shows a summary of the workspace instead of one line of text.
7. **The left column** hides empty folders and names the held notes.
8. **In a narrow card** the folder column folds into a picker above the list.

Not in this round, and not to be touched: what a filter matches (title or path), the sharing
control's own panel and its rules, the import, connect and attach steps and their wording, the
delete and unlink questions, Linked with, the Markdown renderer apart from section 6.2, the shell
and its rail, every other page, the server, the loader and the database.

## 2. The top bar

One row inside the Vault card, left to right:

| Part      | What it is                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| Tabs      | The workspace tabs and Shared with me, unchanged                                                                     |
| Filter    | The filter field, unchanged in what it does and in its placeholder "Filter by title or path". It takes the room left |
| Add notes | A button "Add notes" with a down mark, at the right end. Opens the menu in section 3                                 |

On **Shared with me** there is no Add notes button: nothing can be added there. (Today Import a
folder shows there alone.)

## 3. The Add notes menu and the dialog

The menu opens under its button, aligned to its right edge. Each item is a button with a name and
one line under it:

| Item               | Line under it                                            | Shown                                 |
| ------------------ | -------------------------------------------------------- | ------------------------------------- |
| Import a folder…   | Markdown notes from your computer. Each arrives private. | Always (when the bar has the menu)    |
| Connect wiki links | Turn [[wiki links]] between your notes here into links.  | On one of the person's own workspaces |
| Attach topics      | Put each note here under the hive's topics it names.     | On one of the person's own workspaces |

The names are the existing `IMPORT`, `CONNECT` and `ATTACH` texts (Import gains "…"). Choosing an
item closes the menu and opens that panel. The menu closes on Escape, on a press outside it and
when focus leaves it, with focus back on Add notes; it uses the map's `useDismiss` hook, so opening
it closes any other popover of the page.

**The dialog.** The Import, Connect and Attach panels render unchanged inside one dialog
container: centred near the top of the Vault card, about 560 px wide, over a dimmed card, with
`role="dialog"`, `aria-modal="true"` and the panel's heading as its label. While a panel is open:
Add notes shows nothing else; focus moves into the dialog and stays in it (Tab wraps); Escape and
a press on the dimmed area close it only when the panel could be closed today (no import, connect
or attach is running — `panelBusy` decides, as now); closing returns focus to Add notes. The
panels' own Close buttons keep working.

## 4. The left column

- The Folders / Topics switch and both lists are unchanged, except as follows.
- **A folder is hidden when it holds no notes (at any depth) and neither it nor a folder under it
  has a sharing rule.** A folder with a rule stays even when empty, so its sharing can still be
  reached. "All notes" is never hidden.
- The dot that marks a folder with a rule gets a `title` and screen-reader text: "Folder sharing:
  " followed by the mark's text (for example "Folder sharing: Everyone").
- The row "Held" reads **"Held, waiting for you"** in the accent colour, with its count. It still
  appears only when there are held notes.

## 5. The note list

### 5.1 Rows

Each row: the title on the first line (one line, cut with an ellipsis); on the second line the
short date, then the Held, Agent and "Opened by a link" tags as today, then the note's topics.

- **Topics on a row**: the first two of `note.topics` (already strongest first), by name, each a
  small chip; when the note has more, a last chip "+N". A topic id that is not among the hive's
  topics is skipped and not counted. No topics, no chips.
- **Sharing**: on one's own notes, a mark at the right end of the first line: ● for the whole hive,
  ◐ for some people, nothing for private. The mark's full text (today's `MarkTag` text, for example
  "Ahmed, from harbor-logistics") is its `title` and its screen-reader text; a private note keeps
  its screen-reader "Private". The words are no longer printed on the row.
- The shared tab's rows keep their owner grouping and show no sharing mark, as today; they show
  topics like any row.

### 5.2 The list header

The title and count as today. Under them, for a chosen folder of one's own workspace, the folder's
sharing control as today, except its button reads **"Folder sharing: "** followed by the mark's
text, or **"Folder sharing: none"** when the folder has no rule. The option in its panel that
means "no rule" keeps its meaning and reads "None (each note decides)".

## 6. The note pane

### 6.1 Order

1. **Title.**
2. **One meta line**, in the small mono style of today's path: the path · "changed" and the long
   date · who wrote it ("written by you", "written by your agent", "shared by Ahmed", "opened by a
   link"). It may wrap.
3. **One action row** (wraps when it must):
   - the sharing control's button (own notes only, unchanged);
   - the topic chips, each with the topic's name, its kind in small text and, on one's own note, a
     **×** button (accessible name "Remove <topic>"); removing acts at once, as today;
   - **+ Topic** (own notes, fewer than five topics): opens the topic picker (6.3);
   - **⋯** at the end of the row (own notes): opens the note menu (6.4). A colleague's note shows
     **⋯** with Copy link only.
   - A note with no topics shows no chips; the words "No topics yet." are dropped.
4. **The held notice** (own held notes): the release box as today, with 14 px of space above and
   below, its sentence unchanged.
5. **Linked with**: unchanged.
6. A line, then the note's text.

### 6.2 The title once

If the body's first line that is not empty is a level-one heading (`# text`) whose text equals the
note's title — compared trimmed, with runs of white space as one space, ignoring case — that line is
not shown. Nothing else in the body changes. A pure function `withoutTitle(body, title)` does it;
frontmatter is already not part of `body`.

### 6.3 The topic picker

A popover under **+ Topic**: a search field (label "Find a topic"), then the hive's topics the note
does not have, grouped under their kind's heading in the fixed kind order, filtered by the text
(contains, ignoring case). Choosing one adds it through today's `onAddTopic` and closes the picker;
the outcomes and their sentences are today's ("A note has at most five topics. Remove one first.",
"That didn't work. Try again."). When no topic matches: "No topic matches." When the hive has no
other topics, + Topic is not shown. It closes like the Add notes menu.

### 6.4 The note menu

A popover under **⋯** (accessible name "More actions for this note"), aligned to its right edge:

- **Copy link**: copies the note's absolute address (`location.origin` plus today's note href) to
  the clipboard; the status line says "Link copied." or, when the browser refuses, "The link could
  not be copied."
- **Delete note…** (own notes only): closes the menu and shows today's delete question in the
  action row's place, with Delete and Keep, the half-second rule and the outcomes as today. Keep
  returns focus to ⋯.

## 7. With no note open

The pane shows a summary instead of "Choose a note to read it.". All of it is worked out on the
page from the loaded data.

**A workspace tab**, top to bottom:

1. The workspace's name as a heading.
2. Four counts: **notes** (all notes of the tab), **folders** (folders in the tree, "All notes" not
   counted, hidden ones not counted), **topics** (distinct topics attached to the tab's notes),
   **changed today** (notes whose last change falls on the viewer's today, by `now`).
3. When there are held notes: a box "N notes are held. Your agents wrote them; nobody else sees
   them until you release them." (one note: "1 note is held. …") with **Review**, which chooses
   "Held, waiting for you" in the left column (Folders mode).
4. "Recently changed" and the six most recently changed notes of the tab, each a link that opens
   it, with its short date.

An empty workspace keeps today's empty sentence in the list and shows only the heading and the
counts.

**Shared with me**: the heading "Shared with me", one line "N notes from M colleagues" (with
singulars), then "Newest" and the five newest notes as links.

"That note isn't available." stays for a missing note.

## 8. Narrow

When the Vault card is **under 1,000 px wide** (measured with a `ResizeObserver` on the card; the
first render assumes wide), the folder column is not shown. The list header's title becomes a
button — the title followed by a down mark — that opens a popover holding the Folders / Topics
switch and the same list, at most 70% of the card's height and scrolling. Choosing a folder, a
topic, Held or All notes closes it. It closes like the Add notes menu. When the card is wide again
the column returns with the same choice. On the shared tab there is no folder column and no
button, as today.

At 1,100 px (rail open) the note then gets about 500 px. The bar stays one row.

## 9. Code shape

All in `web/src/vault/` unless named.

| Unit                                          | Change                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `rowTopics.ts` (new, + test)                  | `rowTopics(ids, topics, max = 2): { shown: VaultTopic[]; more: number }`                                              |
| `withoutTitle.ts` (new, + test)               | `withoutTitle(body, title): string` (6.2)                                                                             |
| `overview.ts` (new, + test)                   | `overview(data, tree, now): { notes, folders, topics, today, held, recent }` and `sharedOverview(notes, members)` (7) |
| `tree.ts` (+ test)                            | `visibleTree(root, rules)` or a flag on nodes: hides folders per section 4                                            |
| `NoteList.tsx`                                | Rows per 5.1                                                                                                          |
| `Folders.tsx`, `marks.ts`                     | Hidden folders, the dot's label, the Held row's words                                                                 |
| `ShareControl.tsx`                            | "Folder sharing: …" button text and the none option's words (5.2)                                                     |
| `Preview.tsx`                                 | Order of 6.1, `withoutTitle`, the summary of 7 in place of the idle line                                              |
| `NoteTopics.tsx`                              | Chips with ×, + Topic and the picker (6.3)                                                                            |
| `NoteMenu.tsx` (new)                          | The ⋯ menu (6.4); takes over `DeleteNote`'s place                                                                     |
| `Overview.tsx` (new)                          | Section 7                                                                                                             |
| `AddNotes.tsx` (new)                          | The menu of section 3                                                                                                 |
| `PanelDialog.tsx` (new)                       | The dialog container of section 3                                                                                     |
| `ScopePicker.tsx` (new), `useNarrow.ts` (new) | Section 8                                                                                                             |
| `Vault.tsx`                                   | The bar, the dialog, the fold; wiring                                                                                 |
| `vault.module.css`                            | Styles for all of the above                                                                                           |

Every sentence a person reads lives in the vault's text modules (`sentences.ts`, `topicText.ts`
and the like), as `no-literals.test.ts` requires. The popovers reuse `web/src/map/useDismiss.ts`
by import.

## 10. Performance and data

- **First paint**: unchanged. The loader, its queries and their bounds are not touched.
- **Interactions**: opening the menu, the dialog, the picker, the note menu, the narrow picker, and
  computing rows, hidden folders and the summary are client state over the loaded data: **0 new
  server round trips**. `overview` and `visibleTree` are memoised on `data` and run once per load,
  in one pass over at most 2,000 notes.
- **Writes**: the same ones as today (sharing, release, delete, unlink, add and remove topic,
  import, connect, attach), each followed by today's refresh. Copy link writes nothing to the
  server.

## 11. Accessibility

- Add notes, + Topic, ⋯ and the narrow title button are buttons with `aria-expanded` and
  `aria-controls`; their popovers are groups of buttons reached with Tab, closed with Escape, with
  focus returned to their button.
- The dialog traps focus and is labelled by its panel's heading.
- Sharing marks on rows keep their text for screen readers; × buttons are named per topic.
- The status line that says "Link copied." is the existing `role="status"` line.

## 12. Tests

Unit (Vitest): `rowTopics` (none, two, five with "+3", unknown ids skipped); `withoutTitle` (equal
heading removed, different heading kept, heading not first kept, case and spaces); `overview`
(counts, today by `now`, held, the six recent, an empty workspace); `sharedOverview` (singular and
plural); hidden folders (empty without rule hidden, empty with rule kept, empty parent of a ruled
child kept).

Browser (Playwright, `/dev/vault`): the bar has Add notes and the filter, and Shared with me has no
Add notes; the menu lists three items on a workspace and opens the import dialog; Escape closes the
dialog and returns focus; rows show topic chips and no sharing words; the folder header reads
"Folder sharing: …"; an empty folder without a rule is not listed; the open note shows its title
once, one action row, × removes a topic, + Topic adds one, ⋯ → Delete note… asks and Keep returns;
Copy link reports; the held notice and Release work; with no note open the summary shows counts,
held with Review choosing Held, and six recent notes; at 1,100 px the folder column is gone and the
title button opens the tree, choosing a folder closes it and filters the list. Existing vault tests
are updated where the words or the order changed, never deleted to pass.

## 13. Documents

`docs/ui-concept.md`, section 4, Vault: the bar and Add notes menu, the dialog, rows, "Folder
sharing", the note pane's order, the summary and the narrow fold, replacing the words they change.

## 14. Independent units (for the plan)

- (a) Rows and left column: `rowTopics`, hidden folders, `NoteList`, `Folders`, `marks`,
  `ShareControl`'s words.
- (b) Note pane: `withoutTitle`, `Preview`'s order, `NoteTopics` and the picker, `NoteMenu`.
- (c) Summary: `overview`, `Overview`, its place in `Preview` (after (b) lands in `Preview`, or in
  a separate slot the plan names).
- (d) Bar, menu and dialog: `AddNotes`, `PanelDialog`, `Vault`'s bar.
- (e) Narrow fold: `useNarrow`, `ScopePicker`, `Vault`'s columns; after (a) and (d).
- (f) Browser tests and `docs/ui-concept.md`; last.
