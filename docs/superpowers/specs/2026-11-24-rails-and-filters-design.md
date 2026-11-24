# Folding rails and a filter bar: design

Date: 2026-11-24. Status: approved from a clickable mock ("ok go ahead").

## 1. What changes

Three things on the map screen, and one of them on every page:

1. The legend dock at the bottom of the map becomes a **filter bar**: labelled buttons that open
   lists, several choices at once, chips for what is active, a count and "Clear all".
2. The **left rail** folds to a strip of icons, on every page.
3. The **right panel** of the map folds to a narrow strip, and its "By person" rows become
   filters.

Not in this round: Timeline and Orbit drawing, the canvas, the server, the vault, gallery, inbox
and settings pages beyond the rail they share.

## 2. Filters

### 2.1 Model

A filter holds three lists and the search text:

- groups (the folders, clusters or months of the current arrangement; "topics" in code),
- kinds (note, file, hub, agent),
- people (member ids).

An empty list means "all". Inside one list a node passes when it matches **any** entry; across
lists and the search it must pass **all**. The selection rule (a selected dot lights itself and
its neighbours) and the rule that the index stays lit are unchanged.

Groups are kept by name, people by id, so they survive a refresh; a name or id the new model no
longer has is dropped. Changing the arrangement clears the groups, as today.

### 2.2 The bar

It sits where the dock sits (bottom left of the stage, over the canvas) and holds, in order:

- **Group button**, labelled with the arrangement's heading ("Folders", "Clusters", "Months";
  "Topics" in Timeline and Orbit), then **Kind**, then **People**. A button shows how many
  entries are chosen in its list.
- A button opens a list above the bar. Each row is a checkbox with a name and a count. In the
  group list a row carries the group's swatch; in Kind its shape; in People the initials.
  Kind lists Notes, Files, Groups (or Topics) and Agents.
- Pointing at or focusing a row **previews** it: the map shows what choosing only that row in
  that list would give, with the other lists and the search kept. Leaving ends the preview.
- **Chips** for every active entry and for the search text, each with a remove button. When they
  do not fit, the last chip reads "+N".
- **A count**: "All 301 shown", or "21 of 301 shown" when anything is active. It counts notes
  and files only.
- **Clear all**, shown only when something is active; it also clears the search field.
- **Legend**: a button opening a short key: note, file, not shared with you, group hub, agent,
  and "Brighter means changed more recently" (Rings only).

Only one list is open at a time. Escape or a press outside closes it and returns focus to its
button. Choosing a row keeps the list open.

The zoom control stays at the bottom right and must not be overlapped at 1280 px wide.

## 3. Left rail

- A fold button at the top of the rail, and the `[` key, switch between the full rail and a
  60 px strip. The state is kept per browser in a cookie and applied on the server, so a reload
  does not flash.
- Folded: each destination is its icon with its name as a tooltip and accessible name; the
  current one keeps its bar and tint; the inbox count is a small badge on its icon; the hive
  switcher is the mark alone (pressing it unfolds the rail and opens the switcher); the agents
  card is its status dots (pressing unfolds and opens the list); the account menu is the avatar
  alone and still opens its popover.
- Unfolded: as today, except the agents button reads "Agents" with "1 of 4 live" under it and no
  longer cuts its text.
- The fold applies on every page that shows the rail.

## 4. Right panel (map only)

- A fold button at its top, and the `]` key, switch between the panel and a 52 px strip showing
  today's count and, when anything waits, the "needs you" count. Pressing the strip unfolds it.
- Selecting a dot unfolds the panel.
- "By person" rows are buttons: pressing one adds or removes that person in the People filter;
  pointing at one previews it, as today. A chosen row is marked.
- The state is kept in the same cookie.

## 5. Keys

`[` folds or unfolds the left rail on every page; `]` the right panel on the map. Neither fires
while typing in a field, inside a popover or dialog, or with a modifier key.

## 6. Accessibility

- Fold buttons are real buttons with `aria-expanded` and a name ("Fold navigation", "Unfold
  navigation", and the same for "details").
- A folded rail keeps every control reachable by keyboard with its full accessible name.
- Filter buttons have `aria-expanded` and `aria-controls`; rows are `role="checkbox"` with
  `aria-checked` inside a labelled group; chips' remove buttons are named "Remove <name>".
- The count is in a polite live region.
- Reduced motion: folding does not animate.

## 7. Performance and data-fetching budget

- First paint: unchanged, one `map_graph` call. The fold cookie is read with the look cookie.
- Folding, filtering, previewing, clearing: 0 server round-trips; no write to the server.
- Hot path: filtering is one pass over the nodes, as today. A preview recomputes that pass; it
  must not rebuild the model, the layout or the scene.
- Folding resizes the stage; the canvas already redraws on resize. The 5,000-item checks must
  still pass.

## 8. Independent units

1. Filter model (`types.ts`, `select.ts`): pure.
2. Fold state and the left rail (`web/src/shell`, `app/layout.tsx`): independent of the map.
3. Filter bar and the map's wiring (`FilterBar.tsx` replaces `Dock.tsx`, `Map.tsx`): needs 1.
4. Right panel folding and its person filter (`DetailRail.tsx`, `Map.tsx`): needs 2 and 3.
5. Browser tests and docs: needs all.

Units 1 and 2 share nothing.

## 9. Testing

- Unit: the filter rule (any within, all across; empty means all; search; selection; index);
  parsing the fold cookie.
- Browser: choosing two folders lights both; adding a person narrows; chips appear and remove;
  the count; Clear all; preview on hover and focus; Escape and outside press; the legend; fold
  and unfold by button and by key on the map and on the vault page; a reload keeps the fold with
  no flash; a folded rail's controls keep their names; selecting a dot unfolds the panel; a
  "By person" row filters; nothing overlaps at 1280 px; the 5,000-item checks.
