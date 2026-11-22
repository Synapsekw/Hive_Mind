---
type: adr
date: 2026-11-22
status: open
tags: [gotcha]
related:
  - "[[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]"
  - "[[2026-11-16-decision-02-sharing-rules-live-in-the-database]]"
---

# Gotcha 06 — Agent sign-in rests on the legacy JWT secret

## Context

The MCP server exchanges the agent token for an identity (`agent_login`), then signs its own HS256 JWT with `SUPABASE_JWT_SECRET` carrying `agent_id`, `workspace_id` and `trust_tier`. On the hosted dev project this works (proved 2026-11-22 by `pnpm test:live`), together with a new-style publishable key as the `apikey`. But the project's current signing key is asymmetric (ES256, per its JWKS); the shared secret is the **legacy** one, which Supabase still honours and which can be revoked in the dashboard.

## Decision

Keep the HS256 sign-in for the local, single-owner phase. Do not revoke the legacy JWT secret on any project the MCP server signs in to. Replace the mechanism before phase 3 (hosting and colleagues).

## Rationale

It works today and phase 1 runs on the owner's machine only. The replacement is a design of its own (a server-side exchange that mints the session), and it is needed anyway: the secret can forge any member's identity, so it must never sit on a colleague's machine.

## Consequences

- Positive: no sign-in work blocks phase 1.
- Negative: revoking the legacy secret, or Supabase retiring it, stops every agent at once. The symptom is `hive_overview` failing with a JWT error while `agent_login` still succeeds.
- Open follow-ups: design the server-side token exchange (an Edge Function or the hosted MCP server holding a signing key) as part of phase 3.

## Related

- `mcp/src/index.ts` (`db()`), `tests/mcp.integration.test.mjs`
