---
type: north-star
status: active
last-updated: 2026-11-22-0815
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
- **1 — Local end to end** — <span style="color:#eab308">**[Next]**</span> — MCP server on a live stack, the owner's Claude connected, existing notes imported, file storage. Plan: [[2026-11-21-local-end-to-end]].
- **2 — Web app and map** — **[Not started]** — Sign-in, the brain-dashboard map on real data, vault browser with sharing controls, inbox.
- **3 — Hosting and colleagues** — **[Not started]** — Remote MCP connector, invitations, token management, the first colleague connected.
- **4 — Linking** — **[Not started]** — Entity registry, link discovery, overlap notifications, the handshake UI, semantic search.
- **5 — Synthesis and upkeep** — **[Not started]** — Synthesis pages, contradiction flags, the housekeeper, health reports.
- **6 — Hosted chat and admin** — **[Not started]** — Chat on members' own plans, SSO, super admin, multi-hive operations.

## 3. Now

- **Phase:** **Phase 1 has started.** The schema and sharing rules now run on the hosted dev project; the MCP server has still not run against it.
- **Branch:** `develop` == `main`. No `task/*` branches, no worktrees.
- **The MCP server is untested end to end** ([[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]]). It typechecks. Its sign-in signs a JWT with the project secret and has never met a live database; expect that to need work on the hosted project.
- **Green tests prove the SQL, not Supabase** ([[2026-11-20-gotcha-01-tests-stub-supabase-auth]]). The auth schema and roles are stubbed in `scripts/local-db.mjs`.
- **The hosted dev project is up** (T1, hosted half, 2026-11-22): `tokyttkztrkjvkaksdnh`, wired in `.mcp.json` as `supabase-dev`. Both migrations applied under the repo's version stamps; one hive (`Synapse`), one owner, one workspace, one agent (`Claude`); the token is in the local `.env`. `agent_login` works through the public API and a signed-out caller reads nothing. Runbook: `docs/hosted-db-bringup.md`. The local Docker stack is still not set up.
- **In flight:** none.
- **Next:** **T2**, the critical path of [[2026-11-21-local-end-to-end]]: run the MCP server against the live database (unblocked now). **T4** (vault importer) is independent and can run alongside.
- **Owed — Danijel:** install Docker + the Supabase CLI on the build machine for the local stack.
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
