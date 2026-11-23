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

| Threat                              | Example                                                           | Control                                                                                                                                                                                                                                                         | Status   |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Private note leaks across members   | A bug or prompt-injected agent reads a colleague's private folder | Row-level security; agents inherit member permissions; no service-role key in the agent path                                                                                                                                                                    | built    |
| Stolen or leaked agent token        | Lost laptop, token pasted in a public repo                        | Tokens hashed at rest, bound to one workspace, revocable per agent, last use recorded                                                                                                                                                                           | built    |
| Over-sharing by an agent            | Agent writes client material into a shared folder by mistake      | Private by default; agents can never set sharing; writes are versioned. A note an agent writes into a folder its owner shared is shared at once, unreviewed (accepted; the vault says so whenever a folder is shared)                                           | built    |
| Sharing by moving a note            | Agent moves a private note into a shared folder                   | Agents cannot change a note's path, and cannot change, rename or delete a folder record                                                                                                                                                                         | built    |
| A sharing change with no trace      | Someone shares a folder and nobody can tell when or who           | A person's changes to a note's own setting or a folder rule, releases of held notes, and moves that change who can read a note write one audit row each, readable by the hive owner only. Not yet recorded: a member's default visibility, and accepting a link | built    |
| Untrusted self-hosted agent         | Open-source agent with no vendor safety layer                     | Lower trust tier: reads shared notes only, writes are quarantined until the member releases them                                                                                                                                                                | built    |
| Prompt injection via note content   | A shared note tells agents to exfiltrate data                     | Reads are framed as data; no tool changes sharing, members or tokens; inbound scan and quarantine                                                                                                                                                               | partly   |
| Departing member                    | Colleague leaves with access                                      | Owner removes member; tokens revoked; content stays or is withdrawn by owner decision                                                                                                                                                                           | designed |
| Platform compromise                 | Project credentials exposed                                       | Service-role key only in background jobs; secrets in a vault; MFA on the owner account                                                                                                                                                                          | designed |
| Overlap detection as a side channel | Notifications reveal what a colleague works on                    | Notification names only the entity; content never moves before double accept; mute per folder                                                                                                                                                                   | designed |
| The map as a side channel           | Locked dots show that a colleague has notes in a folder           | A stub shows only existence, owner, topic (two folder levels) and last change; refused for agents                                                                                                                                                               | built    |

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
- The function signs only what `agent_login` returned, and always as an agent: every identity
  it makes carries `agent_id`, the workspace and the trust tier from the database. Nothing in
  the request is copied into the identity, so there is no way to ask it for a person's identity
  or for another agent's. It decides nothing about permissions; the database does that with the
  identity it is given.
- Anyone on the internet can call the function: the caller has no identity yet, so it is
  deployed without JWT verification. What protects it is the agent token, which has 244 random
  bits and is checked against its hash, revocation and expiry on every call. There is no
  lockout and no rate limit beyond what Supabase applies to functions. The function never logs
  the token, the identity or the key.
- Accepted: the key itself could sign as any member's agent or as a person. That is why it stays
  in the function's secrets only, and why the function has no input that reaches the claims.
- The importer (`pnpm import:vault`) signs in as the person, through Supabase Auth, with their
  email and password. It asks for them in the terminal without echoing the password, uses them
  for that one sign-in and stores neither. An agent token cannot be exchanged for a person's
  identity. The `HIVE_PERSON_*` values in `.env` are for the live tests and unattended imports
  only, with a test account.
- The project's legacy JWT secret can still sign an identity for any member until the owner
  revokes it. Nothing in the repo reads it; it may be revoked once every machine runs a build
  from after 2026-11-23 (see [hosted-db-bringup.md](hosted-db-bringup.md#set-up-agent-sign-in)).
- The owner invites a person by email in Settings ("Invite a member"). A person with a confirmed
  account is added at once; anyone else gets an invitation that lasts 14 days, can be revoked,
  and is honoured when they first sign in with that email. The app sends no email and there is
  no invitation link or code: whoever controls the invited mailbox joins, and nobody else can.
- Invitations depend on two Supabase project settings (dashboard → Authentication): **"Allow new
  users to sign up" on**, so the invited person's first "Email me a link" can create their
  account, and **"Confirm email" on**. The design rests on the second. With it off, Supabase
  treats a password sign-up as confirmed without proof, so someone who knows an invited address
  could sign up with it and join in that person's place. The database only lets a confirmed
  email join, and matches it to the invitation exactly after lower-casing. Nothing in the app
  can check the setting, so it must stay on.
- Only the hive owner can read invitations, including the email addresses in them; an agent
  never can. Inviting, revoking and joining are refused for any agent identity.
- The owner learns whether an email has an account: the form answers "added" for one that has
  and "invited" for one that has not. Only the owner sees it.
- Accepted gap: sign-ups stay open until invitations are emailed by the server. Until then a
  stranger can create an account on the project. They are in no hive and see nothing of
  anyone's, but can start a hive of their own.
- Accepted gaps that follow from open sign-ups, all closed by emailed invitations with sign-ups
  off (the next step) and not before:
  - **Nobody consents to being added.** A stranger who has started a hive of their own can add
    any confirmed account to it, or leave an invitation for an address that has no account yet.
    They read nothing by doing so. For a person who already has a hive the app keeps showing
    that one (it uses the person's oldest membership); a person with no hive yet would land in
    the stranger's hive at first sign-in. The same call tells the stranger whether an email has
    an account on the project.
  - **A password set before the address was confirmed.** Someone who knows an invited address
    can sign up with it and a password of their choosing. If the invited person then clicks
    that "Confirm your signup" email instead of asking for a sign-in link, the account is
    confirmed with the other person's password and joins. Whether a later sign-in link clears
    such a password depends on the Supabase Auth version and has not been checked on the
    hosted project. Until sign-ups are closed: invite only addresses you have told nobody
    else about, tell the person to use "Email me a link" themselves, and treat an unexpected
    "Confirm your signup" email as a warning.
  - A person who already has a hive and signs in with a password does not pick up a waiting
    invitation; it is honoured the next time they use an emailed link.
- Revocation takes effect on the next sign-in; the MCP server re-signs in at least hourly.
- Trust tiers: `vendor` (Claude, ChatGPT apps) and `self_hosted` (open-source agents).

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
- Full version history on notes; deletions soft for 30 days, then purged.
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
- Built: membership changes write one row each, with the action `member.added` (the owner
  invited a person who had a confirmed account), `member.invited` (an invitation was saved),
  `member.joined` (the invited person signed in and became a member) or
  `member.invitation_revoked`. The detail holds the email and the invitation or member id.
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
- When is the legacy JWT secret revoked? Agent sign-in no longer uses it (section 3); it stays
  valid until every machine has switched.
- Does the `agent-session` function need its own rate limit before colleagues' agents use it?
