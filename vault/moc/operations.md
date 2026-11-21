---
type: moc
status: active
tags: [moc/operations]
related: ["[[00-north-star]]"]
---

# Operations — Map of Content

> How Hive Mind is built, wired, and run. Supabase, MCP, migrations, gates.

## Which database is which (read first)

- **Hosted dev:** project `tokyttkztrkjvkaksdnh` (`https://tokyttkztrkjvkaksdnh.supabase.co`).
  Added 2026-11-21. **No migrations applied yet.**
- **Local stack:** `pnpm db:start` (Supabase CLI in Docker) on the build machine.
- **In-process:** PGlite, for `pnpm test` and `pnpm demo`. Supabase auth is stubbed
  ([[2026-11-20-gotcha-01-tests-stub-supabase-auth]]).
- **Production:** none. Nothing deploys.

## Environment & secrets

- `.env` (gitignored) — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`,
  `HIVE_AGENT_TOKEN`. The JWT secret and any service-role key are **server-only**.
- `.env.example` — the template (committed, blank values).

## Supabase + MCP

- `.mcp.json` at repo root: `supabase-dev` → the hosted dev project, via OAuth (no secret in the
  file). `.codex/config.toml` mirrors it for Codex.
- 🧑 **Manual (Danijel):** paste the keys into `.env`; `claude /mcp` → browser OAuth; approve MCP
  tool calls.
- The product's own MCP server (`mcp/`) is separate: it is what members' agents connect to.

## Migration workflow

1. `scripts/new-migration.sh <slug>` — never hand-invent a version.
2. Write the SQL; a change to who can see what needs a test in `tests/sharing-rules.test.mjs`.
3. `pnpm test` (runs every migration in PGlite), then `supabase db reset` on the local stack.
4. Apply to hosted dev with `supabase db push`, or the `supabase-dev` MCP using the **same version
   and name** as the committed file.

## Quality gates

`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`. `scripts/finish-task.sh` runs all
four against the rebased branch before merging. Husky runs lint-staged and commitlint. CI
(`.github/workflows/ci.yml`) runs the same on `develop` and `main`.

## Deploy

None yet. Planned: Vercel (web app) + Supabase Cloud, `main` only.

## Related MOCs

- [[architecture]]
- [[memory]]
