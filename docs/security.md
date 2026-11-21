---
type: spec
status: active
last-updated: 2026-11-21
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

| Threat                              | Example                                                           | Control                                                                                           | Status   |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| Private note leaks across members   | A bug or prompt-injected agent reads a colleague's private folder | Row-level security; agents inherit member permissions; no service-role key in the agent path      | built    |
| Stolen or leaked agent token        | Lost laptop, token pasted in a public repo                        | Tokens hashed at rest, bound to one workspace, revocable per agent, last use recorded             | built    |
| Over-sharing by an agent            | Agent writes client material into a shared folder by mistake      | Private by default; agents can never set sharing; writes are versioned                            | built    |
| Untrusted self-hosted agent         | Open-source agent with no vendor safety layer                     | Lower trust tier: reads shared notes only, writes are quarantined until the member releases them  | built    |
| Prompt injection via note content   | A shared note tells agents to exfiltrate data                     | Reads are framed as data; no tool changes sharing, members or tokens; inbound scan and quarantine | partly   |
| Departing member                    | Colleague leaves with access                                      | Owner removes member; tokens revoked; content stays or is withdrawn by owner decision             | designed |
| Platform compromise                 | Project credentials exposed                                       | Service-role key only in background jobs; secrets in a vault; MFA on the owner account            | designed |
| Overlap detection as a side channel | Notifications reveal what a colleague works on                    | Notification names only the entity; content never moves before double accept; mute per folder     | designed |

## 3. Identity and tokens

- Members sign in to the web app with email magic link or SSO; MFA required for the owner.
- Each agent gets its own token, created by the member, bound to one workspace and one trust tier.
- Tokens are shown once, stored as SHA-256 hashes, and carry an optional expiry.
- Revocation takes effect on the next sign-in; the MCP server re-signs in at least hourly.
- Trust tiers: `vendor` (Claude, ChatGPT apps) and `self_hosted` (open-source agents).

## 4. Authorisation

- Effective visibility = note override, else folder rule, else member default.
- RLS policies implement this on every content table. The MCP server acts with the member's own
  identity plus agent claims, never a service key.
- Visibility, membership and tokens are not exposed as MCP tools. They change only in the web app
  by a signed-in person.
- Agents may create inbox proposals (share this note, link these notes); people act on them.

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
