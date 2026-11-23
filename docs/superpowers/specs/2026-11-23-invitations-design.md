---
type: spec
status: active
last-updated: 2026-11-23
tags: [project/hive-mind, spec, ui, security]
---

# Invitations — design

Second slice of Phase 3 (master spec §10), after
[settings for agents and members](2026-11-23-settings-design.md).

## Intent

The owner can add only a person who already has an account, and nothing in the app creates one
on purpose. To bring in a colleague the owner must today create a user in the Supabase
dashboard. This slice lets the owner invite by email from Settings, and lets the invited person
join by signing in with that email.

## Decisions taken with Danijel (2026-11-23)

- **Two steps.** Now: a pending invitation, honoured at the person's first sign-in; the app
  sends no email and holds no new secret. Later, with hosting: the server emails the invitation,
  so sign-ups can be closed again.

Decided in the design (say so if any is wrong):

- **One form.** "Invite a member" replaces "Add a member": a person who already has a confirmed
  account is added at once, anyone else gets a pending invitation.
- **An invitation lasts 14 days** and can be revoked by the owner.
- **Joining needs a confirmed email address.** The invited person proves the address by clicking
  the sign-in link Supabase emails them. An account whose email is not confirmed joins nothing.
- **Only the owner sees invitations**, including the email addresses typed into them.

## Goals, non-goals, anti-goals

- **Goals**
  - Settings → Members: **Invite a member** (email, display name). Outcome "added" or "invited".
  - For the owner, a list of pending invitations: name, email, invited date, expiry, **Revoke**.
  - After "invited": the sign-in address to pass on, with Copy, and what the person must do.
  - On sign-in, a person with a pending invitation for their confirmed email becomes a member
    with a `Main` workspace, with the display name the owner gave.
  - Invite, join and revoke are written to the audit log.
- **Non-goals:** sending email; an invitation link or code; choosing a role (always `member`);
  resending; removing a member; closing sign-ups (comes with the emailed invitation); a sign-up
  page (the existing "Email me a link" is the way in).
- **Anti-goals**
  - Joining a hive by claiming an email address that was not confirmed.
  - An agent inviting, revoking or joining.
  - A service-role key in the web app.
  - Any member but the owner reading invitations.

## Constraints found in the project

- `add_member` exists and stays as it is; the app stops calling it.
- The sign-in page's "Email me a link" calls `signInWithOtp`, which creates the account when the
  project allows sign-ups. `/auth/confirm` completes the link and redirects.
- A signed-in person with no hive sees "You're not in a hive yet." and can call `create_hive`.
- `audit_log` rows are readable by the hive owner only; `action` is free text, `detail` jsonb.
- The database tests stub `auth.users` with `id` and `email` only (`scripts/local-db.mjs`).
- **Two project settings this slice depends on**, both in the Supabase dashboard
  (Authentication): **"Allow new users to sign up" on**, and **"Confirm email" on**. With
  "Confirm email" off, Supabase marks any password sign-up as confirmed without proof, and an
  attacker who knows an invited address could join in that person's place.

## Design

### 1. Database (one migration, `invitations`)

Table `public.invitations`: `id`, `hive_id`, `email` (stored lower-case, at most 254
characters), `display_name` (1 to 60 characters), `invited_by` (member), `created_at`,
`expires_at` (default 14 days ahead), `accepted_at`, `accepted_member`, `revoked_at`.

- At most one pending invitation per hive and email (partial unique index on
  `(hive_id, email)` where not accepted and not revoked), and a partial index on `email` for
  the claim.
- Row-level security: **select for the hive's owner only**, never for an agent. No insert,
  update or delete grant: everything goes through the functions.

Functions (security definer, `search_path = ''`, executable by `authenticated` only):

- `invite_member(p_hive, p_email, p_display_name) returns text` — the hive's owner, not an
  agent. The email is trimmed and lower-cased.
  - Someone with that email is already a member → `that person is already a member`.
  - A confirmed account with that email exists → member row and `Main` workspace now; audit
    `member.added`; returns `added`.
  - Otherwise: expired pending invitations for that email are closed; a live one →
    `that email is already invited`; else a new invitation; audit `member.invited`; returns
    `invited`.
- `revoke_invitation(p_invitation) returns void` — the owner of its hive, not an agent; only a
  pending one (`invitation not found` otherwise); audit `member.invitation_revoked`.
- `claim_invitations() returns integer` — a signed-in person, not an agent. Reads the caller's
  own email from `auth.users` **only when `email_confirmed_at` is set**. For each pending,
  unexpired invitation with that email: creates the member row (display name from the
  invitation) and the `Main` workspace unless the person is already in that hive, marks the
  invitation accepted, audit `member.joined`. Returns how many hives were joined. Safe to call
  any number of times.

Audit `detail` carries the invitation id and the email; only the owner reads the log.

### 2. Joining

`claimIn(db)` calls `claim_invitations` and answers the number joined (0 on any failure, logged
by code and message). It runs in two places:

- `/auth/confirm`, after the link has produced a session and before the redirect.
- The home page, when the person has no hive: claim, and when it joined something, redirect to
  `/` once. This covers a person who signs in with a password, or whose invitation was made
  after their last sign-in.

The sign-in page gains one line: "Invited? Enter the email the invitation was sent to and choose
Email me a link."

### 3. Settings

- **Invite a member** (owner): email and display name, with the line "If they have an account
  they are added now. Otherwise they join when they first sign in with this email."
  - `added` → the member appears; "{name} added."
  - `invited` → the invitation appears under **Invitations**, and a notice stays until
    dismissed: "Invitation saved. Ask {name} to open {address}, enter {email} and choose Email me
    a link." with **Copy address** (the app's own origin plus `/login`).
  - Failures: "That person is already a member.", "That email is already invited.", "That
    didn't work. Try again."
- **Invitations** (owner, shown when there are any): name, email, "Invited {date}", "Expires
  {date}", **Revoke** (one step: a revoked invitation can be made again).
- A member who is not the owner sees neither.

Loading adds one read to the settings page: pending, unexpired invitations of the hive, newest
first, at most 100. For anyone but the owner the database returns none.

### 4. Server actions

- `inviteMember(email, name)` → `{ ok: true, outcome: "added" | "invited" }` or
  `{ ok: false, reason: "already-member" | "already-invited" | "failed" }`. The same checks as
  today's add form, then `invite_member`.
- `revokeInvitation(id)` → `{ ok }`.
- `addMember` is removed from the app with its tests.

### 5. Development page and tests

- `/dev/settings`: two pending invitations in the sample data; `?outcome=added|invited`,
  `?reason=already-member|already-invited` steer the stand-in action.
- **Database tests:** only the owner invites and revokes (not a member, not another hive's
  owner, not an agent); a confirmed account is added at once; an unknown or unconfirmed email
  gets an invitation; a second invitation for the same email is refused, in any letter case;
  an already-member is refused; claim joins with a workspace and the given name; claim does
  nothing for an unconfirmed email, a revoked or an expired invitation, another person's email,
  or an agent; claim twice joins once; an expired invitation can be made again; only the owner
  reads invitations; the three audit entries exist and only the owner reads them.
- **Unit tests:** checks and mapping of the two actions, `claimIn`, the loader's new read.
- **Browser tests** (`/dev/settings`): each outcome and failure; the notice with the address and
  Copy; Revoke removes the invitation; a non-owner sees no form and no invitations.
- **By hand, on the hosted project** (cannot be automated here: it needs a real mailbox): invite
  an address, sign in with it through the emailed link, land in the hive.

## Performance and data-fetching budget

- **Settings first paint:** one more small read (invitations, capped at 100, by the partial
  unique index's `hive_id`), in the same parallel batch.
- **Invite, revoke:** one rpc, then one refresh.
- **Sign-in:** one extra rpc in `/auth/confirm`. **Home page:** one extra rpc only for a person
  with no hive. The claim reads by the partial index on `email`.
- No tabs, filters or sorts.

## Independent units (for the plan)

1. The migration, the auth stub's `email_confirmed_at`, the database tests.
2. The contract change in `web/src/settings/` (types, sentences, sample data).
3. Loading, actions, claiming at sign-in (`web/src/app/`). Needs 2; needs 1 by its written
   answers only.
4. The Members part of the screen, the development page, browser tests. Needs 2.
5. Docs, the hosted database, gates. Needs all.

1 and 2 share no file; 3 and 4 share no file.

## Known gaps (accepted)

- **Sign-ups must be open** on the Supabase project until the emailed invitation exists. A
  stranger can create an account; they see no hive and nothing of anyone's, but can start a hive
  of their own on the project.
- **"Confirm email" must stay on.** Nothing in the app can check the setting; the runbook says
  so.
- The owner learns whether an email has an account ("added" against "invited"), as before.
- The owner must pass the address on themselves; nothing is emailed.
- No invitation link: anyone who controls the invited mailbox joins, which is the point, and
  nobody else can.
- A person invited to two hives joins both at once; the app still shows only the first hive.

Found in review (2026-11-23), accepted until sign-ups are closed; details in
`docs/security.md` §3:

- **No consent to being added.** With open sign-ups a stranger can start a hive and add or
  invite anyone. Fixed in this slice: the app shows the hive of a person's _oldest membership_,
  so a later, unwanted membership never displaces the hive they use. Not fixed: a person with no
  hive lands in the stranger's hive; the stranger learns which emails have accounts.
- **A password sign-up for an invited address**, confirmed by the invited person through the
  "Confirm your signup" email, leaves the account with the other person's password. Unchecked
  on the hosted project.
- A person who already has a hive and signs in with a password does not claim a waiting
  invitation.
- The database messages are mapped by their text, as elsewhere in the app.

## Review focus

- Nobody joins without a confirmed email matching the invitation exactly (after lower-casing).
- Only the owner invites, revokes and reads invitations; agents are refused everywhere.
- `claim_invitations` cannot be used to join a hive one was not invited to, to change a display
  name or role, or twice.
- No permission logic in `web/`.
