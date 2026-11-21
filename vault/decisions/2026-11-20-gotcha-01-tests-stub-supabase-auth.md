---
type: adr
date: 2026-11-20
status: accepted
tags: [gotcha]
related:
  - "[[2026-11-20-decision-06-local-first-on-the-supabase-stack]]"
---

# Gotcha 01 — The sharing-rule tests stub Supabase's auth schema

## Context

`pnpm test` runs the real migrations in PGlite, which has no Supabase. `scripts/local-db.mjs` creates the `anon` / `authenticated` / `service_role` roles, an `auth.users` table, and `auth.uid()` / `auth.jwt()` reading `request.jwt.claims`.

## Decision

Treat a green `pnpm test` as proof of the SQL logic only. Anything that depends on real Auth, PostgREST, Storage or Realtime also needs a check against the local stack or the hosted project.

## Rationale

The stub mirrors how Supabase exposes claims, but default privileges, the `extensions` schema and real JWT verification are not reproduced.

## Consequences

- Example of the gap: `agent_login` is callable by `anon` in the tests because of stubbed default privileges; confirm the same on a real project.
