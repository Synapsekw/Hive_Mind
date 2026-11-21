# Contributing to Hive Mind

The short version is in [`AGENTS.md`](AGENTS.md). This file is the full reference.

## Prerequisites

- Node 22 or newer (`.nvmrc` pins 24) and pnpm 10.
- Git with bash available (Git Bash on Windows) for the `scripts/*.sh` helpers.
- Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development), only when you
  want the full local stack. The tests and the demo need neither.
- Obsidian with the Dataview, Templater and Homepage community plugins, to browse `vault/`.

## Setup

```sh
git clone https://github.com/Synapsekw/Hive_Mind.git
cd Hive_Mind
pnpm install          # also installs the git hooks (husky)
pnpm test             # 10 sharing-rule tests + hook tests, no Docker
pnpm demo             # two people and their agents, step by step
cp .env.example .env  # then fill in the keys
```

## Scripts

| Command                           | What it does                                           |
| --------------------------------- | ------------------------------------------------------ |
| `pnpm typecheck`                  | `tsc --noEmit` on the MCP server                       |
| `pnpm lint`                       | Prettier check over the repo                           |
| `pnpm test`                       | Sharing rules (real migrations in PGlite) + hook tests |
| `pnpm build`                      | Build the MCP server to `mcp/dist/`                    |
| `pnpm demo`                       | Scripted walkthrough against the real schema           |
| `pnpm format`                     | Prettier write                                         |
| `pnpm db:start`                   | Local Supabase in Docker; applies the migrations       |
| `pnpm db:reset`                   | Rebuild the local database from the migrations         |
| `scripts/start-task.sh <name>`    | Cut a task worktree off `develop`                      |
| `scripts/finish-task.sh`          | Rebase, gate, merge into `develop`, clean up           |
| `scripts/new-migration.sh <slug>` | Mint a migration with a real UTC version               |
| `scripts/watch-ci.sh branch <b>`  | Bounded CI poller                                      |
| `scripts/wrapup-context.sh`       | One-shot context dump for `/wrapup`                    |

## Branching & promotion workflow

- `develop` is the integration branch; `main` is production. Nothing deploys yet.
- The main checkout stays parked on `develop`. Build in a worktree:

  ```sh
  scripts/start-task.sh vault-import     # creates .claude/worktrees/vault-import on task/vault-import
  cd .claude/worktrees/vault-import
  # ...build, commit...
  scripts/finish-task.sh                 # rebase onto develop, run the four gates, merge, push, clean up
  ```

- Promote with a `develop → main` pull request once CI is green.
- Trivial edits (a typo, a one-liner) may go straight on `develop`.

## Commit hygiene (stage your own work only)

- Stage by path: `git add <paths>`. Never `git add -A`, `git add .` or `git commit -a`.
- Run `git status` first and confirm every staged path is yours.
- Commit as `Danijel Jovanovic <info@synapse-solutions.ai>`. `start-task.sh` sets this in each
  worktree; `finish-task.sh` and CI refuse anything else.
- `/wrapup` commits `vault/` only. Source changes are never committed by a wrapup.

## Commit messages (Conventional Commits)

`type(optional-scope): subject`, enforced by commitlint on commit and in CI.
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
Scopes are free-form: `db`, `mcp`, `rules`, `vault`, `ci`, `ui`.

## Code style

Prettier decides formatting (`.prettierrc.json`); the pre-commit hook formats staged files.
TypeScript is strict. Validate tool inputs with Zod at the MCP boundary.

## Database & sharing rules

- The schema lives in `supabase/migrations/`. Mint new files with `scripts/new-migration.sh`.
- Row-level security is the security boundary. Every table has RLS enabled and default-deny.
- A change to who can read or write what needs a test in `tests/sharing-rules.test.mjs`, written
  first and seen failing.
- Privileged operations are `security definer` functions with `set search_path = ''`, and each one
  checks who is calling. People-only operations refuse any caller with an `agent_id` claim.
- The hosted dev project is `tokyttkztrkjvkaksdnh`. Apply migrations to it with `supabase db push`
  or the `supabase-dev` MCP, using the committed files. Never edit it from the dashboard.

## Testing

- `tests/sharing-rules.test.mjs` runs the real migrations in an in-process Postgres (PGlite) and
  checks the rules as several people and two kinds of agent. Supabase's `auth` schema and roles are
  stubbed in `scripts/local-db.mjs`.
- The stub is the one place the tests differ from a real Supabase project. Anything that depends
  on real Auth, Storage, Realtime or PostgREST needs a check against the local stack too
  ([[2026-11-20-gotcha-01-tests-stub-supabase-auth]]).
- Hook tests live next to the hooks in `.claude/hooks/`.

## Dev memory

`vault/` is a tracked Obsidian vault; the whole repo opens as the vault. Start at
[`vault/00-north-star.md`](vault/00-north-star.md). End each working block with `/wrapup`. Record
decisions and traps in `vault/decisions/`. See [`vault/README.md`](vault/README.md).
