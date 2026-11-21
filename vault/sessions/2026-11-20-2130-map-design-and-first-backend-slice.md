---
type: session
date: 2026-11-20-2130
branch: main
trigger: backfill
status: complete
tags: [session]
related:
  - "[[2026-11-20-decision-06-local-first-on-the-supabase-stack]]"
  - "[[2026-11-20-decision-07-brain-dashboard-is-the-map]]"
  - "[[2026-11-20-decision-08-every-row-belongs-to-a-hive]]"
  - "[[2026-11-20-decision-09-embeddings-and-storage-deferred]]"
  - "[[2026-11-20-gotcha-01-tests-stub-supabase-auth]]"
  - "[[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]"
---

# The map design and the first backend slice

Backfilled on 2026-11-21. Covers 2026-11-16 (first UI attempts) to 2026-11-20.

## What changed

- **Map design chosen after five attempts.** Rejected: the entity-level neural map, three per-note
  cluster layouts, a plain force graph. Chosen: the brain dashboard, one dot per note with six
  views ([[2026-11-20-decision-07-brain-dashboard-is-the-map]]). Rails and controls were then
  reworked to be minimal; the chat screen was restyled to match. Exports in `docs/ui/`.
- **Local-first decided** ([[2026-11-20-decision-06-local-first-on-the-supabase-stack]]) and the
  repo `Synapsekw/Hive_Mind` created.
- **First commit `d5565f1`:** schema (14 tables), sharing rules, 10 tests, the MCP server with six
  tools, README.
- **Second commit `3e36849`:** `scripts/demo.mjs` and the shared `scripts/local-db.mjs` helper.
- **Left out on purpose:** embeddings and file storage
  ([[2026-11-20-decision-09-embeddings-and-storage-deferred]]).

## Why

The sharing rules are the product's promise, so they were built and tested first, before any
screen. The demo exists because the cloud session could not run a real stack and something
runnable was needed to show the idea works.

## How to test (for the user)

1. `pnpm install`
2. `pnpm test` — expect 10 passing sharing-rule tests.
3. `pnpm demo` — expect the story to print: each agent finds only its own notes; an agent's attempt
   to share is refused with "agents cannot change sharing"; after Dani shares one note Ahmed's
   agent finds it; a link stays `proposed` after one accept and becomes `accepted` after both, and
   only then do the two private notes appear for each other.

## Open threads

- The MCP server has never run against a live database
  ([[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]).
- The tests stub Supabase auth ([[2026-11-20-gotcha-01-tests-stub-supabase-auth]]).
- UI not built: Inbox, Entities, Vault, Gallery, Settings; the map's fly-to animation.

## Next session entry point

Set the project up for day-to-day building — see [[2026-11-21-1400-project-setup-and-dev-memory]].
