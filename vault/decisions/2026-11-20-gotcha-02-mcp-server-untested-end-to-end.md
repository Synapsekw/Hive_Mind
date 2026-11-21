---
type: adr
date: 2026-11-20
status: open
tags: [gotcha]
related:
  - "[[2026-11-20-decision-06-local-first-on-the-supabase-stack]]"
---

# Gotcha 02 — The MCP server has never talked to a live database

## Context

The first slice was built in a cloud session with no Docker daemon and no way to download PostgREST. The MCP server typechecks, but its sign-in was never exercised.

## Decision

First task of phase 1: run it against a real stack. Expect the sign-in to need work: it signs a JWT with `SUPABASE_JWT_SECRET` (HS256), and newer Supabase projects use asymmetric signing keys.

## Rationale

Calling it "done" before that run would be a claim without evidence.

## Consequences

- Options if HS256 is not accepted: a legacy JWT secret if the project still offers one, or an Edge Function that exchanges the agent token for a session.
- Either way the secret must not sit on members' machines once hosted: the token exchange has to move server-side.
