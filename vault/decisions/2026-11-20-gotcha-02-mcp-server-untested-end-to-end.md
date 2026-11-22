---
type: adr
date: 2026-11-20
status: resolved
tags: [gotcha]
related:
  - "[[2026-11-20-decision-06-local-first-on-the-supabase-stack]]"
  - "[[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]]"
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

## Resolution (2026-11-22)

The server ran against the hosted dev project and all six tools work; nothing in `mcp/` needed changing. `pnpm test:live` (`tests/mcp.integration.test.mjs`) repeats the proof. HS256 is accepted because the project still honours its legacy JWT secret; that remaining risk is [[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]]. Still unproven: the local Docker stack.
