---
type: session
date: 2026-11-24-2213
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-1928-eight-hand-tuned-themes]]"
  - "[[2026-11-24-1609-rings-hive-theme-rails-filters]]"
---

# The map's controls in one bar

## What changed

- Danijel asked to rethink the rest of the interface after the themes: easier to use, less cluttered. A walk through every screen gave a list of problems and a split into four rounds: the map's controls, the Vault, then Inbox, Settings and Gallery, then the shell. This session built round 1. He chose layout "A · One bar" from three clickable mocks. Spec `docs/superpowers/specs/2026-11-24-map-chrome-design.md`, plan `docs/superpowers/plans/2026-11-24-map-chrome.md`.
- **One top bar** (merge `ce21e72`): the view switch, a "Group by" menu in place of the "Arrange by" switch, search with a Filter button inside it, the chips, one count ("301 items" or "96 of 301 shown") and a Today button. The stats line and the count of links are gone.
- **One filter list** with three columns (the groups, Kind, People) that opens downward under search. The bottom-left filter bar is removed. The filter's rules, previews and chip fitting were moved, not rewritten.
- **The side panel is hidden until asked for.** It opens on Today, on a selected dot or on `]`; the folded strip is gone. A browser whose cookie says the panel is open keeps it open.
- **Labels and Legend** sit beside the zoom control. A shared hook, `useDismiss`, closes the three popovers alike and keeps only one open at a time.
- Gates on the merged state: unit tests, typecheck, lint, build; 367 browser tests; frame checks at 16.7 to 16.8 ms p95 at 5,000 items.

## Why

The map's controls sat in all four corners of the card, two identical switches stood side by side, search and filters were on opposite sides, the same count appeared twice, and the side panel held 290 px for three numbers.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev:web`, open `http://localhost:3000/dev/map`. The top of the card is one row; the bottom left corner is empty; the map is wider because the side panel is hidden. If the panel shows, your browser remembered it open: press `]` once.
2. Press **Today** at the right of the bar: the side panel opens with today's count. Press it again, or the × in the panel, or `]`: it closes.
3. Click a dot: the panel opens on that note. Close the panel: the dot stays selected.
4. Press **Group by Folder** and choose Time: the dots regroup by month and the button reads "Group by Time". Switch to Timeline: Group by is gone. Back to Rings: it returns.
5. Press **Filter** inside the search field: one list with Folders, Kind and People opens under it. Point at a row: the map previews it. Tick two folders: two chips appear, the count reads "N of 301 shown", the rest of the map dims.
6. Tick a person as well: the count narrows. Press **Clear all**: everything returns and the count reads "301 items".
7. Type in search: a chip with the text appears; its × clears the field. `/` focuses search.
8. Bottom right: **Aa** turns the labels off and on; **?** opens the legend above the corner.
9. With the legend open, open Filter: the legend closes. Escape closes whichever is open and does not clear a selected dot.
10. Narrow the window to about 1,000 px: the bar becomes two rows and nothing overlaps.

## Open threads

- Not deployed and not promoted.
- When the card is under about 1,100 px wide (a 1,366 px window with the side panel open) the bar is two rows, and an open Group by menu covers the Filter button below it until it is closed.
- A map with one item or none shows search and the count but has no browser test.
- The chip fitting is measured again on every keystroke in search; it costs one layout read each time.
- Focus rules differ slightly between the three popovers when focus moves within the same control; in Safari a click into search may leave the filter list open.
- The browser tests reuse whatever server listens on port 3100. With several sessions running at once, a run can hit another session's server or be cut short: one full run here ended at 170 tests and passed in full (367) on the rerun. Wait for the port to be free before a run that counts.
- Rounds 2 to 4 are not started: the Vault's empty preview pane and rare actions, button weight and repeated text in Inbox, section navigation in Settings, one header pattern for every page.
- The Timeline's empty band between the agent rows and the notes was left alone.

## Next session entry point

Have Danijel try the new bar on the real hive, then deploy `develop`. Round 2 is the Vault: start a brainstorm from the critique in this session (empty preview pane, rare actions as heavy as common ones, the sharing text on every row).
