---
type: moc
status: active
tags: [moc/architecture]
related: ["[[00-north-star]]"]
---

# Architecture — Map of Content

> System + code structure. Authoritative detail lives in the master spec
> ([[2026-11-16-hive-mind-design]], §2 / §4–§8); this is the navigation layer.

## Tech stack (spec §2)

- **Backend:** Supabase — Postgres, Auth, RLS, Storage, Realtime, Edge Functions.
- **Agent interface:** MCP server in TypeScript (`@modelcontextprotocol/sdk`, `@supabase/supabase-js`, `jose`, Zod). stdio now, HTTP when hosted.
- **Web app (phase 2):** Next.js on Vercel.
- **Tooling:** pnpm workspace, Prettier, node:test + PGlite, husky + commitlint.

## Code layout (current)

- `supabase/migrations/20261120000001_schema.sql` — tables and enums.
- `supabase/migrations/20261120000002_sharing_rules.sql` — helpers, triggers, RLS policies, functions.
- `mcp/src/index.ts` — the MCP server: token exchange, six tools, data framing.
- `scripts/local-db.mjs` — in-process Postgres with the migrations applied (tests and demo).
- `scripts/demo.mjs` — two people and their agents, step by step.
- `tests/sharing-rules.test.mjs` — the sharing rules as people and agents.
- `docs/ui/` — the map and chat prototypes.

## Data model (spec §5)

`hives` → `members` → `workspaces` → `folders` / `notes` (+ `note_versions`, `files`);
`agents` bound to one workspace; `entities` + `note_entities`; `links` with a per-side accept;
`synthesis_pages`; `notifications`; `audit_log`. `hive_id` on every row
([[2026-11-20-decision-08-every-row-belongs-to-a-hive]]).

**Rules:** RLS on every table, default deny. Effective visibility = note, else folder, else member
default. Agent claims (`agent_id`, `workspace_id`, `trust_tier`) narrow what an identity may do.
See [[2026-11-16-decision-02-sharing-rules-live-in-the-database]].

## Live: architecture/design docs by recency

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs"
WHERE type AND (type = "design" OR type = "spec")
SORT file.mtime DESC
```

## Related MOCs

- [[platform-roadmap]] — where the architecture is heading
- [[operations]] — how it runs (Supabase, MCP, migrations)
- [[specs]] — the master design spec
