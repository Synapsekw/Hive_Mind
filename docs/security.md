---
type: spec
status: active
last-updated: 2026-11-22
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

| Threat                              | Example                                                           | Control                                                                                                                                                                                                               | Status   |
| ----------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Private note leaks across members   | A bug or prompt-injected agent reads a colleague's private folder | Row-level security; agents inherit member permissions; no service-role key in the agent path                                                                                                                          | built    |
| Stolen or leaked agent token        | Lost laptop, token pasted in a public repo                        | Tokens hashed at rest, bound to one workspace, revocable per agent, last use recorded                                                                                                                                 | built    |
| Over-sharing by an agent            | Agent writes client material into a shared folder by mistake      | Private by default; agents can never set sharing; writes are versioned. A note an agent writes into a folder its owner shared is shared at once, unreviewed (accepted; the vault says so whenever a folder is shared) | built    |
| Sharing by moving a note            | Agent moves a private note into a shared folder                   | Agents cannot change a note's path, and cannot change, rename or delete a folder record                                                                                                                               | built    |
| A sharing change with no trace      | Someone shares a folder and nobody can tell when or who           | Every sharing change by a person writes one audit row, readable by the hive owner only                                                                                                                                | built    |
| Untrusted self-hosted agent         | Open-source agent with no vendor safety layer                     | Lower trust tier: reads shared notes only, writes are quarantined until the member releases them                                                                                                                      | built    |
| Prompt injection via note content   | A shared note tells agents to exfiltrate data                     | Reads are framed as data; no tool changes sharing, members or tokens; inbound scan and quarantine                                                                                                                     | partly   |
| Departing member                    | Colleague leaves with access                                      | Owner removes member; tokens revoked; content stays or is withdrawn by owner decision                                                                                                                                 | designed |
| Platform compromise                 | Project credentials exposed                                       | Service-role key only in background jobs; secrets in a vault; MFA on the owner account                                                                                                                                | designed |
| Overlap detection as a side channel | Notifications reveal what a colleague works on                    | Notification names only the entity; content never moves before double accept; mute per folder                                                                                                                         | designed |
| The map as a side channel           | Locked dots show that a colleague has notes in a folder           | A stub shows only existence, owner, topic (two folder levels) and last change; refused for agents                                                                                                                     | built    |

## 3. Identity and tokens

- Members sign in to the web app with email magic link or SSO; MFA required for the owner.
- The web app currently signs in with email and password or an emailed link; MFA and SSO are not
  yet built.
- Each agent gets its own token, created by the member, bound to one workspace and one trust tier.
- Tokens are shown once, stored as SHA-256 hashes, and carry an optional expiry.
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

## 5. Data handling

- Notes and files encrypted at rest and in transit (Supabase defaults).
- Storage buckets private; files served by short-lived signed URLs only.
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

- Built: every sharing change by a person writes one row to `audit_log`. That covers a note's or
  a folder's setting, releasing a held note, deleting or renaming a folder that has a rule, and
  moving a note so that a different folder rule applies. A row holds the hive, the person, the
  note id or the folder's path, and the settings before and after; never a note's text, title or
  path. Only the hive owner can read it, and there is no screen for it yet. Writes with no person
  behind them are not recorded.
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
- Agent sign-in currently signs a JWT with the project's secret. What replaces it when hosted?
