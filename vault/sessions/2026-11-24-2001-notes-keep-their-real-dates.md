---
type: session
date: 2026-11-24-2001
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-1750-wiki-links-become-links]]"
---

# Notes keep their real dates

## What changed

- Merged as `70f5314` and deployed. Migration `20261124153504_note_dates` is applied to the
  hosted project and recorded.
- Database: only a person may set a note's `created_at` and `updated_at` (never before 1990,
  never after now, the change never before the writing); an agent or a connected app always gets
  the real moment. Nobody sets a file's date through the API (`files_keep_date`). `map_graph`
  carries `created_at`.
- Import: the browser works out each note's dates (a date field, then the file name or path, then
  the file's last-modified time; `web/src/import/dates.ts`) and the server checks and stores them.
  Importing a folder again corrects the dates of notes already there and counts them as updated.
- Map: the Timeline places a note by when it was written. Its 14 columns are days, weeks, months,
  quarters or years, the smallest that fits (`web/src/map/timescale.ts`). The note's details show
  "Written" and "Changed". Rings freshness still uses the last change.
- Review found four things, all fixed before the merge: an agent could backdate a file, no lower
  limit on a person's date, a second "updated" after importing an edited file, and a date for
  today falling through to an older date in the file name before 12:00 UTC.
- The deploy also put the hub-hover fix and the eight themes on the live site; they were on
  `develop` and had not been deployed.
- Gates at merge: 301 database and tooling tests, 2,001 web unit tests, typecheck, lint, build.
  On the branch before the review fixes: 103 vault and 61 map browser tests.

## Why

After the DRA import every note sat on "Today" in the Timeline, because the map placed a note by
its last change and an import stamped that with the moment of import. Danijel asked for the
Timeline to follow when a note was created.

## How to test (for the user)

1. Open `https://hive-mind-synapse.netlify.app/vault` and reload. Switch to the hive "Autonomous
   Mobility Etisalat" and open the workspace "DRA Vault".
2. Press "Import a folder" and choose the same DRA folder as before. Expect about 1,643 notes
   counted as "Updated" and none added. Text and links stay as they were.
3. Open the map and switch to Timeline. Expect the notes spread over the columns instead of all
   on "Today", with column labels in weeks, months, quarters or years.
4. Click a note. Expect "Written" with its real date and "Changed" beside it.
5. Import the same folder once more. Expect every note "Unchanged".
6. Switch to the hive "Synapse" and open Timeline. Expect days ending in "Today" if all its notes
   are from the last 14 days, a wider scale otherwise.

## Open threads

- Not run on the real project yet: the re-import of the DRA folder is Danijel's test.
- The browser tests were not rerun after the review fixes (those touched the database and the
  import's server code, covered by unit and database tests).
- Accepted limits: a copied vault may carry the copy day as every file's time; the 5,000-item cap
  still picks by last change; one old note widens the scale for the whole hive; wide labels
  ("Q4 2026") were not checked at small window sizes.
- Still open from before: run "Connect wiki links" on the DRA vault and time `map_graph`; test
  results for delete a hive, folder import and wiki links; then promote `develop` to `main`.

## Next session entry point

Ask for the result of the DRA re-import and the Timeline, then time `map_graph` and promote
`develop` to `main` once the earlier slices are confirmed.
