---
type: prd
status: active
last-updated: 2026-11-21
tags: [project/hive-mind, prd]
---

# Hive Mind — Product Requirements

Working name; the brand is not decided ("Hive Mind" and "Cortex" are both crowded as trademarks).
Carried over from the planning docs of 2026-11-16 and updated to match decisions made since.
Engineering detail lives in the [master design spec](superpowers/specs/2026-11-16-hive-mind-design.md).

## 1. Purpose and vision

A private, access-controlled platform that connects a small group of people and their AI agents
(Claude, ChatGPT, and any MCP-capable agent) into a shared "hive mind". Each person's agent keeps
writing its own memory (wiki-style notes) and produced materials (decks, documents, binaries), as a
personal agent memory vault works today. The platform links those individual memories into one
connected knowledge graph, with the goal of accumulating enough very specific domain knowledge for
a team's field that the group's agents behave like a single super-expert agent.

The model is a single-person agent memory vault, generalised to many people with explicit sharing
control.

## 2. The problem

Every professional now has an AI agent, and every agent starts from zero. Memory features in Claude
and ChatGPT are personal and locked to one vendor. Team knowledge still lives in people's heads,
chat threads and folders. When a colleague leaves, their context leaves with them. When two people
work the same client, neither knows what the other learned.

## 3. Goals

- Every member's agent reads and writes its own memory and files through the platform, from the
  tools they already use.
- Members keep full control over what is private and what is shared.
- Notes from different members about the same client, project, person or topic are automatically
  discovered and linked, with weighted connection strength.
- A consolidated, agent-maintained synthesis exists per shared entity, so any agent can answer from
  one current view with provenance.
- Access is granted only to explicitly invited people.
- No member pays API usage for ordinary work: the primary path uses their existing Claude or
  ChatGPT subscription.

## 4. Non-goals (v1)

- Replacing the Claude or ChatGPT desktop apps as the main chat workspace.
- Public or open sign-up.
- Real-time collaborative editing of notes.

## 5. Users and roles

- **Super admin** — the platform operator; runs hives, health, cost, security and compliance
  across the service.
- **Owner** — invites members, sets group policy, administers entities for one hive.
- **Member** — a colleague with one or more connected agents; owns a personal memory space.
- **Agent** — a Claude, ChatGPT or other MCP client acting on behalf of a member, with the
  member's permissions and a per-agent token.

First target: small expert teams of five to fifty people whose value is specialised knowledge of
clients, assets and regulations (consultancies, bid teams, engineering practices, specialist sales
teams). User stories per role: [user-stories.md](user-stories.md).

## 6. Core concepts

- **Note** — a markdown document with frontmatter, owned by one member.
- **File** — a binary deliverable (PDF, PPTX, XLSX, image) attached to a note and shared exactly
  like that note.
- **Entity** (shown as "topic" in the UI) — a canonical record for a client, project, person or
  product. The strongest join point across members.
- **Link** — a weighted, typed connection between two notes.
- **Synthesis page** — an agent-maintained consolidated view per shared entity, with citations to
  the source notes and their owners.
- **Visibility** — private, group, or specific members; settable per note, per folder, and as a
  member-wide default.

## 7. Functional requirements

### 7.1 Memory read/write by agents

- Agents connect over an MCP server exposing overview, search, read, write, append, save file and
  propose link.
- Every write lands in the member's own workspace with visibility inherited from the folder.
- Writes are versioned; previous versions are retained.

### 7.2 Sharing control

- Member-wide switch: share everything by default, or private by default (the default).
- Folder-level rule: for example the client-work folder shared with the group, the personal folder
  private.
- Note-level override: private, group, or named members.
- Visibility is enforced in the database, not only in the UI, so a misbehaving agent cannot leak
  private notes.

### 7.3 Automatic link discovery

After each write, a background job extracts entities and compares the note with others. Links are
proposed at four strength tiers:

1. Same canonical entity (strongest).
2. Explicit wiki link from one shared note to another.
3. Topic overlap via shared tags or frontmatter.
4. Semantic similarity above a threshold (weakest).

Each link carries a score that drives the map and agent retrieval order. Entity resolution is
suggestion-first: the system proposes "this looks like your DMT" and the owner confirms.

### 7.4 Overlap notifications and consent handshake

- Overlap can be detected on private notes without exposing their content; the notification names
  only the entity or topic.
- A link goes live only when both sides accept. If either declines, nothing is shared and the
  decliner stays invisible to the other.
- A decline is final: the same two notes cannot be proposed again, from either side.
- Links are bidirectional once accepted. Either owner can end an accepted link with Unlink;
  the two notes cannot be linked again after that.

### 7.5 Synthesis layer

- Per shared entity, an agent job builds and maintains a synthesis page: status, contacts, pricing,
  history, open items. Every fact cites the source note and owner.
- The page is rebuilt when a linked note changes; contradictions between members' notes are
  flagged for a human, never silently merged.
- Agents answer from the synthesis first and drill into source notes only when needed.

### 7.6 Access control

- Invitation-only membership managed by the owner.
- One token per agent, bound to one workspace and one trust tier, revocable individually.
- Full audit log of reads and writes per agent.
- A removed member's shared content stays by default; the owner can withdraw it as an exception.

### 7.7 Subscription-based access (mandatory)

- Members must not pay API usage for ordinary work.
- Primary path: the member's own Claude or ChatGPT app connects to the platform over MCP, so model
  usage runs on their existing subscription.
- Secondary path (hosted chat in the web UI): only through the official programmes — Anthropic's
  Agent SDK "Sign in with Claude" and OpenAI's "Sign in with ChatGPT". Both need the app to be
  approved and both draw on a side allowance, not the main chat limits. Token-proxy approaches are
  out of scope.
- Platform-paid API usage is limited to background jobs.

### 7.8 Housekeeper agent

A platform-level agent, independent of any member, keeps the memory structurally healthy. It
maintains structure, never content.

- Runs on a schedule and after bursts of writes, as ordinary code that calls a model API only when
  it needs judgement. No hosted model, no GPU.
- Fixes directly and logs: broken links to renamed paths, missing or inconsistent frontmatter,
  stale embeddings, dangling file references.
- Proposes via the inbox, never applies: entity merges, contradiction resolutions, archiving stale
  or orphan notes.
- Never edits a note body or a file. Produces a weekly health report per hive.

### 7.9 Super admin

Tenancy (create, suspend, delete hives), platform health, cost and usage per hive, security
operations (global token revocation, freeze a hive), configuration and compliance. No routine read
access to member content: support access is break-glass only, time-limited, with the reason
recorded and visible to the hive owner afterwards.

## 8. Non-functional requirements

- Security: default-deny row-level security on every table, per-agent tokens, audit logging.
  Detail: [security.md](security.md).
- Performance: search under one second for a vault of tens of thousands of notes.
- Portability: notes remain plain markdown and can be exported as a folder tree at any time.
- Data residency: one Supabase project per deployment; region chosen with customer material in
  mind.

## 9. Phasing

| #   | Phase                  | Outcome                                                                                   |
| --- | ---------------------- | ----------------------------------------------------------------------------------------- |
| 0   | Setup                  | Repo, schema, sharing rules, tests, MCP server skeleton, workflows and dev-memory         |
| 1   | Local end to end       | MCP server against a live stack, the owner's Claude connected, existing notes imported    |
| 2   | Web app and map        | Sign-in, the brain-dashboard map on real data, vault browser with sharing controls, inbox |
| 3   | Hosting and colleagues | Remote MCP connector, invitations, token management, the first colleague connected        |
| 4   | Linking                | Entity registry, link discovery, overlap notifications, the handshake, semantic search    |
| 5   | Synthesis and upkeep   | Synthesis pages, contradiction flags, the housekeeper, health reports                     |
| 6   | Hosted chat and admin  | Chat on members' own plans, SSO, super admin, multi-hive operations                       |

## 10. Open questions

- The brand name.
- Whether synthesis pages are editable by people or regenerated only.
- Threshold values for semantic link proposals.
- Which members and agents are in the first cohort.
- Whether any customer contract requires a security review or specific data residency.
