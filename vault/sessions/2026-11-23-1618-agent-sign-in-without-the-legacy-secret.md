---
type: session
date: 2026-11-23-1618
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-1517-invitations-merged]]"
  - "[[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]]"
---

# Agent sign-in without the legacy JWT secret

## What changed

- **Invitations promoted:** PR #4 (`develop` to `main`, `f04c117`) after Danijel tested them by
  hand, including the sign-in-by-email journey.
- **Agent sign-in merged** into `develop` (`5628084`), third slice of Phase 3. The Edge Function
  `agent-session` exchanges an agent token for a one-hour identity signed with an ES256 key of
  our own, imported into the project as a standby signing key. The MCP server calls it
  (`mcp/src/sign-in.ts`); nothing in the repo reads `SUPABASE_JWT_SECRET`. No migration. Spec and
  plan: `2026-11-23-agent-sign-in-*`.
- **The importer signs in as the person** with email and password asked in the terminal, names
  the hive it writes to, and refuses when the person is in more than one.
- **Set up on the dev project:** Danijel ran `scripts/setup-agent-signing.sh`; the function is
  deployed with the secrets `AGENT_SIGNING_JWK` and `HIVE_PUBLISHABLE_KEY`.
- **From the review:** every agent identity carries a `session_id` that matches no session, so
  Supabase Auth refuses it (an agent could otherwise have changed its person's password); the
  function uses the publishable key as its own secret, not the runtime's legacy anon key; only
  a refusal by `agent_login` reads as a bad token; the setup script imports the key before it
  stores it.
- **Live check** (Mac, legacy secret blanked): 8 passed, 0 failed, 8 skipped. Proven: the
  database accepts an identity signed by the standby key, Auth refuses an agent identity, a
  token signed by another key is refused. Gotcha 06 is closed.

## Why

The legacy secret can sign an identity for any member, so it could never sit on a colleague's
machine, and Supabase can retire it. This had to land before the first colleague connects an
agent, and the remote connector will use the same exchange.

## How to test (for the user)

On `develop`. The dev project is already set up.

1. In `~/Dev/hive-work` (Mac), pull and rebuild the MCP server, remove `SUPABASE_JWT_SECRET` from
   its `.env`, and restart Claude Code. Ask the agent for the hive overview: it answers as
   before.
2. Write a note through the agent and open it in the web app's vault: it is there.
3. In Settings, revoke a spare agent and start a server with its token: it stops with "Hive
   sign-in failed: unknown, expired or revoked token".
4. `pnpm import:vault <folder> <workspace> --dry-run`: it asks for your email and password
   (password not shown), prints `Importing into hive "Synapse" as <email>`, and reports what it
   would do.
5. Repeat step 1 on Windows when convenient. Old builds keep working until the legacy secret is
   revoked.

## Open threads

- **Not run live:** the agent's write tools and the importer's real sign-in (the person checks
  skip without `HIVE_PERSON_*`; the two-member suite needs the Windows machine).
- The legacy JWT secret is still valid. Revoke it only when both machines run the new build;
  the function already uses `HIVE_PUBLISHABLE_KEY`.
- The signing key is as powerful as the service-role key; it lives only in the function's
  secrets, which every Edge Function of the project can read.
- Anyone can call the function; there is no lockout or rate limit of our own.
- A revoked agent's identity lasts up to an hour.
- The setup script's key check failed on macOS grep (a repetition above 255) and was fixed
  during the run; it has now run once end to end, on the Mac only.
- Still open from before: the two link behaviours, the Acme test data, `task/keystone-glass`.

## Next session entry point

Promote `develop` to `main` once Danijel has tried the new build with his agent. Then the remote
MCP connector, and hosting with server-emailed invitations.
