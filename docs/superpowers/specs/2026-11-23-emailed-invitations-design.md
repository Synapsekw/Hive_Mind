# Emailed invitations — design

Date: 2026-11-23. Follows [invitations](2026-11-23-invitations-design.md) and closes the gaps it
left open (`docs/security.md` §3).

## Goal

The owner invites an address in Settings; the server emails an invitation; the invited person
opens it and presses **Join**. Nobody becomes a member of a hive without pressing Join. After
this ships, "Allow new users to sign up" is switched off on the hosted project, so only invited
addresses can ever get an account.

## Decisions (Danijel, 2026-11-23)

- Mail is sent through the existing Resend account.
- Always ask: every invited person gets the same email and must press Join, whether or not they
  already have an account. The owner is never told whether an address has an account.

## What a person sees

**Owner.** Settings, "Invite a member", email and name as today. The answer is "Invitation sent"
or "Invitation saved, but the email could not be sent. Use Send again." Each open invitation has
**Send again** beside **Revoke**.

**Invited person.** An email from the hive's sending address with one button, "Open invitation".
It opens `/join` on the web app, which shows a **Continue** button (so a mail scanner that
pre-opens the link cannot use it up). Continue signs the person in and lists the invitations
waiting for their address: hive name, who invited them, and **Join**. Join makes them a member
and opens the map. An invitation that is ignored lapses after 14 days. There is no Decline.

A link older than the project's email link lifetime (set to 24 hours) answers "This link has
expired" with the way forward: sign in with "Email me a link" using the invited address, which
leads back to `/join`. For a person who never opened any link and has no confirmed account, the
owner's **Send again** is the way forward.

## Design

### Database (one new migration)

- `invitations` gains `last_emailed_at timestamptz` and `email_count integer not null default 0`.
- `invite_member(p_hive, p_email, p_display_name)` is dropped and recreated to return the
  invitation's `uuid`. It never adds a member. It refuses when the address already belongs to a
  member of the hive ("that person is already a member"), when an invitation is open ("that email
  is already invited"), and when the hive has made 20 invitations in the last 24 hours ("too many
  invitations today").
- `invitation_to_email(p_invitation uuid) returns text`: for the hive's owner, signed in as a
  person, and an invitation that is open and unexpired. Refuses with "wait before sending again"
  when `last_emailed_at` is under 2 minutes old, and with "too many emails for this invitation"
  at `email_count >= 5`. Otherwise stamps both columns and returns the email address. This is the
  only thing the mail function asks the database.
- `my_invitations() returns table (id uuid, hive_name text, invited_by text, expires_at
timestamptz)`: the open, unexpired invitations for the caller's own confirmed email.
- `accept_invitation(p_invitation uuid) returns uuid` (the hive): the caller's confirmed email
  must equal the invitation's; creates the member and its `Main` workspace, marks the invitation
  accepted, writes `member.joined` to the audit log. Someone else's invitation is "invitation not
  found".
- `claim_invitations()` is dropped: nothing joins silently any more.
- `add_member` loses its grant to `authenticated`: it added any account without asking.
- Every new function refuses an agent identity, a self-hosted identity and an app pass
  (`jwt_oauth_client()`), like the existing ones, and is covered by the catalogue test.

### Mail function (`supabase/functions/invite-email`)

`POST { "invitation": "<uuid>" }` with the owner's own session as the bearer. Steps:

1. Call `invitation_to_email` with the caller's bearer. The database decides whether this caller
   may send for this invitation; a refusal is passed on as 403 (or 429 for the two limits).
2. With the project's secret key, ask Supabase Auth for a sign-in link for that address without
   sending anything (`POST /auth/v1/admin/generate_link`, type `invite`; when the address already
   has a confirmed account, type `magiclink`). Only the `hashed_token` and the type are used.
3. Send one email through Resend's API: fixed subject and text, one link
   `<site>/join?token_hash=<hashed_token>&type=<type>`. The email names no hive and no person:
   those are owner-chosen words and would let an owner dress up a phishing mail. The Join page
   shows them after sign-in.
4. Answer `{ "ok": true }`. The answer never says which kind of link was made.

Secrets, function-only: `RESEND_API_KEY`, `HIVE_INVITE_FROM` (for example
`Hive Mind <hive@example.com>`), `HIVE_SITE_URL`, and the secret key (`HIVE_SECRET_KEY`, falling
back to the runtime's `SUPABASE_SERVICE_ROLE_KEY`). Nothing it logs carries an address, a token
or a key. `verify_jwt = false`, as for the other two functions: the database checks the caller.

### Web app

- `/join` (open to visitors in the proxy):
  - with `token_hash` and `type`: the Continue button; its server action calls `verifyOtp` and
    redirects to `/join`; a failure shows the expired-link text.
  - signed in, no token: the list from `my_invitations()`, each with Join
    (`accept_invitation`, then `/`). No invitations: "No invitations are waiting" and a link to
    the map.
  - not signed in, no token: redirect to `/login?next=/join`.
- `/auth/confirm` no longer claims invitations. `/` (the map page), when the person has no hive,
  sends them to `/join` if `my_invitations()` is not empty.
- Settings: `inviteMember` calls `invite_member`, then the mail function; new action
  `resendInvitation(id)`. One new button and changed notice text; nothing else on the screen
  changes (another session is reworking the look).
- Login: the "Invited?" line now reads "Invited? Open the link in your invitation email."

### Docs and runbook

`docs/security.md` §3 rewritten for the new flow, with the gaps it closes; `docs/hosted-db-bringup.md`
gains "Invitation email": Resend domain and key, Supabase SMTP for sign-in links, the function's
secrets, link lifetime 24 hours, and switching sign-ups off.

## Performance and data-fetching budget

- Settings first paint: unchanged (same four bounded queries). Invite: 1 database call plus 1
  function call. Send again: 1 function call. Both refresh only the settings data.
- `/join`: one call, `my_invitations()`, reading `invitations_email_idx` (partial index on
  `email` for open invitations). Join: one call, then a navigation.
- `/` adds one `my_invitations()` call only for a signed-in person with no hive.
- No in-page toggles, no unbounded reads.

## Independent units

Database migration and tests; the mail function and its tests; the Settings change; the `/join`
page with the confirm and proxy changes; docs. They meet only at the function signatures above
and the function's request and answer, so all five can be built at once.

## Testing

- `tests/sharing-rules.test.mjs`: every refusal and every success above, both limits, expiry,
  agents and app passes refused, `add_member` not callable, catalogue test.
- `tests/invite-email.test.mjs`: the function under `node --test` with a stub `fetch`.
- Web unit tests for the writes, the join actions, the proxy and the texts; one browser test of
  the Join page on sample data under `/dev/join`.
- By hand on the hosted project before promotion: invite a fresh address and an existing
  account, join with both; expired link; Send again limits; sign-ups off and an uninvited
  address gets no account.

## Out of scope

Decline; who may start a hive; changing the sign-in email templates; a rate limit by sender IP.
