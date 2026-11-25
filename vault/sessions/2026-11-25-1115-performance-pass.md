---
type: session
date: 2026-11-25-1115
branch: develop
trigger: wrapup
status: complete
tags: [session, performance]
related: ["[[2026-11-25-1110-vault-tidied]]"]
---

# Performance pass: vault, loading screens, idle map

## What changed

- Audit first, measured: `/vault?note=` took 10.1 s on the server (dev trace, compile 284 ms);
  the workspace note index cost about 3.7 s in Postgres on the 1,641-note `Main` (RLS plus four
  per-row sharing columns, each re-running `_can_read_note`, and the `note_entities` embed
  re-checking note RLS per tag). Spec `docs/superpowers/specs/2026-11-25-performance-pass-design.md`,
  plan `docs/superpowers/plans/2026-11-25-performance-pass.md`.
- Unit A (`7289879`): a loading screen on every signed-in route (the map's page moved to
  `app/(map)/` so the root loading screen does not cover `/login`, `/join`, `/oauth/consent`);
  the proxy verifies the session with `getClaims()` (ES256, no auth-server call); the
  memberships read and the server client are `cache()`d per render; loaders use `sessionUserId`.
- Unit C (`e9eabce`): migration `20261125063103_vault_index` — the workspace tab's index in one
  pass, row-for-row equal to the per-row columns (tested), nobody but the owner as a person.
  Applied to the hosted project with `supabase db push`: **79 ms** for 1,641 notes, was ~3.7 s.
- Unit D (`11cec0c`): map decorative motion at 15 fps and stopped after 15 s idle; hub glow from a
  sprite, not `shadowBlur`; hover and zoom keep the dot and edge caches; deferred search; device
  pixel ratio capped at 2, layer at 6 MP; one canvas resize per rail fold.
- Unit B (`ae3fd81`): opening a note is a server action (`openNote`) plus `history.pushState`; the
  list stays in memory, back and forward work, stale answers are dropped; rows memoised with
  `content-visibility: auto`.
- Gates on `develop` at `ae3fd81`: typecheck, build, 323 node tests and 2,239 web tests pass;
  lint flags only two other sessions' untracked `_draft-*.md` files.

## Why

Danijel reported map to vault taking 30 s or more, no loading feedback and a choppy map. The
cost was per-row sharing functions and a full page re-render per note click, not the network.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev:web` (hosted dev project; the migration is already applied).
2. Click Map, then Vault: a loading card shows at once, and the vault arrives in a second or two.
3. Click several notes: the preview changes, the list does not reload, the address gets
   `?note=`; Back and Forward step through them; Cmd-click opens a new tab.
4. On the map, leave Rings untouched for 15 s: the motion stops where it is; move the mouse and
   it resumes. Hover a big hub and zoom with the wheel: no stall.
5. Fold the rail with `[`: the map stretches during the glide and redraws once.

## Open threads

- Not measured in a real browser end to end (the Chrome extension was not connected); time
  map to vault and a note click on the real hive.
- Out of scope, still open: fewer `router.refresh()` calls after Settings changes; `map_graph`
  paging; a `members (user_id)` index; the rail fold still animates `flex-basis`.
- The two `_draft-*.md` files in `vault/sessions/` belong to other sessions and were left alone.
- Not deployed; the site still runs the previous build.

## Next session entry point

Have Danijel time map to vault and note clicks on the real hive, then deploy `develop`.
