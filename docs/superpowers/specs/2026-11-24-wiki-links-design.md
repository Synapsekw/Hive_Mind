# Wiki links become links: design

Date: 2026-11-24. Approved by Danijel in chat the same day.

## Why

A folder import brings notes in with their `[[wiki links]]` still in the text, and nothing on the
map. The DRA vault arrived as 1,643 notes with about 5,700 references and no link. This slice
turns the references between a person's own notes into links, with no model and no tokens. It is
the first piece of Phase 4, pulled forward. Maintenance that does need tokens is the owner's cost
([[2026-11-24-decision-15-the-hive-owner-pays-for-hive-maintenance]]); none is spent here.

## Decisions (Danijel)

1. It runs by itself at the end of every folder import, and from a "Connect wiki links" button in
   the vault for a workspace that is already there.
2. A wiki link connects only to a note in the same workspace.
3. When several notes carry the name, the closest wins, as in Obsidian: same folder first, then
   the shortest path.

## Behaviour

### What counts as a reference

Read from a note's text and from every text value in its fields (frontmatter), at any depth.

- `[[Target]]`, `[[Target|shown]]`, `[[Target#heading]]`, `[[Target#^block]]`, `![[Target]]`.
  The target is the text before the first `|` or `#`, trimmed.
- Skipped: an empty target (`[[#heading]]`), a target with a line break, a target whose last part
  has an extension other than `.md` (an image, a PDF), and anything inside a fenced code block
  (``` or ~~~) or inline code in the text. Fields are not markdown, so nothing is skipped there.
- Ordinary markdown links `[text](note.md)` are out of scope.
- At most 2,000 distinct targets are taken from one note; the rest are ignored.

### Which note a target means

All comparisons ignore case; a trailing `.md` on the target is optional; `\` is not a separator.

1. A target that begins with `./` or `../` is resolved from the linking note's folder and must
   then equal a note's path. Leaving the workspace root resolves to nothing.
2. A target that begins with `/` must equal a note's path from the root.
3. A target with a `/`: the note whose path equals it; failing that, the notes whose path ends
   with `/` + target, closest first.
4. A bare name: the notes whose file name (without `.md`) equals it, closest first.

Closest: in the linking note's own folder; then fewest folders deep; then shortest path; then
first by plain string order. The result is always one note or none.

A target that resolves to the linking note itself is dropped. A target that resolves to nothing
is counted as "pointing at no note"; no note is created.

### What is written

One link per pair of notes, whichever way the text points and however many times: `tier` 2
(explicit reference), `score` 0.8, the same values an agent's proposal of that tier gets. Both
notes belong to the person, so the database accepts the link at once
(`links_before_insert`); it appears on the map and under "Linked with". A pair that already has a
link is left as it is and counted as "already linked".

Only notes of the workspace's owner are read and linked. Nothing is ever proposed to a colleague
by this feature.

### Where it runs

- **After an import.** When the last batch of notes has been answered and at least one note was
  saved or already there, the panel goes on to "Connecting wiki links" over the whole workspace
  (so links between new notes and notes that were already there are found too). Stop works as in
  the import. The result screen gains three counts.
- **The button.** In the vault, beside "Import a folder", when the open tab is one of the
  person's own workspaces: "Connect wiki links". It opens a panel with one sentence and a Start
  button, shows progress, then the three counts. The panel cannot be closed while it runs.

Running it again adds nothing twice. It is safe to stop and start again.

### Counts shown

Links made, already linked, pointing at no note. When some inserts were refused, a fourth line
says how many could not be saved. When three batches in a row are refused the run stops and says
so, as the import does.

### Known limits (accepted)

- Unlinking one of these links is not permanent: an unlink between two of one's own notes deletes
  the row, so the next run makes it again while the text still says `[[…]]`. The link follows the
  text.
- Notes an agent writes later are not scanned by themselves. The person presses the button, or
  Phase 4 does it.
- A reference removed from the text does not remove its link.
- A workspace of more than 20,000 notes is refused.

## Architecture

No database change. The existing rules decide: `links_insert` lets a person insert a link from
their own note, `links_before_insert` accepts it at once when both notes have one owner, the
pair index refuses a second link, `zz_hive_frozen` refuses a hive that is being deleted.

Units:

- `web/src/import/wikilinks.ts`: pure. `wikiTargets(body, frontmatter)` finds targets;
  `buildIndex(notes)` and `resolveTarget(index, fromPath, target)` find the note. Runs anywhere.
- `web/src/app/vault/connect.ts`: `connectBatchIn(db, workspaceId, after)`. One step: checks the
  workspace is the person's own (the import's check, shared), reads the workspace's index of
  `id, path`, reads the next 40 notes after the cursor, resolves, reads the links those notes
  already have, inserts the missing pairs, answers counts and the next cursor.
- `web/src/app/vault/actions.ts`: `connectWikiLinks(workspaceId, after)`, the public endpoint.
- `web/src/vault/connectRun.ts`: the loop a browser runs over the steps, with stop and give-up.
- `web/src/vault/Connect.tsx` and changes to `Import.tsx` and `Vault.tsx`: the two places it runs.
- `web/src/vault/connectText.ts`: every sentence.

The step is a public endpoint. `workspaceId` must be a uuid and `after` null or a string of at
most 500 characters; anything else answers `{ ok: false }` before any query. The hive and the
member come from the workspace's row, never from the browser. Nothing a note says is logged or
returned; the answer is numbers and a cursor (a path of the person's own note).

## Performance and data budget

- First paint of the vault: nothing new is read. The button is plain markup.
- Each step is one request with bounded reads over indexed columns: the index by
  `(workspace_id, path)` in pages of 1,000 (at most 20); 40 notes by the same index; the links of
  those 40 notes by `from_note` (unique index) and `to_note` (`links_to_idx`) in pages of 1,000
  (at most 20); inserts in chunks of 200.
- A 1,643-note workspace is 42 steps; expected about half a minute. Server data changes, so the
  page is refreshed once at the end, not per step.
- The map with about 5,000 more links: `map_graph` is timed on the hosted project after the
  first real run, before promotion. The canvas was already measured with 6,782 links
  ([[2026-11-23-decision-14-the-map-is-drawn-on-one-canvas]]).

## Independent units (for the plan)

`wikilinks.ts` (pure) and the browser side (`connectRun.ts`, `Connect.tsx`, `Import.tsx`,
`Vault.tsx`, the dev stand-in) depend only on the shared types and can be built at the same time.
`connect.ts` needs `wikilinks.ts`.

## Testing

- Unit (Vitest): extraction (every form, code blocks, fields, caps), resolution (each rule, ties,
  case, `.md`, relative paths, self), the server step against a fake client (hostile arguments,
  not the owner, paging, existing pairs in both directions, chunked inserts with the one-by-one
  fallback, counts, cursor), the loop (stop, three refusals), the sentences.
- Database: nothing new. `tests/sharing-rules.test.mjs` already proves the two rules the feature
  rests on: a link between two notes of one owner is accepted at once, and a second link for the
  pair, in either direction, is refused with 'these notes already have a link'.
- Browser (Playwright, `/dev/vault`): import then connecting then counts; the button and its
  panel; stop; refusals; keyboard and focus.
- Live, by hand after deploy: the DRA workspace; `map_graph` timing.
