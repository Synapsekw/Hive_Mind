---
type: spec
status: active
last-updated: 2026-11-22
tags: [project/hive-mind, spec, ui]
---

# The vault and sharing controls — design

Second slice of Phase 2 (master spec §10), after
[the web app, sign-in and the map](2026-11-22-web-map-design.md).

## Intent

The map shows that notes exist; nothing in the app lets a person read one or decide who else may.
Sharing is the product's central promise ("people decide what is shared, never agents"), and today
the only way to share a note is SQL. This slice gives the person the place to read their notes and
make that decision, for one note or for a whole folder.

## Goals, non-goals, anti-goals

- **Goals**
  - `/vault`: workspaces, a folder tree, a note list and a note preview with rendered markdown.
  - Sharing shown on every note and folder, and changed in place: private, the whole hive, or
    named members. Before a change is saved, one line says what it will do.
  - **Folder sharing that works for every note under the folder**, including notes an agent
    writes there later (Danijel's decision, 2026-11-22).
  - Notes colleagues have shared with the person, read-only.
  - Notes held from a self-hosted agent, with a release action.
  - Every sharing change recorded in the audit log.
  - "Open in vault" from a selected note on the map; "Vault" in the left rail.
- **Non-goals:** editing or deleting a note; creating notes or folders by hand; moving notes; file
  previews and the gallery; version history; the member's default visibility and other settings;
  an audit-log screen; full-text search (the list filters by title and path only); rendering
  Obsidian `[[wikilinks]]` as links.
- **Anti-goals**
  - Sharing logic in app code: the app never computes who can read what; it shows what the
    database says and writes the person's decision.
  - Any agent path that changes sharing — including by moving a note into a shared folder.
  - A sharing change with no trace.
  - Note text rendered as HTML the author controls (script injection through a note).
  - A page taller than the window (the map's first version had this).

## Constraints found in the project

- A folder's rule reaches a note only through `notes.folder_id`. The importer sets it; the MCP
  server does not, so agent-written notes ignore folder rules today.
- Folder rules do not nest: a note takes the rule of its own folder record only.
- `audit_log` exists and is readable by the hive owner, but nothing writes to it.
- `note_visibility(notes)` and `note_shared_with(notes)` already exist and can be selected through
  the API as computed columns, so the app can ask the database for a note's effective sharing.
- An agent may currently change a note's `path`. Harmless today; with path-based folder rules it
  would let an agent share a note by moving it.

## Approaches

**How a folder rule reaches the notes under it**

1. **Resolve by path in the database — picked.** A note's effective sharing is its own setting,
   else the rule of the nearest folder above it (by path, same workspace) that has one, else the
   member's default. No link to maintain; agent-written and imported notes behave the same; nested
   folders inherit. `folder_id` stops mattering for sharing.
2. **Keep `folder_id` and maintain it with triggers.** Every insert, path change and new folder
   has to re-link notes; nesting still needs a walk up the tree. More moving parts, same result.
3. **Copy the folder's setting onto each note when the person shares a folder.** Simple, but a
   note the agent writes tomorrow is not covered, which is the case Danijel asked for.

**Where the preview's markdown is rendered**

1. **`react-markdown` with GitHub-flavoured markdown, raw HTML off — picked.** Renders to React
   elements, so nothing in a note can inject markup or script.
2. **A markdown-to-HTML library plus a sanitiser.** Two things to keep correct.
3. **Plain text.** Safe, but tables and headings in real notes become unreadable.

**How the page reads and writes**

1. **Server-rendered page, selection in the URL, server actions for writes — picked.** One place
   holds the session; a link to a note is shareable (`/vault?note=…`); a write is followed by a
   targeted refresh.
2. **Client-side fetching with the browser Supabase client.** More state in the browser, and a
   second auth path to keep correct.

## Design

### 1. Database: migration `<minted>_folder_rules_by_path`

Minted with `scripts/new-migration.sh folder_rules_by_path`. Replaces functions with
`create or replace`; it does not edit a shipped migration.

- **`note_folder_rule(n public.notes)`** (new, security definer, stable): the folder row in the
  note's workspace with a non-null `visibility` whose `path` is a proper ancestor of the note's
  path (`n.path` starts with `folder.path || '/'`, compared without `like`), longest path first.
- **`note_visibility(n)`** becomes: `n.visibility`, else the rule folder's `visibility`, else the
  member's `default_visibility`. **`note_shared_with(n)`** becomes: the note's own list when it
  has its own setting, else the rule folder's list, else empty.
- A folder record with no rule (`visibility` null) is transparent: the search continues to the
  folder above it. Matching is case-sensitive; folder paths carry no trailing slash.
- **`note_rule_folder(n public.notes) returns text`** (new): the path of that rule folder, or
  null. Selectable through the API as a computed column, so the app can say "from Decisions"
  without working it out itself.
- **`folder_share_preview(p_workspace uuid, p_path text) returns jsonb`** (new, for people only,
  own workspaces only): exact counts for the sentence — `follows` (notes under the folder with no
  setting of their own and no nearer rule folder), `own_setting`, `under_nested_rule`, and `held`.
  Counted in the database over the whole workspace, not from the capped list.
- **Agents cannot move a note:** `notes_before_write` refuses an `agent_id` identity changing
  `path` on an existing note ("agents cannot move a note").
- **Audit:** `after insert or update` triggers write one `audit_log` row whenever a signed-in
  person sets or changes `visibility` or `shared_with` on a note (`note.sharing`), releases a held
  note (`note.released`), or sets or changes `visibility` / `shared_with` on a folder
  (`folder.sharing`); an insert that already carries a setting counts. Writes with no person
  behind them (no `auth.uid()`) are not audited. The row carries the hive, the acting member and
  `detail` with the before and after values; a note row carries the note id only, a folder row the
  folder's path. Never a note's path, title or body: the audit log is readable by the hive owner,
  who must not learn a private note's name from it. Folder paths are shown because a rule is
  meaningless without one; topics on the map already reveal the first two folder levels.
- **Unchanged and relied on:** agents cannot set sharing on notes or folders; self-hosted agents'
  notes are quarantined whatever the folder says; a quarantined note is never shared.

Consequences, accepted: `folder_id` is no longer read for sharing (left in place; removed in a
later clean-up). The existing test "a folder rule shares every note inside it" is rewritten to
place notes by path.

**Tests** in `tests/sharing-rules.test.mjs`: a folder rule shares a note under it that has no
`folder_id`; a note an agent writes into a shared folder is readable by the colleague at once; a
nested folder with its own rule wins over its parent; a nested folder with no rule inherits; a
note's own `private` beats a shared folder; a folder named `clients/ac` does not capture
`clients/acme/x.md`; a folder path containing `%` or `_` matches literally; another workspace's
folder of the same path has no effect; an agent cannot change a note's path; a self-hosted agent's
note in a shared folder stays held; each kind of sharing change writes exactly one audit row with
the before and after values; the owner reads the audit rows and another member does not; the map
function follows the new rule. One `pnpm test:live` check: sharing a folder as the person makes a
note the agent then writes there readable by the second member; cleaned up afterwards.

Applied to the hosted project through the Supabase MCP and re-stamped (gotcha 04). **Before
applying**, a pre-flight query compares every note's effective visibility under the old and the new
functions; the migration is applied only if no note changes. Checked on 2026-11-22: the hosted
project has no folder with a rule and no note with its own setting, so nothing changes.

### 2. The page

`/vault`, signed-in only, exactly one window tall; each column scrolls on its own.

```
┌ rail ┐┌──────────────────────── panel ─────────────────────────┐
│ Hive ││ Main · DRA · Shared with me            [ filter…      ] │
│      ││┌ folders ────┐┌ notes ───────────┐┌ preview ───────────┐│
│ Map  │││ All notes 25││ Title        ◐   ││ Title               ││
│ Vault│││ Decisions ◐ ││ Title            ││ path · changed · by ││
│      │││ MOCs        ││ Title        ●   ││ [ Private ▾ ]       ││
│      │││ Held (2)    ││ …                ││                     ││
│      ││└─────────────┘└──────────────────┘│ rendered markdown   ││
│agents││                                   └─────────────────────┘│
└──────┘└────────────────────────────────────────────────────────┘
```

- **Tabs:** one per workspace of the person, then "Shared with me".
- **Folders:** derived from note paths (and folder records), with counts; "All notes" on top;
  "Held" appears only when the workspace has held notes. A folder with a rule shows its mark.
- **Notes:** title, last change, an agent mark when an agent wrote it, and the sharing mark.
- **Sharing marks** (shape and text, never colour alone): none = private; half-filled = named
  members; filled = whole hive. A mark that comes from a folder rule reads "from Decisions".
- **Preview:** title, path, last change, written by you or by your agent, the sharing control,
  then the note. Frontmatter is not shown.
- **Sharing control** (note or folder): a pill showing the current state; opening it offers
  _Private_, _Everyone in <hive>_, _Specific people_ (a checklist of the other members), and for
  a note inside a folder with a rule, _Same as folder_; for a folder, _No rule_ (it follows the
  folder above, or your default setting). Choosing shows the sentence and "Save" / "Cancel"; nothing is
  written before "Save". "Save" is disabled for _Specific people_ with nobody ticked.
- **The sentence** is built from counts the database supplies (`folder_share_preview` for a
  folder), in these forms:
  - "Only you will be able to read this note, and anyone whose link to it you accepted."
  - "Everyone in Synapse (2 people) will be able to read this note."
  - "Ahmed and Sara will be able to read this note."
  - Folder: "Everyone in Synapse (2 people) will be able to read the 17 notes in Decisions, and
    any note added there later, including by your agent. 2 notes with their own setting are not
    affected." (and "3 notes in folders with their own rule are not affected." when there are any)
  - Folder to private: "The 17 notes in Decisions will be readable only by you, and so will any
    note added there later. A note linked with a colleague's note stays readable to that colleague.
    2 notes with their own setting are not affected."
- **Held notes:** listed under "Held" with "Release"; the sentence is "This note was written by a
  self-hosted agent. Releasing it makes it follow its sharing setting: <state>."
- **Shared with me:** colleagues' notes the person can read, grouped by owner, newest first,
  capped at 500; preview only. A note readable only through an accepted link is marked "Opened by
  a link". `/vault?note=<id>` for a colleague's note opens this tab.
- **Left rail on the vault:** the mark, "Map", "Vault" and "Sign out"; the agents list stays on
  the map.
- **Empty states:** no notes → "Nothing here yet. Notes your agent writes appear in this
  workspace."; nothing shared → "Nobody has shared a note with you yet."
- **From the map:** the detail rail of a readable note gains "Open in vault" (`/vault?note=<id>`).
  The left rail gains "Vault".
- `/dev/vault`: the same screen over a fixture, 404 in production, as `/dev/map`.

### 3. Reads, writes and budget (AGENTS.md #5)

- **First paint:** the session check (proxy), then in parallel: the person's hive and members; own
  workspaces; own folders; the note index of the open tab. The index is metadata only — `id`,
  `workspace_id`, `path`, `title`, `updated_at`, `written_by_agent`, `visibility`,
  `shared_with`, `quarantined`, and the database's effective `note_visibility`,
  `note_shared_with` and `note_rule_folder` — for one workspace, ordered by path, capped at 2,000 rows with a
  "showing the first 2,000" line. Never `body`. If `?note=` is present, one more read of that
  note's body by id.
- **Interactions with no round-trip:** opening and closing folders, the filter, opening the
  sharing control on a note and composing its sentence.
- **Interactions with one read:** opening the sharing control on a folder (one
  `folder_share_preview` call, exact counts); choosing a note (navigation to `?note=<id>`: the body by id,
  capped display at 200,000 characters) and switching tab (that workspace's index).
- **Writes:** saving a sharing change or releasing a note is one server action — an update of the
  note, or an upsert of the folder record — then a refresh of the current tab's index. The action
  sends only the person's decision; whether it is allowed is the database's answer, and a refusal
  is shown as "That change was refused." with no partial state.
- **Indexes:** `notes (workspace_id, path)` exists (unique); `folders (workspace_id, path)` exists.

### 4. Tests

- Database rules: §1.
- Web unit tests: building the folder tree from paths (root notes, nested folders, a folder record
  with no notes); the sentence builder for every form above, including singular and plural and a
  hive of one; the sharing-mark logic uses only the database's effective values.
- Browser test on `/dev/vault`: the page does not scroll at four window sizes; choosing a folder
  filters the list with no request; a note whose text contains `<script>` and an `<img onerror>`
  renders them as text; the sharing control shows the sentence and writes nothing until "Save".
- Manual, by Danijel: share the `Decisions` folder with the whole hive and see the sentence, the
  marks and the map's hollow/solid dots agree; make one note in it private again.

### 5. Independent units (for the plan's execution DAG)

- **A — database:** migration, rule tests, live check, apply to hosted. Depends on nothing.
- **B — vault logic:** tree builder, sentence builder, fixture, unit tests. Depends on nothing.
- **C — vault UI:** components and `/dev/vault`, browser test. Needs B.
- **D — real data:** queries, server actions, `/vault`, rail and map links, docs. Needs A and C.

A and B run at the same time; the critical path is B → C → D.

## Left to the builder

- Component and file layout under `web/src/vault/`, CSS within the tokens of `ui-concept.md` §2.
  Load `frontend-design` and read `ui-concept.md` first (AGENTS.md #3). Reuse the shell and panel
  from the map.
- The fixture's contents.
- How the shell is shared between the map and the vault.

## Known gaps

- A note an agent writes into a shared folder is visible to colleagues at once, unreviewed.
  Accepted; the sentence says so every time a folder is shared.
- Sharing changes are recorded but there is no screen to read the record yet.
- The preview shows wikilinks as text.
- A person cannot yet delete a note from the app.
