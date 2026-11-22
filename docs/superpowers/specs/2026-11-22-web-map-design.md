---
type: spec
status: draft
last-updated: 2026-11-22
tags: [project/hive-mind, spec, ui]
---

# Web app, sign-in and the map — design

First slice of Phase 2 (master spec §10). Phase 2 has four slices, built in this order, one task
each: **(1) app shell, sign-in and the map — this document**, (2) vault browser with sharing
controls, (3) file gallery, (4) inbox. The inbox is last because nothing creates inbox items until
phase 4.

## Intent

Phase 1 proved the engine through agents and tests. Nobody can yet _see_ the hive. This slice puts
a signed-in person in front of the map of their real hive: every note and file as a dot, the six
views of [decision 07](../../../vault/decisions/2026-11-20-decision-07-brain-dashboard-is-the-map.md),
drawn from the hosted dev project. It is also the shell every later page hangs on.

## Goals, non-goals, anti-goals

- **Goals**
  - A Next.js app in `web/` that a member signs in to with their Supabase account.
  - The map at `/` on real data: six views, isolate by topic / kind / person, search, selection
    with a detail rail, today's activity.
  - A colleague's unshared note or file appears as a hollow dot: "Private note", its topic (the
    folder name), its owner, the date it last changed and nothing else (Danijel's decision,
    2026-11-22).
  - The look of `docs/ui-concept.md` and `docs/ui/map.dc.html`.
- **Non-goals:** opening or editing a note, changing sharing, the vault, gallery, inbox, chat and
  settings pages; "Needs you" and the housekeeper line (no data until phases 4 and 5); realtime
  push; deployment; MFA and SSO; invitations; phone layouts beyond "does not break".
- **Anti-goals**
  - A private note's title, path, body or frontmatter reaching another member's browser.
  - Any agent identity being able to read the map data.
  - The JWT secret or a service-role key anywhere in `web/` or its environment.
  - Sharing logic in app code. The app shows what the database returns.
  - A view switch, filter or search that makes a server round-trip.
  - Invented content (sample inbox items, fake counts) standing in for missing data.

## Constraints found in the project

- **Topics do not exist yet.** The prototype colours by client or project; the entity registry is
  empty until phase 4. Until then a note's topic is derived from its folder (below).
- **No links, no synthesis pages, no files** in the hive today (27 notes, 2 members, 2 agents).
  All six views are built anyway; the Links view and the file ring fill in as data arrives.
- **Row-level security hides unshared notes entirely.** Hollow dots therefore need a new,
  deliberately narrow database function, plus tests.
- **The repo's gates only cover `mcp/`.** They must grow to cover `web/`.
- **Supabase's built-in email** is rate-limited to a few messages an hour, so magic links alone
  would make development painful.

## Approaches

**How the map gets its data**

1. **One database function, `map_graph(p_hive)` — picked.** Returns every node and link the caller
   may know about in one call, with unshared colleagues' items already reduced to stubs inside the
   database. One round-trip, and the redaction lives where every other sharing rule lives.
2. **Read `notes` and `files` through row-level security, plus a second call for stubs.** Two or
   three round-trips, and the browser stitches readable rows and stubs together.
3. **A view over `notes` with the private columns nulled.** Needs a security-definer view, which
   bypasses row-level security for the whole table shape and is easy to widen by accident.

**How the dots are drawn**

1. **HTML buttons positioned with CSS, edges in one SVG, as the prototype does — picked.** Every
   dot is a real, focusable, labelled button, and the glide between views is a CSS transition.
   Comfortable to roughly 2,000 dots.
2. **Canvas or WebGL.** Scales to tens of thousands but loses built-in accessibility and needs its
   own hit-testing and animation. Revisit with the "camera for large hives" follow-up in decision 07.
3. **A graph library (d3-force, Cytoscape, React Flow).** Brings its own look and layout model;
   five of the six views are fixed geometry, not graph layout, so it would be fought more than used.

**Sign-in**

1. **Email and password, with a magic link as the second option — picked.** Password works today
   with no email quota; the magic link is what `docs/security.md` promises colleagues.
2. **Magic link only.** Matches the security document exactly, but the email quota blocks it.
3. **Vendor SSO.** Phase 6.

## Design

### 1. Database: migration `<minted>_map_graph`

Minted with `scripts/new-migration.sh map-graph`.

**`public.note_topic(p_path text) returns text`** — immutable. The note's folder cut to its first
two segments (`clients/acme/pricing.md` → `clients/acme`, `Decisions/x.md` → `Decisions`,
`Home.md` → `General`). Replaced by entities in phase 4. For a file, the topic is that of the note
it is attached to, else `Files`.

**`public.map_graph(p_hive uuid) returns jsonb`** — `stable`, `security definer`,
`search_path = ''`, executable by `authenticated` only.

- Raises an exception when the caller carries an `agent_id` claim, or is not a member of `p_hive`.
- Returns `{ members, agents, nodes, links, truncated }`:
  - `members`: `id`, `display_name`, `is_me` for every member of the hive (already visible today).
  - `agents`: `id`, `member_id`, `provider`, `trust_tier`, `last_used_at` for every agent in the
    hive that is not revoked. The agent's name is returned only for the caller's own agents.
    _This is new: today a member sees only their own agents._
  - `nodes`: one per note and per file, with `id`, `kind` (`note` | `file`), `topic`, `member_id`,
    `updated_at` (`created_at` for a file) and `locked`.
    - Readable by the caller: `locked = false`, plus `title` (file: `name`), `path`,
      `workspace_id`, `by_agent` (boolean; always false for a file, since `files` records no
      author and this slice adds no column) and for a file `note_id`. `agent_id` is returned only
      on the caller's own notes.
      - A note is readable by the same test as `can_read_note`.
      - A file is readable when it is the caller's own, or it is attached to a note the caller can
        read. This must be written out with `can_read_note`: the existing `files_select` policy
        relies on row-level security filtering `notes`, which does not apply inside a
        security-definer function.
    - Not readable, same hive: `locked = true` and only `id`, `kind`, `topic`, `member_id`,
      `updated_at`. No `by_agent`, no `agent_id`.
    - Never returned: someone else's quarantined note, and someone else's file attached to their
      quarantined note.
  - `links`: `from`, `to`, `tier`, `score` for accepted links where one of the two notes is the
    caller's own. This is exactly what `links_select` shows today, so link visibility does not
    widen. Links between two colleagues' shared notes stay invisible until a later slice decides
    otherwise.
  - Ordered by `updated_at desc` and capped at 5,000 nodes; `truncated` is true when the cap cut
    something. Never returns `body` or `frontmatter`.
- Uses `notes_hive_idx`; adds `files_hive_idx on files (hive_id)`.

**Tests** in `tests/sharing-rules.test.mjs`: owner sees own notes in full; a colleague's private
note comes back locked with no title, path or workspace; a group-shared note comes back in full; a
quarantined colleague note is absent, and so is a file attached to it; a locked node carries no
`by_agent`; a link between two colleagues' notes is absent; an agent identity is refused; a non-member is refused; a
member of another hive gets nothing from this hive; a link to a locked node is absent; the JSON
never contains a `body` key. Plus one `pnpm test:live` check calling the function as each of the
two real members.

The migration is applied to the hosted project through the Supabase MCP and re-stamped (gotcha 04).

### 2. The app: `web/`

- **Stack:** Next.js (App Router, current stable), React, TypeScript strict, `@supabase/ssr` +
  `@supabase/supabase-js`, CSS Modules with the tokens of `ui-concept.md` §2 as CSS variables,
  Geist through `next/font`. No component library, no Tailwind, no state library.
- **Workspace:** `web` added to `pnpm-workspace.yaml`. Root scripts become
  `typecheck`/`build` across both packages, `test` also runs the web unit tests, `dev:web` starts
  the app. CI needs no secrets: the build must succeed with no environment set.
- **Environment:** `web/.env.local` (git-ignored) holds only `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key). The app never reads the root `.env`. A
  unit test fails if `SUPABASE_JWT_SECRET` or `service_role` appears anywhere under `web/src`.
- **Routes**
  - `/login` — email + password, and "Email me a link". Errors inline, never a modal.
  - `/auth/confirm` — exchanges a magic-link code for a session, then redirects to `/`.
  - `/` — the map. Server-rendered: checks the session, picks the hive, calls `map_graph` once and
    hands the result to the client map.
  - `/dev/map` — the same map over a built-in fixture graph (about 300 nodes, three members,
    links, files, locked nodes). Returns 404 in production builds. It exists so every view can be
    designed, screenshotted and tested without an account.
  - Middleware refreshes the session cookie and sends signed-out visitors to `/login`.
- **Which hive:** the member's first hive by creation date. A member of no hive sees the first-run
  state: an empty map and one line saying an owner has to invite them. A hive switcher is phase 6.

### 3. The map

Split so the geometry is testable without a browser:

- `web/src/map/graph.ts` — turns the `map_graph` payload into the drawing model: topics ranked by
  size, the seven largest keep their own hue and the rest fold into "Other" (eight hues exist); one
  **topic hub** per topic; the hive index at the centre; structural edges index → hub → item, plus
  the real links. Pure.
- `web/src/map/layouts.ts` — one pure function per view (`rings`, `circle`, `topics`, `links`,
  `timeline`, `orbit`) from the model to positions in a 1000 × 760 box, ported from the prototype's
  geometry. `links` is the force layout, computed on first use and cached.
- `web/src/map/select.ts` — which nodes are lit for a given filter, search text and selection. Pure.
- `web/src/map/Map.tsx` and small components — the client component holding the only state:
  view, topic, kind, person, selection, search text, labels on or off.

Behaviour follows `ui-concept.md` §3 and the prototype, with these adaptations to real data:

| Prototype                       | This slice                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthesis page per topic        | A topic hub; the ring is labelled "Topics" until phase 5                                                                                                               |
| Topic = client or project       | Topic = folder (`note_topic`)                                                                                                                                          |
| Agents named "Danijel, ChatGPT" | "<member>, <provider>"; `self_hosted` agents say so                                                                                                                    |
| Agent status "writing" / "idle" | "connected" when `last_used_at` is within 70 minutes, else the last-used day. `last_used_at` is set at sign-in and the MCP server signs in again at least hourly       |
| Agent dot's connections         | The topic hubs where that agent wrote (own agents, exact, from `agent_id`); a colleague's agent connects to the hubs where its member has readable agent-written notes |
| Core swarm, "126 notes today"   | Counted from nodes whose `updated_at` is within 24 hours, locked included                                                                                              |
| Timeline: agent writes per day  | Readable nodes with `by_agent`, grouped by owner and day, last 14 days                                                                                                 |
| Left rail: five destinations    | Only "Map" and "Sign out"; a destination appears when its page exists                                                                                                  |
| "Needs you", housekeeper line   | Omitted                                                                                                                                                                |
| Selected readable note          | Title, path, topic, owner, last change, "written by an agent", connections                                                                                             |
| Selected locked note            | "Private note", topic, "<owner> has not shared this"                                                                                                                   |

States: loading skeleton is not needed (server-rendered); empty hive shows the first-run line;
`truncated` shows "Showing the 5,000 most recent items"; a failed load shows one line and a retry.
Accessibility as `ui-concept.md` §6: real buttons with labels, visible focus, shape doubles colour,
`prefers-reduced-motion` stops the glide, the breathing core and the orbit.

### 4. Performance and data-fetching budget (AGENTS.md #5)

- **First paint:** one `auth.getUser`, one `members` lookup for the hive, one `map_graph` call.
  Nothing else.
- **Every interaction** (view switch, topic / kind / person filter, search, selection, labels):
  **0 round-trips**, client state only. Search matches titles and topics already in memory.
- **Server data changed by this slice:** none. The map only reads.
- **Bounded:** `map_graph` selects named columns over `hive_id` indexes, never bodies, capped at
  5,000 nodes. Layouts are computed once per view and cached; the force layout is the only
  super-linear one and is capped at 170 iterations.
- **Freshness:** the page refetches when the window regains focus, at most once a minute.

### 5. Tests

- Database rules: §1.
- `web` unit tests (Vitest): topic ranking and the "Other" fold; every layout returns a finite
  position inside the box for every node, on the fixture and on an empty graph; selection and
  filter logic; locked nodes never yield a title; the secret-scan test.
- One browser test (Playwright) on `/dev/map`: the six views switch without a network request,
  a topic chip dims the rest, clicking a locked dot shows "Private note".
- Manual, by Danijel: sign in with his own account and see his 27 notes.

### 6. Independent units (for the plan's execution DAG)

- **A — database:** migration, rule tests, live check, apply to hosted. Depends on nothing.
- **B — app shell:** `web/` scaffold, tokens, gates and CI, sign-in, middleware. Depends on nothing.
- **C — map logic:** `graph.ts`, `layouts.ts`, `select.ts`, the fixture, unit tests. Depends on
  nothing but the payload shape in §1.
- **D — map UI:** components and `/dev/map`, browser test. Needs B and C.
- **E — real data:** `/` wired to `map_graph`, states, docs, runbook. Needs A and D.

A, B and C can run at the same time; the critical path is B or C → D → E.

## Left to the builder

- Exact Next.js and library versions (current stable), file layout inside `web/src`, CSS details
  within the tokens. Load the `frontend-design` skill and read `docs/ui-concept.md` and
  `docs/ui/map.dc.html` before any UI work (AGENTS.md #3).
- The fixture's contents.
- Whether the force layout needs a worker; only if `/dev/map` stutters at 2,000 nodes.

## Owed by Danijel

- A password on his own account if it has none (Supabase dashboard → Authentication → Users), and
  for magic links: `http://localhost:3000/**` added to the allowed redirect URLs
  (Authentication → URL Configuration). Neither is a database change.

## Known gaps

- Folder-as-topic is crude for a flat vault; it is a placeholder for entities.
- A hollow dot tells colleagues how many private notes a member keeps under each topic, the
  topic's folder name (first two folder levels) and when each last changed. Accepted.
- Other members now see which providers a colleague's agents use and when they were last active.
- "Test Colleague" has no password, so the two-member view is checked by the database tests and
  `/dev/map`, not by signing in as that account.
