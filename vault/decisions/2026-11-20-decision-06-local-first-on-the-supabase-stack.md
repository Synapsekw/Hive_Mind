---
type: adr
date: 2026-11-20
status: accepted
tags: [decision]
related:
  - "[[2026-11-20-gotcha-01-tests-stub-supabase-auth]]"
---

# Decision 06 — Build local-first, on Supabase's own stack

## Context

Start on hosted Supabase, or locally?

## Decision

Develop against the Supabase CLI's local stack and keep the schema as migration files. Never build on a stand-in database. The sharing-rule tests run the same migrations in PGlite so they need no Docker. A hosted dev project (`tokyttkztrkjvkaksdnh`) was added on 2026-11-21 and receives the same committed migrations.

## Rationale

The sharing rules are the heart of the product and live in Postgres; a stand-in would mean rewriting them. Migration files make going hosted a push, not a port.

## Consequences

- Positive: no cost while building; identical engine everywhere.
- Negative: the build machine needs Docker for the full stack.
- Open follow-ups: the hosted project has no migrations applied yet.
