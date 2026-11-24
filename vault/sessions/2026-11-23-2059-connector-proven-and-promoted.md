---
type: session
date: 2026-11-23-2059
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-1941-remote-connector-merged-site-live]]"
  - "[[2026-11-23-gotcha-07-supabase-oauth-id-token-can-change-the-account]]"
---

# Connector proven with Claude and ChatGPT, a Supabase flaw found, promoted

## What changed

- **Promoted:** PR #7 (`develop` to `main`, `56ee65c`) after CI passed. `main` now holds the
  remote connector, the sign-in window and the Netlify configuration.
- **Claude and ChatGPT both connected by hand** to `https://hive-mind-synapse.netlify.app/mcp`,
  each through an OAuth client registered by hand in Supabase, both rated `vendor`, both read
  the hive overview.
- **Live checks with a real pass** (a throwaway app on this Mac, tokens kept in memory): the
  pass reads no table, no stored file and is refused by every function except
  `connector_login`; Supabase refuses it at its own account endpoint; revoke in Settings ends
  the agent, the approval and the sign-in.
- **Flaw found in Supabase's OAuth server (beta):** the ID token an app gets with the `openid`
  scope is accepted by `PUT /auth/v1/user`. On a throwaway account an approved app set a new
  password and signed in with it, with "secure password change" on. Recorded as
  [[2026-11-23-gotcha-07-supabase-oauth-id-token-can-change-the-account]].
- **Decision (Danijel, option A):** dynamic client registration is off and stays off; Claude and
  ChatGPT are registered by hand; the two vendors holding such a token is an accepted risk until
  Supabase fixes it. ChatGPT is set to ask for `email` and `offline_access` only, so it gets no
  ID token; Claude asks for every scope.
- Docs: runbook "Connect an app" with both client IDs and ChatGPT's steps; security doc;
  `supabase/config.toml` (`allow_dynamic_registration = false`).

## Why

The spec made promotion wait on one check that could only be made against the real service:
whether what an app receives can touch a person's account. It could, so the way apps register
was narrowed before anything was opened to colleagues.

## How to test (for the user)

On the live site, `https://hive-mind-synapse.netlify.app`.

1. In Claude, ask for the hive overview and ask it to write a note; open the note in the vault.
2. Do the same in ChatGPT with the Hive Mind plugin switched on.
3. In Settings, revoke one of the two agents; that app's next call fails. Remove and re-add its
   connector with the same client ID and approve again; it works again.
4. A colleague's Claude: address plus client ID `c5b56322-1148-4076-bee7-5f918cd44656` under
   Advanced settings. A colleague's ChatGPT: first add their Callback URL to the "GPT" entry
   under Authentication > OAuth Apps (runbook, "Connect an app").

## Open threads

- Report gotcha 07 to Supabase (text is in the session; the gotcha note has the facts). Until
  it is fixed: never switch dynamic registration on.
- Onboarding is the address plus a client ID, not the address alone. ChatGPT also needs each
  colleague's callback address registered by the owner.
- Claude desktop is untried. Two dead agents (the first automatic "Claude", "Hive safety probe
  3") still show as live in Settings; their apps are deleted, so they are cut off.
- The Netlify site is deployed by hand from `develop` and is not connected to GitHub; the Site
  URL in Supabase is this one site.
- The Supabase CLI created a login role when the migration was applied with
  `supabase db query --linked`; `supabase/.temp` in the main checkout links the CLI to the dev
  project.
- Unverified: `connector_login`'s consent check and the tier rule against apps other than these
  two; no rate limit on the connector; the deployed `agent-session` is the older build.
- Still open from before: the two link behaviours, the Acme test note, `task/keystone-glass`,
  the Windows machine's old MCP build. A separate session is reworking the look (`ui-rework`).

## Next session entry point

Server-emailed invitations, so sign-ups can be closed again. Before that, connect the Netlify
site to GitHub with `main` as production, and decide the two link behaviours before the first
colleague joins.
