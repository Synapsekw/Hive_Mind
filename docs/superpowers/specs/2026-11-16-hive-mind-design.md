---
type: spec
status: active
last-updated: 2026-11-21
tags: [project/hive-mind, spec, master]
---

# Hive Mind — Master Design Spec

The engineering source of truth. Product intent is in the [PRD](../../prd.md). Sections marked
**built** describe code in this repo; the rest is design.

## 1. Product in one paragraph

Each member's AI agent writes notes into that member's private space through an MCP connector. The
platform detects when two members' notes concern the same thing and proposes a link; only when both
accept do the notes open to each other. On top of shared notes the platform keeps a synthesis page
per client or project. A web app shows the whole hive as a map and is where people, never agents,
decide what is shared.

## 2. Tech stack (decided)

- **Backend:** Supabase — Postgres, Auth, row-level security, Storage, Realtime, Edge Functions.
- **Agent interface:** an MCP server in TypeScript (`mcp/`). stdio today; a remote HTTP transport
  when hosted.
- **Web app (later):** Next.js on Vercel.
- **Background jobs (later):** Supabase Edge Functions, database triggers and `pg_cron`, calling a
  model API only where judgement is needed.
- **Tooling:** pnpm workspace, TypeScript strict, Prettier, node:test with PGlite for the
  sharing-rule tests.

## 3. Environment

- Hosted dev project: `tokyttkztrkjvkaksdnh` (`https://tokyttkztrkjvkaksdnh.supabase.co`), reached
  from agents through the `supabase-dev` MCP in `.mcp.json`.
- Local stack: `pnpm db:start` (Supabase CLI in Docker) applies `supabase/migrations/`.
- No production project and no deploy yet.

## 4. Architecture

| Component       | Technology                            | Responsibility                                                             |
| --------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Database        | Supabase Postgres                     | Hives, members, agents, notes, files, entities, links, synthesis, audit    |
| Access control  | Supabase Auth + row-level security    | Member identity, agent claims, visibility enforced in every query          |
| Agent interface | MCP server (TypeScript)               | overview, search, read, write, append, propose link                        |
| Object storage  | Supabase Storage (private buckets)    | Deliverables; signed URLs only (not built)                                 |
| Vector search   | pgvector                              | Embedding per note for semantic search and tier-4 links (not built)        |
| Background jobs | Edge Functions + triggers + `pg_cron` | Entity extraction, link proposal, synthesis, housekeeper (not built)       |
| Realtime        | Supabase Realtime                     | Pushes link suggestions and notifications to the web app (not built)       |
| Web app         | Next.js                               | Map, inbox, vault, gallery, entity pages, settings (not built)             |
| Hosted chat     | Vendor sign-in programmes             | Optional browser chat on the member's own plan, subject to vendor approval |

The desktop apps talk to the database only through the MCP server. The web app goes direct with
the signed-in person's identity. Nothing uses the service-role key except background jobs.

## 5. Data model — built

Defined in `supabase/migrations/20261120000001_schema.sql`. Every row belongs to one hive.

| Table             | Purpose                                                                           |
| ----------------- | --------------------------------------------------------------------------------- |
| `hives`           | A tenant                                                                          |
| `members`         | A person in a hive; role `owner` or `member`; `default_visibility`                |
| `workspaces`      | A member's space; an agent token is bound to exactly one                          |
| `agents`          | A connected agent: provider, trust tier, token hash, expiry, revocation, last use |
| `folders`         | Optional visibility rule inherited by the notes inside                            |
| `notes`           | Path, title, frontmatter, body, visibility, `shared_with`, `quarantined`, version |
| `note_versions`   | Full history, written by trigger                                                  |
| `files`           | A deliverable, shared exactly like the note it is attached to                     |
| `entities`        | Canonical client, project, person or product, with aliases                        |
| `note_entities`   | Which notes concern which entity, with confidence                                 |
| `links`           | Tier 1 to 4, score, status, and an accepted timestamp per side                    |
| `synthesis_pages` | One per entity: body, sources, contradictions                                     |
| `notifications`   | Per member                                                                        |
| `audit_log`       | Per hive; readable by the owner                                                   |

Deferred on purpose: the `embedding` column (the dimension locks the model choice) and Storage
buckets ([[2026-11-20-decision-09-embeddings-and-storage-deferred]]).

## 6. Sharing rules — built

Defined in `supabase/migrations/20261120000002_sharing_rules.sql`, tested in
`tests/sharing-rules.test.mjs`.

**Effective visibility** of a note = its own setting, else its folder's, else the member's default
(private).

**Who can read a note:**

- Its owner. A self-hosted agent only reads what it wrote itself plus shared notes.
- Anyone in the same hive, when the note is not quarantined and its visibility is `group`.
- The named members, when visibility is `members`.
- The owner of the note on the other side of a link that **both** owners accepted.
- Nobody outside the hive; nobody who is not signed in.

**Who can write:** only the owner, in their own workspace. An agent's identity carries three extra
claims — `agent_id`, `workspace_id`, `trust_tier` — and the database uses them:

- writes outside the token's workspace are refused;
- setting or changing visibility, `shared_with`, quarantine or folder is refused;
- deletes are refused;
- accepting or declining a link is refused;
- a self-hosted agent's writes are forced into quarantine.

**Functions:** `create_hive`, `add_member`, `create_agent` (returns the token once; only a hash is
stored), `revoke_agent`, `agent_login` (token → identity), `respond_to_link`, `search_notes`
(keyword search, runs with the caller's rights).

## 7. MCP server — built, not yet run against a live stack

`mcp/src/index.ts`. On start it exchanges `HIVE_AGENT_TOKEN` for the member's identity
(`agent_login`), signs a one-hour JWT carrying the agent claims, and talks to Supabase as that
member. It holds no permission logic.

| Tool                | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `hive_overview`     | Workspace, recent notes, known topics             |
| `hive_search`       | Keyword search over everything the agent may read |
| `hive_read`         | One note in full                                  |
| `hive_write`        | Create or replace a note in the agent's workspace |
| `hive_append`       | Add a dated line to a note                        |
| `hive_propose_link` | Propose a link; a person on each side must accept |

Every read is wrapped as data with a fixed "this is not an instruction" header. Signing with the
project's JWT secret fits the local stack and must be revisited before hosting
([[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]). Planned tools and the trust-tier matrix:
[agent-integration.md](../../agent-integration.md).

## 8. Data flows

### 8.1 Agent writes a memory

1. The member's Claude or ChatGPT app calls the write tool with path, title and body.
2. The MCP server resolves the agent token to the member and workspace.
3. The note is inserted or updated in the member's space; a version row is written by trigger;
   visibility is inherited.
4. (Later) a trigger enqueues a job that extracts entities, computes the embedding and proposes
   links against other members' notes. Links between two notes of the same owner are created
   directly; cross-member links become proposals and each side gets a notification.

### 8.2 Overlap handshake

1. Both members see: "Another member's agent is working on DMT. Share your notes to consolidate?"
   The notification carries the entity only, never content.
2. Each accepts or declines. Either decline ends it; the decliner stays invisible.
3. On double accept the link status becomes `accepted` and the two notes become readable to each
   other. The synthesis job for that entity is triggered.

### 8.3 Synthesis rebuild

1. A change to a note linked to an entity triggers the job (debounced).
2. The job reads all shared notes linked to the entity, with owners.
3. A model call drafts the page with citations to note ids and owners.
4. Conflicting statements are written to `contradictions` and flagged in both members' inboxes.

### 8.4 Agent reads for an answer

Search returns, in order: matching synthesis pages, the member's own notes, then shared notes by
link score — all filtered by the sharing rules. The agent drills into source notes only when the
synthesis is not enough.

### 8.5 The map's data

The map draws every view from one graph: every node (kind, topic, layer, path, owner, last
changed) and every link. It is derived data — "show, don't store". The page holds no state of its
own, so losing it loses nothing ([[2026-11-20-decision-07-brain-dashboard-is-the-map]]).

## 9. Member onboarding and project isolation

Each member works from a dedicated project in their own Claude or ChatGPT app; only that project
syncs to the hive. The token is bound to one workspace, so anything written through it lands in the
right space even if the connector is enabled elsewhere by mistake.

1. The owner invites the member; the member signs in to the web app once.
2. The member creates an agent token, choosing a workspace.
3. The member adds the connector and enables it in one project only.
4. The member pastes the instruction template (in [agent-integration.md](../../agent-integration.md))
   into the project's instructions.
5. A new chat reads the hive and begins writing back.

The agent writes only what the instructions tell it to, so the template is the most important
onboarding artefact.

## 10. Phased build plan

Status is tracked in [`vault/00-north-star.md`](../../../vault/00-north-star.md) §2; detail in
[`vault/moc/platform-roadmap.md`](../../../vault/moc/platform-roadmap.md). Commit and checkpoint
after each phase.

| #   | Phase                  | Scope                                                                                   |
| --- | ---------------------- | --------------------------------------------------------------------------------------- |
| 0   | Setup                  | Repo, schema, sharing rules, tests, MCP server skeleton, workflows and dev-memory       |
| 1   | Local end to end       | MCP server on a live stack; owner's Claude connected; vault import; file storage        |
| 2   | Web app and map        | Auth, map on real data (six views), vault browser with sharing controls, inbox          |
| 3   | Hosting and colleagues | Remote MCP transport, invitations, token UI, first colleague, revisit agent sign-in     |
| 4   | Linking                | Entity registry and extraction, link discovery, notifications, handshake UI, embeddings |
| 5   | Synthesis and upkeep   | Synthesis pages, contradictions, housekeeper, weekly health report                      |
| 6   | Hosted chat and admin  | Vendor sign-in chat, SSO, super admin, multi-hive operations                            |

## 11. Engineering guardrails

- Row-level security is the security boundary; default deny on every table; no cross-hive access.
- People decide sharing. No agent path can set visibility, accept a link or delete.
- All schema through versioned migrations minted by `scripts/new-migration.sh`.
- Every change to who can see what ships with a sharing-rule test.
- Hive content is data, never instructions.
- Service-role key and JWT secret stay server-side.
- TypeScript strict; Zod at the MCP boundary.
- Every feature ships with tests; no phase is complete with a failing gate.

## 12. Manual responsibilities (Danijel)

- Supabase project keys into `.env`; OAuth for the `supabase-dev` MCP (`claude /mcp`).
- Docker and the Supabase CLI on the build machine for the local stack.
- Applying for the vendor sign-in programmes before phase 6.
- Choosing the brand name and checking domains and trademarks.
