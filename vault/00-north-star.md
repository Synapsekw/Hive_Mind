---
type: north-star
status: active
last-updated: 2026-11-24-2023
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
- **2 — Web app and map** — <span style="color:#22c55e">**[Done]**</span> — Sign-in, the map on real data, the vault with sharing controls, the Keystone glass look with 17 themes, the file gallery and the inbox; promoted to `main` on 2026-11-23 (PR #2). ([[2026-11-22-2050-keystone-glass-merged]], [[2026-11-23-1139-file-gallery-and-inbox-merged]])
- **3 — Hosting and colleagues** — <span style="color:#eab308">**[In progress]**</span> — Settings for agents, tokens and members is on `main`; invitations honoured at first sign-in are on `main` too; agent sign-in through an Edge Function is on `main` as well; the remote connector with its sign-in window is on `main` (PR #7), the web app is live on Netlify, and Claude and ChatGPT both connected by hand on 2026-11-23; emailed invitations are live and sign-ups are closed (2026-11-24): an account exists only by invitation; a declined link is final and Unlink is its own action ([[2026-11-24-1210-link-behaviours-merged]]). ([[2026-11-23-1823-delete-a-note-merged]], [[2026-11-23-1941-remote-connector-merged-site-live]], [[2026-11-23-2059-connector-proven-and-promoted]], [[2026-11-24-0946-emailed-invitations-live]])
- **4 — Linking** — **[Not started]** — Entity registry, link discovery, overlap notifications, the handshake UI, semantic search.
- **5 — Synthesis and upkeep** — **[Not started]** — Synthesis pages, contradiction flags, the housekeeper, health reports.
- **6 — Hosted chat and admin** — **[Not started]** — Chat on members' own plans, SSO, super admin, multi-hive operations.

## 3. Now

- **Phase:** **Phase 2 is done and on `main`; Phase 3 is in progress** (settings, invitations, agent sign-in, deleting a note and the remote connector on `main`; a colleague's Claude or ChatGPT connects through a sign-in window, [[2026-11-23-2059-connector-proven-and-promoted]]). A signed-in member sees the hive as a map, reads their notes in the vault, decides who else may read them and can delete their own, browses files in the gallery, and answers link proposals and releases held notes in the inbox, in the Keystone layout (a rail, one card, a side panel); the map is drawn on one canvas and zooms ([[2026-11-23-2138-ui-rework-merged]]); on `develop` it opens on Rings (with Timeline and Orbit), is filtered from a bar of lists and chips, and both rails fold ([[2026-11-24-1609-rings-hive-theme-rails-filters]]). The look on `develop` is eight hand-tuned themes on flat surfaces (Honey by default, Paper the light one), with a freshness colour ramp and a halo under fresh notes in Rings; the 18 generated themes, the glass and the Mode, Reach and Dot colours switches are gone ([[2026-11-24-1928-eight-hand-tuned-themes]], [[2026-11-24-decision-16-eight-hand-tuned-themes-replace-keystone-glass]]). An owner invites an address in Settings, the server emails a link, and the invited person joins by pressing Join and may set a password ([[2026-11-24-0946-emailed-invitations-live]]).
- **Branch:** `main` holds everything through the hive switcher (promotion PR #10, 2026-11-24); `develop` adds deleting a hive (`a840874`) and importing a folder from the vault (`d473db5`), both live on the site but not promoted until Danijel has tested them ([[2026-11-24-1459-delete-a-hive-merged]]); it also adds the Rings map, the darker Hive theme, the filter bar and the folding rails (`0833845`), and turning wiki links between a person's own notes into links (`841754a`, [[2026-11-24-1750-wiki-links-become-links]]); a smooth hover on a big hub (`ccb7a33`, [[2026-11-24-1829-hub-hover-perf]]), the eight themes (`51475bb`, [[2026-11-24-1928-eight-hand-tuned-themes]]), and notes keeping their real dates with a Timeline by date written (`70f5314`, [[2026-11-24-2001-notes-keep-their-real-dates]]); all of that is live on the site. The new logo (a linked-hive mark and the HIVE MIND wordmark, favicon, tab title; `2fa8710`, [[2026-11-24-2023-linked-hive-logo]]) is on `develop` but not yet deployed. The merged branch `task/keystone-glass` is still to be deleted, locally and on GitHub.
- **What runs today:** the web app in `web/` (`pnpm dev:web`; needs `web/.env.local`) with `/`, `/vault`, `/gallery`, `/inbox`, `/settings`, `/join` and `/login`; hosted dev project `tokyttkztrkjvkaksdnh` (`supabase-dev` in `.mcp.json`) with every migration through `20261124153504_note_dates`, hive `Synapse` and a second, empty test hive, two members (Danijel as owner; `Test Colleague`, a no-password test account) and two workspaces of notes: `Main` (the agent's) and `DRA` (25 imported notes, read-only to the agent). The MCP server has seven tools; Danijel's Claude Code uses it from `E:\Dev\hive-work` (Windows) and `~/Dev/hive-work` (Mac), each with its own agent. Runbook: `docs/hosted-db-bringup.md`.
- **How it is checked:** `pnpm test` (301 database and tooling tests plus 2,001 web unit tests, no Docker) proves the SQL against stand-ins for Supabase auth and storage ([[2026-11-20-gotcha-01-tests-stub-supabase-auth]]). `pnpm test:live` (23 checks; on the Mac 8 run and 8 skip without a person's credentials, and the two-member suite needs Windows) proves the real thing, and the 342 browser tests in `web/e2e` cover the screens on sample data (including 5,000-item map frame checks, which run alone, only through `--project=perf --no-deps`, and fail when another session runs browser tests at the same time; the hub-hover check runs on the GPU at retina density, since headless software drawing hides blur cost, [[2026-11-24-gotcha-10-headless-chrome-hides-gpu-shadow-blur-cost]]); **neither runs in CI**.
- **Agent sign-in:** the Edge Function `agent-session` exchanges an agent token for a one-hour identity; its signing key (`AGENT_SIGNING_JWK`, as powerful as the service-role key) lives only in the function's secrets. Set up on the dev project with `scripts/setup-agent-signing.sh`. **The legacy JWT secret is still valid: revoke it only when both machines run a build from after 2026-11-23** ([[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]], closed).
- **Migrations applied through the Supabase MCP must be re-stamped** to the repo's version ([[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]).
- **Not done from Phase 1:** the local Docker stack; about 930 of the DRA vault's notes and all of its non-markdown files; saving files from self-hosted agents.
- **In flight:** none. The web app is live at `https://hive-mind-synapse.netlify.app` (Netlify team Synapse-Solutions, deployed by CLI from `develop`, not connected to GitHub); the connector address is that site's `/mcp`; the Edge Functions `mcp`, `invite-email` and `purge-hives` are deployed, invitation mail goes out through Resend, and the database's scheduler calls `purge-hives` daily.
- **Connecting an app:** Supabase's OAuth server is on with **dynamic registration off, and it must stay off**: an app a member approves gets an ID token that Supabase Auth accepts for a password change ([[2026-11-23-gotcha-07-supabase-oauth-id-token-can-change-the-account]]). Claude and ChatGPT are registered by hand under OAuth Apps; a colleague pastes the address and a client ID. ChatGPT needs each colleague's own callback address registered, and is set to ask for no ID token. Steps: `docs/hosted-db-bringup.md`, "Connect an app".
- **Next:** have Danijel import the DRA folder again into "DRA Vault" and open the Timeline (dates are corrected by a re-import); have him try the eight themes (Appearance in the account menu) and hover the big hubs on the real hive; if he wants the map's controls and filters rearranged, that is a new brainstorm (parked on 2026-11-24); run "Connect wiki links" on the imported DRA vault (1,643 notes in hive "Autonomous Mobility Etisalat") and time `map_graph` with the new links; try the Rings map, the filter bar and the folding rails on the real hive, then promote and redeploy; invite the first real colleague, the three slices Danijel asked for on 2026-11-24 are built (hives can be created, switched and deleted; a folder of notes is imported from the vault, notes only, at most 2,000 an import). Prove a real erase of a hive once on the hosted project. Then Phase 4 (linking), where paid maintenance runs on the server with the owner's key, never a member's ([[2026-11-24-decision-15-the-hive-owner-pays-for-hive-maintenance]]); connect the Netlify site to GitHub with `main` as production. Report gotcha 07 to Supabase. Later, decided 2026-11-23: signed desktop apps for Mac and Windows wrapping the same web app. Agents, members and invitations are managed in **Settings**, not by SQL. The hive holds one test note of `Test Colleague` (`clients/acme/pricing-notes.md`); its test link to `clients/acme/proposal.md` was unlinked on 2026-11-24, so that pair is closed for good.
- **Known gaps in what shipped:** deleting a note has no undo and gives a linked colleague no notice ([[2026-11-23-1823-delete-a-note-merged]]); response time can reveal whether an invited address has an account, and `/auth/confirm` still spends a sign-in link on a GET (`docs/security.md`, [[2026-11-24-0946-emailed-invitations-live]]); a change to a member's default visibility is not written to the audit log; a decline or an unlink of a link is final with no undo and gives the colleague no notice, and withdrawing one's own proposal closes the pair too ([[2026-11-24-1210-link-behaviours-merged]]); deleting a file writes no audit entry; a wiki link that was unlinked comes back on the next run while the text still names it, and a reference removed from the text keeps its link; vault load time for a 2,000-note workspace is unmeasured; the "By person" bars in the map's side panel are not contrast-checked (they were below 3:1 before the rework) ([[2026-11-22-2050-keystone-glass-merged]]); the rail's active bar does not slide between pages, dots removed on a refresh vanish without a fade-out, and the map renderer has few unit tests of its own ([[2026-11-23-2138-ui-rework-merged]]); the filter bar is not laid out for phone width, and one join browser test is flaky in parallel runs; the Timeline's week, month and quarter labels overprint each other when the map is zoomed out (seen at a 1,100 px window; to fix after `task/map-chrome` merges, [[2026-11-24-2001-notes-keep-their-real-dates]]) ([[2026-11-24-1609-rings-hive-theme-rails-filters]]); in Rings old notes are below 3:1 against the card on purpose, note halos are off above 400 fresh notes, seven themes have no light version and Paper no dark one, and anyone who had chosen an old theme lands on Honey ([[2026-11-24-1928-eight-hand-tuned-themes]]).
- **Workflow note:** from an agent session `finish-task.sh` leaves one empty worktree folder to delete after `ExitWorktree` ([[2026-11-22-gotcha-05-finish-task-cannot-remove-the-worktree-the-session-sits-in]]).
- **Machines:** Windows and a Mac (`/Users/danijeljovanovic/Dev/Hive_Mind`), each with its own agent token in a local `.env`. The Mac has no `HIVE_AGENT_TOKEN_2`, so the two-member live suite runs only on Windows.
- **Owed — Danijel:** send the gotcha 07 report to Supabase; try Claude desktop; pull and rebuild the MCP server on the Windows machine and remove `SUPABASE_JWT_SECRET` from its `.env` (the Mac is done), then revoke the legacy secret; install Docker + the Supabase CLI for the local stack; decide whether to import the rest of the DRA vault, and whether to keep the Acme test notes.
- **Owed — product:** the brand name ([[2026-11-16-gotcha-03-brand-name-is-unresolved]]; the UI now says Hive Mind at Danijel's request, so the trademark check matters before anything public); applications to the vendor sign-in programmes (needed only for phase 6, but approval takes time).

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
