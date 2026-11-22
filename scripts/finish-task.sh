#!/usr/bin/env bash
#
# finish-task.sh
#
# Completes the current task worktree. Run it from INSIDE a `task/<name>`
# worktree (the folder start-task.sh created). It:
#   1. verifies the worktree is committed and clean
#   2. refreshes develop and rebases task/<name> onto it (auto-integration)
#   3. runs typecheck / lint / test / build AGAINST the integrated state
#   4. merges task/<name> directly into develop and pushes
#   5. installs dependencies and rebuilds in the main checkout
#   6. removes the worktree and deletes the branch
#
# Why integrate before gating: develop moves while you work (other sessions
# merge; the main checkout itself gains doc/vault commits). Gating the task tip
# in isolation can pass while the *merged* result is red. So we rebase onto the
# latest develop FIRST, then gate, so the checks see exactly what lands.
#
# A task is not "done" until this completes successfully.

set -euo pipefail

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
case "$BRANCH" in
  task/*) : ;;
  *)
    echo "error: not on a task/* branch (on '$BRANCH')." >&2
    echo "       run this from inside the worktree start-task.sh created." >&2
    exit 1
    ;;
esac

WT="$(git rev-parse --show-toplevel)"
MAIN="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"

# Stop-hook session drafts are generated noise — clear them BEFORE the clean-tree
# check so they never block a finish.
rm -f "$WT"/vault/sessions/_draft-*.md

if [ -n "$(git status --porcelain)" ]; then
  echo "error: you have uncommitted changes — commit them before finishing." >&2
  git status --short >&2
  exit 1
fi

# Serialize the whole rebase→gate→merge pipeline machine-wide with an atomic
# mkdir lock in the shared git dir (bash-3.2 safe — no flock). Holding it from
# before the rebase is what makes serialization correct: each finisher rebases
# onto — and gates against — the previous finisher's merge.
GATE_LOCK="$(cd "$(git rev-parse --git-common-dir)" && pwd)/finish-task-gate.lock"
GATE_LOCK_HELD=""
release_gate_lock() { [ -n "$GATE_LOCK_HELD" ] && rm -rf "$GATE_LOCK"; return 0; }
trap release_gate_lock EXIT

echo "→ acquiring machine-wide gate lock (serialized finishes)…"
WAITED=0
while ! mkdir "$GATE_LOCK" 2>/dev/null; do
  HOLDER="$(cat "$GATE_LOCK/pid" 2>/dev/null || true)"
  # Steal the lock if the recorded holder process is gone (crashed finish).
  if [ -n "$HOLDER" ] && ! kill -0 "$HOLDER" 2>/dev/null; then
    echo "  lock holder (pid $HOLDER) is dead — stealing the stale lock"
    rm -rf "$GATE_LOCK"
    continue
  fi
  if [ "$WAITED" -ge 1800 ]; then
    echo "error: gave up after 30min waiting for the gate lock (held by pid ${HOLDER:-unknown})." >&2
    echo "       if no other finish-task.sh is really running:  rm -rf \"$GATE_LOCK\"  and re-run." >&2
    exit 1
  fi
  if [ $((WAITED % 30)) -eq 0 ]; then
    echo "  another worktree is running its gates (pid ${HOLDER:-unknown}) — waiting… (${WAITED}s)"
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "$$" > "$GATE_LOCK/pid"
GATE_LOCK_HELD=1

# 1. Refresh the integration target. `pull --rebase` covers every case in one go:
#    local behind → fast-forward · local ahead (unpushed vault/doc commits) → no-op ·
#    local diverged → replays local commits onto origin.
#    autoStash protects the persistently-dirty .obsidian/* tree in the main checkout.
echo "→ refreshing develop (fetch + rebase local onto origin)…"
git -C "$MAIN" fetch origin develop
git -C "$MAIN" checkout develop
if ! git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop; then
  echo "error: local develop in the main checkout conflicts with origin/develop." >&2
  echo "       resolve it in $MAIN (git status), then re-run finish-task.sh." >&2
  exit 1
fi

# 2. Rebase the task branch onto the fresh develop, IN THE WORKTREE, so any
#    conflicts surface here and the gates below see the integrated state.
echo "→ rebasing $BRANCH onto the latest develop…"
if ! git rebase develop; then
  CONFLICTS="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
  git rebase --abort
  echo "" >&2
  echo "error: develop moved and auto-rebase hit conflicts: ${CONFLICTS:-<see above>}" >&2
  echo "       the rebase was aborted — your worktree is clean and unchanged." >&2
  echo "       resolve manually:  git rebase develop  (fix conflicts, git rebase --continue)" >&2
  echo "       then re-run finish-task.sh." >&2
  exit 1
fi

# The rebase can bring dependency changes from develop, but a rebase never runs
# pnpm install — refresh node_modules so the gates don't run stale.
echo "→ refreshing dependencies after rebase (pnpm install --prefer-offline)…"
pnpm install --prefer-offline

# Migration hygiene (offline): two committed files sharing one version prefix
# corrupt the Supabase migration ledger.
DUP="$(ls "$WT/supabase/migrations" 2>/dev/null | sed 's/_.*//' | sort | uniq -d || true)"
if [ -n "$DUP" ]; then
  echo "error: two migrations share a version prefix: $DUP" >&2
  echo "       re-mint one with scripts/new-migration.sh, commit, then re-run finish-task.sh." >&2
  exit 1
fi

# 3. Gates — against the integrated (rebased) state.
echo "→ running checks (typecheck / lint / test / build) against integrated state…"
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Author-email assertion: every commit is authored as info@synapse-solutions.ai
# (verified on Synapsekw). Block the merge while it's still cheap to rewrite.
BAD_AUTHORS="$(git log develop..HEAD --format='%h %ae' | grep -v ' info@synapse-solutions\.ai$' || true)"
if [ -n "$BAD_AUTHORS" ]; then
  echo "error: commits in develop..HEAD not authored as info@synapse-solutions.ai:" >&2
  echo "$BAD_AUTHORS" | sed 's/^/         /' >&2
  echo "       fix the identity, rewrite the branch's authors, then re-run finish-task.sh:" >&2
  echo "         git config user.name \"Danijel Jovanovic\"" >&2
  echo "         git config user.email info@synapse-solutions.ai" >&2
  echo "         git rebase develop --exec 'git commit --amend --no-edit --reset-author'" >&2
  exit 1
fi

# 4. Merge + push. The task is already rebased onto develop, so --no-ff is
#    conflict-free and keeps the merge-commit convention. Retry the push once if
#    origin advanced again in the gap.
echo "→ merging $BRANCH into develop…"
git -C "$MAIN" merge --no-ff "$BRANCH" -m "Merge $BRANCH into develop"
if ! git -C "$MAIN" push origin develop; then
  echo "→ push rejected (origin moved) — re-syncing develop and retrying once…"
  git -C "$MAIN" -c rebase.autoStash=true pull --rebase origin develop
  git -C "$MAIN" push origin develop
fi

# 5. The main checkout now has the merged code but not its dependencies or its
#    build. The owner's agent runs mcp/dist from here, and scripts import from
#    its node_modules, so bring both up to date. The merge is already pushed, so
#    a failure here is reported, not fatal.
echo "→ refreshing the main checkout (pnpm install + build)…"
if ! (cd "$MAIN" && pnpm install --prefer-offline && pnpm build); then
  echo "warning: could not refresh the main checkout. Run there:  pnpm install && pnpm build" >&2
fi

# 6. Clean up. Step out of the worktree first: a folder that is a process's
#    working directory cannot be removed on Windows. If git still cannot remove
#    it (files held open, or the calling session sits in it), unregister it and
#    delete what can be deleted; the merge is done either way.
echo "→ cleaning up worktree + branch…"
cd "$MAIN"
LEFTOVER=""
if ! git worktree remove "$WT" 2>/dev/null; then
  git worktree remove --force "$WT" 2>/dev/null || true
  rm -rf "$WT" 2>/dev/null || true
  rm -f "$WT/.git" 2>/dev/null || true
  git worktree prune
  [ -e "$WT" ] && LEFTOVER=1
fi
git branch -d "$BRANCH"

echo ""
if [ -n "$LEFTOVER" ]; then
  echo "✓ done: $BRANCH rebased onto develop, gated, merged, pushed, branch deleted."
  echo "  the worktree is unregistered, but part of its folder is still in use and was left behind:"
  echo "    $WT"
  echo "  leave that folder (an agent session: ExitWorktree with action keep), then:  rm -rf \"$WT\""
else
  echo "✓ done: $BRANCH rebased onto develop, gated, merged, pushed, worktree removed, branch deleted."
  echo "  your shell is in a folder that no longer exists — cd \"$MAIN\""
fi
echo ""
echo "  NEXT (closure): give the user a numbered 'How to test this' walkthrough"
echo "  — in your closing message AND the /wrapup session note. If nothing is"
echo "  user-facing, say so in one line. (AGENTS.md working agreement #1.)"
