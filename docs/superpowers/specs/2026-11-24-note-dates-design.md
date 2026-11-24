# Notes keep their real dates: design

Date: 2026-11-24. Approved by Danijel in chat the same day.

## Why

After importing the DRA vault every note sat on today in the Timeline: the map places a note by
`updated_at`, and an import stamps that with the moment of import. Danijel: "the timeline should
be based on when the note has been created not when it was inserted in the Hive".

## Decisions (Danijel)

1. An imported note's date comes from, in order: a date in its fields, a date in its file name or
   path, the file's last-modified time. (A browser cannot read a file's creation time.)
2. The Timeline places a note by when it was created. Rings keeps using the last change for
   freshness.
3. The Timeline keeps 14 columns and picks its own scale: a column is a day, a week, a month, a
   quarter or a year, the smallest that fits the oldest note it shows.

## Behaviour

### The two dates of a note

`created_at` is when the note was written; `updated_at` is when it last changed. For a note an
agent writes, both are the real moment, as today. For an imported note:

- **Written date**, the first of:
  1. A field named, ignoring case, `created`, `date created`, `date_created`, `created_at`,
     `creation_date` or `date`, tried in that order. Its value is a text (or a number of
     milliseconds) in one of: `YYYY-MM-DD`, `YYYY-MM-DD HH:MM[:SS]`, an ISO date-time,
     `YYYY/MM/DD`, `YYYY.MM.DD`. Surrounding `[[ ]]` or quotes are ignored.
  2. A date in the file name, then in the folders from the deepest up: `YYYY-MM-DD`,
     `YYYY_MM_DD`, `YYYY.MM.DD` or `YYYYMMDD`, not part of a longer run of digits.
  3. The file's last-modified time.
- **Last changed**: the file's last-modified time, and never before the written date.
- A date without a time of day is taken as 12:00 UTC, so it lands on the same day everywhere.
- A candidate is usable only when it is a real calendar date from 1990-01-01 up to now. An
  unusable candidate is skipped and the next source is tried. With no usable source the note
  keeps the moment of import, as today.

### Import

- The browser works out the two dates and sends them with each note. The server checks them
  again (shape and range) and drops what is unusable.
- A new note is stored with them. A note that is already there and differs only in its dates
  has only its dates corrected and counts as "Updated"; its version does not change.
- A note whose text changed is updated as today; the database stamps its last change as now.
- So importing the same folder into the same workspace again fixes notes imported before this
  change. Nothing is duplicated; links stay.

### Who may set dates (database)

- A person (a signed-in session with no agent and no app pass) may set `created_at` and
  `updated_at` of their own notes. The database cuts a future value back to now and never lets
  `updated_at` be before `created_at`.
- An agent or a connected app: `created_at` and `updated_at` are the real moment on insert,
  whatever was sent, and `created_at` cannot be changed afterwards (the old value is kept).
- A content change stamps `updated_at` as now for everyone, as today.
- Today nothing checks these columns at all; this closes that.

### The map

- `map_graph` gives each note and file its `created_at` beside `updated_at`. Which 5,000 items
  are picked is unchanged (newest change first).
- **Timeline.** A note sits under the column of its created date. The scale is chosen from the
  oldest created date among the notes and files the Timeline is laying out, at the moment it
  lays them out:
  - day when everything is within the last 14 days (today's look, unchanged);
  - else week (Monday to Sunday, UTC), month, quarter, year: the first where the oldest fits in
    14 columns counting the current one;
  - older than 14 years: years, and the rest sits in the first column.
  - The last column is the current day, week, month, quarter or year.
  - Column labels: days as today; weeks by the day the week starts ("3 Nov") and "This week";
    months by short name, with the year on January and on the first column ("Jan 2026"), and
    "This month"; quarters "Q4 2026"; years "2026".
  - The agent row on top counts, per column, the notes an agent wrote whose created date falls
    in it.
  - A hub sits under the column of its topic's newest created date.
- **Arranged by time** (the grouping): groups by created date.
- **Rings freshness, sorting by recency, "today" counts**: unchanged, by last change.
- **The note's details** (peek and side panel): show "Written" and "Changed".
- A payload without `created_at` (an older database) falls back to `updated_at`.

## Architecture

- Migration `note_dates`: replaces `notes_before_write` (date rules added, nothing else changed)
  and `map_graph` (one more field).
- `web/src/import/dates.ts`: pure; `noteDates(frontmatter, path, lastModified, now)`.
- `web/src/import/plan.ts`, `web/src/vault/Import.tsx`, `web/src/app/vault/import.ts`: the two
  dates travel with a note and are stored.
- `web/src/map/timescale.ts`: pure; picks the scale, gives a column for a time and a label for a
  column. `graph.ts`, `layouts.ts`, `scene.ts`, `arrange.ts`, `Peek.tsx`, `DetailRail.tsx`,
  `types.ts` use it.

## Performance and data budget

- No new request anywhere. The map's one read gains one timestamp per item.
- The scale is computed in the browser in one pass over the items the Timeline lays out, when
  it lays them out; switching views or filters does no server round trip.
- Import: no extra request for a new note. A note that differs only in dates costs one update,
  as a changed note does today.

## Independent units

The migration with its tests, the import side, and the map side touch different files and
depend only on two names: the note fields `written_at` / `modified_at` in an import batch, and
`created_at` on a map item.

## Security notes

- A person can backdate their own notes. It moves only their own notes on the map; the audit
  log keeps real times. An agent or app cannot.
- Dates are data from a file: the server takes only a text of at most 40 characters that parses
  to a time in range, and sends the database an ISO text it formatted itself.

## Testing

- Database (node:test): a person's insert keeps past dates, a future one is cut to now,
  `updated_at` before `created_at` is raised to it; an agent's and an app's dates are ignored on
  insert and `created_at` is kept on update; a person's date-only update keeps the version; a
  content change stamps now; `map_graph` carries `created_at` for a note and a file.
- Unit (Vitest): date sources and their order, every format, invalid and future values, the
  range; the server's check and the date-only update; the scale for each unit and its edges,
  labels, columns; grouping by created date; the fallback without `created_at`.
- Browser (Playwright): the dev map with old sample notes shows a wider scale and its labels; a
  hive of recent notes still shows days; a re-import that corrects dates counts as updated.

## Known limits (accepted)

- A vault that was copied may have every file's time set to the copy day; notes with no date in
  fields or name then land there.
- A note edited in the hive and then imported again from an older file takes the file's text
  and time, as the import already did for text.
- The 5,000-item cap still picks by last change.
