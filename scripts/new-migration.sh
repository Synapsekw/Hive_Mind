#!/usr/bin/env bash
#
# new-migration.sh <slug>
#
# Mints `supabase/migrations/<UTC-stamp>_<slug>.sql` with a REAL
# `date -u +%Y%m%d%H%M%S` version. Hand-invented stamps ship invalid hours and
# parallel branches mint the same version, which corrupts the Supabase ledger.
# This script makes the version trustworthy and checks for collisions across
# ALL worktrees before creating the file.
#
# Usage: scripts/new-migration.sh add_embeddings

set -euo pipefail

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "usage: scripts/new-migration.sh <slug>   (lowercase, e.g. add_embeddings)" >&2
  exit 1
fi
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9_-]*$'; then
  echo "error: <slug> must be lowercase letters, digits, underscores or dashes. got: '$SLUG'" >&2
  exit 1
fi

WT="$(git rev-parse --show-toplevel)"
MIG_DIR="$WT/supabase/migrations"
if [ ! -d "$MIG_DIR" ]; then
  echo "error: $MIG_DIR not found — run this from inside the repo." >&2
  exit 1
fi

# Real UTC stamp — never hand-invent a version.
VERSION="$(date -u +%Y%m%d%H%M%S)"
FILE="$MIG_DIR/${VERSION}_${SLUG}.sql"
REL="supabase/migrations/${VERSION}_${SLUG}.sql"

# Collision check (a): duplicate version prefix in THIS checkout.
CLASH="$(ls "$MIG_DIR" | grep "^${VERSION}_" || true)"
if [ -n "$CLASH" ]; then
  echo "error: version $VERSION is already taken in this checkout:" >&2
  echo "$CLASH" | sed 's/^/         /' >&2
  echo "       wait a second and re-run." >&2
  exit 1
fi

# Collision check (b): scan the OTHER worktrees' migration dirs. A sibling
# branch carrying an unmerged migration forces a merge order — warn up front.
WARNED=0
WORKTREES="$(git worktree list --porcelain | sed -n 's/^worktree //p')"
while IFS= read -r OTHER; do
  [ -n "$OTHER" ] || continue
  [ "$OTHER" = "$WT" ] && continue
  [ -d "$OTHER/supabase/migrations" ] || continue

  SAME_SECOND="$(ls "$OTHER/supabase/migrations" | grep "^${VERSION}_" || true)"
  if [ -n "$SAME_SECOND" ]; then
    echo "" >&2
    echo "!! worktree $OTHER already has a migration with THIS EXACT version ($VERSION):" >&2
    echo "$SAME_SECOND" | sed 's/^/     /' >&2
    echo "   two files sharing one version corrupt the Supabase ledger. Aborting." >&2
    exit 1
  fi

  UNMERGED=""
  for F in $(ls "$OTHER/supabase/migrations"); do
    [ -e "$MIG_DIR/$F" ] || UNMERGED="$UNMERGED $F"
  done
  if [ -n "$UNMERGED" ]; then
    WARNED=1
    echo "" >&2
    echo "!! WARNING: worktree $OTHER carries UNMERGED migration(s) not in this checkout:" >&2
    for F in $UNMERGED; do echo "     $F" >&2; done
    echo "   parallel branches with migrations force a merge order — coordinate who lands first." >&2
  fi
done <<EOF
$WORKTREES
EOF
[ "$WARNED" -eq 1 ] && echo "" >&2

cat > "$FILE" <<EOF
-- ${VERSION}_${SLUG}.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp). Do not hand-edit
-- the version, and never edit a migration that has shipped.
--
-- What this migration does:
--

EOF

echo "✓ created $REL"
echo ""
echo "  next:"
echo "    1. write the SQL. A change to who can see what also needs a test in"
echo "       tests/sharing-rules.test.mjs (AGENTS.md, engineering invariants)."
echo "    2. pnpm test            # runs every migration in an in-process Postgres"
echo "    3. supabase db reset    # local stack, when Docker is running"
echo "    4. commit the file by path:  git add $REL"
