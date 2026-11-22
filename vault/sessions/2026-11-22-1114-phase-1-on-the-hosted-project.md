---
type: session
date: 2026-11-22-1114
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-21-local-end-to-end]]"
  - "[[2026-11-22-0923-hosted-db-bringup]]"
  - "[[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]]"
  - "[[2026-11-22-decision-12-agents-save-files-only-from-the-working-folder]]"
---

# Phase 1 on the hosted project (T2 to T6)

## What changed

- **T2, MCP server live** (`2695a3e`): `tests/mcp.integration.test.mjs` and `pnpm test:live`. All tools worked on the first run; nothing in `mcp/` changed. Sign-in rests on the legacy JWT secret ([[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]]).
- **T3, owner's Claude connected** (`044d2a0`): `hive` registered at user scope with `node --env-file`; instructions only in `E:\Dev\hive-work\CLAUDE.md`. Danijel ran a real session (note, appends, session note, read-back in a fresh session). Template cut to the built tools; one fix from use: facts stated together go in one append.
- **T4, importer** (`ef5d436`): `scripts/import-vault.mjs`, ten tests, `yaml` dev dependency. 25 notes of the DRA vault (`Decisions`, `MOCs`, `Home.md`) imported as the person into a separate `DRA` workspace.
- **finish-task fix** (`ad6bfd0`): installs and rebuilds in the main checkout after a merge (a merged dependency had broken `pnpm import:vault` there) and no longer fails at cleanup.
- **T5, file storage** (`21c10cc`): migration `20261122063919_file_storage`, applied to the hosted project and re-stamped; `hive_save_file`; five rule tests against a stand-in for the storage tables. A trigger closes a hole where a `files` row naming another member's path would have exposed their file. [[2026-11-22-decision-12-agents-save-files-only-from-the-working-folder]].
- **T6, two members** (`a2f2cc3`): `tests/two-members.integration.test.mjs`; test member `Test Colleague` created by SQL (sign-up would have emailed a made-up address), kept as a standing account.

## Why

Phase 1's point was to stop trusting an in-process database with stubbed auth: every claim about the engine is now checked on real Supabase, through the real MCP server, before any UI or colleague depends on it.

## How to test (for the user)

1. In `E:\Dev\Hive_Mind` on `develop`: `pnpm test` (45 pass) and `pnpm test:live` (17 pass, hive left clean).
2. Open Claude Code in `E:\Dev\hive-work`, state a fact about a client, say "that's all for today"; a new session answers from the hive.
3. Ask that session to write a short file and save it to the hive; it appears under Storage → `files` in the Supabase dashboard. Asking it to save a file outside the folder is refused.
4. `pnpm import:vault "<folder>" DRA --include <subfolder> --dry-run` reports what it would create.

Danijel ran these on 2026-11-22 and confirmed each.

## Open threads

- The local Docker stack was never set up; storage rules are tested against a stand-in, and `test:live` does not run in CI.
- About 930 DRA notes and all non-markdown files are not imported; two notes have frontmatter that is not valid YAML (`Knowledge/Products/Flyability Elios 3.md`, `Knowledge/Vendors/Pipe Trekker.md`).
- A decision in the DRA vault is titled "no vault on cloud sync"; Danijel approved the import after it was flagged, contents not reviewed.
- Self-hosted agents cannot save files; an upload whose row is refused leaves an orphan object.
- Process: no separate plan-approval round was held per task, and tests were written with the code rather than seen failing first.
- `develop` is far ahead of `main`; no promotion PR.

## Next session entry point

Start Phase 2 with `/develop` and a UI brief (sign-in and the map on real data); load the design skills and `docs/ui-concept.md` first, and state the data-fetching budget. The hive already has two members and 27 notes to draw.
