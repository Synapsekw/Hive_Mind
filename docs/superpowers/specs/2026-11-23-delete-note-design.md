---
type: spec
status: active
last-updated: 2026-11-23
tags: [project/hive-mind, spec, ui, security]
---

# Delete a note — design

A short slice between agent sign-in and the remote connector.

## Intent

Agents create notes; nobody can remove one. The database already lets a person delete their own
notes and refuses an agent, but no screen offers it and the audit log does not record it. This
slice adds Delete to the vault.

## Decisions taken with Danijel (2026-11-23)

- **Gone for good, with a confirm step.** No trash, no restore.

Decided in the design (say so if any is wrong):

- **Your own notes only**, one note at a time. No folder or bulk delete.
- **What goes with the note:** its history (versions), its links in either state, its topic
  tags. **Files attached to it stay** in the gallery, no longer attached (the schema already
  does this).
- **The audit log records it** with the note's id and counts only, never its path, title or
  body.

## Goals, non-goals, anti-goals

- **Goals**
  - In the vault, an open note of yours has **Delete**; a second, deliberate click removes it.
  - After deleting, the note's tab closes and the list no longer shows it.
  - `note.deleted` in the audit log, readable by the hive owner as the rest of the log.
- **Non-goals:** trash or undo; deleting folders, several notes, or a colleague's note;
  deleting through an agent; deleting the files attached to the note.
- **Anti-goals**
  - An agent deleting a note (the database refuses; no MCP tool exists and none is added).
  - Deleting a note the person does not own.
  - The note's path, title or body in the audit log or in a server log.

## Constraints found in the project

- `notes_delete` policy: `member_id in my_member_ids() and jwt_agent_id() is null`. No change.
- `note_versions`, `links`, `note_entities` reference notes with `on delete cascade`;
  `files.note_id` is `on delete set null`; `audit_log.note_id` has no foreign key, so the id
  stays readable after the note is gone.
- `notes_audit` fires on insert and update only. It skips writes with no person behind them.
- The vault's actions return `{ ok }` only; the preview pane has the note's sharing control and,
  for a held note, Release. Two-step confirms elsewhere (inbox Decline, settings Revoke) wait
  500 ms before the second click counts.

## Design

### 1. Database (one migration, `note_delete_audit`)

A trigger `notes_deleted_audit`, **before** delete on `public.notes`, for each row (before, so
the links and files it counts are still there; the row is written in the same transaction as
the delete and vanishes with it if the delete fails). When a person is signed in (`auth.uid()`
set) **and the note's hive still exists**, it writes one `audit_log` row: action `note.deleted`,
`note_id` = the deleted id, `member_id` = the person's member row in that hive, `detail` =
`{ "links": <links removed>, "files": <files detached> }`.

No audit row when there is no person (a service delete) or when the note goes because its hive
is being deleted. Deleting a workspace or a member still works and audits each note the person
removed that way.

### 2. Server (`web/src/app/vault/`)

`deleteNote(noteId)` → `{ ok }`. `deleteNoteIn(db, id)`: the id must be a uuid; a session must
exist; `from("notes").delete().eq("id", id).select("id")`; ok only when exactly one row came
back (a note that is not yours, or is already gone, deletes nothing and answers not ok). Logs an
error's code and message only.

### 3. Screen (`web/src/vault/`)

- In the preview of **your own** note: **Delete**, a quiet control after the sharing control. A
  colleague's note has none.
- First click: "Delete this note? It is gone for good, with its history and its links. Files
  attached to it stay in the gallery." with **Delete** and **Keep**. The second Delete counts
  only 500 ms after the question appeared.
- On success: the note's tab closes, the page refreshes, focus goes to the note list, and a
  status line says "Note deleted."
- On failure: "That didn't work. Try again." and the page refreshes (the note may already be
  gone).
- Tokens only, no new colours; the confirm follows the inbox's Decline.

### 4. Development page and tests

- `/dev/vault`: the stand-in action removes the note from the sample data; `?fail=1` refuses.
- **Database tests:** a person deletes their own note (gone with versions, links and tags; the
  file stays with no note); the audit row with id and counts and no text; an agent, another
  member, another hive's owner and anon are refused and nothing changes; only the owner reads
  the audit row; a service delete writes none; deleting a workspace and deleting a hive still
  work.
- **Unit tests:** `deleteNoteIn` (checks before any query, one row or not ok, logging).
- **Browser tests:** Delete appears only on own notes; the two-step with the 500 ms guard
  (double-click does not delete, at 390, 700 and 1600 wide); success closes the tab and removes
  the row; `?fail=1`; keyboard order.

## Performance and data-fetching budget

No change to first paint. Delete is one write and one refresh. The trigger counts links by
`from_note` / `to_note` and files by `note_id`, all indexed.

## Independent units (for the plan)

1. The migration and its database tests.
2. The server action (`web/src/app/vault/`).
3. The screen, the dev page and the browser tests (`web/src/vault/`, `web/src/app/dev/vault/`,
   `web/e2e/vault.spec.ts`).
4. Docs, the hosted database, gates. Needs all.

1, 2 and 3 share no file and meet at `VaultActions.deleteNote(noteId): Promise<Result>`.

## Known gaps (accepted)

- No undo. A slip past the confirm loses the note and its history.
- A colleague whose note was linked to the deleted one loses the link without a notice.
- Attached files stay in the gallery with no note, under whatever the sharing rules give a file
  without a note.
- Agents cannot delete, so an agent cannot tidy up after itself.

## Review focus

- Only the note's owner, as a person, can delete; the audit row carries no text of the note.
- The trigger never blocks a delete that worked before (workspace, member, hive).
- The confirm cannot be passed by one gesture.
