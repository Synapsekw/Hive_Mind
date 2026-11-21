---
type: plan
status: active
last-updated: 2026-11-21
tags: [project/hive-mind, plan, phase-1]
---

# Phase 1 — Local end to end

**Goal:** one real agent writing into a real hive, with the owner's existing notes imported as the
first workspace. Spec: [master design spec](../specs/2026-11-16-hive-mind-design.md) §7 and §10.

**Done when:** from a Claude session on the build machine, `hive_write` creates a note that a
second, different member cannot read, `hive_search` finds it for its owner, and an existing folder
of markdown notes has been imported and is searchable.

## Tasks

### T1 — Bring the database up and apply the migrations

- Local stack (`pnpm db:start`) and the hosted dev project `tokyttkztrkjvkaksdnh`
  (`supabase db push`, or the `supabase-dev` MCP with the same file names).
- Create a user, call `create_hive` and `create_agent`, keep the token in `.env`.
- **Consumes:** `supabase/migrations/*`. **Produces:** a running database with one hive, one
  member, one agent token.

### T2 — Run the MCP server against the live database and fix what breaks

- `pnpm build`, start `mcp/dist/index.js` with the `.env` values, call all six tools.
- The agent sign-in signs a JWT with the project's secret; this has never run against a real
  stack ([[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]). Newer Supabase projects use
  asymmetric signing keys, so confirm what the hosted project accepts.
- Add an integration test that starts the server and calls each tool, skipped when no database is
  configured.
- **Consumes:** T1. **Produces:** a working `hive` MCP server and `tests/mcp.integration.test.mjs`.

### T3 — Connect the owner's Claude

- Add the server to Claude Code (`.mcp.json` local entry) or Claude Desktop's config.
- Write the project instructions from the template in
  [agent-integration.md](../../agent-integration.md) and use it for a real working session.
- **Consumes:** T2. **Produces:** notes written by a real agent; a list of instruction-template
  fixes.

### T4 — Vault import

- `scripts/import-vault.mjs <folder> <workspace>`: walk a folder of markdown, parse frontmatter,
  upsert notes by path, map folders, keep wiki links as text for the later link job.
- Idempotent: re-running updates changed notes and creates versions, never duplicates.
- Tested against a fixture folder in PGlite.
- **Consumes:** the schema only. **Produces:** the importer and its tests.

### T5 — File storage

- Migration: a private `files` bucket and storage policies that follow the note a file is attached
  to. Sharing-rule tests for upload, read and cross-member denial (needs the local stack; storage
  is not available in PGlite).
- MCP tool `hive_save_file`.
- **Consumes:** T1 for testing. **Produces:** the migration, the tool, tests.

### T6 — Second member proof

- Add a second user to the hive, connect a second token, and confirm on the live database what the
  demo shows in PGlite: private stays private, sharing opens it, the handshake opens two notes.
- **Consumes:** T2. **Produces:** a recorded walkthrough in the session note.

## Execution DAG

```
T1 ──▶ T2 ──▶ T3
        └───▶ T6
T4 (independent)
T1 ──▶ T5
```

- **Batch A (parallel):** T1, T4 — no shared files; T4 needs only the schema.
- **Batch B (parallel, after T1):** T2, T5 — `mcp/` sign-in vs a new migration plus one new tool
  file. T5 touches `mcp/src/index.ts` to register the tool, so land T2 first if both edit it.
- **Batch C (parallel, after T2):** T3, T6.
- **Critical path:** T1 → T2 → T3. T2 is the real risk: it is the first contact with a live stack.

## Performance & data-fetching budget

No UI in this phase. `hive_search` and `hive_overview` are the hot paths: both are bounded
(`limit`), read through the GIN index on `notes.search` or the `updated_at` order, and never
return note bodies in lists.

## Out of scope

The web app, link discovery, embeddings, synthesis, hosting and a remote MCP transport.
