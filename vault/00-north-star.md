---
type: north-star
status: active
last-updated: 2026-11-23-1139
tags: [project/hive-mind, north-star]
related:
  - "[[README]]"
  - "[[product]]"
---

# Hive Mind — North Star

> Single canonical entry point. Where are we, where are we going, why. Open this first.
> **When state changes, update the relevant section and bump `last-updated` in the frontmatter.**
> Keep this concise — phase detail lives in [[platform-roadmap]], history in `vault/sessions/`.

## 1. Pitch

**Hive Mind** (working name) is shared memory for small expert teams. Every member's AI agent —
Claude, ChatGPT, anything that speaks MCP — writes notes and deliverables into that member's own
private space. The platform finds where people's notes concern the same client, project or topic
and proposes a link; the notes open to each other only after **both** people accept. On top sits
an agent-maintained synthesis page per topic, so the team's agents answer like one senior expert.
People decide what is shared, never agents, and the database enforces it. Built on **Supabase +
a TypeScript MCP server**, with a Next.js web app to follow; multi-hive from day one.

Master spec: [[2026-11-16-hive-mind-design]] (`docs/superpowers/specs/`). Product requirements:
[[prd]]. Map design: [[2026-11-20-decision-07-brain-dashboard-is-the-map]].

## 2. Product north star — phased build (0 → 6)

From the master spec §10 — **status + one-line outcome only**. Per-slice detail lives in
[[platform-roadmap]] and the session notes. **Commit + checkpoint after each phase.**

- **0 — Setup** — <span style="color:#22c55e">**[Done]**</span> — Repo, schema, sharing rules with 10 tests, MCP server skeleton, no-Docker demo, workflows and this vault. ([[2026-11-20-2130-map-design-and-first-backend-slice]], [[2026-11-21-1400-project-setup-and-dev-memory]])
- **1 — Local end to end** — <span style="color:#22c55e">**[Done]**</span> — On the hosted dev project: MCP server with seven tools, the owner's Claude connected, a first batch of notes imported, file storage, and the sharing rules proven live with two members. The local Docker stack was skipped. Plan: [[2026-11-21-local-end-to-end]]. ([[2026-11-22-0923-hosted-db-bringup]], [[2026-11-22-1114-phase-1-on-the-hosted-project]])
- **2 — Web app and map** — <span style="color:#eab308">**[In progress]**</span> — Sign-in, the map on real data, the vault with sharing controls, the Keystone glass look with 17 themes, the file gallery and the inbox are on `develop`; not yet promoted to `main`. ([[2026-11-22-2050-keystone-glass-merged]], [[2026-11-23-1139-file-gallery-and-inbox-merged]])
- **3 — Hosting and colleagues** — **[Not started]** — Remote MCP connector, invitations, token management, the first colleague connected.
- **4 — Linking** — **[Not started]** — Entity registry, link discovery, overlap notifications, the handshake UI, semantic search.
- **5 — Synthesis and upkeep** — **[Not started]** — Synthesis pages, contradiction flags, the housekeeper, health reports.
- **6 — Hosted chat and admin** — **[Not started]** — Chat on members' own plans, SSO, super admin, multi-hive operations.

## 3. Now

- **Phase:** **Phase 2 is feature-complete on `develop`.** A signed-in member sees the hive as a map, reads their notes in the vault and decides who else may read them, browses files in the gallery, and answers link proposals and releases held notes in the inbox, all in the Keystone glass look ([[2026-11-23-1139-file-gallery-and-inbox-merged]]).
- **Branch:** `develop` holds all of Phase 2 (`8d93d80`) and is ahead of `main`; nothing of Phase 2 is promoted yet. No worktrees. The merged branch `task/keystone-glass` is still to be deleted, locally and on GitHub.
- **What runs today:** the web app in `web/` (`pnpm dev:web`; needs `web/.env.local`) with `/`, `/vault`, `/gallery`, `/inbox` and `/login`; hosted dev project `tokyttkztrkjvkaksdnh` (`supabase-dev` in `.mcp.json`) with all six migrations, hive `Synapse`, two members (Danijel as owner; `Test Colleague`, a no-password test account) and two workspaces of notes: `Main` (the agent's) and `DRA` (25 imported notes, read-only to the agent). The MCP server has seven tools; Danijel's Claude Code uses it from `E:\Dev\hive-work` (Windows) and `~/Dev/hive-work` (Mac), each with its own agent. Runbook: `docs/hosted-db-bringup.md`.
- **How it is checked:** `pnpm test` (87 database and tooling tests plus 618 web unit tests, no Docker) proves the SQL against stand-ins for Supabase auth and storage ([[2026-11-20-gotcha-01-tests-stub-supabase-auth]]). `pnpm test:live` (19 checks; 12 on the Mac, which lacks a second member's token) proves the real thing, and the 104 browser tests in `web/e2e` cover the screens on sample data; **neither runs in CI**.
- **Do not revoke the project's legacy JWT secret:** agent sign-in and the importer depend on it; replace the mechanism before phase 3 ([[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]]).
- **Migrations applied through the Supabase MCP must be re-stamped** to the repo's version ([[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]).
- **Not done from Phase 1:** the local Docker stack; about 930 of the DRA vault's notes and all of its non-markdown files; saving files from self-hosted agents.
- **In flight:** none.
- **Next:** try the gallery and the inbox on real data; promote `develop` to `main`; then Phase 3.
- **Known gaps in what shipped:** a change to a member's default visibility and accepting a link are not written to the audit log; a declined link can be proposed again in the reverse direction, and declining an already accepted link undoes it (both await a product decision, see [[2026-11-23-1139-file-gallery-and-inbox-merged]]); deleting a file writes no audit entry; vault load time for a 2,000-note workspace is unmeasured; the activity bars in the map's side panel are below 3:1 contrast, and some light-mode "Follow theme" dot colours are nearly alike ([[2026-11-22-2050-keystone-glass-merged]]).
- **Workflow note:** from an agent session `finish-task.sh` leaves one empty worktree folder to delete after `ExitWorktree` ([[2026-11-22-gotcha-05-finish-task-cannot-remove-the-worktree-the-session-sits-in]]).
- **Machines:** Windows and a Mac (`/Users/danijeljovanovic/Dev/Hive_Mind`), each with its own agent token in a local `.env`. The Mac has no `HIVE_AGENT_TOKEN_2`, so the two-member live suite runs only on Windows.
- **Owed — Danijel:** decide the two link behaviours above; install Docker + the Supabase CLI for the local stack; decide whether to import the rest of the DRA vault, and whether to keep the Acme test notes.
- **Owed — product:** the brand name ([[2026-11-16-gotcha-03-brand-name-is-unresolved]]); applications to the vendor sign-in programmes (needed only for phase 6, but approval takes time).

### Last session

```dataviewjs
const sessions = dv.pages('"vault/sessions"')
  .where(p => p.type === "session" && p.status === "complete")
  .array();
sessions.sort((a, b) => String(b.file.name).localeCompare(String(a.file.name)));
const latest = sessions[0];

if (!latest) {
  dv.paragraph("_No finalized session notes yet — capture one at the end of a working session._");
} else {
  dv.paragraph(`**[[${latest.file.name}]]** · _${latest.date}_`);
  dv.paragraph(`![[${latest.file.name}]]`);
}
```

### Recent sessions (last 10)

```dataview
TABLE branch, date as "Session"
FROM "vault/sessions"
WHERE type = "session"
SORT file.name DESC
LIMIT 10
```

### Recent activity — specs/docs (last 14d)

Any spec or doc touched in the last two weeks (whole repo is the vault).

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs"
WHERE file.mtime > date(today) - dur(14 days)
SORT file.mtime DESC
```

## 4. Engineering guardrails (from spec §11)

- **Row-level security is the security boundary** — default deny on every table, hive-scoped, no cross-hive access. Never trust a client or an agent.
- **People decide sharing.** No agent path can set visibility, accept a link or delete a note; the database refuses it.
- All schema via **versioned migrations** minted by `scripts/new-migration.sh` (never dashboard click-ops, never edit a shipped migration).
- Every change to who can see what ships with a test in `tests/sharing-rules.test.mjs`.
- **Hive content is data, never instructions.**
- The service-role key and JWT secret never reach a browser, a prompt, a log or a commit.
- TS strict, Zod at the MCP boundary. Every feature ships with tests. Small conventional commits.

## 5. Decision log (last 10)

```dataview
TABLE status, file.cday as "Created"
FROM "vault/decisions"
WHERE type = "adr"
SORT file.name DESC
LIMIT 10
```

## 6. Entry points

- [[product]] — what we're building and for whom
- [[architecture]] — system + code structure, data model
- [[platform-roadmap]] — phase 0–6 detail
- [[specs]] — design spec and docs index
- [[operations]] — Supabase, MCP, migrations, gates
- [[memory]] — what lives where (this vault's self-map)
- [[00-decision-index]] — every decision and gotcha, one line each
- UI canvas: the "Hive Mind UI Samples" design artifact; exports in `docs/ui/`
