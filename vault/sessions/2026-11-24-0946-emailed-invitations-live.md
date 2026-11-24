---
type: session
date: 2026-11-24-0946
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-2059-connector-proven-and-promoted]]"
  - "[[2026-11-23-1517-invitations-merged]]"
  - "[[2026-11-24-gotcha-08-backslash-v-is-not-a-postgres-escape]]"
---

# Emailed invitations are live; joining is a button the invited person presses

## What changed

- **Merged to `develop`:** `task/emailed-invitations` (`4d03903`) and `task/invite-password`
  (`7b65a70`). Spec and plan: `docs/superpowers/specs/2026-11-23-emailed-invitations-design.md`,
  `docs/superpowers/plans/2026-11-23-emailed-invitations.md`.
- **Database** (`20261123174149_emailed_invitations`, applied to the hosted project):
  `invite_member` no longer adds anyone; `invitation_to_email`, `my_invitations` and
  `accept_invitation` are new; `claim_invitations` is gone; `add_member` is closed to everyone
  but the server. Caps: 20 invitations a day per hive and per person, 5 emails per invitation,
  2 minutes between two emails.
- **Edge Function `invite-email`** (deployed, mail through Resend): the owner's Settings calls
  it; it mints a one-time link and sends it. Every address gets the same email, and the owner is
  never told whether the address has an account.
- **Web:** `/join` (Continue, then Join), `/join/password` (optional password for a new
  account, Save or Skip), "Send again" in Settings. Continue signs the browser out of any other
  account first and checks afterwards that the signed-in account is the invited one.
- **Found in review:** `\v` in a trim constant cut the letter "v" from emails and names
  ([[2026-11-24-gotcha-08-backslash-v-is-not-a-postgres-escape]]); a pre-registered,
  unconfirmed account could have kept an attacker's password, so the function now resets the
  password before it mints the link.
- Gates at the last merge: 214 database and tooling tests, 1,344 web unit tests, 207 browser
  tests, typecheck, lint and build.

## Why

While sign-ups were open, nobody consented to being added to a hive, and a password sign-up for
an invited address could pre-empt the invited person. With the server sending the invitation
and the person pressing Join, sign-ups can be closed.

## How to test (for the user)

On the live site, `https://hive-mind-synapse.netlify.app`. Danijel ran these on 2026-11-24 and
all passed.

1. Signed in as the owner, Settings → Invite a member → a fresh address. Expect "Invitation
   sent to …".
2. Open the email in the same browser and press "Open invitation". Expect the page to name the
   account that is signed in, with "Sign out and continue" and "Stay signed in as …".
3. Press "Sign out and continue". Expect "Signed in as (the invited address)", the hive's name
   and "Join".
4. Press "Join". Expect "Choose a password". A short one is refused ("Use at least 10
   characters."), two different ones too.
5. Save a proper password. Expect the map. Sign out and sign in with that address and password.
6. With another fresh address, press "Skip for now" instead. Expect the map and no password.

## Open threads

- **Sign-ups are still open.** Left for Danijel in the Supabase dashboard: SMTP through Resend
  for the project's own mails, code length 10 and lifetime 86400, then "Allow new users to sign
  up" off, and one check that an uninvited address gets no account. Steps:
  `docs/hosted-db-bringup.md`, "Invitation email".
- The cause of the "wrong account stays signed in" report is likely, not proven: the site's
  session refresh and the new sign-in writing cookies on one response. Both that path and the
  general case are closed, and the retest passed.
- Accepted gaps (`docs/security.md`): response time can reveal whether an address has an
  account; any account holder can start a hive and invite; `/auth/confirm` still spends a
  sign-in link on a GET; the caps follow columns that are cleared when a member is removed.
- The tracked draft `_draft-2026-11-23-1542.md` was found deleted in the worktree by something
  other than this session and its removal was committed as is.
- Unchanged from before: connect Netlify to GitHub, report gotcha 07, Claude desktop, the
  Windows MCP build and the legacy secret, the two link behaviours, `task/keystone-glass`.

## Next session entry point

Close sign-ups once the dashboard steps are done, then invite the first real colleague. Before
that, decide the two link behaviours.
