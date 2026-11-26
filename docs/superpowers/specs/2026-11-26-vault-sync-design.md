---
type: spec
status: approved
last-updated: 2026-11-26
tags: [project/hive-mind, spec, db, sync, web]
---

# Vault sync: the Mac's vault folder kept in the app — design

Today the app's copy of a vault comes from **Import folder** on the Vault page, run by hand. On
2026-11-26 the app's workspace `Main` matched the DRA Vault on Danijel's Mac for 1,641 notes, with
3 notes only on the Mac (two new agent session notes and `file-index.md`, which is over the 1 MB
note limit) and one only in the app (`Uploads.md`, the gallery's upload note). It drifts every
day, because agents and Obsidian write the folder and nothing carries the changes over.

This spec makes a scheduled job on the Mac keep one workspace equal to one vault folder: notes
and files, additions, changes, moves and deletions.

A second, separate spec follows: **viewing HTML decks in the app** (a sandboxed frame on its own
origin, with the deck's own scripts, styles and images). The sync stores HTML files; the viewer
opens them. They share no code and can be built in parallel.

## Decisions (Danijel, 2026-11-26)

| Question         | Decision                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Direction        | One way: vault into the app. The app never writes back.                                                              |
| Source           | The vault folder on this Mac (`~/Dev/DRA Vault/DRA (Drones, Robotics, AI)`), not the GitHub repo `Synapsekw/DRA`.    |
| When             | On a timer: every 15 minutes, plus once at login.                                                                    |
| Deletions        | Mirrored: a file deleted on the Mac deletes the note or file in the app, behind a mass-delete guard.                 |
| Moves            | A path gone and a new path with the same content in the same run is a move, not a delete plus a create.              |
| Sign-in          | A sync key, made in Settings, scoped to one workspace, enforced by the database.                                     |
| What goes in     | Notes and every other file type, HTML included, **except video**; at most 50 MB a file (the storage bucket's limit). |
| Edits in the app | Synced notes are read-only in the app: their text belongs to the vault.                                              |
| Approach         | The app's copy is the reference: each run compares the folder's full manifest with the app.                          |

## 1. Parts and where they live

### On the Mac: `sync/` (new package)

- **`hive-sync`**, a Node command, run by a launchd agent every 15 minutes and at login
  (`RunAtLoad`). Subcommands: `setup` (asks for the key, the folder and the workspace; stores the
  key in the macOS Keychain with `security`), `now`, `status`, `--confirm-deletes`, `uninstall`.
- **Fingerprint cache** in `~/Library/Application Support/hive-sync/cache.json`: per path, the
  size, the modified time and the SHA-256 of the content. A file whose size and modified time
  match is not read again. Losing the cache costs one slower run, nothing else.
- **What is skipped:** any path with a dot-folder or dot-file part (`.obsidian`, `.git`,
  `.trash`), video files (by extension: `mp4 mov m4v webm mkv avi wmv flv mpg mpeg 3gp`), and
  anything listed in `.hivesyncignore` at the vault root (gitignore syntax). Files over 50 MB are
  **listed** in the run report and not uploaded.
- **Lock:** a lock file stops two runs overlapping.
- **Logs** in `~/Library/Logs/hive-sync.log`. A macOS notification only when the person must act
  (see §4).

### On Supabase

- **One migration** (minted with `scripts/new-migration.sh vault_sync`): the `sync_keys` table,
  the sync columns on `notes` and `files`, the sync functions, the rules of §3, and the
  `sync_runs` table. Tests in `tests/sync.test.mjs`.
- **Edge Function `sync-session`:** exchanges a sync key for a one-hour identity carrying a
  `sync_key_id` claim, the same way `agent-session` does for an agent token (same signing key,
  `AGENT_SIGNING_JWK`; no new secret).

### In the web app

- **Settings → Sync** tab: make a key (shown once, like agent tokens), revoke it, see when it
  was last used, the last 20 runs and the too-big files of the latest run.
- **Vault:** a synced note shows "From your vault on this Mac · Edit in your vault" where the
  edit control would be.
- **Gallery:** synced files appear like any file. A synced file shows "Home note set by your
  vault" instead of the Change home note button.

## 2. One run

1. **Sign in.** Read the key from the Keychain and exchange it at `sync-session`. A refused key
   stops the run (§4).
2. **Check the folder exists** and is readable. If not, stop before comparing anything: a missing
   folder must never read as "everything was deleted".
3. **Walk** the folder, applying the skip rules, and fingerprint each file (cache first).
4. **Compare** with `sync_plan(workspace, page)`: the job sends pages of up to 2,000
   `(path, sha256, size)` entries; after the last page the database answers four lists:
   - **new**: a path the app does not have;
   - **changed**: a path the app has with a different fingerprint;
   - **moved**: a synced path not in the manifest whose fingerprint matches exactly one new path
     (ties or several candidates: not a move, treated as gone plus new);
   - **gone**: synced paths not in the manifest and not moved.
5. **Notes first** (`.md` files). New and changed notes go up in batches (the import's limits:
   at most 50 notes and 1 MB of text a batch; a note over 1 MB is listed as too big). They are
   read exactly as the import reads them today (`parseNote`, the written-date rule from a date
   field, the file name or the file's modified time). A changed note gets a new version. Moves are
   applied as a path change on the existing note. After the batch the job runs the existing
   "Connect wiki links" rule over the changed notes (only between the person's own notes,
   accepted at once).
6. **Then files.** Each new or changed file: an upload slot (the gallery v2 upload flow), the
   PUT, then the record. A file whose fingerprint the workspace already stores is recorded
   against the stored object, not uploaded again. HTML and SVG are stored as
   `application/octet-stream`, as gallery v2 decided. The **home note** is the first synced note,
   in path order, whose text links to the file (`![[name]]`, `[[name]]`, or a markdown link to
   its relative path); with none, the "Vault files" note of the file's folder
   (`<folder>/Vault files.md` in the app only, made by the sync, private). When a home note stops
   linking to its file, the file moves to the next linking note, else to "Vault files".
7. **Deletes last**, in one call `sync_delete(run, paths, confirm)` (§3 guard).
8. **Report.** `sync_finish(run, counts, too_big, error)` records the run; the job saves its
   cache.

**Interruption-safe:** every step is repeatable; an interrupted run's next run compares again and
continues, with nothing duplicated. **First run** against the real vault: the 1,641 matching notes
are adopted (§3), 3 notes and about 12,500 files go up. A run uploads at most about 2 GB, so the
first catch-up takes a day or so of runs. **An unreadable file** (permission, locked mid-write) is
skipped for the run and retried on the next.

## 3. Database rules

- **Keys.** `create_sync_key(workspace_id)` — a person only (refused for any identity with an
  `agent_id` or app claim), for a workspace they own; returns the key once, stores its SHA-256.
  `revoke_sync_key(id)` — its owner. At most one live key per member per workspace (a new key
  revokes the old). The sync identity (`sync_key_id` claim) is checked on every request: the key
  must be live, else nothing is allowed.
- **What the sync identity may do**, only in its key's workspace: read paths and fingerprints of
  synced notes and files; insert, update, move and delete **synced** notes and files; upload into
  that workspace's storage folder; run the wiki-link rule. It may **not** set or change sharing
  (a synced note or file arrives private, as the import does; sharing it is the person's act in the app), propose or
  accept links (other than the person's own wiki-link rule), touch topics, gallery folders, other
  workspaces or the account, or delete anything it did not create.
- **Columns.** `notes.synced_by uuid references sync_keys` and `notes.sync_sha256 text`;
  `files.vault_path text`, `files.synced_by`, `files.sync_sha256`. Unique
  `(workspace_id, vault_path)` on files where synced. Indexes on `(workspace_id, path)` for notes
  (exists) and files.
- **Read-only synced notes.** For a note with `synced_by` set, only the sync identity may change
  `body`, `title`, `frontmatter`, `path` or `folder_id`. The person in the app, their Hive agents
  and connected apps are refused. Sharing, links, topics and gallery folders stay the person's.
  The person may still delete a synced note; it returns on the next run while its file exists,
  and the Vault says so.
- **Adopting imported notes.** On the first plan, a non-synced note at the same path in the
  key's workspace, owned by the key's member, is adopted: `synced_by` set; its text replaced by
  the vault's (a new version) only if it differs. Notes with no file (`Uploads.md`, notes written
  in the app) stay unsynced and untouched. Files already in the workspace are not adopted (they
  have no vault path); a synced file with the same content becomes a separate gallery entry.
- **Mass-delete guard.** `sync_delete` refuses, deleting nothing, when the batch is more than 25
  items or more than 2% of the workspace's synced items, unless `confirm` is true **and** the run
  is the one the job opened after a refused run for the same set (the refused list is stored on
  the run; confirm applies to that list only, never to a larger one).
- **Audit.** Every sync delete and move writes an audit entry with `sync_key_id`
  (`note.deleted`, `file.deleted`, `note.moved`, `file.moved`).
- **Runs.** `sync_runs`: key, started, finished, counts (added, changed, moved, deleted, skipped,
  too big), the too-big list, the refused-delete list, the error text. Readable by the key's
  member; written only by the sync identity. Old runs are trimmed to the last 200 per key.
- **Purge.** `purge_hive` covers `sync_keys` and `sync_runs`.

## 4. Errors, status, budget, tests

**Errors.** Key refused or revoked: stop, notify once, stay quiet until `hive-sync setup`.
Network down or server error: stop; the next run retries; a notification after 3 failed runs in a
row. Folder missing: stop before comparing, notify once. Guard refused: nothing deleted, notify
with the count, `hive-sync --confirm-deletes` lets that list through on the next run. A note with
unreadable frontmatter is kept as text (as the import does); a failed upload is retried next run;
neither stops the run. Every database function checks the shape and size of its arguments and
never returns another workspace's paths; errors returned to the job carry a code and a short
message, never note text.

**Status.** Settings → Sync shows the key (made, last used), the last 20 runs (started,
duration, counts, error) and the latest run's too-big files. `hive-sync status` prints the same
plus the next scheduled run.

**Performance and data-fetching budget.**

- First paint of Settings → Sync: one bounded read (the key row and the last 20 runs). No other
  request on opening the tab.
- `sync_plan` reads one workspace's synced notes and files by `(workspace_id, path)` /
  `(workspace_id, vault_path)`, both indexed, in pages of 2,000. A run with no change is one
  sign-in plus about 7 plan pages for 14,000 files.
- Interactions: make or revoke a key is a write plus a refresh of that one row.

**Tests.**

- `tests/sync.test.mjs` (PGlite): keys made only by a person and only for an own workspace;
  revoked key refused; sync identity walled off from other workspaces, sharing, topics, links and
  non-synced notes; read-only synced notes (person, agent and app refused; sharing still the
  person's); plan lists including moves and ties; adoption of imported notes; the guard and the
  one-run confirm; audit entries; runs readable only by the member; purge.
- `sync/` unit tests on a temporary folder and a stand-in store: skip rules, videos,
  `.hivesyncignore`, the 50 MB listing, the cache, move detection, resume after interruption,
  missing folder, notes before files, home-note choice and "Vault files".
- `web/e2e`: Settings → Sync (make and revoke a key, the run list, too-big files); a synced note
  shows "Edit in your vault" and no edit control; a synced file shows "Home note set by your
  vault".
- By hand on the real DRA Vault: the first run; then add, edit, rename and delete one file each;
  trip the guard once and confirm.

## 5. Independent units (execution DAG for the plan)

1. **Database** — migration and `tests/sync.test.mjs`. Everything depends on it.
2. **`sync-session`** Edge Function — after 1.
3. **Settings → Sync and the read-only markers** in the web app — after 1; parallel with 2 and 4.
4. **`sync/`** — the walker, cache, plan client and launchd setup against a stand-in store; can
   start with 1 and wires to the real functions last.
5. **HTML deck viewer** — its own spec; parallel with all of the above.

Critical path: 1 → 4 (wiring) → the live run.

## Out of scope

Two-way sync; syncing from Windows or from the GitHub repo; video; files over 50 MB (raising the
bucket limit is its own decision); viewing HTML in the app (next spec); topics set by the sync;
several folders per key (one key, one folder, one workspace).

## Refinements (from the plan)

1. **The sync identity is an agent plus a claim.** `create_sync_key` makes an `agents` row (name
   `Hive sync`, provider `hive-sync`, tier `vendor`). Its `token_hash` is the hash of a random
   value that is never given out, so `agent_login` can never match it. The key's own hash lives
   in `sync_keys`.
2. **No storage dedupe by fingerprint.** `files.storage_path` is unique, so two vault paths with
   the same content are two objects. An object's place is
   `<member>/<workspace>/vault/<first 32 hex of sha256(vault_path + "\n" + content sha)>/<name>`.
   That place is fixed by path and content, so a retried upload lands on the same object.
3. **Old objects are removed later.** When a synced file changes or is deleted, its old object's
   path goes into `sync_orphans`. `purge-hives`, already running daily with the secret key,
   removes those objects (Task 5). The sync identity itself never deletes an object.
4. **Audit:**
   - Deletes are recorded by the existing delete-audit triggers. Their `agent_id` is the sync
     key's agent, and `sync_keys.agent_id` is unique, so the key can be found from it.
   - Moves write `note.moved` and `file.moved` entries, with `sync_key_id` in `detail`.
5. **Synced writes carry no session.** The sync's notes and files have `session_id` null. In the
   gallery's "By session" view, synced files form their own group, "From your vault", ahead of
   "No session".
6. **Generated notes.** A "Vault files" note (`<folder>/Vault files.md`) has
   `sync_generated = true`. It is never treated as gone. `sync_finish` deletes it once no file
   lives in it.
7. **Keys rotate without re-upload.** "Synced" means kept by any key, live or revoked, of the
   same member and workspace. A new key takes over the old key's notes and files.
8. **Too-big and unreadable paths are never deleted.** The job leaves them out of the manifest
   and also drops them from the gone list before calling `sync_delete`.
9. **A single delete never needs a confirm.** The guard trips at more than 25 items, or at more
   than 2% of synced items when that is more than one item. Without that, every single delete
   in a small workspace would wait for a confirm.
10. **The sync key's agent row stays out of the Agents tab** (filtered by provider `hive-sync`).
    While a key is live, deleting its workspace is refused ("still has an agent in use"); revoke
    the key first.
