# Link behaviours: a decline is final, and Unlink is its own action

Date: 2026-11-24. Status: approved by Danijel in the session.

## Problem

Two behaviours of links shipped undecided:

1. A declined link can be proposed again in the reverse direction. `links` is unique on
   `(from_note, to_note)`, so the same direction is refused but `(to_note, from_note)` is a new
   row. A person who said no is asked again.
2. `respond_to_link(link, false)` sets any link to declined, an accepted one too. So "decline"
   silently ends a link both people had agreed to, and nothing in the app says so.

Accepted links are also not listed anywhere in the app, so there is no place to end one on
purpose.

## Decisions (Danijel, 2026-11-24)

- A declined pair of notes cannot be proposed again, by anyone, from either side. No undo.
- Ending an accepted link is a separate action named **Unlink**. It lives in the vault, on the
  open note. An unlinked pair cannot be proposed again either.
- Decline answers a proposal only.

## Design

### Database (one migration, `20261124074246_link_behaviours`)

- **One link per pair.** A unique index on
  `(least(from_note, to_note), greatest(from_note, to_note))`. `links_before_insert` checks
  first and raises a plain message: `this link was declined` when the existing row is declined,
  `these notes already have a link` otherwise. The index is the backstop for two opposite
  proposals at the same moment. The proposer owns one of the two notes and may already read
  every link touching it (`links_select`), so the message tells them nothing new.
- **Columns** `links.ended_at timestamptz` and
  `links.ended_by uuid references members on delete set null`, set by a decline or an unlink.
- **`respond_to_link(p_link, p_accept)`** keeps its signature and guards. New: declining an
  accepted link raises `this link is accepted; unlink it instead`; declining a declined link
  returns `declined` and changes nothing; a decline stamps `ended_at`/`ended_by` and writes
  audit `link.declined`; the accept that completes a link writes audit `link.accepted`.
- **`unlink(p_link uuid) returns void`**, security definer, `search_path = ''`. Refuses an app
  pass and anything that is not a person, like `respond_to_link`. The caller must own one of
  the two notes, else `link not found`. The link must be accepted, else
  `this link is not accepted`. Two different owners: status becomes `declined`, `ended_at` and
  `ended_by` are stamped, audit `link.unlinked`. One owner on both sides (such a link is
  accepted at once and needs no handshake): the row is deleted, so the two notes can be linked
  again; audit `link.unlinked` too.
- **`note_links(p_note uuid)`** returns
  `table (id uuid, note_id uuid, title text, owner text, mine boolean)`: the accepted links of
  one note where the caller owns at least one side, newest first, at most 50. `note_id`,
  `title` and `owner` describe the other note; `mine` says whether the caller owns that other
  note. A person only; an agent or an app pass gets no rows. Reads go through
  `unique (from_note, to_note)` and `links_to_idx`.
- Audit rows carry `hive_id`, the acting member, `note_id` = the caller's note in the link and
  `detail = {"link": id, "other_note": id}`.
- Read access needs no change: `can_read_note` already follows accepted links only, so an
  unlinked note closes at once. A test proves it.
- Agents: no change in what they may do. The database still refuses `respond_to_link` and now
  `unlink` for any identity with an `agent_id` claim.

### Web (vault only)

- `VaultData.open` gains `links: NoteLink[]` (`{ id, note_id, title, owner, mine }`), loaded by
  `note_links` in the same parallel batch as the open note. A failure of that read shows the
  note with no list, and is logged.
- `Preview` shows **Linked with** under the sharing control when the list is not empty: the
  other note's title (a link to it in the vault), its owner, and **Unlink**.
- Unlink asks in place, as Delete does: "Unlink these notes? You and (owner) will no longer
  read each other's note through this link. The two notes cannot be linked again." with
  **Unlink** and **Keep**. For two notes of one's own: "Unlink these two notes of yours?".
- New action `unlink(linkId)` → `{ ok }`; on success the page refreshes. When the open note
  was a colleague's read only through that link, it is gone after the refresh and the vault
  shows its existing "not found" state.
- Inbox: the Decline confirmation gains "It cannot be proposed again." Nothing else changes.
- Look: existing vault tokens and button styles only; another session reworks the look.

### MCP server

No new tool, no permission logic. `hive_propose_link` already returns the database's message,
so an agent reads `this link was declined`. The tool description gains one sentence: a
declined or unlinked pair cannot be proposed again.

## Performance and data budget

- First paint of the vault index, the map and the inbox: unchanged.
- Opening a note: one more read, in parallel with the note itself, bounded at 50 rows over
  indexed columns. No new round trip in sequence.
- Unlink: one write, then the existing page refresh.
- Proposing a link: one more indexed lookup in the insert trigger.

## Independent units

1. Migration and database tests.
2. Vault list, Unlink action and its tests (against the contract above).
3. MCP description, inbox wording, docs.

No unit shares a file with another.

## Not in this slice

- No notice to the colleague when a link is unlinked or declined.
- No undo of a decline or an unlink.
- No list of declined links in the app.

## Rollout

Before applying to the hosted project: check for pairs that already have rows in both
directions (the new index would refuse them) and resolve them with Danijel. Apply with
`supabase db query --linked -f`, record the version, redeploy the site.
