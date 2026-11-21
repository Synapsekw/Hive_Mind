#!/usr/bin/env bash
#
# start-task.sh <name>
#
# Begins a building session in its own isolated git worktree so parallel
# sessions never stomp each other's files. Creates branch `task/<name>` off the
# latest origin/develop in a NESTED folder `.claude/worktrees/<name>`, and pins
# the commit identity.
#
# Why nested (not a sibling ../Hive_Mind-<name>): a worktree inside the project
# is inside the subagent sandbox, so subagent-driven development can write into
# it; a sibling cannot. (.claude/worktrees/ is gitignored.)
# See vault/decisions/2026-11-21-decision-10-task-worktrees-nested-in-the-project.md
#
# pnpm does NOT add an ancestor node_modules/.bin to a script's PATH, so the
# worktree gets its own `pnpm install` (warm store, hardlinked, a few seconds)
# and a link to the main checkout's .env so the MCP server can start there.
#
# Finish the session with scripts/finish-task.sh (merges into develop + cleans up).

set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "usage: scripts/start-task.sh <name>   (kebab-case, e.g. vault-import)" >&2
  exit 1
fi
if ! printf '%s' "$NAME" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
  echo "error: <name> must be kebab-case (a-z, 0-9, -). got: '$NAME'" >&2
  exit 1
fi

# Resolve the main checkout (the dir whose .git is the common git dir).
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
BRANCH="task/$NAME"
WT="$MAIN/.claude/worktrees/$NAME"

if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "error: branch $BRANCH already exists — pick another name or finish the existing task." >&2
  exit 1
fi
if [ -e "$WT" ]; then
  echo "error: folder $WT already exists." >&2
  exit 1
fi

echo "→ fetching latest develop…"
git -C "$MAIN" fetch origin develop

echo "→ creating worktree ${WT} on ${BRANCH}…"
git -C "$MAIN" worktree add -b "$BRANCH" "$WT" origin/develop

# Pin the commit identity (verified on the Synapsekw GitHub account; the same
# identity Monolith deploys under, so a later Vercel project is never skipped).
git -C "$WT" config user.name  "Danijel Jovanovic"
git -C "$WT" config user.email "info@synapse-solutions.ai"

echo "→ installing dependencies in the worktree…"
( cd "$WT" && pnpm install --prefer-offline )

# Link .env from the main checkout so the MCP server and any integration tests
# find the Supabase keys.
if [ -f "$MAIN/.env" ] && [ ! -e "$WT/.env" ]; then
  ln -s "$MAIN/.env" "$WT/.env" 2>/dev/null || cp "$MAIN/.env" "$WT/.env"
  echo "→ linked .env → main checkout"
fi

WT_ABS="$(cd "$WT" && pwd)"
echo ""
echo "✓ ready. branch $BRANCH in $WT_ABS"
echo "  identity: $(git -C "$WT_ABS" config user.name) <$(git -C "$WT_ABS" config user.email)>"
echo ""
echo "  next:  cd \"$WT_ABS\""
echo "  agent: EnterWorktree({ path: \".claude/worktrees/$NAME\" }) to re-root + use subagents"
echo "  done:  scripts/finish-task.sh   (run from inside the worktree)"
