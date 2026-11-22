---
type: adr
date: 2026-11-22
status: open
tags: [gotcha]
related:
  - "[[2026-11-21-decision-10-task-worktrees-nested-in-the-project]]"
  - "[[2026-11-22-0923-hosted-db-bringup]]"
---

# Gotcha 05 — finish-task.sh cannot remove the worktree the session sits in

## Context

`/develop` re-roots the session into `.claude/worktrees/<name>` with `EnterWorktree`, then runs `scripts/finish-task.sh` from there. On Windows a folder that is some process's working directory cannot be deleted. The script merged and pushed correctly, then failed at cleanup with `failed to delete ...: Directory not empty`, exit 255. Git had already unregistered the worktree; a half-deleted folder and the merged `task/*` branch were left behind.

## Decision

Until the script handles it: when cleanup fails this way, the merge is already done. Leave the worktree (`ExitWorktree` with `keep`), then from the main checkout remove the leftover folder, run `git worktree prune`, and `git branch -d task/<name>`.

## Rationale

The failure is after the push, so nothing is lost, but the exit code reads like a failed finish. Knowing which half ran avoids re-running the merge.

## Consequences

- Positive: a known three-command recovery.
- Negative: every `/develop` run on Windows ends with a manual cleanup.
- Open follow-ups: make `finish-task.sh` step out of the worktree before removing it, or have `/develop` exit the worktree and run the cleanup half from the main checkout.

## Related

- `scripts/finish-task.sh`, `.claude/commands/develop.md`
