---
type: session
date: 2026-11-21-1400
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-21-decision-10-task-worktrees-nested-in-the-project]]"
  - "[[2026-11-21-decision-11-plans-must-state-execution-dag]]"
  - "[[2026-11-21-local-end-to-end]]"
---

# Project setup: workflows, docs and this vault

## What changed

- **Workflows mirrored from Monolith:** `AGENTS.md` (with `CLAUDE.md` importing it),
  `CONTRIBUTING.md`, `scripts/start-task.sh` / `finish-task.sh` / `new-migration.sh` /
  `wrapup-context.sh` / `watch-ci.sh`, the `/wrapup`, `/whats-next`, `/develop`, `/goal` and
  `/roast` commands, the SessionStart and Stop hooks, the `obsidian-cli` skill, husky + commitlint,
  Prettier, CI, the PR template, editor config. Mirrors for Codex under `.codex/` and `.agents/`.
- **Not carried over:** `/promote` and `/sync-prod` (no production yet), `/board` (no plan board
  yet), the `pulse-ui` skill and the Monolith-specific lint and migration-ledger checks.
- **npm → pnpm**, with the four gates defined: `pnpm typecheck`, `lint`, `test`, `build`.
- **All planning docs brought into `docs/`** with frontmatter, plus the master spec and the
  Phase 1 plan [[2026-11-21-local-end-to-end]].
- **This vault created:** north-star, product context, five maps, 11 decisions and 3 gotchas,
  three session notes (two backfilled).
- **Hosted dev Supabase project wired:** `tokyttkztrkjvkaksdnh` in `.mcp.json`,
  `.codex/config.toml` and `.env.example`. Nothing applied to it.
- **Branches:** `develop` created as the integration branch; `main` equals it.

## Why

So that building can start from the IDE with the same habits as Monolith: a session starts with
context injected, work happens in task worktrees, and every block ends with a note here.

## How to test (for the user)

1. Open the folder in the IDE and run `pnpm install`.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all four pass.
3. `pnpm demo` — the story prints.
4. Open the folder as an Obsidian vault and enable Dataview, Templater and Homepage: the
   north-star opens and its session and decision tables fill in.
5. In Claude Code, start a session in the folder: the first lines show "Hive Mind session
   context" with the branch and the north-star's "Now" bullets. `/goal` reports the Phase 1 plan.
6. `scripts/start-task.sh smoke-test` creates `.claude/worktrees/smoke-test`; remove it with
   `git worktree remove .claude/worktrees/smoke-test && git branch -D task/smoke-test`.

## Open threads

- `.codex/hooks.json` assumes the project lives at `C:\Users\D\Hive_Mind`; edit it if not.
- The hooks and task scripts were checked on Linux, not on Windows Git Bash.
- `.env` still needs the anon key and JWT secret; `supabase-dev` needs its OAuth step.
- No plan board yet; add `/board` when one is wanted.

## Next session entry point

Phase 1, Batch A of [[2026-11-21-local-end-to-end]]: T1 (database up, migrations applied, hive and
agent token created) alongside T4 (vault importer). Use `/whats-next` or `/develop`.
