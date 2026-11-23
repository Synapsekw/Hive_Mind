---
type: spec
status: active
last-updated: 2026-11-23
tags: [project/hive-mind, security]
---

# Hive Mind — Security & Trust

The platform holds commercially sensitive client material for a small, invited group, written
mostly by AI agents. Security rests on three things: visibility enforced in the database, every
agent acting under a revocable identity, and humans owning every sharing decision.

## 1. What we protect

- Members' private notes and files, including personal and non-group work.
- Shared client and project knowledge (pricing, contacts, bid status) belonging to the group and
  its customers.
- The entity registry and synthesis pages, which concentrate the group's most valuable knowledge.
- Agent tokens, which are the keys to all of the above.

## 2. Threat model

| Threat                               | Example                                                                             | Control                                                                                                                                                                                                                                                         | Status   |
| ------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Private note leaks across members    | A bug or prompt-injected agent reads a colleague's private folder                   | Row-level security; agents inherit member permissions; no service-role key in the agent path                                                                                                                                                                    | built    |
| Stolen or leaked agent token         | Lost laptop, token pasted in a public repo                                          | Tokens hashed at rest, bound to one workspace, revocable per agent, last use recorded                                                                                                                                                                           | built    |
| Over-sharing by an agent             | Agent writes client material into a shared folder by mistake                        | Private by default; agents can never set sharing; writes are versioned. A note an agent writes into a folder its owner shared is shared at once, unreviewed (accepted; the vault says so whenever a folder is shared)                                           | built    |
| Sharing by moving a note             | Agent moves a private note into a shared folder                                     | Agents cannot change a note's path, and cannot change, rename or delete a folder record                                                                                                                                                                         | built    |
| A sharing change with no trace       | Someone shares a folder and nobody can tell when or who                             | A person's changes to a note's own setting or a folder rule, releases of held notes, and moves that change who can read a note write one audit row each, readable by the hive owner only. Not yet recorded: a member's default visibility, and accepting a link | built    |
| A connected app acting as the person | Claude or ChatGPT holds a pass that names the member, and uses it to change sharing | The database refuses an app's pass everywhere except the one function that swaps it for a limited agent identity (section 10)                                                                                                                                   | built    |
| Untrusted self-hosted agent          | Open-source agent with no vendor safety layer                                       | Lower trust tier: reads shared notes only, writes are quarantined until the member releases them                                                                                                                                                                | built    |
| Prompt injection via note content    | A shared note tells agents to exfiltrate data                                       | Reads are framed as data; no tool changes sharing, members or tokens; inbound scan and quarantine                                                                                                                                                               | partly   |
| Departing member                     | Colleague leaves with access                                                        | Owner removes member; tokens revoked; content stays or is withdrawn by owner decision                                                                                                                                                                           | designed |
| Joining a hive unasked or uninvited  | A stranger signs up, or an owner adds a person who never agreed                     | Sign-ups off; an account exists only through an emailed invitation; a person becomes a member only by pressing Join, and only for their own confirmed email (section 3)                                                                                         | built    |
| Platform compromise                  | Project credentials exposed                                                         | Service-role key only in background jobs and the invitation mail function; secrets in a vault; MFA on the owner account                                                                                                                                         | designed |
| Overlap detection as a side channel  | Notifications reveal what a colleague works on                                      | Notification names only the entity; content never moves before double accept; mute per folder                                                                                                                                                                   | designed |
| The map as a side channel            | Locked dots show that a colleague has notes in a folder                             | A stub shows only existence, owner, topic (two folder levels) and last change; refused for agents                                                                                                                                                               | built    |

## 3. Identity and tokens

- Members sign in to the web app with email magic link or SSO; MFA required for the owner.
- The web app currently signs in with email and password or an emailed link; MFA and SSO are not
  yet built.
- Each agent gets its own token, created by the member, bound to one workspace and one trust tier.
- Tokens are shown once, stored as SHA-256 hashes, and carry an optional expiry. In the web app
  the token is shown in one dialog straight after the agent is created and kept nowhere: not in
  a log, a URL, browser storage or the page once the dialog is closed. Setting an expiry is not
  built yet.
- An agent's machine holds its own token and nothing that can sign an identity. The MCP server
  sends the token to the Edge Function `agent-session`, which asks the database who the token
  belongs to (`agent_login`) and answers with an identity that lasts one hour.
- The key that signs those identities is an ES256 key of our own. Its private half lives in one
  place, the function's secrets (`AGENT_SIGNING_JWK`); it is imported into the project as a
  standby signing key so the database accepts what the function signs. It is made by
  `scripts/setup-agent-signing.sh`, which the owner runs in their own terminal and which never
  prints it. It is not in the repo, a `.env`, a browser, a prompt or a log.
- **The signing key is as powerful as the service-role key and the legacy JWT secret.** The
  database accepts whatever role a validly signed token claims, including `service_role`, which
  bypasses every sharing rule. So the key falls under the "server-only" invariant, exactly like
  those two: never in a browser, a prompt, a log line, a commit or a `.env`. The only thing
  that protects it is that it never leaves the function's secrets.
- Function secrets are readable by every Edge Function of the project, not only by
  `agent-session`. Any function deployed to this project can therefore read the key, so a new
  function is reviewed as code that holds it. There are three today: `agent-session`, the
  connector `mcp` (section 10) and `invite-email` (below). The first two sign with it and do
  not log it; `invite-email` does not read it.
- What the function itself can sign is narrow. It writes `role` and `aud` as fixed values
  (`authenticated`), and copies only validated ids from `agent_login`: the member's user id as
  `sub`, `agent_id`, `workspace_id`, and a trust tier that must be one of the two known ones.
  Every identity it makes carries `agent_id`. Nothing in the request is copied into the
  identity, so there is no way to ask it for a person's identity, another agent's or another
  role. It decides nothing about permissions; the database does that with the identity it is
  given.
- Every agent identity carries a `session_id` that matches no session. Supabase Auth looks the
  session up and refuses the identity, so an agent cannot read or change the person's account
  (email, password, sessions) even though the identity names that person as `sub`. A check in
  `pnpm test:live` guards this.
- The function calls `agent_login` with the project's publishable key, which it reads from the
  secret `HIVE_PUBLISHABLE_KEY` (stored by the setup script). The Edge runtime's own
  `SUPABASE_ANON_KEY` is the legacy anon key, which dies with the legacy JWT secret; the
  function falls back to it only where the secret is not set.
- Anyone on the internet can call the function: the caller has no identity yet, so it is
  deployed without JWT verification. What protects it is the agent token, which has 244 random
  bits and is checked against its hash, revocation and expiry at sign-in. It is not checked
  again afterwards: an identity that was issued lasts up to one hour after the agent is
  revoked. There is no lockout and no rate limit beyond what Supabase applies to functions. The
  function never logs the token, the identity or the key.
- The importer (`pnpm import:vault`) signs in as the person, through Supabase Auth, with their
  email and password. It asks for them in the terminal without echoing the password, uses them
  for that one sign-in and stores neither. An agent token cannot be exchanged for a person's
  identity. The `HIVE_PERSON_*` values in `.env` are for the live tests and unattended imports
  only. The live tests need the account behind `HIVE_AGENT_TOKEN`; where that agent belongs to
  the owner, that means the owner's own password in `.env`, so leaving them out (those checks
  then skip) is the safe default.
- The project's legacy JWT secret can still sign an identity for any member until the owner
  revokes it. Nothing in the repo reads it. It may be revoked once two things hold: every
  machine runs a build from after 2026-11-23, and the function is using `HIVE_PUBLISHABLE_KEY`
  (set by the setup script), not the legacy anon key. The legacy API keys must not be disabled
  before that either (see [hosted-db-bringup.md](hosted-db-bringup.md#set-up-agent-sign-in)).
  A third condition comes with invitation email: `invite-email` must have `HIVE_SECRET_KEY`
  set, or it is still using the legacy service-role key and stops sending.
- **Invitations.** The owner invites a person by email in Settings ("Invite a member"). The
  server emails that address an invitation, and the person becomes a member only by pressing
  **Join**. Nobody is added to a hive without that, whether or not they already have an
  account. In order:
  - `invite_member` saves an invitation and returns its id. It never creates a member. It
    refuses an address that already belongs to a member of the hive, an address with an open
    invitation, and an invitation past either daily cap ("too many invitations today"): 20 per
    hive in 24 hours, and 20 per inviting person in 24 hours across all their hives. An
    invitation lasts 14 days and the owner can revoke it. There is no Decline: an
    invitation that is ignored lapses.
  - The web app then calls the Edge Function `invite-email` with the owner's own session. The
    function decides nothing. It asks the database, as the caller, for the address
    (`invitation_to_email`), and the database answers only for the hive's owner, signed in as a
    person, and an invitation that is open and not expired. The same call enforces two limits
    per invitation: one email every 2 minutes ("wait before sending again") and 5 emails in
    all ("too many emails for this invitation"). The time and the count are stamped in that
    call, before any mail goes out, so a send that then fails still counts. The call also
    writes `member.invitation_emailed` to the audit log. **Send again** in Settings goes the
    same way.
  - The function answers 401 when there is no bearer and 503 when one of its secrets is
    missing; it checks its secrets before it calls anything. A refusal by the database is 403,
    the 2-minute wait is 429 and the 5-email limit is 409. A failure at Supabase Auth or Resend
    is 502.
  - With the project's secret key the function asks Supabase Auth for a sign-in link for that
    address, without Auth sending anything, and sends one email through Resend. The email has a
    fixed subject and text and one link, to `/join` on the web app. It names no hive and no
    person: those are words the owner chose, and would let an owner dress up a phishing mail.
    The person sees them on the Join page, after sign-in.
  - Before it mails a first-time (`invite`) link, the function sets a fresh random password on
    the account, which is not yet confirmed, and stores that password nowhere. A password that
    someone else registered for the invited address beforehand stops working at that moment.
    The password of a person whose account is confirmed is never touched.
  - Opening the link shows a **Continue** button and spends nothing, so a mail scanner that
    opens links ahead of the person cannot use the link up. Continue signs the person in.
  - If someone is already signed in on that browser, the Continue screen says so before
    anything happens: who is signed in, that continuing signs this browser out of that account,
    and that the invited address is signed in instead. The button then reads "Sign out and
    continue", and a link "Stay signed in as &lt;email&gt;" leaves the invitation link unused.
    Pressing it reads who is signed in, signs this browser out (this browser only: the
    person's other devices stay signed in, and that one session is ended at the auth server),
    and only then verifies the link, over cookies that hold nothing of the old session. A link
    that turns out to have expired therefore leaves nobody signed in, as the button's label
    says. The server then asks the auth server who is signed in and requires it to be the
    person the link belongs to; if it is anyone else, the browser is signed out again and the
    page says the link has expired. When the account did change, the list that follows says
    so; when the link was for the account already signed in, it says nothing.
  - The proxy does not read or refresh the session on requests that change it themselves:
    Continue's request, `/auth/confirm` and `/auth/signout`. Otherwise two parts of the app
    write the session cookies on one response, and on the host the proxy's cookies come last:
    a person signed in as A who pressed Continue on B's link stayed signed in as A (found by
    hand on the test site, fixed, and pinned by tests).
  - The page then lists the invitations waiting for their address (`my_invitations`: hive name, who
    invited them) with **Join** beside each, and shows "Signed in as &lt;email&gt;" with a
    sign-out link, so a person on a shared computer or with two addresses can see which account
    is about to join. Join is `accept_invitation`: it creates the member
    and its `Main` workspace and marks the invitation accepted.
  - **Optional password, for a new person only.** A person who came in through a first
    invitation link (`invite`, the kind mailed to an address with no confirmed account) is
    offered one more page after Join, `/join/password`: "Choose a password", with **Save
    password** and **Skip for now**. Without it they could only ever sign in by emailed link.
    - It is offered only right after such a link. Continue leaves a cookie (`hm_new`: one
      hour, `HttpOnly`, `SameSite=Lax`, `Secure` in production, sent to `/join` paths only),
      and the page and its action do nothing without it. A sign-in link for an existing
      account removes it. Saving or skipping removes it. The cookie carries no secret and
      grants nothing: a signed-in person can change their own password through the auth
      server in any case.
    - The page is closed to a visitor with no session, is never cached, and sends no referrer.
    - Rules, checked in the browser and again on the server: at least 10 characters, at most
      72 bytes (what the auth server's hash reads), both fields the same. The auth server may
      still refuse a password (too weak or known from a leak, as the project is configured);
      the page then says "That password was not accepted. Try a different one." and never
      shows the auth server's own words.
    - The password is sent once, to the auth server, with the person's own session (never a
      secret key). The app never stores it and never logs it, the form or the auth server's
      answer; a refusal is logged as one fixed phrase with the error's code and status. It is
      never sent back to the page, and the fields are emptied after a refusal.
  - The link lasts as long as the project's email link lifetime, set to 24 hours, and works
    once. After that the page says the link has expired; the person signs in with "Email me a
    link" using the invited address and is led back to `/join`, or the owner uses Send again.
    The invitation itself is not spent by an expired link.
- The database lets a person see and accept only invitations for their own confirmed email,
  matched exactly after lower-casing. Someone else's invitation is "invitation not found". An
  account whose address is not confirmed sees none and joins nothing.
- Only the hive owner can read invitations, including the email addresses in them; an agent
  never can. Inviting, sending, revoking, listing and joining are refused for an agent identity,
  a self-hosted identity and an app's pass.
- The owner is not told whether an address has an account: Settings answers "Invitation sent"
  either way, and neither the database's nor the function's answer says which kind of link was
  made. The owner can still infer it, because the time a send takes differs between the two
  kinds (an accepted gap, below).
- `add_member` can no longer be called by a signed-in person: it added any account to a hive
  without asking. `claim_invitations`, which joined a person silently at sign-in, is gone.
- What the mail function holds. Its secrets are the Resend key (`RESEND_API_KEY`, a key with
  sending access only), the sender (`HIVE_INVITE_FROM`), the web app's address
  (`HIVE_SITE_URL`) and the project's secret key (`HIVE_SECRET_KEY`; without it the function
  uses the Edge runtime's legacy `SUPABASE_SERVICE_ROLE_KEY`). The secret key bypasses every
  sharing rule, so it falls under the "server-only" invariant; the function uses it for one
  call, the sign-in link, and never against the database. They are set in the dashboard, not in
  a `.env`. Nothing the function logs carries an address, a token or a key: a failure is one
  fixed phrase. It is deployed without JWT verification, like the other two functions, because
  the database checks the caller.
- Two Supabase project settings (dashboard → Authentication) belong to this design:
  - **"Allow new users to sign up" off.** Only an invitation can then create an account: the
    function's sign-in link is made with the secret key, which the setting does not stop. A
    stranger's "Email me a link" or password sign-up creates nothing. It is switched off on the
    hosted project only after invitation email has been set up and tested by hand
    ([hosted-db-bringup.md](hosted-db-bringup.md#invitation-email)). Until then a stranger can
    still create an account there and start a hive, and someone who knows an invited address
    can sign up with it and a password before its owner confirms it.
  - **"Confirm email" on.** The database lets only a confirmed email join. With the setting
    off, Supabase treats an account as confirmed without proof. Nothing in the app can check
    either setting.
- What emailed invitations close. The first and the fourth need sign-ups off; the others hold
  as soon as the migration is applied:
  - _A stranger could create an account and start a hive._ No account exists without an
    invitation.
  - _Nobody consented to being added._ An owner can no longer add an account, and an
    invitation does nothing until its addressee presses Join.
  - _The owner learned whether an email had an account._ The answer is now the same for both;
    what remains is the difference in timing, listed below.
  - _A password set before the address was confirmed._ Nobody can sign up with a password, so
    nobody can attach one to an invited address before its owner confirms it. While sign-ups
    are still on, the random password the function sets before mailing covers an account that
    was registered before the invitation email went out, not one registered after it.
  - _A person who signed in with a password did not pick up a waiting invitation._ Joining no
    longer depends on how the person signed in: `/join` lists what is waiting for anyone
    signed in.
- Accepted gaps that remain:
  - **A link in a mailbox signs its holder in**, as any emailed sign-in link does. Whoever can
    read the invited mailbox within the link's 24 hours can sign in as that address and join.
  - **An owner can send mail to addresses of their choosing**: 20 invitations in 24 hours,
    counted per hive and per inviting person across all their hives, and per recipient at most
    5 invitation emails to one address in 24 hours from one person, even by revoking and
    inviting again. The text is fixed, so the mail cannot carry the owner's words, but it
    arrives unasked. There is no limit by IP address, and none across people.
  - **The owner can infer whether an address has an account** from how long a send takes: the
    function does different work for an address with a confirmed account and for one without.
    Its answers are the same.
  - **Inviting disturbs the invited account, without giving access to it.** Inviting an address
    whose account is not yet confirmed replaces that account's password with a random one and
    withdraws its open links. Inviting a confirmed address replaces that person's pending
    sign-in link, so a link they had just asked for stops working. Neither lets the inviter
    sign in or read anything.
  - **The emailed code.** With every link Supabase Auth also issues an email code that is valid
    for the same time, so a 24-hour lifetime gives more time to guess one. Guessing is limited
    by Auth's own per-IP rate limit, and the code length is set to 10, the maximum, which makes
    it impractical ([hosted-db-bringup.md](hosted-db-bringup.md#4-supabase-mail-for-sign-in-links)).
  - **Who may start a hive is not restricted.** Anyone with an account, which now means anyone
    who was invited, can start a hive of their own and invite from it.
  - **An invitation creates an account record.** Making the link for an address that has none
    creates an unconfirmed account at Supabase Auth, before the person has done anything. It
    is in no hive and reads nothing.
  - **There is no Decline**, and the invited person cannot stop an owner inviting them again
    after an invitation lapses or is revoked.
  - **The secret key is in the function's secrets**, readable by every Edge Function of the
    project, like the signing key above. While `HIVE_SECRET_KEY` is not set the function
    depends on the legacy service-role key, so the legacy API keys cannot be disabled.
  - The sign-in emails Supabase Auth sends itself ("Email me a link") keep Supabase's own
    templates.
- Revocation takes effect on the next sign-in; the MCP server re-signs in at least hourly. An
  identity issued before the revocation keeps working until it expires, up to one hour later.
- Trust tiers: `vendor` (Claude, ChatGPT apps) and `self_hosted` (open-source agents).
- An app connected through the sign-in window has no agent token. It is an agent all the same,
  with one workspace and one trust tier, and it is revoked in the same place; see section 10.

## 4. Authorisation

- Effective visibility = note override, else the rule of the nearest folder above the note (by
  path, in the same workspace) that has one, else member default. A folder record without a rule
  is skipped. Folder paths are matched literally and case-sensitively.
- RLS policies implement this on every content table. The MCP server acts with the member's own
  identity plus agent claims, never a service key.
- Visibility, membership and tokens are not exposed as MCP tools. They change only in the web app
  by a signed-in person.
- The vault page saves a sharing decision through a server action that signs in with the
  person's session cookie. It checks the shape of every argument before any query and sends only
  the decision (a note's or folder's visibility and named members, or releasing a held note);
  the database decides whether it is allowed. It never writes a note's text, path or owner.
- Agents may create inbox proposals (share this note, link these notes); people act on them.
- Deleting a note is a person's decision, on their own notes only. The database refuses it for
  any agent identity and for anyone who is not the note's owner; no MCP tool offers it. The
  vault's Delete goes through a server action with the person's session cookie that sends only
  the note's id, and the database decides. This rule is older than the vault's Delete and did
  not change with it.
- `map_graph`, the one call the web app's map reads, is a security-definer function: a
  deliberate, tested exception to "RLS decides". Row-level security does not apply inside it, so
  every read is filtered by hive and decided with `can_read_note`, the test the notes policy uses.
  Tests in `tests/sharing-rules.test.mjs` hold it to that.
- What a member cannot read comes back as a stub. A stub reveals that the item exists, its owner,
  its topic (the first two folder levels of its path) and when it last changed; never its title,
  path, body or links. Someone else's quarantined note is left out entirely.
- `map_graph` is refused for any identity carrying an agent claim, and for a self-hosted claim.
  Only people draw the map.
- Through it, members see colleagues' agents by provider, trust tier and last sign-in, never by
  name. An agent's name is returned only to its own member.
- The inbox is read through `inbox` and `inbox_count`, for people only. About a colleague's note
  on the other side of a proposed link they return what the map returns for a locked dot: the
  owner's name and the note's topic, and the title only when the member may already read the
  note. A link with a held note on either side is left out. The link's own row, with the two
  note ids, was already readable to both owners.

## 5. Data handling

- Notes and files encrypted at rest and in transit (Supabase defaults).
- Storage buckets private; files served by short-lived signed URLs only. The gallery makes each
  link on the server, for the signed-in member, valid for 10 minutes; the database decides which
  files that member may read. A link contains the file's storage path, so it is only ever given
  to someone who may read that file.
- A file's declared type is not trusted. Only images (in an image element) and PDFs (after the
  browser has checked the content is a PDF) are shown in the app; anything else, including HTML
  and SVG, can only be downloaded.
- Full version history on notes. Deleting a note is permanent: the 30-day soft delete of the
  design is not built, so there is no trash and no restore.
- What goes with a deleted note: its history, its links (proposed or accepted) and its topic
  tags. Files attached to it stay in the gallery with no note; a file with no note is readable
  by its owner only, so a file that was shared through the note stops being shared.
- Accepted gaps: there is no undo, so a slip past the confirm loses the note and its history;
  and a colleague whose note was linked to the deleted one loses the link without a notice.
- Region: chosen for the customer material members will load; decide whether any class of
  document must stay in the UAE.
- Export: a member can export their own space as a markdown folder; the owner the whole hive.

## 6. Agent safety rules

- Content read from the hive is treated as data; the MCP server says so on every read and the
  instruction template repeats it.
- Agents write to their own workspace only; cross-member writes are refused by the database.
- Background jobs run with a service role but write only to derived tables, never to members'
  notes.
- Contradictions are flagged, never auto-resolved.

## 7. Audit and monitoring

- Built: these sharing changes by a person each write one row to `audit_log`: a note's own
  setting changed; a held note released; a folder rule set, changed, removed, renamed or deleted;
  a note moved by a person when that changes who can read it. Not yet recorded: a change to a
  member's default visibility, and accepting a link. A row holds the hive, the person, the
  note id or the folder's path, and the settings before and after; never a note's text, title or
  path. Only the hive owner can read it, and there is no screen for it yet. Writes with no person
  behind them are not recorded.
- Built: membership changes write one row each, with the action `member.invited` (the owner
  saved an invitation), `member.joined` (the invited person pressed Join and became a member),
  `member.invitation_emailed` (an invitation email was requested, first send or Send again) or
  `member.invitation_revoked`. The detail holds the email and the invitation or member id.
  `member.added` is no longer written, since nobody is added without joining; rows from before
  stay in the log. `member.invitation_emailed` is written when the database hands the address
  to the mail function, before the mail goes out, so a row does not prove delivery. The
  invitation itself keeps the time of the last one and how many were requested.
- Built: a note deleted by a person writes one row with the action `note.deleted`. It holds the
  note's id, the person, and two counts in the detail: the links removed and the files left
  without a note. Never the note's path, title or body. The row is written in the same
  transaction as the delete, so a refused or failed delete leaves none. Not recorded: a delete
  with no person behind it, and notes that go because their whole hive is deleted.
- Every MCP call logged: agent, member, tool, note, time, result.
- Owner view: reads and writes per agent per day, failed authorisations, token last use.
- Alerts: a burst of reads across many entities by one agent; repeated authorisation failures. A
  breach pauses the token and notifies the member and owner.

## 8. Hosted chat (phase 6)

- Only via Anthropic's "Sign in with Claude" (Agent SDK) and OpenAI's "Sign in with ChatGPT",
  after approval.
- Vendor refresh tokens are never stored in plain text.
- Token-proxy approaches are prohibited by both vendors' terms and are out of scope.

## 9. Open questions

- Do any customer contracts require a security review or specific data residency before their
  material is loaded?
- Should vendor-tier agents also start in quarantine for a new member's first week?
- Does Supabase Auth accept an app's pass on its own account endpoints? To be checked before
  promotion to `main` (section 10).
- When is the legacy JWT secret revoked? Agent sign-in no longer uses it (section 3); it stays
  valid until every machine has switched and the function uses `HIVE_PUBLISHABLE_KEY`.
- Does the `agent-session` function need its own rate limit before colleagues' agents use it?
- Should starting a hive be limited to named people, now that every account comes from an
  invitation?

## 10. The remote connector

A member connects Claude or ChatGPT by pasting `https://<site>/mcp` into the app and approving
it in a Hive Mind window. Setup is in
[hosted-db-bringup.md](hosted-db-bringup.md#hosting-and-the-connector).

**The pass.**

- When a member approves an app, Supabase Auth's OAuth server gives that app a pass (an access
  token, with a refresh token to renew it). The pass says "this is that person, through this
  app": it carries the member's user id and the app's `client_id`.
- The app's vendor holds it, on Anthropic's or OpenAI's servers. It is sent to us with each
  call; the model does not see it. We never store it. The web app's `/mcp` route forwards it to
  the connector function and keeps nothing, and neither the route nor the function logs it.
- The web app holds no secret for this. The signing key stays in the Edge Functions' secrets and
  is not copied to Netlify.

**What the pass can do.**

- One thing: `connector_login`. On every call that function checks three things in the
  database: the app is still registered with Supabase Auth (not deleted), the member's approval
  of it there has not been revoked, and the member has an agent for this app here that is not
  revoked. Then it returns the agent's ids and its trust tier. The connector signs the usual
  one-hour agent identity (the same claims `agent-session` writes, including the `session_id`
  that matches no session) and runs the tool with it. From there on the rules are those of any
  agent: writes only in its workspace, never sharing, accepting a link or deleting.
- **The database refuses the pass everywhere else.** A pass names a person, so without this rule
  an app could do what the person can, including change sharing. Every table in `public`, and
  stored files, has a restrictive policy that fails for an identity carrying `client_id`, and
  every function a signed-in caller may run refuses such a caller, except `connector_login`. A
  test lists those functions from the database's own catalogue, so one added later cannot be
  forgotten.
- **A token made for another audience is refused the same way.** A person's and an agent's
  identity name the audience `authenticated`. An identity whose `aud` is anything else is
  treated as an app's even when it carries no `client_id`: it reads nothing, every function
  refuses it, and `connector_login` has no app to look up for it. This covers a token the
  sign-in hands an app besides the pass (an ID token).
- `my_member_ids`, `my_hive_ids` and `is_hive_owner` can be run by a signed-in identity only,
  no longer by a visitor.
- The connector decides nothing about permissions. It offers six tools; `hive_save_file` stays
  in the local server, since a hosted function cannot read a member's disk.

**Registration and approval.**

- **Dynamic registration is off and must stay off.** Tried live on 2026-11-23: besides the
  pass, Supabase Auth gives an app that asks for the `openid` scope an ID token, and its account
  endpoint accepts that token. On a throwaway account an approved app set a new password and
  signed in as the person, with "secure password change" on. The database rules above hold, but
  a person may change sharing, so this goes around them. Until Supabase fixes it, the only apps
  that exist are the ones the owner registers by hand (Claude and ChatGPT), so only those two
  vendors can hold such a token. That is an accepted risk, decided by Danijel on 2026-11-23, not
  a closed one (gotcha 07 in `vault/decisions/`).
- An app receives an ID token only when it asks for the `openid` scope. ChatGPT lets the person
  choose its scopes, and the runbook has it ask for `email` and `offline_access` only, so no ID
  token is issued to it. Claude asks for every scope and cannot be told otherwise.
- A pass exists only after a signed-in member approves the app in the window, and the pass then
  reaches only what that member approved: one agent in one of their own workspaces.
- Approval is `connect_app`, for a person only. It is refused for an agent identity and for an
  app's pass, and the workspace must be the caller's own. The web app passes two things: the
  app's id, read again on the server from Supabase Auth, and the workspace the member chose.
  The database looks the app up in Supabase Auth's own record of it (`auth.oauth_clients`),
  refuses an id that is not registered or was deleted, and takes the agent's name from there,
  with control characters and the characters that reorder or hide text removed. If it fails,
  nothing is approved. It writes `agent.connected` to the audit log.
- **The trust tier is decided by the database from every address the app registered, and
  checked on every call.** Nothing the web app or the app itself sends takes part. An app is
  `vendor` only when each redirect address in its registration is `https` on a host that
  equals, or is a subdomain of, one of `claude.ai`, `claude.com`, `chatgpt.com`, `openai.com`.
  One address that is anything else makes the whole app `self_hosted`: another host, a host
  that only looks similar (`evil-claude.ai`, `claude.ai.evil.com`), another scheme
  (`http://claude.ai/…`, `evilapp://claude.ai/…`), an address with user info, or one that does
  not parse. So does a registration with no address. A `self_hosted` app reads shared notes
  only and its writes are held for the member's review. The list is fixed in the migration.
  Why every address: a pass does not say which address it was issued through, so an app that
  registered a trusted address and one of its own could be approved through the first and
  collect the pass through the second.
- Note, 2026-11-23: migration `20261123174149` also corrects a whitespace-trimming constant
  that stripped the letter "v" from the ends of invited emails, names, app names and the
  redirect list used to rate an app. Before the fix an invitation to an address beginning or
  ending in "v" was stored wrongly. No hand-registered app was affected.
- `connector_login` works the tier out again each time, so an app whose registration is not
  fully trusted is never `vendor`, however and whenever it was approved. The tier stored on the
  agent is only what Settings shows; it is written at approval and corrected at each call.
- **The app name in the window is self-declared.** A program picks its own name at
  registration and could call itself "Claude". The window shows the host this request returns
  to beside the name, for the member to read. That host is information only: it does not
  decide the tier.
- **A request Supabase Auth approves by itself.** When a member has approved an app before and
  the app asks again, Supabase Auth may answer without showing the window, and the app gets a
  new pass. Nothing is recorded on our side in that case. The new pass can do no more than the
  old one: `connector_login` still needs an agent the member has not revoked, and still works
  out the tier.
- After sign-in the window returns only to a path on our own site, so the `next` address cannot
  send a person elsewhere.
- No page of the site can be shown inside a frame on another site (`frame-ancestors 'none'` and
  `X-Frame-Options: DENY` on every route), so the Approve button cannot be placed under a
  person's click by a page they do not see.

**Disconnecting.** A connected app is an agent in Settings, named after the app, with the
provider `Connected app`. Revoking it there does two things:

1. The agent is revoked in the database. This is what cuts the app off, and it is at once:
   `connector_login` refuses the app's next call, since an identity is made for each call. (An
   identity the connector already made for a call in progress lasts up to one hour, as for any
   agent; the app never holds it.)
2. The web app then asks Supabase Auth to end the app's sign-in for this member (the approval
   is marked revoked, the app's sessions and refresh tokens are removed). This step is best
   effort. If it fails the agent is still revoked and the app is still cut off; a line is
   logged.

**Connecting again.** Revoking is not undone from Settings. To connect the app again the member
removes the connector inside the app (Claude or ChatGPT), adds it again, and approves in the
window. If step 2 above failed, Supabase Auth still holds the old approval and may hand the app
a new pass without showing the window; that pass is refused, because there is no agent for it,
and the member cannot reach the window to connect again until that old approval is removed in
Supabase Auth.

**Open items.**

- **`connect_app` takes effect before the approval is confirmed.** The window records the app
  first and asks Supabase Auth to approve second, so an app is never approved without being
  recorded. If the second step fails, the connected agent stays, in Settings, though no app
  holds a pass for it. Nothing can use it: `connector_login` needs the member's approval at
  Supabase Auth as well. The member can revoke it in Settings or try again.
- **What Supabase Auth stores is assumed, not yet seen.** The tier is read from
  `auth.oauth_clients.redirect_uris`, whose exact text format is not confirmed (the database
  reads a JSON array, or a list separated by commas or white space; anything else gives
  `self_hosted`). `connector_login` reads the member's approval from `auth.oauth_consents`.
  Both are checked against a real sign-in before promotion to `main`
  ([hosted-db-bringup.md](hosted-db-bringup.md#5-checks-before-promotion-to-main)).

- **Supabase Auth's own account endpoints.** The database refuses a pass, but Supabase Auth is a
  separate service. Whether it accepts a pass on its account endpoints (reading the account,
  changing the email or password) has not been checked: it needs a real pass, which exists only
  once the site is hosted. The same goes for the ID token the sign-in hands an app that asks
  for the `openid` scope. It is checked after the merge to `develop` and **before promotion to
  `main`**. If Auth accepts it and that cannot be closed, promotion stops and the owner decides.
- **No rate limit or lockout of our own.** `/mcp` and the function can be called by anyone. A
  call without a valid pass is refused, but nothing counts or slows repeated attempts beyond
  what Netlify and Supabase apply themselves.
- **The OAuth server is a beta feature** of Supabase Auth. Its behaviour may change or differ
  from its documentation.
- The function is deployed without JWT verification, like `agent-session`, and can be reached
  at its own address as well as through the site. It checks the pass itself by handing it to
  `connector_login`, where the database verifies signature and expiry.
