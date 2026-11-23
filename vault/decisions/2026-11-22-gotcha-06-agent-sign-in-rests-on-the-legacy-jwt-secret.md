---
type: adr
date: 2026-11-22
status: closed
closed: 2026-11-23
tags: [gotcha]
related:
  - "[[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]"
  - "[[2026-11-16-decision-02-sharing-rules-live-in-the-database]]"
---

# Gotcha 06 — Agent sign-in rests on the legacy JWT secret

## Closed 2026-11-23

Nothing in the repo reads `SUPABASE_JWT_SECRET` any more. What replaced it:

- **Agents.** The MCP server sends its agent token to the Edge Function `agent-session`. The function asks `agent_login` who the token belongs to and signs a one-hour ES256 identity with a key of our own, held only in the function's secrets (`AGENT_SIGNING_JWK`) and imported into the project as a standby signing key so the database accepts it. An agent's machine holds only `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `HIVE_AGENT_TOKEN`.
- **People.** The importer and the person checks in `pnpm test:live` sign in through Supabase Auth with email and password. An agent token can no longer be turned into a person's identity.
- **Setup.** `scripts/setup-agent-signing.sh <project-ref>`, run once per project by the owner in their own terminal; see `docs/hosted-db-bringup.md`. Design: `docs/superpowers/specs/2026-11-23-agent-sign-in-design.md`.

**When the legacy secret may be revoked.** Only once every machine that runs an agent, the importer or the live tests runs a build from after this change. A build from before it still signs with the secret and stops working the moment the secret is revoked (the symptom below). Revoking is the owner's step in the dashboard and is not done yet; until then the secret can still sign an identity for any member, so it stays off every machine but the owner's and should leave that one's `.env` too.

The sections below are the record of the decision as it stood on 2026-11-22.

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
- `supabase/functions/agent-session/`, `scripts/setup-agent-signing.sh`
