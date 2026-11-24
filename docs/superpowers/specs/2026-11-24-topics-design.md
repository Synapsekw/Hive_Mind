# Topics: every note under a customer or subject — design

Date: 2026-11-24. Direction agreed with Danijel in chat the same day; this document is for his
review before a plan is written.

## Why

After the folder import and "Connect wiki links", the Synapse hive holds 1,641 notes in `Main` and
692 of them have no link at all. 665 of those carry no `[[wiki link]]`, so nothing built so far
can connect them: sources under `sources/zain`, decks and proposals under `outputs/`, 384 session
notes. Danijel's requirement: every note, decks and sources included, must hang off something — a
customer, a vendor, a subject.

The PRD already names the mechanism: the **entity**, shown as "topic" in the app, "the strongest
join point across members" (PRD 6 and 7.3, link tier 1). The tables (`entities`,
`note_entities`) have existed since the first migration and are empty. This slice fills them,
with rules and no model, so it costs no tokens
([[2026-11-24-decision-15-the-hive-owner-pays-for-hive-maintenance]]).

## Decisions (Danijel)

1. Topics, not extra note-to-note links. A note is attached to topics; no link rows are made.
   Linking 600 notes to one hub note would make a few giant hubs and hide the map's clusters.
2. The topic list starts from the vault's own structure, and the hive's owner confirms it once.
3. Once the list is confirmed, a person's own notes are attached automatically by rule. The
   person can detach a note from a topic, or add one by hand, afterwards. This replaces the PRD's
   "suggestion-first" for a person's own notes; the PRD keeps it for anything across members.

## What is measured

On the hosted Synapse hive, taking as topic names only the file names of notes whose `type` field
says client, partner, vendor, product, project or person (281 names), and no aliases:

| Of the 692 notes with no link        | Notes |
| ------------------------------------ | ----- |
| a folder in the path is a topic name | 130   |
| a tag is a topic name                | 26    |
| the title contains a topic name      | 95    |
| the text contains a topic name       | 404   |
| at least one of the four             | 458   |

So names alone place about two thirds. Aliases and subject topics (below) place more. What is
left is shown as "No topic" on the map, so the person can see it and add a topic by hand.

**Success for this slice:** after one run on `Main`, at least 450 of the 692 have a topic, every
note that has none sits in one "No topic" group on the map, and nothing a colleague could not
read before is readable now.

## Behaviour

### A topic

A topic is a row of `entities`: a hive, a kind, a name, aliases. Kinds: client, project, person,
product (as today), plus two new ones, **vendor** and **subject** (a concept or theme, such as
"Flare inspection"). A topic's name and aliases are readable by every member of the hive, as the
policy already says; which notes are attached is readable only by someone who can read the note.

Only the hive's owner makes, renames or deletes topics (the existing policies). A hive has at
most 2,000 topics; a name is 1 to 80 characters, stored trimmed; a topic has at most 20 aliases
of at most 80 characters each.

### Finding the topics (the owner, once, and again whenever wanted)

In Settings the owner has a **Topics** section with **Find topics in my notes**. It reads the
path, title and fields of the owner's own notes in this hive (never the text) and proposes
candidates:

1. **A note that says it is one.** A `type` field of `client`, `client-entity`, `partner-entity`
   (client); `project`, `internal-project` (project); `person` (person); `product` (product);
   `vendor` (vendor); `concept`, `cluster-topic`, `category` (subject). The name is the note's
   file name without `.md`; a file called `_Index`, `index` or `README` takes its folder's name.
   Aliases: the note's title when it differs, and the `aliases` field when it is a list of texts.
2. **A folder with an index note.** `…/X/_Index.md` with no such `type` proposes X as a client
   when the folder above is called Employers, Clients or Customers, else as a subject.
3. **A tag used on five or more notes** that matches no candidate from 1 or 2 is proposed as a
   subject. A tag that does match one becomes that candidate's alias.

Notes under a folder called `Templates`, and names shorter than 3 characters, propose nothing.
Two candidates with the same kind and the same name (ignoring case and accents) are one.

The owner sees the candidates grouped by kind, each with a tick. Clients, projects, vendors,
products and people start ticked; subjects start unticked. **Save topics** inserts the ticked
ones that are not there yet. Nothing is ever deleted or renamed by this step, and running it
again proposes only what is new. The section then lists the hive's topics by kind with a count,
and **Delete** on each (asked once).

### Attaching notes to topics (every member, their own notes)

For each of the person's notes in a workspace, each topic of the hive is tried. Names and aliases
are compared ignoring case and accents, with space, `-` and `_` taken as the same character.

| Signal                                                                           | Confidence |
| -------------------------------------------------------------------------------- | ---------- |
| the note itself proposes this topic by rule 1 or 2 above                         | 1.0        |
| a folder in the note's path equals a name or alias                               | 0.9        |
| a tag of the note equals a name or alias                                         | 0.9        |
| the title contains a name or alias, as whole words                               | 0.7        |
| the text contains a name or alias of 4+ characters, as whole words, outside code | 0.5        |

A note keeps its five strongest topics; ties go to client, project, vendor, product, person,
subject, in that order, then to the name. One row of `note_entities` per pair, with the
confidence. A pair that is already there is left as it is, including one the person detached.

Text read from notes is data here as everywhere: it is compared with topic names and nothing
else is done with it.

### Where it runs

- **After an import**, as a third step after the notes and the wiki links: "Attaching topics".
  Stop works as in the import. Skipped, with one line saying so, when the hive has no topics.
- **A button** in the vault beside "Connect wiki links", for one of the person's own workspaces:
  "Attach topics". One sentence, Start, progress, then the counts.
- Running it again adds nothing twice and never brings back a detached pair.

Counts shown: notes given a topic, already attached, notes with no topic. Those last ones are the
"No topic" group on the map.

### What the person sees

- **Vault, open note:** under "Linked with", a **Topics** line: each topic as a chip with a
  remove control, and **Add topic** (a list of the hive's topics). Remove asks nothing and can be
  undone by adding the topic again. Only the note's owner sees the controls.
- **Map, Rings:** the "Group by" menu gains **Topic**. A note sits with its strongest topic; the
  rest sit in "No topic". As with the other groupings, at most twelve groups are drawn and the
  rest fold into "Other topics". The filter bar lists the groups; the detail rail names all of a
  note's topics. A note the viewer cannot read shows no topic.
- **Agents:** `hive_overview` already returns the hive's topics; it now has some. No MCP tool is
  added or changed.

### Known limits (accepted)

- A note an agent writes later is not attached by itself. The person presses "Attach topics".
- A note whose text changes keeps the topics it has; a run only adds.
- A topic renamed or deleted in the vault's files does not rename or delete the topic.
- No links are proposed between two members' notes that share a topic, and no notification is
  sent. That is the next slice of Phase 4.
- Renaming a topic and editing its aliases in the app are not in this slice; the names come from
  the vault. Delete and find again is the way round.

## Architecture

### Database (one migration, minted with `scripts/new-migration.sh topics`)

- `entity_type` gains `vendor` and `subject`.
- `entities`: a trigger checks the name (1 to 80, trimmed), the aliases (20 of 80) and the cap of
  2,000 per hive, under a lock per hive, as `workspace_cap` does for workspaces.
- `note_entities` gains `detached_at timestamptz` (null while attached). The person who owns the
  note may set or clear it, as a person and never as an agent or an app pass: a new update
  policy, with the column grant limited to `detached_at`. Insert and delete stay as they are.
  The existing `zzz_one_hive` already refuses a note and a topic from different hives.
- `map_graph` gains, for each note the caller can read, `topics`: up to five topic ids, attached
  and not detached, strongest first; and at the top level `topics`: id, name and kind of every
  topic that appears. A locked stub carries none.
- No change to who can read a note, a link or a file.

Every rule above gets a test in `tests/sharing-rules.test.mjs`, written first: who makes a topic;
who attaches, detaches and re-attaches; that an agent and an app pass cannot detach; that a
colleague reads a note's topics only when they can read the note; that the map payload gives a
locked note no topic; the caps; a hive that is being deleted.

### Units

- `web/src/topics/normal.ts` — pure. One form of a name for comparing.
- `web/src/topics/candidates.ts` — pure. `candidates(notes)` from `{ path, title, frontmatter }`.
- `web/src/topics/match.ts` — pure. `topicsFor(note, topics)` gives up to five `{ id, confidence }`.
- `web/src/app/settings/topics.ts` — server steps for the owner: read own notes' paths, titles and
  fields a page at a time; save the ticked candidates; delete a topic.
- `web/src/app/vault/attach.ts` — `attachBatchIn(db, workspaceId, after)`: the workspace is the
  person's own (the import's check, shared); reads the hive's topics; reads the next 40 notes
  after the cursor; matches; reads the pairs those notes already have; inserts the missing ones.
  Answers counts and the next cursor, never a path, a title or text other than the cursor.
- `web/src/app/vault/write.ts` — `detachTopic`, `addTopic` for one note.
- Browser: `attachRun.ts` (the loop, as `connectRun.ts`), `Attach.tsx`, the third step in
  `Import.tsx`, the Topics line in `Preview.tsx`, the Topics section in `Settings.tsx`, the
  sentences in each area's text file, the dev stand-ins.
- Map: `types.ts` and `load-map.ts` carry the new payload keys; `arrange.ts` gains the `topic`
  arrangement; `Controls` (the Group by menu) lists it; `DetailRail.tsx` names a note's topics.

Every server step is a public endpoint: ids must be uuids, cursors bounded strings, lists capped
before any query; the hive and the member are read from the database, never taken from the
browser. The MCP server is not touched and gains no permission logic.

## Performance and data budget

- **First paint.** Vault: the open note's topics come with the note's existing read (one
  embedded select over the `note_entities` primary key). Settings: one more bounded read, the
  hive's topics (at most 2,000, by `(hive_id, type, canonical_name)`). Map: still one
  `map_graph` call; it reads `note_entities` by its primary key for the notes it already returns.
- **Interactions.** Group by Topic, the filter bar and the detail rail are client state: 0 new
  round-trips. Detach and Add topic change server data: one write, then the open note is read
  again, not the page.
- **The runs.** Each step is one request: topics of the hive (bounded as above), 40 notes by
  `(workspace_id, path)`, their pairs by primary key, inserts in chunks of 200. A 1,641-note
  workspace is 42 steps. Matching 40 notes against 2,000 topics is done in memory on the server.
- `map_graph` is timed on the hosted project after the first real run, before promotion to
  `main`, as for wiki links.

## Independent units (for the plan's execution DAG)

1. **Rules** — `normal.ts`, `candidates.ts`, `match.ts`. Pure; depends on nothing.
2. **Database** — the migration and its tests. Depends on nothing.
3. **Owner's topics** — `settings/topics.ts` and the Settings section. Needs 1 and 2.
4. **Attaching** — `attach.ts`, the loop, the button and the import's third step. Needs 1 and 2.
5. **A note's topics** — the Topics line in the vault with detach and add. Needs 2.
6. **Map** — payload keys, the `topic` arrangement, the detail rail. Needs 2, and
   `task/map-chrome` merged first, since that task replaces the control this adds an entry to.

1 and 2 can be built at the same time; then 3, 4, 5 and 6 at the same time.

## Testing

- Unit (Vitest): normalising; each candidate rule, the kinds, merging, templates and short names;
  each signal, whole-word matching, code blocks, the five-topic cap and its tie order; the server
  steps against a fake client (hostile arguments, not the owner, paging, existing and detached
  pairs, chunked inserts, counts, cursor); the loop (stop, three refusals); the sentences; the
  `topic` arrangement (strongest topic, "No topic", folding at twelve).
- Database: the list under Architecture.
- Browser (Playwright, dev pages): find, tick, save; attach after an import and from the button;
  chips, remove, add; Group by Topic; keyboard and focus; nothing scrolls at 1100 x 560.
- Live, by hand after deploy: Synapse `Main` — the success numbers above; `map_graph` timing.

## Points for Danijel's review

1. Two new kinds, **vendor** and **subject**. The vault has 137 vendor notes and about 170
   concept, cluster and category notes that fit none of the four existing kinds.
2. Subjects start **unticked** in the candidate list, so the first topic list is customers,
   projects, vendors, products and people. Tick the subjects you want.
3. A note keeps at most **five** topics, and the map places it under the strongest one.
4. Only the **owner** makes topics. A member's notes attach to the hive's topics, but a member
   cannot add a topic of their own in this slice.
