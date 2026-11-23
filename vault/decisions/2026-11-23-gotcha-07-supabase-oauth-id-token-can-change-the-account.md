---
type: adr
date: 2026-11-23
status: open
tags: [gotcha, security]
related:
  - "[[2026-11-23-1941-remote-connector-merged-site-live]]"
  - "[[2026-11-16-decision-02-sharing-rules-live-in-the-database]]"
---

# Gotcha 07 — An app's identity token can change the member's password

## What happens

Supabase Auth's OAuth 2.1 server (beta, tried 2026-11-23 on project `tokyttkztrkjvkaksdnh`) gives
an app two tokens when it asks for the `openid` scope: the access token (our "app pass") and an
OIDC ID token. Supabase refuses the access token at its own account endpoint
(`OAuth client access tokens are not allowed to access this endpoint`). It **accepts the ID
token** there: `PUT /auth/v1/user` with the ID token as the bearer changed user metadata and set
a new password.

Proven on a throwaway account: after the change, password sign-in worked with the new password
and failed with the old one. "Secure password change" was on; it asks for a fresh proof only when
the last sign-in is over a day old, and an app receives its token right after the member signs in
to approve it.

## Why it matters

An app a member approves can sign in as that member, and a person may change sharing, accept
links and delete notes. The database rules of `20261123150712_connected_apps` hold (the ID token
has no `role` and another audience, so the database treats it as nobody), but the takeover goes
around them through the account. Claude asks for every scope the server lists, `openid` included.
With dynamic client registration on, any program can register and ask a member to approve it.

## What we know does not help

- The restrictive policies and `jwt_oauth_client()`: they guard the database, not Supabase Auth.
- "Secure password change" and "secure email change", for the reason above.
- Our approval window: `POST /auth/v1/oauth/authorizations/<id>/consent` can also be called
  directly by anything that holds a member's session.

## What limits it

- Dynamic registration off, with Claude and ChatGPT registered by hand: only those two vendors
  can ever hold such a token.
- The OAuth server off: no such token exists. The connector then needs another way for an app to
  prove itself (a personal connector address carrying an agent token).

## To close this note

Supabase refuses ID tokens at its account endpoints (or stops issuing them to clients we do not
choose), proven again with a throwaway account: the password change must fail. The probe scripts
used are described in `docs/hosted-db-bringup.md`, "Checks before promotion to `main`".
