# The map's controls in one bar: design

Date: 2026-11-24. Status: approved from a clickable mock (layout "A", then "confirmed" to the
design). Round 1 of four; rounds 2 to 4 (Vault; Inbox, Settings and Gallery; the shell) get their
own specs.

## 1. What changes

Today the map's controls sit in all four corners of the card: a stats line top left, the view
switch, the "Arrange by" switch, Labels and Search along the top, the filter bar bottom left and
the zoom control bottom right. The side panel takes 290 px whether or not it has anything to say.

After this change:

1. **One top bar** holds the view switch, a "Group by" menu, search with the filter inside it, the
   chips, one count and a Today button.
2. **One filter list** replaces the three list buttons. It opens downward under the search field.
3. **The side panel is hidden until it is asked for.** It no longer folds to a strip.
4. **The bottom right corner** holds zoom, then Labels and Legend. The bottom left bar is gone.

Not in this round, and not to be touched: the canvas and the renderer, the three views and their
geometry, what a filter means (any within a list, all across lists), the contents of the side
panel, the hover card, the left rail, the themes, every other page, the server and the database.
The empty band in Timeline is a known wart and stays for now.

## 2. The top bar

One row inside the map card, left to right:

| Part        | What it is                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| View switch | Rings, Timeline, Orbit. The segmented control and its sliding highlight, unchanged                                                                           |
| Group by    | A button reading "Group by Folder" (or Links, Time) that opens a menu of the three. Shown only in Rings. Replaces the "Arrange by" segmented control         |
| Search      | One field, placeholder "Search notes and files", with a **Filter** button at its right end. The `/` key still focuses it                                     |
| Chips       | One chip per filter choice and one for the search text, each with a remove button. When they do not fit, the first ones show and a "+N" chip counts the rest |
| Count       | See section 4. Followed by **Clear all** while anything is filtered                                                                                          |
| Today       | A button showing today's number. Opens and closes the side panel (section 5)                                                                                 |

The count and Today sit at the right end; the chips take the room between search and count.

**Group by.** Choosing an entry does what the switch did: the dots glide to the new arrangement,
the selected item stays selected, a group choice in the filter is cleared, and the menu closes.
The menu is a popover with three radio rows; Escape or a press outside closes it and focus
returns to the button. The current choice has a tick.

**Narrow widths.** The bar wraps. Row one keeps the view switch, Group by and Today; search,
chips and count drop to a second row. Search never gets narrower than 220 px. Under 700 px the
page stacks as it does today.

## 3. The filter list

Pressing **Filter** opens one popover under the search field, right-aligned to it, with three
columns side by side:

- the groups, headed "Folders", "Clusters" or "Months" in Rings (by the arrangement) and "Topics"
  in Timeline and Orbit;
- **Kind**: Notes, Files, and the hubs (called "Groups" in Rings, "Topics" elsewhere);
- **People**.

Each row is a checkbox with a name and a count, as today. Everything the old lists did is kept:
pointing at or focusing a row previews it on the map without choosing it; Escape, a press outside
or tabbing out closes the list; choosing a filter clears the selection. Each column scrolls by
itself when it is longer than the popover (at most 60% of the card's height). When the card is
too narrow for three columns they stack and the popover scrolls as one.

The Filter button shows a badge with the number of choices when there are any, and reads
"Filter, N chosen" to a screen reader. The "All" shortcut in each list's head is kept per column.

## 4. One count

The stats line ("301 items, 40 links") and the filter bar's count ("All 301 shown") become one
status line at the right of the bar:

| State                               | Text                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| Nothing filtered                    | `301 items` (`1 item`)                                           |
| A filter or search text is on       | `96 of 301 shown`                                                |
| The map was cut to its newest 5,000 | `5,000 most recent items`, and `96 of 5,000 shown` when filtered |

The number of links is no longer shown. The line is `role="status"`, as the filter count is today.

## 5. The side panel

- **Hidden by default.** A browser with no `hive-fold` cookie, or one whose panel part is missing
  or unknown, gets the panel shut. A cookie that says `open` keeps it open, so nobody's existing
  choice changes. The rail part keeps its default (open).
- **Shut means gone.** The 52 px strip is removed; the map card takes the width.
- **It opens** on the Today button, on selecting a dot (as now), and on `]`.
- **It closes** on the same button, on `]`, and on a close button at the panel's top right (the
  old fold button, renamed "Close details"). Closing keeps the selection.
- **Its contents do not change:** Today, the sparkline, By person, Needs you, then Selected, and
  the housekeeper's line.
- **The Today button** shows the count of today's writes, and a small accent mark when anything
  needs the person, since the strip that showed that number is gone. Its accessible name is
  "Today, 82 notes written or changed" plus ", 5 need you" when that applies; it carries
  `aria-expanded` and `aria-controls` for the panel.
- Under 700 px nothing folds, as today: the panel is stacked under the map and the Today button
  is not shown.
- Focus: when the panel closes while focus is inside it, focus moves to the Today button.

## 6. The bottom right corner

The zoom control keeps −, the percentage, + and Fit. After a divider come two small buttons:

- **Labels** ("Aa", `aria-label="Labels"`, `aria-pressed`): the toggle that sat in the top bar.
- **Legend** ("?", `aria-label="Legend"`): opens the existing legend popover, now upward from
  this corner. Its content is unchanged.

## 7. What is removed

- The stats line and the count of links.
- The "Arrange by" label and its segmented control.
- The bottom-left filter bar with its three list buttons, its rules and its own count.
- The folded strip of the side panel and its two numbers.

## 8. Code shape

All of it is in `web/src/map/` and `web/src/shell/fold.ts`.

| Unit                      | Responsibility                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `Controls.tsx` (`TopBar`) | Lays out the bar; owns nothing but the view switch                                          |
| `GroupMenu.tsx` (new)     | The Group by button and its menu                                                            |
| `FilterBar.tsx`           | Becomes the search field with the Filter button, the one popover, and the chips with "+N"   |
| `countText.ts` (new)      | Pure: the count's text from shown, total, active and truncated                              |
| `TodayButton.tsx` (new)   | The button, its mark and its accessible name                                                |
| `Legend.tsx` (new)        | The legend's list, moved out of `FilterBar.tsx`                                             |
| `ZoomControl.tsx`         | Gains Labels and Legend                                                                     |
| `DetailRail.tsx`          | Loses the strip; the fold button becomes the close button                                   |
| `fold.ts`                 | The panel's default becomes shut; the rail's stays open                                     |
| `map.module.css`          | The bar's layout, the popover's columns, the corner; the strip's and the old bar's rules go |

`chipFit.ts` is reused as it is; only the room it is given changes.

Independent units, which the plan may schedule together: the panel (fold default, strip removal,
Today button); the corner (Labels, Legend); the count text. The Group by menu and the filter both
change `Controls.tsx` and follow one another. `Map.tsx` wires all of them, so its edits are made
in sequence.

## 9. Performance and data

- First paint: unchanged. One load of the map; the fold cookie is read on the server, so the
  panel's state is right on the first paint with no flash.
- Every interaction here (Group by, Filter, search, chips, Today, Labels, Legend) is client state:
  **0 new requests**. Nothing writes to the server.
- No query changes. No migration.
- The frame checks (`e2e/map-perf.spec.ts`, `e2e/hub-map-perf.spec.ts`) must still pass; nothing
  here draws on the canvas, but hiding the panel makes the canvas wider.

## 10. Accessibility

- Every control is a real button or input with a name; the two popovers carry `data-popover` so
  the page's keys stay quiet inside them.
- Tab order follows the bar left to right, then the map's dot list, then the corner.
- Focus returns to the button that opened a popover when it closes, and to the Today button when
  the panel closes with focus inside.
- The count is announced politely when it changes.
- Contrast rules of `docs/ui-concept.md` section 6 apply; no new colour or token is added.

## 11. Tests

- Unit: `countText` (the table in section 4), `parseFold` and the new default, the Today button's
  name, `chipFit` unchanged.
- Browser (`e2e/map.spec.ts`, `e2e/fold.spec.ts`), rewritten where they name what is gone: one
  Filter button opens three columns and each still filters and previews; chips and "+N"; Clear
  all; Group by changes the arrangement and clears the group choice, and is absent in Timeline
  and Orbit; the count's three states; the panel is absent with no cookie, opens on Today, on a
  selected dot and on `]`, and closes without losing the selection; Labels and Legend work from
  the corner; the bar wraps at 1,000 px without overlap.
- The existing gates: typecheck, lint, unit tests, build, and the two frame checks.

## 12. Documents

`docs/ui-concept.md` section 3 is rewritten where it describes the filter bar, "Arrange by", the
layout paragraph and folding of the side panel.
