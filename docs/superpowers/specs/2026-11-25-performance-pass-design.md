# Performance pass — design

Date: 2026-11-25. Status: approved in session.

## Problem

Going from the map to the vault takes 30 s or more; no screen shows that anything is happening;
the map stutters. Measured on the dev project (one workspace, 1,641 notes, 4,107 topic rows):

- `/vault?note=…` server render: **10.1 s** (dev trace; compile 284 ms, so not dev mode).
- The note index in Postgres, cumulative: row-level security alone 285 ms; + `note_visibility`
  290 ms; + `note_shared_with` 320 ms; + `note_rule_folder` 650 ms; + `note_access` 1,080 ms;
  the `note_entities` embed 1,060 ms (every topic row re-checks its note through RLS). About
  3.7 s, in two sequential 1,000-row ranges; the sort spills 15 MB to disk because the functions
  take the whole row (body and search vector included).
- Every note click is a link to `?note=`, which re-runs the whole `loadVault` (index included).
- No `loading.tsx` anywhere, so a dynamic route shows nothing until its render is done and
  prefetch has nothing to fetch.
- Before the first query: `proxy.ts` calls `auth.getUser()` (a network call to the auth server)
  on every navigation; the members table is read three times per request (layout, page loader,
  inbox count).
- The map's Rings view never goes idle (a pulse every 700 ms lasting 1,100 ms keeps a ~30 fps
  loop alive); Orbit spins at 60 fps with `shadowBlur` on every hub batch; a hover change throws
  away the dot batches and re-strokes the edge layer; zoom rebuilds the dot batches every wheel
  step; folding the rail resizes the canvas every frame for 300 ms.

## Decisions

- Map motion: **throttle and stop when idle**, keep the look.
- Opening a note: **client fetch plus URL sync**, not a parallel route.
- Sharing stays decided in the database: the new index read is a SQL function with its own
  sharing test, not app logic.

## Units (independent unless stated)

### A — Loading states and the auth path (web)

- `loading.tsx` for `/`, `/vault`, `/gallery`, `/inbox`, `/settings`: the shell's rail and an
  empty card with a quiet pulse (respects `prefers-reduced-motion`). Copy goes through the
  existing text modules (the `no-literals` tests).
- `proxy.ts`: `getClaims()` in place of `getUser()`. The project signs with ES256 (checked:
  `/auth/v1/.well-known/jwks.json`), so the token is verified locally; the session refresh and
  cookie writing are unchanged. The `SESSION_CHANGING` rule stays as it is.
- Loaders drop `getUser()` (settings, gallery, vault) for `sessionUserId` from `own-hive.ts`.
- `ownHive` and `myHives` wrapped in React `cache()`; `loadInboxCount` accepts the hive id the
  page already has.
- Tests: proxy test for the `getClaims` path (valid, missing, expired); loader tests updated to
  no longer expect `auth.getUser`; a render test per `loading.tsx`.

### B — Vault: open a note without reloading the list (web; after C)

- New server action `openNote(id)`: the note's index row, body (cut at `BODY_CAP`) and links,
  read under RLS exactly as `loadVault` reads them today (one shared helper, so the two cannot
  drift). Answers `{ missing: true }` for an unreadable or unknown id.
- `Vault.tsx` holds the open note in client state. A row click calls `openNote`, then
  `history.pushState` to `?note=…`; `popstate` re-opens the note in the address (or closes it).
  A stale answer (an older click resolving after a newer one) is dropped. The preview shows a
  pending state while the fetch runs; a failure says so and keeps the list.
- A full load of `/vault?note=…` still renders on the server, as today.
- Note rows: `memo`'d, `content-visibility: auto` with an intrinsic row height. No windowing
  library.
- Tests: unit tests for the open/sync reducer (order, back/forward, failure, missing); an e2e
  check that opening a note issues no `/vault` document or RSC request.

### C — `vault_index` in one pass (migration + sharing test)

- Minted with `scripts/new-migration.sh vault_index`. `public.vault_index(p_workspace uuid)`
  returns the rows the workspace tab shows, ordered by path, at most 2,001.
- Answers only when `p_workspace` belongs to one of the caller's members; nothing for an agent
  token (`jwt_agent_id()` not null) or a connected app (`jwt_oauth_client()` not null), matching
  today's policies; a forged or foreign workspace id answers nothing.
- Columns: the ones `NOTE_COLUMNS` reads today, plus `topics` as a JSON array of
  `{entity_id, confidence}` for rows not detached. Computed once per call: the caller's member
  ids; per row the nearest folder rule by one lateral join; `effective`, `effective_with`,
  `rule_folder`, `access` from those. For the caller's own workspace every note is the caller's
  own, so `access` is `'own'`.
- `load-vault.ts` uses it for the workspace tab; the shared tab keeps its current query (500
  rows).
- Tests in `tests/sharing-rules.test.mjs`: for the owner, `vault_index` equals the current
  computed columns row for row (fixture with note overrides, nested folder rules and defaults);
  another member, an agent token, a connected app and a forged workspace id get no rows.
- Target: under 300 ms for 1,641 notes on the dev project; measured before merge.

### D — Map rendering (web)

- Ambient scheduler: no new pulse while one runs; decorative frames at most 15 fps; all ambient
  motion (pulses, breathing core, turning hexagon, hub glow, Orbit spin) stops after 15 s
  without input and resumes on pointer, key or wheel input, data change, or view switch.
  `prefers-reduced-motion` behaves as today.
- Hub glow drawn from a pre-made sprite (like `haloSprite`) instead of `shadowBlur`.
- Hover: the dot batches and the edge layer keep their cache keys; hovered dots and their
  edges are drawn on top. The busy dimming is the edge layer drawn at a lower `globalAlpha`.
- Zoom: while moving, keep the last dot batches; rebuild once settled.
- Search: `useDeferredValue` for the query feeding `lit`; DotList labels computed once per model.
- Device pixel ratio capped at 2; layer capped at 6 MP. During a rail fold the canvas keeps its
  bitmap (CSS-stretched) and resizes once on `transitionend`.
- The rail fold animates `transform`/width snap instead of `flex-basis`.
- Tests: scheduler unit tests (no overlap, idle stop, wake on input, fps cap); cache-key tests
  showing hover and zoom do not invalidate the batches.

## Performance and data-fetching budget

- First paint: the same reads as today minus the proxy's auth round-trip and two members reads.
- Opening a note: one server action, three small reads (row + body, links). 0 list reloads.
- Tab, filter, folder, topic toggles in the vault and all map view/filter switches: 0 new
  server round-trips (client state only), as today.
- Hot reads bounded and indexed: `vault_index` by `unique (workspace_id, path)`, limit 2,001;
  folders by workspace; topics paged.

## Execution DAG

- Independent: A, C, D (no shared files).
- B depends on C (both change `load-vault.ts`; B also consumes the `vault_index` row shape).
- Batch 1: A ∥ C ∥ D. Batch 2: B. Critical path: C → B.

## Out of scope

Fewer `router.refresh()` calls after Settings mutations; `map_graph` paging; a
`members (user_id)` index (the table is small; revisit with data).
