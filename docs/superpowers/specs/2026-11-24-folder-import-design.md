# Import a folder of notes from the app

Date: 2026-11-24. Status: approved by Danijel in the session.

## Problem

A folder of markdown notes can only be imported with `scripts/import-vault.mjs`, from a
terminal, with the person's password typed there. Colleagues need to do it in the app.

## Decisions (Danijel, 2026-11-24)

- Import only: notes are created and updated; links between them are found later by link
  discovery. Wiki links stay in the text.
- Destination: a new workspace named after the folder, or one of the person's existing
  workspaces in the current hive.
- Markdown notes only. Images, PDFs and other files are listed as skipped.

## Design

### What the person does

1. **Vault → Import a folder.** The browser's folder picker; the files are read in the browser.
2. **Summary before anything is saved:** notes found, other files skipped, notes skipped for
   being over 1 MB, frontmatter that could not be read (kept as text).
3. **Destination:** "New workspace" with a name field prefilled with the folder's name, or one
   of their workspaces.
4. **Import**, with progress ("120 of 480 notes"). It can be stopped; what was saved stays.
5. **Result:** created, updated, unchanged, skipped, failed, with the paths of anything skipped
   or failed.

### Rules (the script's, unchanged)

- One note per `.md` file, at the file's path inside the picked folder.
- Frontmatter is read as fields; a title in it is the note's title, else the file's name. An
  unreadable frontmatter is kept as text with a warning.
- Every note arrives private. The import never sets sharing and never deletes a note.
- Importing again into the same workspace updates the notes whose title, text, fields or
  folder changed, creates the new ones and leaves the rest.
- Paths with a part that begins with a dot (`.obsidian`, `.git`, `.trash`) are left out.

### Limits

- At most 2,000 notes per import, checked in the browser before anything is sent; over that
  the screen says so and asks for a subfolder. Each batch the server accepts holds at most 25
  notes and 3 MB, so the limit cannot be passed in one request.
- 1 MB per note, as in the script.
- At most 20 workspaces per member, enforced in the database (migration
  `20261124110155_workspace_cap`), with a name of 1 to 60 characters after trimming.
- A hive that is being deleted refuses every write already.

### How it works

- The browser parses each file with a TypeScript port of the script's `parseNote`. A parity
  test runs both on the same cases, so the app and the script cannot drift apart unseen.
- Server action `importBatch(workspaceId, notes)`, signed in as the person: checks shapes and
  sizes, reads the existing notes at those paths in that workspace, makes any missing folder
  rows, creates the new notes in one insert (falling back to one by one when the database
  refuses the batch, so one bad note does not sink the others) and updates the changed ones.
  It answers one outcome per path: `created`, `updated`, `unchanged` or `failed`. A database
  message is never returned.
- Server action `createImportWorkspace(hiveId, name)`: inserts the workspace as the person in
  the hive the page was showing (bound on the server, as invitations are). A name the person
  already uses answers `taken`.
- No permission logic in the app: the person can only write notes in their own workspaces
  because row-level security says so.
- A closed tab leaves what was saved; importing again finishes the rest.

## Performance and data budget

- The vault's first paint: unchanged. The import screen is client state until Import is pressed.
- Import: one request per batch (at most 25 notes or 3 MB), sent one after another. Each
  request makes one read of existing notes by `(workspace_id, path)`, at most one folder
  insert, one note insert and one update per changed note.
- Afterwards the vault is refreshed once.
- Server actions' body limit is raised to 4 MB.

## Independent units

1. Server side: the parser port and parity test, the two actions with their tests, the
   migration with its tests.
2. The import screen in the vault with its browser tests (against in-memory actions).
3. Docs.

## Not in this slice

- Images, PDFs and other files.
- Choosing subfolders to include or leave out (pick the subfolder instead).
- Removing notes whose file is gone.
- Import by an agent, or through the connector.
