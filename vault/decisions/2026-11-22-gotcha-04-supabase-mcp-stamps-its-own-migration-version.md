---
type: adr
date: 2026-11-22
status: open
tags: [gotcha]
related:
  - "[[2026-11-20-decision-06-local-first-on-the-supabase-stack]]"
  - "[[2026-11-22-0923-hosted-db-bringup]]"
---

# Gotcha 04 — The Supabase MCP stamps its own migration version

## Context

The Supabase MCP's `apply_migration` takes a name and SQL but no version. It records the moment it ran as the version (`20261122050658`), not the repo file's stamp (`20261120000001`). A later `supabase db push` compares versions, sees the repo files as unapplied, and tries to run them again on a database that already has the tables.

## Decision

After applying a repo migration through the MCP, re-stamp its row in `supabase_migrations.schema_migrations` to the file's version, and compare a hash of the recorded statements with the file. Prefer `supabase db push` once the CLI is installed; it has no such problem.

## Rationale

The repo's migrations are the source of truth, so the hosted history must name them the way the repo does. The re-stamp only makes the history say what is true.

## Consequences

- Positive: the hosted history matches the repo; `db push` stays usable.
- Negative: one hand edit of the history table per MCP-applied migration. Never use it to hide a difference between the files and the database.
- Open follow-ups: install the Supabase CLI and drop this path.

## Related

- Runbook: `docs/hosted-db-bringup.md`
