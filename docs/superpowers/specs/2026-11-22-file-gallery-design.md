---
type: spec
status: active
last-updated: 2026-11-22
tags: [project/hive-mind, spec, ui]
---

# The file gallery — design

Third slice of Phase 2 (master spec §10), after [the vault](2026-11-22-vault-design.md) and the
[Keystone glass look](2026-11-22-keystone-glass-design.md).

## Intent

Agents save deliverables (PDFs, decks, spreadsheets, images) into the hive with `hive_save_file`.
Today a person can see that a file exists only as a diamond on the map, and can open it only in
the Supabase dashboard. This slice gives the person the place to find, look at, download and
remove the files they may read.

## Decisions taken with Danijel (2026-11-22)

- **Viewer:** images and PDFs open in a full-screen viewer; every other type downloads.
- **Actions:** view, download, and delete your own files. No upload from the browser.
- **Sharing is shown, not changed here.** A file is read by whoever may read the note it is
  attached to; that decision is made on the note, in the vault.
- **A grid of cards**, not a table (the concept doc: "previews of generated documents").

## Goals, non-goals, anti-goals

- **Goals**
  - `/gallery`, and "Gallery" as the third entry in the left rail.
  - A grid of the files the person may read, newest first: preview, name, type, size, date,
    owner, and one line on sharing.
  - Tabs **Mine**, **Shared with me**, **All**, and a filter by name.
  - A full-screen viewer for images and PDFs; Download for every file.
  - Delete for the person's own files, behind a confirmation.
  - From a file attached to a note the person may read: a link that opens the note in the vault.
- **Non-goals:** uploading; previews of PPTX, XLSX or other types; thumbnails of PDFs; changing
  sharing from the gallery; attaching or detaching a file; colleagues' unshared files as
  placeholders (the map shows those); search inside files; an audit entry for a deleted file
  (needs a migration; listed under "Known gaps").
- **Anti-goals**
  - A public or long-lived link to a file. The bucket stays private.
  - Any permission decision in app code: the database decides which rows and objects are readable
    and deletable.
  - A file's content run as a page of ours (an HTML or SVG file opened inline).
  - A schema change. This slice needs none.

## Constraints found in the project

- `public.files` rows carry `member_id`, `workspace_id`, `note_id` (nullable), `storage_path`,
  `name`, `mime`, `size_bytes`, `created_at`. Row-level security shows a row to its owner and to
  anyone who may read the attached note.
- Objects live in the private bucket `files`; `storage.objects` policies let a signed-in member
  read an object when they own its path or can see its `files` row, and let a **person** (never an
  agent) delete objects under their own path. Nobody can overwrite.
- `files` has an index on `hive_id` only. A hive's files are filtered by that index and sorted in
  memory; this is fine at today's sizes and is named in "Known gaps".
- `mime` is whatever the saving agent declared. It must not be trusted to decide how a file is
  shown.
- The colour-literal rule applies: no colour literal outside `web/src/theme/` and `globals.css`.

## Design

### 1. Data the page loads

`loadGallery(db, cursor?)` in `web/src/app/gallery/load-gallery.ts`, signed in as the person, in
three waves like the vault:

1. The caller's first hive.
2. In parallel: the hive's members, the caller's user, and the newest **200** files of the hive
   (`id, member_id, workspace_id, note_id, storage_path, name, mime, size_bytes, created_at`,
   ordered by `created_at` then `id`, descending; 201 are asked for to know whether more exist).
3. In parallel: the notes those files are attached to (`id, title, member_id` and the database's
   `note_visibility`), which returns only the notes the caller may read; and one batch of signed
   links for thumbnails.

The result per file (`GalleryFile`): `id`, `name`, `kind`, `size`, `created_at`, `owner` (display
name), `mine`, `note` (`{ id, title }` or null), `sharing`, `thumb` (a signed link or null).
No field carries `storage_path`. A signed link necessarily contains the path (corrected during
the build: the first wording said the path never leaves the server); a link is only made for a
file the caller may read.

- **`kind`** is decided on the server from the **file name's extension and the declared type
  together**: `image` (png, jpg, jpeg, gif, webp, avif with a matching `image/*` type), `pdf`
  (`.pdf` with `application/pdf`), `slides` (pptx), `sheet` (xlsx, csv), `doc` (docx, md, txt),
  else `other`. A mismatch gives `other`. SVG is `other`.
- **`sharing`** is one of: `private` (mine, no note, or the note is private), `through-note`
  (mine, and the note is shared with a group or the hive), `shared-with-me` (not mine).
- **`thumb`**: only for `kind = image` and `size` up to 2 MB; signed for 10 minutes. Larger images
  show the type tile.
- **More:** `loadMore(cursor)` is a server action returning the next 200 after the last
  `(created_at, id)`, with their notes and thumbnails.

### 2. The screen

The shared rail (`Shell`, `current="gallery"`) and one glass card, as on the vault.

- **Top bar:** tabs Mine / Shared with me / All with counts of what is loaded; a filter box.
  Default tab: Mine, or All when the person has no files of their own.
- **Grid:** cards about 200 px wide, as many columns as fit; the grid scrolls inside the card, the
  page does not. Each card is one button: thumbnail or type tile (the type as a mono label, e.g.
  `PDF`), then name (one line, cut with an ellipsis, full name in `title`), then a quiet line
  `type · size · date`, then owner on other people's files and the sharing line.
- **Sharing line:** "Private", "Shared through _note title_" or "Shared with you by _owner_".
  Text plus a mark, never colour alone.
- **Selecting a card** opens the viewer for `image` and `pdf`, and a small detail popover for the
  rest. Both offer Download, the note link ("Open note in vault", `/vault?note=<id>`) when there
  is a readable note, and Delete on the person's own files.
- **Empty states:** no files at all ("No files yet. Files your agents save appear here."); a tab
  or filter with no match ("No files match.").
- **Load more** at the end of the grid when the server said more exist.
- Fits one window from 1100 × 560 up, like the other screens.

### 3. Viewer

A full-window overlay (`role="dialog"`, `aria-modal`, focus trapped, Escape and a close button
return focus to the card; left and right arrows move through the files of the current tab that
the viewer can show).

- **Image:** `<img>` from a fresh signed link.
- **PDF:** the browser fetches the signed link, checks that the response's type is
  `application/pdf`, and shows it from an object URL with that type in an `<iframe>`. If the type
  differs, or the file is over 25 MB, the viewer shows the file card with Download instead. This
  is what keeps a mislabelled HTML file from being rendered.
- A file is never shown from a link older than its 10 minutes: opening asks the server for a new
  one (`openFile(id)`).

### 4. Server actions

In `web/src/app/gallery/actions.ts`, same shape and rules as the vault's (public endpoints; signed
in as the person; arguments checked before any query; only `{ ok }` or a value comes back; only an
error's code and message are logged):

- `openFile(id)` → `{ url, kind } | null`: reads the row (row-level security decides), signs its
  path for 10 minutes. Only for an image or a PDF; any other kind answers `null`, so a file the
  viewer cannot show never gets a link without the download disposition (added during the
  build).
- `downloadFile(id)` → `{ url } | null`: the same with the download disposition and the file's
  name.
- `deleteFile(id)` → `{ ok }`: reads the row; refuses unless its member is one of the caller's;
  removes the stored object, then deletes the row. The object goes first so the content is
  certainly gone if the second step fails; a row left behind shows as a file that cannot be
  opened and can be deleted again.
- `loadMore(cursor)` as in §1.

After a delete the card is removed from the loaded list in place; nothing else is re-read.

### 5. Development page and tests

- `/dev/gallery` renders the screen over a built-in fixture with stand-in actions, like
  `/dev/vault`; never served in production. Fixture thumbnails are small inline PNG data links.
- **Unit:** `kind` (including every mismatch), sharing line, size and date text, tab and filter
  selection, cursor checks, the loader against a stub client (three waves, the cap, a failed
  query, no hive, unreadable note), each action against a stub (bad id, not mine, storage
  failure leaves the row, order of the two delete steps).
- **Browser (`web/e2e/gallery.spec.ts`, on `/dev/gallery`):** tabs and filter make no request;
  an image opens in the viewer and Escape returns focus; a PDF opens; a deck offers Download and
  no viewer; Delete asks first, is absent on a colleague's file, and removes the card; the screen
  fits 1366 × 768 and 1100 × 560; both looks (default and `aurora.light.vivid.classic`); keyboard
  reaches every control.
- The four gates and all browser suites stay green.

## Performance and data-fetching budget

- **First paint:** 3 waves; 4 queries (hive; members; files, capped at 200 and filtered on the
  indexed `hive_id`; notes by id) and 1 storage call that signs all thumbnails at once. No file
  content is read on the server. Thumbnails load lazily (`loading="lazy"`), each at most 2 MB.
- **Tabs, filter, selecting a card, the detail popover:** 0 requests; client state only.
- **Open in viewer / Download:** 1 server action, then the browser fetches the file from storage.
- **Delete:** 1 server action (a write); the list is updated in place, no reload.
- **Load more:** 1 server action, bounded at 200.
- **Server data changed by an interaction:** only Delete.

## Independent units (for the plan)

1. **Contract:** `web/src/gallery/types.ts`, the pure helpers (`kind`, text, selection) and the
   fixture; the rail entry.
2. **Data:** loader, argument checks, actions. Depends on 1 only.
3. **Screen:** grid, card, viewer, popover, stylesheet, `/dev/gallery`, browser tests. Depends on
   1 only.
4. **Wiring:** `/gallery` page joining 2 and 3; README and concept-doc lines.

Units 2 and 3 share no file and can be built at the same time.

## Known gaps (accepted)

- Deleting a file writes no audit-log entry.
- No composite index on `files (hive_id, created_at)`; add it with the first migration that
  touches files, before a hive holds thousands.
- An object whose row delete failed is gone while the row remains until deleted again.
- Checked on the live project by hand only; the browser tests use the fixture, and `test:live`
  does not cover the gallery.

## Review focus

1. A row whose declared type is `application/pdf` or `image/png` but whose content is HTML or SVG
   is never rendered as a page.
2. Signed links of files the caller cannot read and the service key never reach the browser, and
   no field carries `storage_path`; an id of a file the caller cannot read gives `null`, not an error that tells them
   it exists.
3. `deleteFile` on a colleague's file that is shared with the caller is refused before any
   storage call.
4. Tabs and filter make no request and keep the scroll position sensible.
