---
type: session
date: 2026-11-22-0923
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-21-local-end-to-end]]"
  - "[[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]"
  - "[[2026-11-22-gotcha-05-finish-task-cannot-remove-the-worktree-the-session-sits-in]]"
---

# Hosted database bring-up (T1, hosted half)

## What changed

- Applied `20261120000001_schema` and `20261120000002_sharing_rules` to the hosted dev project `tokyttkztrkjvkaksdnh` through the `supabase-dev` MCP, then re-stamped the history rows to the repo's versions ([[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]). A whitespace-insensitive hash of what was recorded matches both repo files.
- Danijel created his account in the dashboard. Under that identity (JWT claims set in SQL, not an admin bypass): hive `Synapse`, owner `Danijel`, workspace `Main`, agent `Claude` (provider `claude`, tier `vendor`).
- The agent token is in the main checkout's `.env` as `HIVE_AGENT_TOKEN`. It passed through the agent session once on the way there.
- Verified through the REST API with the anon key: `agent_login` accepts the token and rejects a wrong one; signed-out reads of `hives`, `members`, `workspaces`, `notes` return `[]`; `agents` and `create_hive` are denied.
- Repo (merge `aca7190`, pushed to `develop`): `docs/hosted-db-bringup.md` (runbook), `docs/superpowers/specs/2026-11-22-db-bringup-design.md`, README and docs index updated. No change to `mcp/` or the migrations.
- `/develop` deviations: no separate plan-approval round (the five steps were approved in the design message); `finish-task.sh` merged and pushed but could not remove the worktree, cleaned up by hand ([[2026-11-22-gotcha-05-finish-task-cannot-remove-the-worktree-the-session-sits-in]]).

## Why

Phase 1 needs a live database before anything else can be proven. T2 (the MCP server's first real run) was blocked on a schema, a hive and a token existing somewhere real.

## How to test (for the user)

1. Open the dashboard table editor for `tokyttkztrkjvkaksdnh`: 14 tables, one row each in `hives`, `members`, `workspaces`, `agents`.
2. Dashboard → Database → Migrations: exactly `20261120000001 schema` and `20261120000002 sharing_rules`.
3. From the main checkout, POST `HIVE_AGENT_TOKEN` to `/rest/v1/rpc/agent_login` with the anon key (one-liner in the runbook's verify table): expect `200` and one row with `"trust_tier":"vendor"`.
4. GET `/rest/v1/hives` with only the anon key: expect `200 []`.

## Open threads

- The MCP server has still not run against this database ([[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]). The anon key in `.env` is 46 characters, which looks like a new-style publishable key rather than a legacy JWT; unverified, but T2 should check whether the self-signed HS256 token is accepted alongside it.
- The local Docker stack half of T1 is not done (Docker and the Supabase CLI are not installed).
- The account uses a Gmail address, not the Synapse one. Fine for dev; decide before colleagues are invited.
- `develop` is ahead of `main`; no promotion PR opened.

## Next session entry point

Start T2 of [[2026-11-21-local-end-to-end]]: `pnpm build`, run `mcp/dist/index.js` with the `.env` values against the hosted project, call all six tools and fix the sign-in if it breaks. T4 (vault importer) can run alongside.
