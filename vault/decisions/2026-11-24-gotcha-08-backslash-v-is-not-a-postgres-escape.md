---
type: adr
date: 2026-11-24
status: closed
tags: [gotcha, database]
related:
  - "[[2026-11-24-0946-emailed-invitations-live]]"
  - "[[2026-11-20-gotcha-01-tests-stub-supabase-auth]]"
---

# Gotcha 08 — `\v` is not an escape in Postgres, so trimming it trims the letter "v"

## What happens

Postgres escape strings (`E'...'`) know `\b`, `\f`, `\n`, `\r`, `\t`, octal, `\x` hex and `\u`
unicode. They do not know `\v`. An unknown escape is taken as the character itself, so
`E' \t\n\r\f\v'` is the set "space, tab, newline, return, form feed, **the letter v**".

Three functions used that constant as the character set of `btrim`: `invite_member` (email and
display name), `oauth_client_tier` and `connect_app` (app names and redirect lists). Each
silently removed leading and trailing "v" characters: `victor@example.com` was stored as
`ictor@example.com`, a name "Liv" as "Li".

## Why it was missed

The constant reads as correct to anyone who knows C or JavaScript, and no test used a value
that begins or ends in "v". The security review of the emailed-invitations change found it.

## What we did

Migration `20261123174149_emailed_invitations` writes the vertical tab as `\x0B` and re-creates
all three functions. Tests in `tests/sharing-rules.test.mjs` now invite an address and a name
that begin and end in "v". The hosted data was checked on 2026-11-24: no stored address, name or
app entry had been cut.

## Rule

In SQL, write a vertical tab as `\x0B`, never `\v`. When a function trims or strips a set of
characters, give it a test value made of letters that also appear in the set as written.
