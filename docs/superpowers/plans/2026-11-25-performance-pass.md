# Performance pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map to vault in well under 2 s, an instant loading screen on every navigation, a note
opens without reloading the list, and the map is idle when nobody touches it.

**Architecture:** Four units from the spec
(`docs/superpowers/specs/2026-11-25-performance-pass-design.md`): A loading states and the auth
path, B the vault's note open, C a one-pass `vault_index` SQL function, D map rendering. Each
unit is one `task/<name>` worktree (`scripts/start-task.sh`), finished with
`scripts/finish-task.sh`.

**Tech Stack:** Next.js 16 App Router, React 19, `@supabase/ssr` 0.12 / supabase-js 2.119,
Postgres via Supabase (PGlite in tests), vitest, node:test, Playwright.

## Global Constraints

- Sharing is decided in the database; `mcp/` and `web/` add no permission logic. A sharing
  change is a new migration (only via `scripts/new-migration.sh <slug>`) plus a test in
  `tests/sharing-rules.test.mjs`. Never edit a shipped migration.
- No literal UI copy in components: copy goes through the existing text modules (the
  `no-literals.test.ts` files enforce it).
- Gates before finishing: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Commit identity `Danijel Jovanovic <info@synapse-solutions.ai>` (pinned by `start-task.sh`).
  Stage by path only. Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `prefers-reduced-motion`: anything new that moves respects it.
- Read the code you change first; line numbers below are from `develop` @ `df09f02`.

---

## Unit A — `task/perf-loading` (loading states and the auth path)

### Task A1: Loading screens for the five routes

**Files:**

- Create: `web/src/shell/Loading.tsx`, `web/src/shell/loading.module.css`
- Create: `web/src/app/loading.tsx`, `web/src/app/vault/loading.tsx`,
  `web/src/app/gallery/loading.tsx`, `web/src/app/inbox/loading.tsx`,
  `web/src/app/settings/loading.tsx`
- Modify: the shell's text module (find it with `grep -rn "export const" web/src/shell/*Text*`
  or where `Shell.tsx` gets its copy) to add `loadingLabel: "Loading…"`
- Test: `web/src/shell/Loading.test.tsx`

**Interfaces:**

- Produces: `export function Loading({ current }: { current: "map" | "vault" | "gallery" | "inbox" | "settings" })`
  — renders the rail in its folded/unfolded state as the server would, and an empty card with
  `role="status"` and `aria-label` = the loading label. Read `Shell.tsx` and `Notice.tsx`
  first: `Notice` already wraps content in the shell with a `current` prop; reuse its shell
  wrapping rather than a second copy of the rail. If `Shell` needs server data (account,
  hives) that a `loading.tsx` cannot await, render only the card inside the same outer grid so
  the layout does not jump.

- [ ] Step 1: Write `Loading.test.tsx`: renders `<Loading current="vault" />`, asserts an element
      with `role="status"` and the loading label exists; asserts the pulse class is present and
      that `loading.module.css` contains a `@media (prefers-reduced-motion: reduce)` block that
      sets `animation: none` (read the file as text).
- [ ] Step 2: `pnpm --filter @hive-mind/web exec vitest run src/shell/Loading.test.tsx` — FAIL.
- [ ] Step 3: Implement `Loading.tsx` and the CSS (a card with a low-contrast pulse using the
      theme tokens already used by `shell.module.css`). Each `loading.tsx` is
      `export default function L() { return <Loading current="…" />; }`.
- [ ] Step 4: Test passes; `no-literals` tests pass.
- [ ] Step 5: Commit `feat(shell): a loading screen on every route`.

### Task A2: The proxy checks the session locally

**Files:**

- Modify: `web/src/proxy.ts:87-90`
- Test: the existing proxy test (find with `ls web/src/*.test.ts`); create
  `web/src/proxy.test.ts` if none exists, mocking `@supabase/ssr`'s `createServerClient`.

**Interfaces:**

- Consumes: `supabase.auth.getClaims()` → `{ data: { claims } | null, error }`. `claims.sub` is
  the user id.

- [ ] Step 1: Tests: (a) with `getClaims` answering claims, a request to `/vault` passes
      through and `getUser` is never called; (b) with `getClaims` answering `data: null`, `/vault`
      redirects to `/login`; (c) signed in and on `/login?next=/vault` redirects to `/vault`;
      (d) `/join?token_hash=x` with no session passes through.
- [ ] Step 2: Run — (a) fails.
- [ ] Step 3: Replace the `getUser()` block with
      `const { data } = await supabase.auth.getClaims(); const user = data?.claims?.sub ?? null;`
      and update the comment: "Refreshes the session and verifies the token locally against the
      project's signing keys (ES256); no call to the auth server."
- [ ] Step 4: Tests pass.
- [ ] Step 5: Commit `perf(proxy): verify the session locally with getClaims`.

### Task A3: One members read per request, no extra auth calls

**Files:**

- Modify: `web/src/app/own-hive.ts` (wrap `ownHive`, `myHives` in `cache` from `react`)
- Modify: `web/src/app/inbox/load-inbox.ts:136` (`loadInboxCount(db, hiveId?: string)`)
- Modify: `web/src/app/page.tsx`, `web/src/app/vault/page.tsx`, gallery/inbox/settings pages
  that call `loadInboxCount` — pass the hive id when the page already has it
- Modify: `web/src/app/settings/load-settings.ts:220`, `web/src/app/gallery/load-gallery.ts:175`,
  `web/src/app/vault/load-vault.ts` (`db.auth.getUser()` → `sessionUserId(db)` from
  `own-hive.ts`)
- Test: `own-hive.test.ts`, `load-inbox.test.ts`, `load-settings.test.ts`,
  `load-gallery.test.ts`, `load-vault.test.ts`

**Interfaces:**

- Produces: `loadInboxCount(db: Db, hiveId?: string): Promise<number | …>` — unchanged return
  type; when `hiveId` is given it skips `ownHive`.
- Note on `cache()`: React's `cache` memoises by argument identity, per server request. The
  `db` client is created once per page (`createServerSupabase`), but the layout creates its
  own. Key the cache on nothing user-controlled: wrap an inner function that takes the `db`
  and let pages that share a client share the answer. Do not cache across requests.

- [ ] Step 1: Update the loader tests so their fake `db.auth` has no `getUser` (calling it
      throws) and provide the session cookie/claims the way `sessionUserId`'s own tests do.
      Add a `load-inbox` test: with a hive id given, the fake `from("members")` is never called.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: All web tests pass.
- [ ] Step 5: Commit `perf(app): read the hive once per request and skip the auth server`.

---

## Unit C — `task/vault-index` (one-pass note index)

### Task C1: `vault_index` migration and sharing tests

**Files:**

- Create: `supabase/migrations/<stamp>_vault_index.sql` via `scripts/new-migration.sh vault_index`
- Test: `tests/sharing-rules.test.mjs` (new `describe`-style block of `test(...)`s, following
  the file's existing helpers `as`, `person`, `addMember`, `addClient`)

**Interfaces:**

- Produces: `public.vault_index(p_workspace uuid)` returning setof rows with columns
  `id uuid, workspace_id uuid, member_id uuid, path text, title text, updated_at timestamptz,
written_by_agent uuid, visibility public.visibility, shared_with uuid[], quarantined boolean,
effective public.visibility, effective_with uuid[], rule_folder text, access text, topics jsonb`
  (`topics` = `[{entity_id, confidence}]`, detached rows left out, `[]` when none). Check the
  real column types in `supabase/migrations/20261120000001_schema.sql` and match them.

- [ ] Step 1: Tests (fixture: Dani's workspace with notes at `a.md`, `x/b.md`, `x/y/c.md`,
      `z/d.md`; folder rules on `x` (members, [ahmed]) and `x/y` (group); one note override
      private; Dani's default visibility; two topics on one note, one detached):
  - Dani: `select * from vault_index($ws)` equals, row for row by id,
    `select id, note_visibility(n) effective, note_shared_with(n) effective_with, note_rule_folder(n) rule_folder, note_access(n) access from notes n where workspace_id=$ws`,
    and `topics` equals the non-detached `note_entities` rows.
  - Ahmed (same hive) calling with Dani's workspace id: 0 rows.
  - Outsider: 0 rows. A random uuid: 0 rows.
  - An agent token for Dani's workspace (the file's agent-login helper): 0 rows.
  - A connected-app pass (`addClient` / `addConsent` helpers): 0 rows.
  - `anon` cannot execute it.
- [ ] Step 2: `node --test tests/sharing-rules.test.mjs` — FAIL (function missing).
- [ ] Step 3: Write the migration:

```sql
-- The vault's note index for one of the caller's own workspaces, in one pass.
-- Same answers as the per-row columns note_visibility, note_shared_with,
-- note_rule_folder and note_access (tests compare them row for row), but the
-- caller's membership is checked once and each note's folder rule is found by
-- one lateral join, so 2,000 notes cost one scan instead of ~10 function calls
-- each. Only a person's own session: an agent token, a self-hosted agent or a
-- connected app gets no rows (none of them opens the vault).
create function public.vault_index(p_workspace uuid)
returns table (
  id uuid, workspace_id uuid, member_id uuid, path text, title text,
  updated_at timestamptz, written_by_agent uuid, visibility public.visibility,
  shared_with uuid[], quarantined boolean, effective public.visibility,
  effective_with uuid[], rule_folder text, access text, topics jsonb)
language sql stable security definer set search_path = '' as $$
  select n.id, n.workspace_id, n.member_id, n.path, n.title, n.updated_at,
         n.written_by_agent, n.visibility, n.shared_with, n.quarantined,
         coalesce(n.visibility, r.visibility, m.default_visibility),
         case when n.visibility is not null then n.shared_with
              else coalesce(r.shared_with, '{}') end,
         r.path,
         'own',
         coalesce((select jsonb_agg(jsonb_build_object(
                     'entity_id', e.entity_id, 'confidence', e.confidence))
                     from public.note_entities e
                    where e.note_id = n.id and e.detached_at is null), '[]'::jsonb)
    from public.workspaces w
    join public.members m
      on m.id = w.member_id and m.user_id = (select auth.uid())
    join public.notes n
      on n.workspace_id = w.id and n.member_id = m.id
    left join lateral (
      select x.path, x.visibility, x.shared_with
        from public.folders x
       where x.workspace_id = n.workspace_id
         and x.member_id = n.member_id
         and x.visibility is not null
         and left(n.path, length(x.path) + 1) = x.path || '/'
       order by length(x.path) desc
       limit 1) r on true
   where w.id = p_workspace
     and public.jwt_oauth_client() is null
     and public.jwt_agent_id() is null
     and not public.jwt_is_self_hosted()
   order by n.path
   limit 2001
$$;
revoke all on function public.vault_index(uuid) from public, anon;
grant execute on function public.vault_index(uuid) to authenticated;
```

If a test shows a mismatch with `note_folder_rule` (for example the rule lookup has more
conditions in a later migration), read the latest definition
(`grep -n "note_folder_rule" supabase/migrations/*.sql`) and match it exactly.

- [ ] Step 4: `node --test tests/sharing-rules.test.mjs` passes; `pnpm test` passes.
- [ ] Step 5: Commit `feat(db): vault_index answers a workspace's note index in one pass`.

### Task C2: The vault loader reads `vault_index`

**Files:**

- Modify: `web/src/app/vault/load-vault.ts` (`workspaceIndex`, `toNote`/`topicsOf`)
- Test: `web/src/app/vault/load-vault.test.ts`

**Interfaces:**

- Consumes: `db.rpc("vault_index", { p_workspace }).range(from, to)` — the hosted API still
  answers at most 1,000 rows per request, so keep the existing paging loop, now over the RPC.
- Produces: `toNote(r, me, known)` accepts a row with `topics` (array of
  `{entity_id, confidence}`) as well as the old `note_entities` shape. `NOTE_COLUMNS` stays for
  the shared tab and the opened note.

- [ ] Step 1: Update `load-vault.test.ts`: the workspace tab calls `rpc("vault_index")` with the
      tab's workspace id and pages by `range`; a row with `topics` yields `VaultNote.topics` in
      `compareRanked` order; an RPC error answers `{ state: "error" }`; the shared tab still
      uses `from("notes")`.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement. In `topicsOf`, treat `topics` rows like `note_entities` rows with
      `detached_at` null.
- [ ] Step 4: Web tests pass.
- [ ] Step 5: Commit `perf(vault): the note index comes from vault_index`.

### Task C3: Apply and measure

- [ ] Step 1: Apply the migration to the hosted dev project the way the repo does it (read
      `CONTRIBUTING.md` → migrations; never by dashboard). If the repo's process is "applied on
      merge by CI", do the measurement in step 2 after merge instead.
- [ ] Step 2: Measure as the user with the 1,641-note workspace (rolled-back transaction,
      `set local role authenticated`, `request.jwt.claims` with `sub`):
      `explain analyze select * from vault_index('<ws>')`. Target < 300 ms. Record the number
      in the session note.

---

## Unit D — `task/map-idle` (map rendering)

Read first: `web/src/map/MapCanvas.tsx` (loop at ~350-535: `request()`, `fast`, pulses,
`AMBIENT_EVERY`, `PULSE_MS`, `AMBIENT_PULSE_MS`), `web/src/map/renderer.ts` (hub `shadowBlur`
~907-916, dot batch cache ~1160-1170, edge layer ~681-746, `haloSprite`), `web/src/map/useCamera.ts`
(ResizeObserver ~190, `set`/`setVersion` ~94), `web/src/map/Map.tsx` (`setQ` ~569, `lit`
~313-325, `becomeHot` ~388), `web/src/map/DotList.tsx` ~79-95, `web/src/shell/shell.module.css:14`.

### Task D1: Ambient scheduler — no overlap, 15 fps cap, idle stop

**Files:**

- Create: `web/src/map/ambient.ts` (pure scheduling logic)
- Modify: `web/src/map/MapCanvas.tsx` (use it in the loop)
- Test: `web/src/map/ambient.test.ts`

**Interfaces:**

- Produces:

```ts
export const AMBIENT_FPS = 15;
export const IDLE_AFTER_MS = 15_000;
export type AmbientState = { lastInput: number; lastPulseEnd: number };
/** True while decorative motion may run: input within IDLE_AFTER_MS and motion allowed. */
export function ambientAwake(
  s: AmbientState,
  now: number,
  reducedMotion: boolean,
): boolean;
/** True when a new ambient pulse may start: awake and no pulse still in flight. */
export function mayStartPulse(
  s: AmbientState,
  now: number,
  reducedMotion: boolean,
): boolean;
/** Delay to the next frame: 1000/60 while camera or interaction motion runs, 1000/AMBIENT_FPS
 *  while only ambient motion runs, null when nothing runs (the loop stops). */
export function nextFrameDelay(o: {
  moving: boolean;
  interactive: boolean;
  ambient: boolean;
}): number | null;
```

- [ ] Step 1: Tests: `mayStartPulse` false while `now < lastPulseEnd`; `ambientAwake` false
      at `lastInput + IDLE_AFTER_MS + 1`; false when reduced motion; `nextFrameDelay` gives
      `1000/15` for ambient only, `1000/60` when moving, `null` when nothing.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement `ambient.ts`. In `MapCanvas.tsx`: record `lastInput` on pointer, wheel,
      key, data change and view switch (and call `request()` there so the loop wakes); gate
      ambient pulses with `mayStartPulse`; let the renderer's ambient flags (breathing core,
      turning hexagon, level-7 halos, Orbit spin) count only while `ambientAwake`; schedule with
      `nextFrameDelay`. When asleep, draw one final settled frame (spin angle frozen, breathing at
      its rest value) so stopping does not snap visibly.
- [ ] Step 4: Map tests pass; manual check: Rings idle for 15 s → Performance panel shows no
      frames.
- [ ] Step 5: Commit `perf(map): decorative motion at 15 fps, stops after 15 s idle`.

### Task D2: Hub glow from a sprite

**Files:** Modify `web/src/map/renderer.ts` (hub fill ~907-916); Test `web/src/map/renderer.test.ts`
(or the file that tests `haloSprite`).

- [ ] Step 1: Test: drawing hubs makes no assignment to `ctx.shadowBlur` other than 0 (use a
      fake context recording property sets, as existing renderer tests do).
- [ ] Step 2: FAIL. Step 3: pre-render a glow sprite per (colour, radius bucket), like
      `haloSprite`, cached by key; draw it under the hub with `drawImage`; breathing scales its
      alpha. Step 4: pass. Step 5: Commit `perf(map): hub glow from a sprite, not shadowBlur`.

### Task D3: Hover and zoom keep the caches

**Files:** Modify `web/src/map/renderer.ts` (dot batch cache key ~1160-1170, edge layer
~696-746); Test `web/src/map/renderer.test.ts`.

- [ ] Step 1: Tests: building the frame twice with only `hot`/`soft` changed reuses the same
      dot batch object (identity) and does not re-stroke the edge layer (stroke count on the
      layer context unchanged); with `moving: true` and a new scale the batches are reused;
      after `moving: false` they rebuild once.
- [ ] Step 2: FAIL. Step 3: remove `hot`/`soft`/`busy` from the batch and layer keys; draw
      hovered dots and their edges in an overlay pass after the batches; express busy dimming
      as `globalAlpha` on the layer `drawImage`; while moving, skip the `dc.s !== s` rebuild.
      Step 4: pass. Step 5: Commit `perf(map): hover and zoom keep the dot and edge caches`.

### Task D4: Search, DotList, canvas size, rail fold

**Files:** Modify `web/src/map/Map.tsx` (~313-325, ~569), `web/src/map/DotList.tsx` (~79-95),
`web/src/map/MapCanvas.tsx:301` (dpr), `web/src/map/renderer.ts:681` (`LAYER_MAX_PX`),
`web/src/map/useCamera.ts` (~190), `web/src/shell/shell.module.css:14`; Tests alongside.

- [ ] Step 1: Tests: dpr used is `Math.min(devicePixelRatio, 2)`; `LAYER_MAX_PX === 6_000_000`;
      DotList labels come from a per-model memo (render twice with the same model, the label
      builder runs once — inject it or spy on the module function); the resize handler
      ignores sizes while a `data-folding` attribute is set on the shell and measures once on
      `transitionend`.
- [ ] Step 2: FAIL. Step 3: implement: `const dq = useDeferredValue(q)` feeds `lit`; labels
      memoised by model; dpr/layer caps; fold: set `data-folding` on start, clear on
      `transitionend`, the canvas is CSS-stretched meanwhile. Replace `transition: flex-basis`
      with a width snap plus a `transform`/opacity transition on the rail's content. Step 4:
      pass. Step 5: Commit `perf(map): deferred search, capped canvas, one resize per fold`.

---

## Unit B — `task/vault-open` (open a note without reloading; after C merges)

### Task B1: A shared note reader and the `openNote` action

**Files:**

- Modify: `web/src/app/vault/load-vault.ts` (extract
  `export async function readOpenNote(db, noteId, meId, known): Promise<VaultData["open"]>` from
  the `opened` + `noteLinks` code; `loadVault` uses it)
- Modify: `web/src/app/vault/actions.ts` (add `openNote`)
- Test: `web/src/app/vault/load-vault.test.ts`, a new `web/src/app/vault/open-note.test.ts`

**Interfaces:**

- Produces: `export async function openNote(id: string): Promise<{ ok: true; open: VaultData["open"] } | { ok: false }>`
  — a non-uuid id answers `{ ok: true, open: { missing: true } }`; a database error answers
  `{ ok: false }` (logged code and message only). Reads under RLS with the session client like
  every other action in `actions.ts`. Needs `meId` and the topic map: read members (for `me`,
  via `ownHive`'s `memberId`) and topics only as `readOpenNote` needs them; do not re-read the
  index.

- [ ] Step 1: Tests for `readOpenNote` (missing, found with body cut at `BODY_CAP`, links capped
      at 50) and `openNote` (bad id, error, ok).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: pass. Step 5: Commit
      `feat(vault): open a note through a server action`.

### Task B2: Client-side open with the address in sync

**Files:**

- Create: `web/src/vault/openNote.ts` (pure reducer), `web/src/vault/openNote.test.ts`
- Modify: `web/src/vault/Vault.tsx` (open state; `hrefNote` ~394), `web/src/vault/NoteList.tsx`
  (row click), `web/src/vault/Preview.tsx` (pending and failed states; its link rows ~262),
  the vault text module (pending/failed copy)

**Interfaces:**

```ts
export type OpenState = {
  seq: number; // id of the latest request
  wanted: string | null; // note id the address names
  open: VaultData["open"]; // what the preview shows
  pending: boolean;
  failed: boolean;
};
export type OpenEvent =
  | { type: "request"; id: string | null; seq: number }
  | {
      type: "answer";
      seq: number;
      result: { ok: true; open: VaultData["open"] } | { ok: false };
    };
export function reduceOpen(s: OpenState, e: OpenEvent): OpenState;
```

- [ ] Step 1: Reducer tests: an answer with an older `seq` is ignored; `request` with `null`
      closes the preview without pending; a failed answer keeps the previous `open` and sets
      `failed`; a fresh answer clears `pending`/`failed`.
- [ ] Step 2: FAIL. Step 3: implement the reducer; in `Vault.tsx` hold it with `useReducer`,
      seeded from `data.open`. Row links keep their `href` (open in new tab, no-JS) but
      `onClick` (plain left click, no modifier keys) calls `preventDefault`, dispatches
      `request`, `history.pushState(null, "", href)`, then `openNote(id)` → `answer`.
      `popstate` reads `?note=` from `location` and does the same without pushing. Mutations
      that already call `router.refresh()` keep working: when the server's `data.open` changes
      for the same `wanted`, adopt it. Rows memoised with `memo(Row)`; add to the row CSS
      `content-visibility: auto; contain-intrinsic-size: auto 44px;` (measure the real row
      height and use it).
- [ ] Step 4: Tests pass; add a Playwright check in `web/e2e/` (follow the existing vault e2e
      against `/dev/vault`): click a second note, assert the preview title changes, the URL has
      `?note=`, and no request to `/vault` with `_rsc` or a document request was made
      (`page.on("request")`); then `page.goBack()` shows the first note.
- [ ] Step 5: Commit `perf(vault): opening a note keeps the list and fetches only the note`.

---

## Execution DAG

- Dependencies: A1, A2, A3 independent of each other (one worktree, sequential is fine; A3
  touches `load-vault.ts` lightly). C1 → C2 → C3. D1 → D2 → D3 → D4 (same files). B1 → B2;
  B1 depends on C2 (both edit `load-vault.ts`) and on A3 (`sessionUserId` in `load-vault.ts`).
- Parallel batches:
  - Batch 1: Unit A ∥ Unit C ∥ Unit D (three worktrees, three agents).
  - Batch 2: Unit B (after A and C have merged into `develop`).
- Critical path: C1 → C2 → B1 → B2 (D is the longest unit but not on the path to B).

## Performance and data-fetching budget

As in the spec: first paint drops the proxy's auth round-trip and two members reads; opening a
note is one server action; all in-page toggles stay at 0 round-trips; `vault_index` is bounded
(2,001) over `unique (workspace_id, path)`.
