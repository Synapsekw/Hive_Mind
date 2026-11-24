---
type: adr
date: 2026-11-24
status: open
tags: [gotcha, security, database]
related:
  - "[[2026-11-24-1459-delete-a-hive-merged]]"
---

# Gotcha 09 — In SQL, a session running as `authenticated` can make itself `service_role`

## What happens

On Supabase every API request connects as `authenticator` and switches to `authenticated`,
`anon` or `service_role`. Postgres checks `SET ROLE` against the **session** user, not the
current role. So a session that is currently `authenticated` can run `set role service_role`
or `set_config('role', 'service_role', false)` and it succeeds. Shown with a probe during the
security review of hive deletion.

## Why it has not bitten

The API gives a caller no way to run `SET` or `set_config`: PostgREST only runs the tables and
functions we expose, and none of ours calls `set_config` with a caller's value or runs dynamic
SQL. A forged `role` claim in a token does not change the database role.

## Rule

- Never write a rule that trusts `current_setting('role')` alone as proof that the server is
  acting. In hive deletion the service role's deletes pass the freeze only inside `purge_hive`,
  which also marks its own transaction; that marker is not a secret either, only a second thing
  a caller cannot set through the API.
- Never expose a function that passes a caller's text to `set_config`, or that runs dynamic SQL
  built from a caller's text. Either one turns into a bypass of every such rule.

## To close this note

Nothing to fix today. Close it if the rules above are ever enforced by a test that lists every
exposed function and fails on `set_config` or `execute`.
