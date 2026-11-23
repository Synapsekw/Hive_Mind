---
type: session
date: 2026-11-23-1517
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-1330-phase-2-promoted-settings-merged]]"
---

# Invitations merged: invite by email, join at first sign-in

## What changed

- **Settings promoted:** PR #3 (`develop` to `main`) merged after Danijel tested the settings
  slice by hand.
- **Invitations merged** into `develop` (`86f36cc`), second slice of Phase 3. Settings → Members
  has **Invite a member**: a person with a confirmed account is added at once, anyone else gets
  an invitation (14 days, revocable) that is honoured when they first sign in with that email.
  The app sends no email. Spec and plan: `2026-11-23-invitations-*`.
- **Migration `20261123105237_invitations`**: table `invitations` (owner-only read) and
  `invite_member`, `revoke_invitation`, `claim_invitations`. Applied to the hosted project
  through the Supabase MCP and re-stamped; anonymous has no access.
- **Joining** is claimed in `/auth/confirm` and on the home page for a person with no hive.
- **From the review:** the app now takes a person's hive from their own oldest membership
  (`web/src/app/own-hive.ts`, used in all eight places), so being added to another hive never
  switches the hive they see. The test stand-in for `auth.users` now leaves a hand-inserted user
  unconfirmed.

## Why

The owner could add only a person who already had an account, and making one meant the Supabase
dashboard. Danijel chose two steps: an invitation honoured at first sign-in now, invitations
emailed by the server (with sign-ups closed again) once hosting exists.

## How to test (for the user)

On `develop`, hosted project, `pnpm dev:web`. First, in the Supabase dashboard under
Authentication, check **"Allow new users to sign up" is on** and **"Confirm email" is on**.

1. Open the map, the vault, the gallery, the inbox and Settings. All load as before (they now
   find your hive a new way; this has not run against the real project yet).
2. Settings → Members → **Invite a member**. Enter the test colleague's email: "That person is
   already a member."
3. Enter an email address you own that has no account, and a name. A notice shows the sign-in
   address with **Copy address**, and the person appears under **Invitations** with "Invited" and
   "Expires" dates.
4. Invite the same email again: "That email is already invited."
5. In a private browser window open the sign-in page, enter that email, choose "Email me a
   link", and click the link in the email. You land in the hive `Synapse` as the invited name,
   with an empty `Main` workspace.
6. Back as the owner, reload Settings: the person is under Members and no longer under
   Invitations.
7. Invite another address and press **Revoke**: it disappears, and signing in with it shows
   "You're not in a hive yet."
8. `/dev/settings` shows the same screen on sample data; `?member=1` as a non-owner (no form, no
   invitations).

## Open threads

- **Accepted gaps while sign-ups are open** (`docs/security.md` §3): nobody consents to being
  added, so a stranger with their own hive can add or invite anyone and learns which emails have
  accounts; a password sign-up for an invited address, confirmed by the invited person, leaves
  the account with the other person's password (unchecked on the hosted project). Both close
  with emailed invitations and sign-ups off.
- A person who already has a hive and signs in with a password does not pick up a waiting
  invitation.
- The new hive lookup embeds `hives` through `members`; no index on `members.user_id`.
- Still open from before: the two link behaviours, the Acme test data, `task/keystone-glass`.

## Next session entry point

After Danijel's by-hand test, promote `develop` to `main`. Then the agent sign-in rework (legacy
JWT secret), the remote MCP connector, and hosting with server-emailed invitations.
