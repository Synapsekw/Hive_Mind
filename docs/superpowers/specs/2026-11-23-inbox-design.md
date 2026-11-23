---
type: spec
status: active
last-updated: 2026-11-23
tags: [project/hive-mind, spec, ui]
---

# The inbox — design

Fourth and last slice of Phase 2 (master spec §10), after [the vault](2026-11-22-vault-design.md),
the [Keystone glass look](2026-11-22-keystone-glass-design.md) and
[the file gallery](2026-11-22-file-gallery-design.md).

## Intent

Two things in the hive wait for a person's decision and have no place in the app yet:

- **A proposed link.** An agent proposes a link between a note of its member and a note of a
  colleague (`hive_propose_link`). It counts only after a person on each side accepts. Today
  nobody can accept: the database function exists (`respond_to_link`) but no screen calls it.
- **A held note.** A note written by a self-hosted agent is held (`quarantined`) until its owner
  releases it. The vault can release it, but nothing tells the owner that something is waiting.

The inbox is the one list of what needs the person, with the decision next to each item, and a
count on the rail so the person knows without opening it.

## Decisions taken with Danijel (2026-11-23)

- **Build the small, real inbox now**, not in Phase 4.
- **Needs-you only.** Link proposals waiting for the person's own answer, and the person's held
  notes. No "waiting on the other person" section and no history.
- **A count on the rail entry.**
- **What an item reveals about a colleague's note is what the map already reveals:** the
  colleague's name and the note's topic. The title only when the note is already readable by the
  person. Never the body, the path or the note's id.

## Goals, non-goals, anti-goals

- **Goals**
  - `/inbox`, and "Inbox" as the fourth entry in the left rail, with a count when it is above 0.
  - **Links to decide:** each proposed link where one note is the person's and the person's side
    is not accepted. Shows which of their notes, whose note on the other side and its topic, why
    it was proposed (the tier in words), and what accepting does. Actions: **Accept**, **Decline**.
  - **Held notes:** each of the person's notes that is held. Shows title, path, the agent that
    wrote it and when. Actions: **Release**, **Open in vault**.
  - The same count on the rail of the map, the vault and the gallery.
- **Non-goals:** proposals the person already accepted; decided links; overlap suggestions,
  contradiction flags, token and write-rejected items (nothing produces them before Phases 3
  and 4); the `notifications` table (nothing writes to it; it stays unused); marking as read;
  live updates; proposing a link from the browser; undoing a decline; an audit entry for
  accepting a link (existing known gap, see below).
- **Anti-goals**
  - Deciding in app code who may see a link or a note. The database decides.
  - Showing a colleague's private note's title, path, body or id.
  - Invented items standing in for missing data.
  - Any way for an agent to read the inbox or answer a link.

## Constraints found in the project

- `respond_to_link(p_link, p_accept)` is for people only. Accepting sets the caller's side; both
  sides accepted makes the link `accepted`. Declining by either side is final.
- **An accepted link opens the two notes to each other** (`can_read_note`, last clause). Accepting
  is therefore a sharing decision, and the screen must say so in plain words.
- Two notes of the same owner are linked without a handshake, so a proposed link always has two
  different owners.
- A link row is visible to a person when one of its notes is theirs (`links_select`), but the
  other note's row is not readable unless shared, so its owner and topic cannot be read with a
  plain query. The map solves the same problem inside `map_graph` (security definer).
- Someone else's held note is left out everywhere (`map_graph`); a held note is never readable
  by others, linked or not.
- `links` has an index on `to_note` and the unique `(from_note, to_note)`; `notes` has one on
  `member_id`. There is no index that finds proposed links or held notes directly.
- The rail (`Shell`) is rendered by the client components `Map`, `Vault` and `Gallery`; the
  pages load their data on the server.
- The vault opens a note from `?ws=<workspace id>&note=<note id>`.

## Design

### 1. Database (one migration, `inbox`)

Two partial indexes, so both reads stay small however large the hive grows:

- `links_proposed_idx on links (hive_id) where status = 'proposed'`
- `notes_held_idx on notes (member_id) where quarantined`

`public.inbox(p_hive uuid) returns jsonb` — stable, security definer, `search_path = ''`, granted
to `authenticated` only, like `map_graph`. It refuses an agent or self-hosted identity
(`inbox is for people`) and a caller who is not a member of the hive. It returns:

```json
{
  "links": [
    {
      "id": "…",
      "tier": 3,
      "created_at": "…",
      "proposed_by": "theirs",
      "they_accepted": false,
      "mine": { "id": "…", "title": "…", "path": "…", "workspace_id": "…" },
      "theirs": {
        "member_name": "Ahmed",
        "topic": "Clients/Acme",
        "title": null
      }
    }
  ],
  "links_total": 1,
  "held": [
    {
      "id": "…",
      "title": "…",
      "path": "…",
      "workspace_id": "…",
      "agent_name": "Local agent",
      "updated_at": "…"
    }
  ],
  "held_total": 1
}
```

- **A link is listed** when it is in this hive, `proposed`, exactly one of its notes is the
  caller's, the caller's side has no accepted timestamp, and neither note is held.
- `proposed_by` is `mine` when the caller's note is the `from` side (their own agent proposed
  it), else `theirs`. `they_accepted` says whether the other side has accepted.
- `theirs.title` is the other note's title when `can_read_note` says the caller may read it,
  else null. `theirs.topic` is `note_topic(path)`, as on the map.
- **A note is listed as held** when it is the caller's, in this hive, and `quarantined`.
- Each list is the newest 100 (`created_at` for links, `updated_at` for notes); the totals count
  everything.

`public.inbox_count(p_hive uuid) returns integer` — same refusals, same two conditions, returns
`links_total + held_total` without building the lists.

No change to `respond_to_link`, to any policy, or to who can read what.

### 2. Loading

- `loadInbox(db)` finds the person's hive the way the other pages do, calls `inbox`, and maps
  the answer to the screen's types. States: `ok`, `no-hive`, `error`.
- `loadInboxCount(db)` finds the hive and calls `inbox_count`. Any failure answers 0: a missing
  count never breaks a page.
- The map, vault and gallery pages call `loadInboxCount` in parallel with their own load and
  pass the number down to `Shell`. The inbox page uses `links_total + held_total` from its own
  load.

### 3. The screen

The rail, then one glass card that fits the window; the card's content scrolls, the page does
not. Heading "Inbox" with the count. Two sections, each with a mono label and its own count,
shown only when it has items:

- **Links to decide.** One row per link:
  - What: "Link your note **{my title}** with a note of {name}" plus the topic, and the title
    when it is readable ("a private note in Clients/Acme" otherwise).
  - Who: "Proposed by your agent" or "Proposed from {name}'s side".
  - Why: the tier in words — 1 "Same client or project", 2 "One note refers to the other",
    3 "Shared topic", 4 "Similar text".
  - Effect, always visible: "Accepting lets {name} read this note and lets you read theirs."
    then "It takes effect when {name} accepts too." or "{name} has accepted, so it takes effect
    at once."
  - Actions: **Accept** (primary) and **Decline**. Decline asks once in place ("Decline for
    good?" with **Decline** and **Keep**), because it cannot be undone.
  - The person's own note title links to the note in the vault.
- **Held notes.** One row per note: title, path, "Written by {agent}" and the date; **Release**
  (primary) and **Open in vault**. One line under the section label says what release does:
  "A held note is visible only to you until you release it."
- **Empty:** "Nothing needs you." and one line saying what will appear here.
- **More than 100 of a kind:** a line "Showing the newest 100 of {total}."

While an action runs its row's buttons are disabled. On success the row leaves the list and the
page is refreshed from the server (so the rail count follows). On failure the row stays and
shows "That didn't work. Try again." Keyboard: every action is a button; focus moves to the next
row's first action when a row leaves, or to the heading when the list empties.

Look: Keystone glass tokens only, as in the gallery and the vault; no new colours.

### 4. Server actions

- `respondToLink(id, accept)` — checks `id` is a uuid and `accept` a boolean, checks there is a
  session, calls `respond_to_link`. Answers `{ ok }`.
- `releaseNote(id)` — the vault's existing `releaseIn`.

Both run as the person behind the session cookie; the database decides. Only an error's code
and message are logged.

### 5. Development page and tests

- `/dev/inbox` shows the screen on sample data without an account: default, `?empty=1`,
  `?fail=1` (every action fails), `?many=1` (totals above 100).
- **Database tests** (`tests/sharing-rules.test.mjs`): who sees which link and when it leaves
  each side's list; the title appears only when readable; a third member and an outsider see
  nothing; agents are refused by both functions; held notes appear for their owner only; a link
  to a held note is not listed; the count equals the two totals; the answer never contains a
  body.
- **Unit tests** (Vitest): the sentences, the mapping from the function's answer, the argument
  checks and what each action sends, the count loader's failure paths.
- **Browser tests** (Playwright, on `/dev/inbox`): accept removes the row; decline needs the
  second step; release removes the row; a failed action keeps the row and says so; the empty
  state; the rail shows the count and marks Inbox as the current page.
- **Live check** (`tests/two-members.integration.test.mjs`, runs only with two tokens): a
  proposed link appears in the other member's `inbox`.

## Performance and data-fetching budget

- **First paint of `/inbox`:** the hive lookup, then one `inbox` call. Both lists are capped at
  100 rows and read through the two partial indexes; no body is fetched.
- **Each decision:** one write (`respond_to_link` or the note update), then one refresh of the
  page (the same two reads). Opening the decline question is client state: 0 round trips.
- **Every other page:** one extra `inbox_count` call, started in parallel with the page's own
  load, so it adds no step to the chain. It reads the same two partial indexes and returns one
  integer.
- No tabs, filters or sorts on this screen.

## Independent units (for the plan)

1. The migration and its database tests (`supabase/`, `tests/`).
2. The contract: types, sentences, sample data, the rail entry with its count (`web/src/inbox/`,
   `web/src/shell/`).
3. Loading and server actions, the real page, the count on the other three pages
   (`web/src/app/`). Needs 2; needs 1 only by its documented answer shape.
4. The screen, the development page and the browser tests. Needs 2.
5. Docs and the hosted database. Needs all.

1 and 2 have no shared files. 3 and 4 have no shared files.

## Known gaps (accepted)

- **The hosted database needs the migration** before `/inbox` works against it. Until then the
  page says it could not load and the rail shows no count. Applying it is a step for Danijel
  (runbook: `docs/hosted-db-bringup.md`; re-stamp if applied through the Supabase MCP).
- Accepting or declining a link is not written to the audit log (already listed in the
  north-star); not fixed here.
- A link to or from a held note stays out of the inbox until the note is released.
- The count on other pages is as old as the page load; it does not update live.
- A declined link cannot be proposed again (`unique (from_note, to_note)`); decline is final by
  design of the database, and the screen says so.

## Review focus

- The function reveals nothing beyond the map: name and topic always, title only when readable,
  never body, path or id of a colleague's unreadable note.
- The sentence about what accepting does is true to `can_read_note`.
- Agents are refused by both functions.
- No permission logic in `web/`.
