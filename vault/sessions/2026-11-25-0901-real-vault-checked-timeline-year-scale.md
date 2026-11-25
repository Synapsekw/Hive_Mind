---
type: session
date: 2026-11-25-0901
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-2001-notes-keep-their-real-dates]]"
  - "[[2026-11-24-1750-wiki-links-become-links]]"
---

# The real vault checked: dates, links and topics landed; the Timeline falls back to years

## What changed

- No source files changed. This was a read-only check of the hosted project
  (`tokyttkztrkjvkaksdnh`), by counts and dates only, after Danijel imported the folder again,
  ran "Connect wiki links" and applied topics.
- The notes now sit in hive "Synapse", workspace "Main": 1,641 notes. The workspace "DRA Vault"
  in hive "Autonomous Mobility Etisalat" is empty. The earlier import counted 1,643; the two
  missing notes were not traced.
- Dates: written dates run from 2017-12-12 to 2026-11-24; only 5 notes are dated on the import
  day; 806 took their date from a date field or the file name, the rest from the file's
  last-modified time; no note has a change before its writing.
- Wiki links: 5,107 accepted links joining 949 notes, none in another state.
- Topics: 287 topics, 4,107 attachments, 1,309 notes carry at least one.
- `map_graph` as the owner, five runs: 292 to 316 ms, about 1.37 MB, 1,641 items and 5,107
  links, not truncated, every item carries `created_at`. Fine for promotion.
- After the note-dates merge: the vault and map browser tests were rerun on `develop` (163
  passed) and the empty worktree folder was deleted.

## Why

The note-dates slice was only proven on sample data. Danijel asked whether the re-import, the
wiki links and the topics had taken effect on the real vault before testing it by hand.

## How to test (for the user)

No new behaviour shipped in this session. To see what the check found:

1. Open `https://hive-mind-synapse.netlify.app`, hive "Synapse", and switch the map to Timeline.
2. Expect year columns from 2017 to 2026 with almost every note in the last one (see the open
   thread below). Click a note: "Written" shows its real date.

## Open threads

- Defect on real data: the Timeline picks its scale from the oldest note. One note from 2017
  makes the columns years, so 1,549 of 1,641 notes (94%) land in the 2026 column; 92 notes
  cover 2017 to 2025. Within 2026 the notes spread well by month (475 in June, 148 to 242 in
  each month from July to November). This was listed as an accepted limit; on the real vault it
  is not acceptable.
- Proposed fix, not yet approved: pick the scale from where most notes are (for example the
  newest 95%) and gather the older ones in a first column labelled "Earlier". On this vault
  that gives month columns. Code: `web/src/map/timescale.ts` (`pickScale`) and
  `web/src/map/layouts.ts` (`timelineScale`).
- Still open: Timeline labels overprint when the map is zoomed out
  (`web/src/map/renderer.ts`). Danijel chose to wait for the interface merge;
  `task/map-chrome` has merged, so both Timeline fixes can now go in one task.
- Danijel's hand tests are still owed for deleting a hive, folder import, wiki links and note
  dates; `develop` is promoted to `main` after them.

## Next session entry point

Ask Danijel whether to build the two Timeline fixes (a scale that fits most notes, with an
"Earlier" column, and labels that thin out when they would collide) as one `/develop` task, then
collect his test results and promote `develop` to `main`.
