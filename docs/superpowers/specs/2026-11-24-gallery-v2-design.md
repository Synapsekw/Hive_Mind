---
type: spec
status: draft
last-updated: 2026-11-24
tags: [project/hive-mind, spec, ui, db, mcp]
---

# Gallery v2: sessions, links, folders, upload — design

Follows [the file gallery](2026-11-22-file-gallery-design.md) (v1, shipped). v1 lists, views,
downloads and deletes files. v2 makes the gallery the place where every binary produced in the
hive is stored, found, viewed and tied to the notes and the agent session that produced it.

## Intent

Agents produce decks, PDFs, spreadsheets and images during working sessions. Today a file hangs
on at most one note, nothing records which session produced it, there is no way to group files,
and only a local agent can put a file in the hive at all. v2 adds:

1. **Sessions** — an agent's working run is recorded automatically, and closes into a readable
   session note.
2. **Links** — each file has one home note (decides who can read it) and any number of notes that
   reference it.
3. **Personal folders** — a person groups files any way they like, without changing sharing.
4. **Browser upload** — a person carries in files that remote agents (ChatGPT, Claude web)
   produced, or anything else.
5. **Filters and views** — by type, date, session, agent, owner and folder; a session stream and
   a flat grid.
6. **Browser-side previews** — PDF pages and thumbnails, text and Markdown, CSV.

## Decisions taken with Danijel (2026-11-24)

- **Session = both an automatic run record and a shareable session note.** The run is captured
  without the agent having to remember; the note is what people read and share.
- **Capture is implicit, tied to the connection.** The first write of a connection opens a
  session; `hive_end_session` closes it; an idle sweep closes forgotten ones.
- **One home note, many references.** The home note alone decides who can read a file. A
  reference never grants access.
- **Session notes inherit the owner's normal rule** (folder rule, else member default), like any
  note. If the member's default is "hive", a session's files become hive-readable when it ends.
- **Ways in: local agents (as today) plus browser upload.** Remote-agent binary upload is out:
  a remote agent's file lives in the vendor's sandbox, which our server cannot read, and sending
  bytes as model-typed base64 is only practical for tiny files.
- **Folders are personal, a file may be in many, folders never affect sharing.** Shared hive
  folders are a later slice.
- **Previews: browser-only now** (pdf.js, text, CSV). Office previews need a server converter that
  parses untrusted files and get their own slice.
- **Screen:** "By session" stream as default view, "Grid" as the flat alternative, filter chips,
  folder column on the left, file panel on the right; full-window viewer. Visual details are to
  be refined during the build.

## Goals, non-goals, anti-goals

- **Goals:** everything in "Intent".
- **Non-goals:** Office previews (PPTX, DOCX, XLSX); PDF text search; shared folders; remote-agent
  binary upload; splitting, merging or deleting sessions; editing a session's summary from the
  app beyond its title; version history of files; self-hosted agents saving files.
- **Anti-goals**
  - Any permission decision in app or MCP code. Row-level security decides.
  - A gallery folder that changes who can read a file.
  - An agent changing a file's home note, removing a reference, or touching folders.
  - A public or long-lived link to a file. The bucket stays private; links are signed for 10
    minutes.
  - A file's content run as a page of ours. Text, Markdown and CSV are shown as text; HTML and
    SVG are never rendered.

## Constraints found in the project

- `public.files` (`id, hive_id, member_id, workspace_id, note_id, storage_path, name, mime,
size_bytes, created_at`); `files_select` shows a row to its owner and to readers of its note;
  there is no update policy; only `files_note_idx` exists.
- Storage policies (`20261122063919_file_storage.sql`): an agent or person writes under their own
  `<member>/<workspace>/`; a person (never an agent) deletes; nobody overwrites; self-hosted agents
  cannot write.
- Vault `public.folders` carry sharing rules by path. Gallery folders must be a separate table so
  they can never take part in sharing.
- The MCP server runs once per Claude Code conversation (stdio) and per MCP session on the remote
  connector; it signs in as the member behind the agent token.
- The colour-literal rule applies to all UI.

## Design

### 1. Data model (new migrations, each with tests in `tests/`)

**`public.sessions`**

| column                       | notes                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| `id uuid pk`                 |                                                                       |
| `hive_id, member_id`         | from the workspace                                                    |
| `workspace_id`               |                                                                       |
| `agent_id uuid null`         | null = a person's upload batch                                        |
| `client_key text not null`   | `<agent_id>:<x-hive-session>` for agents, `upload:<uuid>` for uploads |
| `agent_name text not null`   | copied from the agent at open (`Browser upload` for uploads)          |
| `title text null`            | set on end; a person may retitle their own                            |
| `summary text null`          | set on end                                                            |
| `note_id uuid null`          | the session note; `on delete set null`                                |
| `started_at, last_active_at` |                                                                       |
| `ended_at timestamptz null`  | null = open                                                           |

Unique `(member_id, client_key)` among open sessions; index `(hive_id, started_at desc)`; partial index on
`last_active_at where ended_at is null` for the sweep.

- **Read:** the owner, or anyone who can read `note_id`. An open session (no note yet) is
  owner-only.
- **Write:** only through `security definer` functions and triggers — the tagging trigger and
  `session_end(title, summary)` for agents; `upload_session_open(workspace)`,
  `upload_session_end(session, note)` and `session_retitle(id, title)` for persons;
  `close_idle_sessions()` for the scheduled sweep. No direct insert/update/delete policy.

**`files` and `notes` gain `session_id uuid null references sessions on delete set null`.**
An insert trigger fills it from the caller's open session for the client key in the request
header `x-hive-session` (read via `request.headers`); the client cannot set it to a session that is
not its own (the trigger overwrites any supplied value). A person's writes in the app carry no
header and get no session, except upload batches (§4).

**`files` gains `kind text not null`** computed once by a before-insert trigger from extension
and declared type together, with the v1 rules plus two new kinds for the new previews: `image`,
`pdf`, `slides` (pptx), `sheet` (xlsx), `doc` (docx), `text` (md, txt — split out of v1's `doc`),
`csv` (split out of v1's `sheet`), `other`. A mismatch gives `other`; SVG is `other`. The web
helper that computes `kind` in v1 is replaced by the stored column. Backfill for existing rows. New index
`files (hive_id, created_at desc, id)`, plus `files (session_id)` and `files (hive_id, kind)`.

**Home note = `files.note_id`, unchanged rule.**

- `session_end` sets the session note as home on that session's files whose `note_id` is null.
- **Changing a file's home** is a person's action only: new function `file_set_home(file_id,
note_id)`; refuses unless the caller owns the file and the note and has no `agent_id` claim;
  writes an `audit_log` row (file id, before and after note id only).

**`public.file_references (file_id, note_id, created_by_agent null, created_at)`**, pk
`(file_id, note_id)`.

- **Read:** only when the caller can read both the file and the note.
- **Insert:** the caller owns the note and can read the file (agents may, from their own notes).
- **Delete:** the note's owner, person only.
- Grants no access: `files_select` is unchanged and does not look at references.

**`public.gallery_folders (id, member_id, parent_id null, name, created_at)`** and
**`public.gallery_folder_files (folder_id, file_id, added_at)`**, pk `(folder_id, file_id)`.

- Owner-only for every operation; any identity with an `agent_id` claim is refused.
- Depth at most 2 (a folder or a sub-folder); `unique (member_id, parent_id, name)`.
- Adding a file requires the caller to be able to read it. If access is later lost, the row stays
  and the file is simply not returned (the join runs under the caller's RLS).
- Deleting a folder deletes its sub-folders and memberships, never files.

**Deleting a file** writes an `audit_log` row (closes a v1 gap). Deleting a session note leaves
its files with `note_id` null — owner-only.

### 2. Agent side (MCP) and the session lifecycle

- The stdio MCP server makes one random key per process and sends it as `x-hive-session` on
  every database request. **The remote connector is stateless** (a fresh server per HTTP
  request, no MCP session id), so it sends no header and its agent gets the key `default`: one
  rolling session per remote agent, broken by `hive_end_session` or 2 h idle. (Corrected while
  planning: the first wording said the remote connector would use the MCP session id.)
- The tagging trigger on `notes` (insert and update) and `files` (insert) opens the session or
  bumps `last_active_at` on any **write**; an open session idle ≥ 2 h is closed first and a new
  one opened. Reads never open one. No MCP call is needed for this.
- **New tool `hive_end_session(title, summary)`** → `session_end`:
  1. writes the session note at `Sessions/<YYYY-MM-DD> <title>.md` (inherits the owner's rule),
     body = summary + generated list of the session's notes and files;
  2. sets `note_id, title, summary, ended_at`;
  3. sets the session note as home on the session's homeless files.
     A later write with the same key opens a new session. The tool description asks agents to call
     it when a piece of work is finished.
- **Idle sweep:** `pg_cron` every 15 minutes closes sessions idle ≥ 2 h with the same steps; title
  is always the neutral `Session · <agent> · <date>` (never a storage folder: `<customer>` would
  land in a note whose sharing is inherited); summary "Closed automatically."
- **`hive_save_file`** gains `references: string[]` (note paths in the agent's workspace) and
  returns the session id and title.
- **`hive_read` / `hive_search`** list a note's files (id, name, kind, size, session title)
  wrapped as data; never a link or `storage_path`.
- Self-hosted agents still cannot save files; their notes are tagged with sessions.

### 3. The screen (`/gallery`)

Shared rail and card. Reference mockups from the brainstorm (`.superpowers/brainstorm/`,
untracked): `screen-v2.html`, `viewer.html`.

- **Left column:** All files · Mine · Shared with me; **My folders** (two levels) with counts;
  **+ New folder**; rename and delete from a folder's menu. Dragging a card onto a folder adds it.
- **Top bar:** view switch **By session** (default) / **Grid**; name filter; **Upload**. Dropping
  files anywhere on the card opens the upload dialog.
- **Filter chips:** Type (multi), Date (today / this week / this month / range), Session, Agent,
  Owner. Chips combine (AND across chips, OR within one). Filters and view live in the URL.
- **By session:** groups in order of the session's start, newest first; header = title, agent,
  time span, count of matching files, link to the session note. Files with no session group under
  "No session".
- **Grid:** flat, newest first (v1 layout).
- **Card:** thumbnail (image, PDF first page) or type tile; name; `size · sharing word`.
- **File panel (right):** preview; Open, Download, Add to folder, Delete (own files); **Who can
  read it** as a sentence, with "Change home note" on own files; Referenced in; Session; In my
  folders.
- **Viewer:** full-window dialog; top bar (name, kind, size, session, "n of m in view", Add to
  folder, Download, close); right strip as the panel; ← → move through the current view; Esc
  closes and returns focus to the card.
  - **PDF:** pdf.js pages, page strip, zoom. Content must begin with `%PDF-` and be ≤ 25 MB, else
    the Download tile.
  - **Image:** fitted, zoom.
  - **Text / Markdown:** monospace plain text, first 512 KB.
  - **CSV:** table, first 500 rows.
  - **Other:** type tile, "No preview yet", Download.
- **Upload dialog:** home note (default: the person's private `Uploads` note, created on demand),
  optional folder, per-file progress and retry.
- **Empty states:** no files ("No files yet. Files your agents save, and files you upload, appear
  here."); no match ("No files match these filters.").

### 4. Server actions (`web/src/app/gallery/actions.ts`)

Same rules as v1: signed in as the person, arguments checked first, only `{ ok }` or values back,
only error code and message logged.

- `loadPage(filter, cursor)` — bounded at 200 over indexed columns.
- `openFile(id)`, `downloadFile(id)` — as v1, extended to `text` and `csv` kinds for `openFile`.
- `deleteFile(id)` — as v1, plus the audit row (written by the database trigger).
- `setHome(fileId, noteId)` → `file_set_home`.
- `createFolder(name, parentId?)`, `renameFolder`, `deleteFolder`, `addToFolder(folderId,
fileIds[])`, `removeFromFolder`.
- `startUpload(files[{name, size, mime}], noteId?, folderId?)` → opens an upload session,
  returns one signed upload URL per file under `<member>/<workspace>/uploads/<batch>/<name>`;
  `finishUpload(batchId, name)` inserts the `files` row (session, home note, folder membership).
  If the row insert fails, the action removes the object. Cap 50 MB per file.

## Performance and data-fetching budget

- **First paint:** 3 waves as v1; files capped at 200 via `files (hive_id, created_at desc, id)`;
  plus the sessions of those files (by id), readable notes (by id), my folders and their
  memberships (owner-only, small), one batched thumbnail signing call.
- **Tabs, chips, folder selection, view switch, panel:** 0 requests while the result is within
  the loaded set. When a filter needs rows beyond it (older date, a session not loaded), 1
  `loadPage` call filtered on `kind`, `session_id`, `created_at` — all indexed — bounded at 200.
- **Writes (server data changes):** folder create/rename/delete, add/remove membership, set home,
  upload, delete. Each is 1 action and updates the loaded list in place; nothing else is re-read.
- **PDF thumbnails:** rendered in the browser only for cards in view, at most 4 at once, cached
  per file id for the page's life.
- **Viewer open:** 1 action for a fresh signed link, then the browser fetches from storage.

## Error handling

- Upload: bytes first, row second; a failed row removes the bytes; per-file retry.
- Idle sweep failure: the session stays open and is retried on the next run.
- `hive_end_session` with no open session: a clear tool error.
- Home note deleted: the file becomes owner-only and the panel says so.
- Declared type and content disagree: `other`, download only.
- A folder membership for a file the person can no longer read: not shown; counts exclude it.

## Testing

- **SQL (`tests/`):** session tagging by header and refusal of a foreign `session_id`; an open
  session is owner-only; a session is readable through its note; `session_end` homes only its own
  homeless files; the sweep; `file_set_home` refuses agents and non-owners and is audited;
  references grant no read and are hidden unless both sides are readable; folders owner-only and
  agent-refused; depth cap; upload path must be one's own; delete writes an audit row; `kind`
  backfill and mismatch cases.
- **MCP:** header sent on every request; session opened on first write only; `hive_end_session`;
  `references`; reads list files as data.
- **Web unit:** filter selection and URL round-trip, grouping, loader against a stub, each action
  against a stub (bad ids, not mine, upload row failure removes the object).
- **Browser (`/dev/gallery` fixture):** chips and folders make no request; by-session and grid
  views; drag to folder; viewer for PDF, image, text, CSV and other; ← → and Esc; upload dialog
  with stubbed actions; Delete absent on colleagues' files; fits 1366 × 768 and 1100 × 560; both
  Honey and Paper; keyboard reaches every control.
- The four gates stay green.

## Independent units and execution DAG (to be detailed in the plan)

1. **DB: sessions + tagging + `kind` + indexes** — no dependency.
2. **DB: references, home-note change, file audit** — no dependency (separate migration).
3. **DB: gallery folders** — no dependency.
4. **DB: upload path policy + upload session** — depends on 1.
5. **MCP: client key header, `hive_end_session`, `references`, file listing** — depends on 1, 2.
6. **Web contract:** types, fixture, pure helpers (filters, grouping, kind labels) — no
   dependency.
7. **Web data:** loader and actions — depends on 1–4 and 6.
8. **Web screen:** layout, chips, folders column, panel, viewer, upload dialog on the fixture —
   depends on 6.
9. **Previews:** pdf.js, text, CSV renderers — depends on 6.
10. **Wiring + live check** — depends on 5, 7, 8, 9.

Batches: **{1, 2, 3, 6}** → **{4, 5, 8, 9}** → **{7}** → **{10}**. Critical path: 1 → 4 → 7 → 10.
Units 1–3 are separate migrations minted in sequence by `scripts/new-migration.sh`, so the
migration-minting step is serialised even when the SQL is written in parallel.

## Corrections found during the build

- The session note body is the summary plus counts only, for example "2 notes, 3 files. Open the
  session in the gallery to see them." It lists no titles, paths or file names, because a note
  that inherits "hive" sharing would otherwise leak them (corrected during the build).
- The remote connector is stateless, so a remote agent gets one rolling session per agent, broken
  by `hive_end_session` or two hours idle (corrected during the build).
- `hive_read` marks its file lists unavailable (`files_unavailable`, `referenced_files_unavailable`)
  when their query fails, and the read itself still succeeds (corrected during the build).
- An upload goes into the workspace of the chosen home note, because `upload_session_end` needs
  the note to be in the session's workspace. Duplicate names in one batch get `-2`, `-3`
  (corrected during the build).
- Uploads must be PUT with the type declared from the file name, not the browser's type, which
  can differ (corrected during the build).
- Cross-hive guards: a reference, a folder membership and an upload session each refuse a note,
  file or workspace of another hive, even for a person who is a member of both (corrected during
  the build).
- A closing hive refuses new references, folder memberships and upload sessions, and the idle
  sweep skips its sessions, so one such session cannot stop the sweep for everyone (corrected
  during the build).

## Known gaps (accepted)

- Remote agents cannot save binaries; a person uploads them.
- One long agent conversation that never calls `hive_end_session` becomes one session per 2 h
  idle gap, which may mix topics.
- No Office previews; no search inside files.
- Folders are personal only.
- An upload whose row insert and object removal both fail leaves an orphan object.

## Review focus

1. No path through references, folders or sessions makes a file readable that its home note does
   not make readable.
2. An agent cannot change a home note, remove a reference, touch folders, or tag a write with
   another member's session.
3. Text, Markdown, CSV and mislabelled files are never rendered as a page.
4. Filter and folder interactions within the loaded set make no request.
