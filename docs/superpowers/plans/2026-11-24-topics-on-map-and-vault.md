# Topics, part 2: on the map and in the vault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person sees their notes by customer, partner, vendor, product and solution: as rings on the map, as a browsable list in the vault, and as chips on the open note that they can remove and add.

**Architecture:** Two new kinds (partner, solution) in the rules and the database. `map_graph` carries each readable note's topics and the hive's topic list; the map gains two groupings computed in the browser. The vault's existing reads carry each note's topics; a pure function builds the kind → topic list; two small server writes detach and add a topic under the person's own session.

**Tech Stack:** Supabase Postgres (RLS, plpgsql), Next.js server actions, React, Vitest, node:test + PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-topics-design.md`, including its "Amendments for part 2". Part 1 is merged (`docs/superpowers/plans/2026-11-24-topics-find-and-attach.md`).

**How this plan is written.** Part 1's plan gave every line of code and several of those lines were wrong until review caught them. This plan gives exact interfaces, exact behaviour, exact sentences and the full list of tests each task must add, and gives code only where precision matters most (SQL, pure functions' rules). Implementers write the rest in the style of the neighbouring code, test first.

## Global Constraints

- Work in the worktree `.claude/worktrees/topics-view` on branch `task/topics-view`. Never `git checkout` or `git stash` in the main checkout.
- Stage by path (`git add <paths>`); never `git add -A`, `git add .` or `git commit -a`. Commit subjects in lower case (commitlint refuses a capitalised subject).
- The migration is minted only with `scripts/new-migration.sh topics_view`. No shipped migration is edited (`20261124173204_topics.sql` is shipped).
- Sharing is decided in the database. Server actions validate arguments, then let row-level security answer. No permission logic in `web/` or `mcp/`.
- Agents and app passes never detach, add or remove a topic. A note the caller cannot read shows no topic, anywhere.
- Text read from notes is data. Only an error's code (and, for writes, its message) is logged; never a path, title or text.
- Kinds, in this order everywhere: `client`, `partner`, `project`, `vendor`, `product`, `solution`, `person`, `subject`. Shown as: Customers, Partners, Projects, Vendors, Products, Solutions, People, Subjects.
- A note keeps at most 5 topics; a note's "strongest" topic is the first by confidence (highest first), then kind order, then name.
- Every sentence shown lives in a text file. Every colour comes from a token. No new CSS unless a task says so; where layout needs a class, reuse an existing one.
- Data budget: the map is still one `map_graph` call; Group by is client state (0 round-trips). The vault's first paint gains one bounded read (the hive's topics, paged by 1,000, at most 2,000) and no extra read for the notes' topics (they ride on the existing index and open-note reads). Remove and add are one write each, then the page's data is refreshed.
- Gates before closure: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Browser specs share port 3100 with other sessions: before `npx playwright test`, check `lsof -nP -iTCP:3100 -sTCP:LISTEN`; a server from another worktree must go away first.

## File Structure

| File                                                                               | Responsibility                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `web/src/topics/types.ts`, `candidates.ts`                                         | The eight kinds; `partner-entity` → partner, `category` → solution |
| `web/src/settings/topicsText.ts`, `Topics.tsx`                                     | Kind names; a visible heading per kind in the list                 |
| `supabase/migrations/<stamp>_topics_view.sql`                                      | Two enum values, `topic_rank`, `map_graph` with topics             |
| `web/src/map/types.ts`, `arrange.ts`, `GroupMenu.tsx`, `Map.tsx`, `DetailRail.tsx` | The two groupings; a note's topics in the side panel               |
| `web/src/vault/types.ts`, `web/src/app/vault/load-vault.ts`                        | Topics on each note and on the page's data                         |
| `web/src/app/vault/write.ts`, `actions.ts`                                         | `detachTopicIn`, `addTopicIn`                                      |
| `web/src/vault/topicTree.ts` (new)                                                 | Pure: kinds → topics → counts; which notes a topic holds           |
| `web/src/vault/TopicList.tsx`, `NoteTopics.tsx`, `topicText.ts` (new)              | The Topics column; the open note's chips; their sentences          |
| `web/src/vault/Vault.tsx`, `Preview.tsx`, `tree.ts`                                | The Folders / Topics switch; the topic scope; the chips' place     |

## Execution DAG

- **Dependencies:** Task 3 needs Tasks 1 and 2. Task 4 needs Tasks 1 and 2. Task 5 needs Task 3. Task 6 needs all.
- **Parallel batches:**
  - Batch A: Task 1 (kinds: `web/src/topics/`, `web/src/settings/`) and Task 2 (database: `supabase/`, `tests/`).
  - Batch B: Task 3 (vault data and writes: `web/src/app/vault/`, `web/src/vault/types.ts`) and Task 4 (map: `web/src/map/`, `web/src/app/dev/map/`, `web/e2e/map.spec.ts`).
  - Batch C: Task 5 (vault screen).
  - Batch D: Task 6 (closure).
- **Critical path:** Task 2 → Task 3 → Task 5 → Task 6.
- Tasks in one batch touch disjoint files and run in the same worktree. While two run at once, neither commits: the controller commits each task's paths when it reports.

---

### Task 1: Eight kinds

**Files:**

- Modify: `web/src/topics/types.ts`, `web/src/topics/candidates.ts`, `web/src/topics/candidates.test.ts`, `web/src/topics/match.test.ts`, `web/src/settings/topicsText.ts`, `web/src/settings/topicsText.test.ts`, `web/src/settings/Topics.tsx`, `web/e2e/settings.spec.ts`
- Any other test that lists `KINDS` or `KIND_NAMES` in full.

**Interfaces:**

- Consumes: nothing new.
- Produces: `KINDS = ["client", "partner", "project", "vendor", "product", "solution", "person", "subject"]`; `Kind` accordingly; `KIND_NAMES` with `partner: "Partners"`, `solution: "Solutions"`.

**Behaviour:**

- In `TYPE_KIND` (`candidates.ts`): `partner-entity` → `partner` (was client); `category` → `solution` (was subject). Add `partner` → `partner` and `solution` → `solution`. Everything else as it is.
- The Settings candidate list still starts every kind ticked except `subject` (the rule in `Topics.tsx` is already "not subject"; confirm it and leave it).
- In the Settings list of saved topics, each kind's list gets a visible heading above it: the kind's name and its count, using the existing `fieldLabel` and `count` classes (an `h3`). The list keeps its `aria-label`.
- The five-topic tie order in `match.ts` follows `KINDS` and needs no code change; its test's expected order does (see below).

- [ ] **Step 1: Tests first.** Update and add, then run and see the new expectations fail:
  - `candidates.test.ts`: in the type table, `partner-entity` → `partner`, `category` → `solution`, plus rows for `partner` and `solution`. A new test: a note `Employers/Zain/Partners/Qualcomm.md` typed `partner-entity` and a note `Knowledge/Vendors/Qualcomm.md` typed `vendor` give two candidates, `partner:Qualcomm` and `vendor:Qualcomm`, in that order.
  - `candidates.test.ts`, "orders by kind, then by name": add a partner and a solution and assert the order client, partner, vendor, solution, subject.
  - `match.test.ts`, the five-topic test: add one `partner` topic and one `solution` topic that the note's text mentions; the kept five are, in order, the folder hit, then by kind: client(s), partner, then the next by kind order. Work the expected ids out from the rule and assert them exactly.
  - `topicsText.test.ts`: `KIND_NAMES` equals the eight names in order.
  - `web/e2e/settings.spec.ts`: in the Topics test that saves candidates, assert a visible heading "Customers" above the saved customers' list (`getByRole("heading", { name: /^Customers/ })` inside the Topics section). Extend the dev fixture (`web/src/settings/fixture.ts` `fixtureHeads()`) with one head typed `category` at `Knowledge/Categories/Underwater ROVs.md` and assert its checkbox is named `Solutions: Underwater ROVs` and starts ticked. Update the counts and recorded `saveTopics` arguments this changes; additions and necessary updates only.
- [ ] **Step 2: Implement** the changes above.
- [ ] **Step 3: Verify.** From `web/`: `npx vitest run src/topics src/settings src/app/settings`, `npx tsc --noEmit`, prettier on the touched files, then `npx playwright test e2e/settings.spec.ts --project=chromium`. All pass.
- [ ] **Step 4: Commit** (when not running beside another task): `feat(topics): partners and solutions are kinds of their own`.

---

### Task 2: The database

**Files:**

- Create: `supabase/migrations/<stamp>_topics_view.sql` (mint with `scripts/new-migration.sh topics_view`)
- Modify: `tests/sharing-rules.test.mjs` (append)

**Interfaces:**

- Consumes: the tables and policies as they are after `20261124173204_topics.sql`.
- Produces: `entity_type` values `partner`, `solution`; `public.topic_rank(public.entity_type) returns integer`; `map_graph(p_hive)` whose answer gains, on every node, `topics` (a JSON array of topic ids) and, at the top level, `topics` (a JSON array of `{ id, name, kind }`).

**The migration, exactly:**

1. `alter type public.entity_type add value if not exists 'partner';` and the same for `'solution'`. Neither value may be used as an enum literal anywhere else in this file.
2. A helper that orders kinds the way the app does. It compares text, so it names the new values without using them as enum literals:

```sql
create function public.topic_rank(p_kind public.entity_type) returns integer
language sql immutable set search_path = '' as $$
  select case p_kind::text
    when 'client' then 1 when 'partner' then 2 when 'project' then 3
    when 'vendor' then 4 when 'product' then 5 when 'solution' then 6
    when 'person' then 7 else 8 end
$$;
revoke all on function public.topic_rank(public.entity_type) from public, anon, authenticated;
```

3. `create or replace function public.map_graph(p_hive uuid)`: copy the whole current body from `supabase/migrations/20261124153504_note_dates.sql` (it is the latest definition; confirm with `grep -n "function public.map_graph" supabase/migrations/*.sql`) and change only this:
   - In the `kept` CTE, the note branch gains a last column `topics`, and the file branch gains `'[]'::jsonb` in the same place:

```sql
           (select coalesce(jsonb_agg(x.entity_id order by x.confidence desc, x.rank, x.name), '[]'::jsonb)
              from (select ne.entity_id, ne.confidence,
                           public.topic_rank(e.type) as rank, e.canonical_name as name
                      from public.note_entities ne
                      join public.entities e on e.id = ne.entity_id and e.hive_id = p_hive
                     where ne.note_id = n.id and ne.detached_at is null
                     order by ne.confidence desc, public.topic_rank(e.type), e.canonical_name
                     limit 5) x) as topics
```

- In the node object: `'topics', case when k.readable then k.topics else '[]'::jsonb end`.
- A new variable `v_topics jsonb`, filled before the `return` with every topic of the hive, and `'topics', v_topics` added to the returned object:

```sql
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'name', e.canonical_name, 'kind', e.type
         ) order by public.topic_rank(e.type), e.canonical_name, e.id), '[]'::jsonb)
    into v_topics
    from public.entities e
   where e.hive_id = p_hive;
```

- Nothing else in the function changes: the same refusals for an app pass and an agent, the same cap, the same locked stubs. Keep the function's `language`, `security definer`, `set search_path` and `set plan_cache_mode` lines exactly, and re-state whatever grants and revokes the earlier migration made for `map_graph` after it (copy them).

4. A header comment in the style of the neighbouring migrations: what changes, that a locked note carries no topic, that a topic's name is the hive's to read (`entities_select`), and that the per-note read goes by the primary key of `note_entities`.

**Tests to append** (helpers `addTopic`, `tpNote`, `attachTopic`, `detachTopic`, `nothingDone`, `person`, `members`, `ws`, `hive` exist; `map(person(...))` and `nodeOf(payload, id)` exist near "the map follows folder rules"):

- [ ] **Step 1: Write them, run, see them fail.**
  - "a partner and a solution are kinds, and they order as the app does": the owner inserts one of each; `select public.topic_rank(type)` as the database owner gives 1, 2, 3, 4, 5, 6, 7, 8 for client, partner, project, vendor, product, solution, person, subject.
  - "the map gives a readable note its topics, strongest first, at most five, and none that were detached": one note of Dani's attached to seven topics with confidences chosen so the order is decided once by confidence, once by kind (a partner before a vendor at the same confidence) and once by name; one of the seven detached. `nodeOf(await map(person("dani")), note).topics` equals the expected five ids in order.
  - "the map gives a note the viewer cannot read no topic": Ahmed's private note attached to a topic; in Dani's map its node is locked and `topics` is `[]`; in Ahmed's own map it has the topic. Then Ahmed shares it with the group and Sara's map shows the topic.
  - "the map lists the hive's topics by kind, then name, and nobody else's": the top-level `topics` holds `{ id, name, kind }` for this hive's topics in `topic_rank` then name order, and holds no topic of the outsider's hive.
  - "a file's node carries no topic": every node with `kind` `file` has `topics` `[]`.
  - "an agent and an app pass are still refused the map": as the existing tests assert for `map_graph` (copy the two refusals), so the replaced function did not lose them.
- [ ] **Step 2: Write the migration.**
- [ ] **Step 3: Run the whole file.** `node --test tests/sharing-rules.test.mjs 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)"` shows `fail 0`. An older map test that compares a whole node object must be extended with `topics: []`, never loosened.
- [ ] **Step 4: Format; commit** (when not running beside another task): `feat(db): partner and solution topics, and the map carries each note's topics`.

---

### Task 3: The vault's data and writes

**Files:**

- Modify: `web/src/vault/types.ts`, `web/src/app/vault/load-vault.ts`, `web/src/app/vault/load-vault.test.ts`, `web/src/app/vault/write.ts`, `web/src/app/vault/write.test.ts`, `web/src/app/vault/actions.ts`, `web/src/app/vault/page.tsx`, `web/src/vault/fixture.ts` (and its test), `web/src/app/dev/vault/DevVault.tsx`

**Interfaces:**

- Consumes: `Kind`, `KINDS`, `MAX_TOPICS_PER_NOTE` from `web/src/topics/types.ts`; `paged`, `counting` from `web/src/app/vault/connect.ts`.
- Produces:
  - `VaultNote.topics: string[]` — ids of the note's attached topics, strongest first (confidence descending; ties in the order the database answered).
  - `VaultTopic = { id: string; kind: Kind; name: string }`; `VaultData.topics: VaultTopic[]` — the hive's topics, by kind order then name.
  - `TopicChange = { ok: true } | { ok: false; reason: "full" | "failed" }`.
  - `VaultActions.detachTopic(noteId: string, topicId: string): Promise<Result>` and `VaultActions.addTopic(noteId: string, topicId: string): Promise<TopicChange>`.
  - `detachTopicIn(db, noteId, topicId)`, `addTopicIn(db, noteId, topicId)` in `write.ts`.

**Behaviour:**

- **Loader.** `NOTE_COLUMNS` gains the embed `note_entities(entity_id,confidence,detached_at)`. `toNote` builds `topics` from it: rows whose `detached_at` is null, sorted by `confidence` descending (stable), mapped to `entity_id`; anything malformed is skipped; absent → `[]`. The open note's read already uses `NOTE_COLUMNS`, so it gains them too. One more read, in the first `Promise.all`: the hive's topics, `entities` `id, type, canonical_name` for the hive, ordered by `id`, paged with `paged()` in pages of 1,000 (so the hosted API's 1,000-row answers lose nothing); rows whose kind is not in `KINDS` are skipped; the result is sorted by `KINDS` order then name (plain string order). If that read fails, the vault still loads with `topics: []` (a topic list is not worth failing the page for) and one line is logged with the error's code.
- **Detach.** `detachTopicIn`: both ids must be uuids (else `{ ok: false }` before any query); needs a session; `update note_entities set detached_at = <now, ISO> where note_id = … and entity_id = … and detached_at is null`, selecting `note_id`; ok when exactly one row came back.
- **Add.** `addTopicIn`: both ids uuids; needs a session. Read the note's pairs (`note_entities` `entity_id, detached_at` for the note). If the pair exists and is attached → ok. Count attached pairs: at `MAX_TOPICS_PER_NOTE` or more → `{ ok: false, reason: "full" }`. If the pair exists detached → `update … set detached_at = null`, ok when one row came back. Otherwise insert `{ note_id, entity_id, confidence: 1 }`; a unique violation (`23505`, a race) is answered as ok; any other error as failed. Row-level security decides whether the note is the caller's; a refused write is `failed`.
- **Actions and page.** `detachTopic` and `addTopic` server actions in `actions.ts`, wired in `page.tsx` beside `unlink`.
- **Fixture and dev page.** `fixture.ts` gives the sample vault six topics across four kinds (two customers, one partner, one vendor, one solution, one subject) and gives several notes topics, one note five, some none. `DevVault.tsx` implements both actions against its in-memory data (recording calls as the others do), with `?fail=1` failing them, and the five-topic refusal.

- [ ] **Step 1: Tests first.**
  - `load-vault.test.ts`: the index and open selects name the embed; `toNote` orders by confidence, drops detached and malformed rows; the topics read is paged (a stub answering 1,000 then 3 rows yields 1,003 topics, sorted by kind then name); an unknown kind is skipped; a failed topics read still answers `state: "ok"` with `topics: []` and logs the code only.
  - `write.test.ts`: for each write, the hostile-argument table (a word, a uuid with a filter appended, a number, null) refuses before any query; no session refuses; detach sends exactly the update described and is not ok on zero rows; add covers the five paths (already attached, full, detached → cleared, new → inserted with confidence 1, duplicate on insert → ok) and a refused insert → failed; nothing but code and message is logged.
  - `fixture.test.ts`: every topic id on a note exists in the fixture's topics; no note has more than five.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** From `web/`: `npx vitest run src/app/vault src/vault`, `npx tsc --noEmit` (errors in `src/map/**` from a task running beside this one are not yours), prettier on the touched files.
- [ ] **Step 4: Commit** (when not running beside another task): `feat(vault): each note carries its topics, and a person removes or adds one`.

---

### Task 4: The map

**Files:**

- Modify: `web/src/map/types.ts`, `web/src/map/arrange.ts`, `web/src/map/arrange.test.ts`, `web/src/map/Map.tsx`, `web/src/map/DetailRail.tsx`, `web/src/map/fixture.ts`, `web/e2e/map.spec.ts`, and `GroupMenu.tsx` only if its list is not driven by `ARRANGES`.

**Interfaces:**

- Consumes: the payload keys from Task 2; `KINDS`, `Kind` from `web/src/topics/types.ts`; the kind names (move `KIND_NAMES` to `web/src/topics/types.ts` as `KIND_NAMES` and re-export it from `web/src/settings/topicsText.ts`, so the map does not import from Settings).
- Produces: `MapNode.topics?: string[]`; `MapPayload.topics?: { id: string; name: string; kind: Kind }[]` (both optional: an older database answers without them and the map must still draw); `Arrange` gains `"category"` and `"topic"`.

**Behaviour:**

- `ARRANGES` order: Folder, Category, Topic, Links, Time. `GROUP_HEADING`: `category: "Categories"`, `topic: "Topics"`.
- **Category.** A node's key is the kind name (Customers, Partners, …) of its strongest topic: the first id in `node.topics` that is found in `payload.topics`. A node with none (no topics, a locked node, a file, an unknown id) has the key `No topic`. Groups are drawn in `KINDS` order, not by size, with `No topic` last; kinds with no node are not drawn. At most nine groups, so nothing folds.
- **Topic.** A node's key is the name of its strongest topic; when two topics of different kinds share a name, the key is `Name (Kind name)` for both, for example `Qualcomm (Partners)` and `Qualcomm (Vendors)`. A node with none has the key `No topic`. Groups are drawn largest first (ties by name), capped like the folder grouping (default 12): the largest eleven and `Other topics`; `No topic` takes part in the sizing like any group.
- In `Map.tsx`, the search lights groups by name for these two groupings as it does for Folder (`groupNames` is true for folder, category and topic).
- **Side panel.** For a selected readable note, `DetailRail.tsx` adds a `Topics` row to its facts list under the existing `Topic` row (which is the folder; rename that row's label to `Folder`): the note's topic names, strongest first, each followed by its kind name in the row's existing secondary style, separated as the other rows separate values. No row when the note has none.
- **Fixture.** `fixture.ts` gives the sample payload a `topics` list across at least five kinds, including one name shared by a partner and a vendor, and gives most notes one to three topic ids, some none.
- No new request: all of this is computed from the one payload.

- [ ] **Step 1: Tests first** (`arrange.test.ts`):
  - Category: nodes whose strongest topics are a customer, a vendor and a solution, one with none and one locked give names `["Customers", "Vendors", "Solutions", "No topic"]` in that order whatever their sizes; the strongest topic decides when a note has several; an id missing from `payload.topics` is skipped in favour of the next; a payload with no `topics` key puts every node under `No topic`.
  - Topic: groups come largest first with ties by name; a name shared by two kinds is suffixed for both and not otherwise; with more than twelve topics the result has twelve names ending in `Other topics`; a node with none sits under `No topic`.
  - Both: `grouping()` with an empty payload answers `{ names: [], of: [] }`; `of` has one index per node.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Browser tests** (`web/e2e/map.spec.ts`, dev page `/dev/map`; read how the existing Group by tests choose an entry and read the group list): choosing Category shows the kinds as the filter's groups in kind order with `No topic` last; choosing Topic shows topic names with the shared name suffixed; selecting a note shows its `Topics` row with names and kinds, and a `Folder` row; choosing either makes no request (the existing "sends no request" assertion style); the search lights a group by its name under Category.
- [ ] **Step 4: Verify.** From `web/`: `npx vitest run src/map src/topics src/settings`, `npx tsc --noEmit`, prettier, `npx playwright test e2e/map.spec.ts --project=chromium`. The frame-time specs (`map-perf`, `hub-map-perf`) are not run here; Task 6 runs them.
- [ ] **Step 5: Commit** (when not running beside another task): `feat(map): group by category and by topic, and a note's topics in the side panel`.

---

### Task 5: The vault screen

**Files:**

- Create: `web/src/vault/topicTree.ts`, `web/src/vault/topicTree.test.ts`, `web/src/vault/TopicList.tsx`, `web/src/vault/NoteTopics.tsx`, `web/src/vault/topicText.ts`, `web/src/vault/topicText.test.ts`
- Modify: `web/src/vault/tree.ts` (+ test), `web/src/vault/Vault.tsx`, `web/src/vault/Preview.tsx`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `VaultNote.topics`, `VaultData.topics`, `VaultTopic`, `TopicChange`, `VaultActions.detachTopic`, `VaultActions.addTopic` (Task 3); `KINDS`, `KIND_NAMES`, `MAX_TOPICS_PER_NOTE`.
- Produces: `Scope` gains `{ kind: "topic"; id: string }` and `{ kind: "untopiced" }`; `topicTree(notes: VaultNote[], topics: VaultTopic[]): { kinds: { kind: Kind; name: string; count: number; topics: { id: string; name: string; count: number }[] }[]; none: number }`.

**Behaviour:**

- **`topicTree`.** For the notes of the open tab: each kind that has at least one topic with a note, in `KINDS` order; under it its topics with at least one note, by name; a topic's count is the notes that carry it (any position, not only strongest); a kind's count is the distinct notes carrying any of its topics; `none` is the notes with no topic. Topics with no note in this tab are left out.
- **`notesIn`** (`tree.ts`): scope `topic` keeps the notes whose `topics` include the id; scope `untopiced` keeps the notes with none. The text filter applies on top as for the other scopes.
- **The switch.** Above the left column (workspace tabs only, where the folder column is), a two-button switch in the style of the screen's existing segmented or tab control: **Folders** and **Topics**; client state, default Folders, kept while the tab stays open. Under Topics, `TopicList` shows "All notes", then each kind as a disclosure (closed by default) with its count, opening to its topics with counts, then "No topic" with its count when it is above zero. Choosing a topic, or "No topic", sets the scope; the list's heading names it (the topic's name, or "No topic"). Switching back to Folders with a topic scope chosen returns the scope to All notes. When the hive has no topics, the Topics view shows one sentence saying where topics come from (the same words as `attachText.NO_TOPICS`; import that constant).
- **The open note.** `NoteTopics` sits directly under the "Linked with" section in `Preview.tsx`: a "Topics" heading; each of the note's topics as a chip showing its name and kind name, in the note's order; on one's own note each chip has a Remove button named `Remove <name>`, and, when the note has fewer than five topics and the hive has topics it does not carry, an "Add topic" control: a labelled `<select>` of the remaining topics grouped by kind (`<optgroup>`), and an Add button. Remove acts at once (no question) and the chip leaves; Add adds it. Either refreshes the page's data once on success. A refusal shows one sentence by the control: for `full`, "A note has at most five topics. Remove one first."; otherwise "That didn't work. Try again." Presses while one is running do nothing. Nothing at all is shown for a note with no topics that is not the person's own; on one's own note with no topics, the heading, "No topics yet." and the Add control show (when the hive has topics).
- A topic id on a note that is not in `VaultData.topics` (the list was cut or the read failed) is not drawn.
- Sentences live in `topicText.ts`: the switch's two labels, "All notes", "No topic", the Topics heading, "No topics yet.", "Add topic", "Add", `removeName(name)`, the two refusals, and what is announced after each change (`removed(name)`: "Removed from <name>."; `added(name)`: "Added to <name>.").

- [ ] **Step 1: Unit tests first:** `topicTree.test.ts` (kind order, name order, counts by any position, distinct kind counts, `none`, topics with no note left out, an unknown id ignored); `tree.test.ts` (the two new scopes, with and without the text filter); `topicText.test.ts` (each function and constant).
- [ ] **Step 2: Implement** the pure parts, then the two components and their wiring.
- [ ] **Step 3: Browser tests** (`web/e2e/vault.spec.ts`, dev page `/dev/vault`, using Task 3's fixture):
  - The switch: Folders is pressed at first; Topics shows the kinds in kind order with counts; opening Customers shows its topics; choosing one filters the list to its notes and names it in the heading; "No topic" lists the notes with none; back to Folders shows the tree with All notes chosen; no request is made by any of it.
  - The open note: its chips in order with kind names; Remove takes one away, announces it and records one `detachTopic` call; Add adds one, announces it and records one `addTopic` call; with five topics there is no Add control; a refused Add (`?fail=1`) says so and changes nothing; a colleague's note shows chips with no Remove and no Add.
  - Keyboard: the switch, a kind's disclosure, a topic and the chips' controls are all reached by Tab and worked by Enter or Space; focus after Remove lands on the next chip's Remove, or on the Add control when none is left.
  - At 390 px wide the column and the chips stay inside the window.
- [ ] **Step 4: Verify.** From `web/`: `npx vitest run src/vault src/app/vault`, `npx tsc --noEmit`, prettier, then the whole vault spec twice in a row: `npx playwright test e2e/vault.spec.ts --project=chromium`.
- [ ] **Step 5: Commit:** `feat(vault): browse notes by topic, and remove or add a topic on the open note`.

---

### Task 6: Closure

**Files:**

- Modify: `docs/ui-concept.md`

- [ ] **Step 1: Document.** In `docs/ui-concept.md`: the map's Group by gains Category and Topic (what each ring is, where "No topic" sits, the suffix for a shared name, the side panel's Topics row); the vault's left column switch and the open note's chips with Remove and Add and the limit of five; the Settings paragraph says eight kinds. Prettier.
- [ ] **Step 2: Gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then from `web/` the frame-time specs once: `npx playwright test --project=perf`. All pass.
- [ ] **Step 3: Commit and finish.** `git add docs/ui-concept.md`, commit `docs(ui): topics on the map and in the vault`, then `scripts/finish-task.sh`.
- [ ] **Step 4: The hosted database (Danijel).** `supabase db push`; it must list only `<stamp>_topics_view.sql`. Apply it before the new web build is used: the vault now selects topics with every note.
- [ ] **Step 5: Repair the partner topics on Synapse (once, with Danijel's OK).** After the migration, through the `supabase-dev` MCP, re-file as partners the topics that were saved as customers from partner notes. First show what it would change:

```sql
select e.id, e.canonical_name
  from entities e join hives h on h.id = e.hive_id
 where h.name = 'Synapse' and e.type = 'client'
   and exists (select 1 from notes n
                where n.hive_id = e.hive_id and n.frontmatter->>'type' = 'partner-entity'
                  and lower(regexp_replace(regexp_replace(n.path, '^.*/', ''), '\.md$', '', 'i')) = lower(e.canonical_name))
   and not exists (select 1 from notes n
                    where n.hive_id = e.hive_id and n.frontmatter->>'type' in ('client', 'client-entity')
                      and lower(regexp_replace(regexp_replace(n.path, '^.*/', ''), '\.md$', '', 'i')) = lower(e.canonical_name));
```

Report the list to Danijel; on his OK run the same condition as an `update entities set type = 'partner'` and report the row count. A name that is both a partner note and a customer note stays a customer and is reported, not changed.

- [ ] **Step 6: Live check and hand-over.** Danijel presses Find topics again (the solutions arrive ticked), then Attach topics. Report how many notes have a topic and how many have neither a link nor a topic. Give a numbered "How to test this" covering Settings, the map's two groupings and the vault's switch and chips.
