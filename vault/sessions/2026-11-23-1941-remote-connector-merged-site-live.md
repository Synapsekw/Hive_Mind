---
type: session
date: 2026-11-23-1941
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-1823-delete-a-note-merged]]"
  - "[[2026-11-23-1618-agent-sign-in-without-the-legacy-secret]]"
---

# Remote connector merged; the web app is live on Netlify

## What changed

- **Remote connector merged** into `develop` (`990e8b3`), fourth slice of Phase 3. A colleague
  adds `https://hive-mind-synapse.netlify.app/mcp` to Claude or ChatGPT, signs in to Hive Mind
  in the window that opens, picks a workspace and approves. Spec and plan:
  `2026-11-23-remote-connector-*`. **Not yet tried with a real app: the slice is merged but
  incomplete.**
- **Parts:** Supabase Auth's OAuth server (beta) does the handshake; the web app has the
  approval window (`/oauth/consent`), the public `/mcp` address (a forward) and the sign-in
  metadata; the Edge Function `mcp` swaps the app's pass for the usual agent identity and offers
  six tools (`hive_save_file` stays local: it reads the agent's own disk). Tools and signing
  code are now shared (`mcp/src/tools.ts`, `supabase/functions/_shared/identity.ts`).
- **Migration `20261123150712_connected_apps`**, applied to the dev project with
  `supabase db query --linked -f` and recorded: a connected app is an agent with
  `oauth_client_id`; `connect_app`, `connector_login`; the database refuses an app's pass on
  every table, in storage and in every function except `connector_login`, with a catalogue test
  that fails when a later function is unguarded.
- **Hosting:** Netlify site `hive-mind-synapse` in the Synapse-Solutions team, deployed by CLI
  from `develop` (not connected to GitHub yet). Checked from outside: login, redirects, the 401
  with metadata on `/mcp`, the forward to the function, frame headers.
- **From the review:** the trust tier is read by the database from every address the app
  registered, at every call (a program with one non-Claude, non-ChatGPT address is
  `self_hosted`); revoking a connected app also ends its sign-in at Supabase; a token for any
  other audience is refused like an app's; the app cannot be framed; the forward has a timeout
  and size limits.
- **Decided for later:** signed desktop apps for Mac and Windows that wrap the same web app.

## Why

The aim for the first colleague is "connected in two minutes with nothing installed". Danijel
chose the sign-in window over a personal connector address, Netlify over Vercel, and both Claude
and ChatGPT proven by hand before the slice counts as done.

## How to test (for the user)

Site: `https://hive-mind-synapse.netlify.app`. Full steps: `docs/hosted-db-bringup.md`,
"Hosting and the connector".

1. Supabase dashboard, Authentication > OAuth Server: enable it, allow dynamic client
   registration, authorisation path `/oauth/consent`.
2. Authentication > URL Configuration: Site URL `https://hive-mind-synapse.netlify.app`; add
   `https://hive-mind-synapse.netlify.app/**` to the redirect list (keep `http://localhost:3000/**`
   for local work).
3. Open the site and sign in: map, vault, gallery, inbox and settings work as they do locally.
4. Claude (web): Settings > Connectors > Add custom connector, address
   `https://hive-mind-synapse.netlify.app/mcp`. A Hive Mind window opens; sign in, pick `Main`,
   Approve. Ask Claude for the hive overview, then to write a note; see it in the vault.
5. Settings in the web app: the app is in the agents list as a connected app. Revoke it; Claude's
   next call fails.
6. Repeat step 4 in Claude desktop and in ChatGPT (developer mode).

## Open threads

- **Checks before promotion** (runbook section 5): whether an app's pass or ID token is accepted
  by `/rest/v1` or by Supabase Auth's account endpoints; the real format of
  `auth.oauth_clients.redirect_uris`; whether `connector_login`'s consent check matches what
  Supabase writes; whether a person's ordinary token always names the audience `authenticated`
  (if not, people are locked out); revoke then reconnect.
- If Claude or ChatGPT registers any address off the trusted list, it is `self_hosted` and its
  writes are held: one query in the runbook shows it.
- A still-connected app cannot be moved to another workspace without revoking it first;
  `connect_app` takes effect before the approval is confirmed.
- The deployed `agent-session` is the build from before its code moved to `_shared/`.
- The Netlify site is deployed by hand from `develop`; connecting it to GitHub with `main` as
  production is not done. Nothing ran under Deno locally; the deploy and a smoke test did.
- No rate limit on the connector. Still open from before: the two link behaviours, the Acme
  test note, `task/keystone-glass`, the Windows machine's old MCP build.
- A separate session is reworking the look in the worktree `ui-rework`.

## Next session entry point

After Danijel has flipped the switches, run the hand tests and the runbook's section 5 checks
with him, fix what Claude or ChatGPT need differently, then promote. After that: emailed
invitations.
