---
type: adr
date: 2026-11-21
status: accepted
tags: [decision]
related: []
---

# Decision 10 — Task worktrees are nested inside the project

## Context

Parallel building sessions need separate folders. A sibling folder next to the repo is outside the subagent sandbox, so dispatched subagents cannot write into it.

## Decision

Each session works in `.claude/worktrees/<name>` on `task/<name>`, created by `scripts/start-task.sh` and closed by `scripts/finish-task.sh`. The main checkout stays on `develop`.

## Rationale

Carried over from Monolith, where the sibling layout failed for subagent-driven development.

## Consequences

- Positive: orchestrator and subagents share one branch with natural relative paths.
- Negative: the worktree needs its own `pnpm install`.
