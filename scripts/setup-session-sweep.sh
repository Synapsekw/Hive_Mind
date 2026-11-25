#!/usr/bin/env bash
#
# setup-session-sweep.sh [--project-ref <ref>]
#
# Schedules the sweep that closes agent sessions idle for two hours, once per
# Supabase project, after the sessions migration is applied. It enables
# pg_cron if needed and (re)schedules the job `close-idle-sessions` every 15
# minutes. The job runs SQL inside the database; no secret is involved.
#
# Needs the Supabase CLI (signed in: `supabase login`). No Docker.
#
# Usage: scripts/setup-session-sweep.sh
#        scripts/setup-session-sweep.sh --project-ref tokyttkztrkjvkaksdnh

set -euo pipefail
umask 077

JOB="close-idle-sessions"
SCHEDULE="*/15 * * * *"

usage() {
  echo "usage: scripts/setup-session-sweep.sh [--project-ref <ref>]" >&2
  exit 1
}

REF_ARG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-ref)
      if [ "$#" -lt 2 ]; then usage; fi
      REF_ARG="$2"
      shift 2
      ;;
    --project-ref=*)
      REF_ARG="${1#--project-ref=}"
      shift
      ;;
    *) usage ;;
  esac
done

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: 'supabase' is not installed or not on the PATH." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- The project --------------------------------------------------------------
# `supabase link` writes the project's id to supabase/.temp/project-ref, and
# newer CLIs also to supabase/.temp/linked-project.json ({"ref": "..."}).
is_ref() {
  printf '%s' "$1" | grep -Eq '^[a-z0-9]{20}$'
}

LINKED=""
if [ -f "$ROOT/supabase/.temp/linked-project.json" ]; then
  LINKED="$(sed -n 's/.*"ref"[[:space:]]*:[[:space:]]*"\([a-z0-9]*\)".*/\1/p' \
    "$ROOT/supabase/.temp/linked-project.json" | head -n 1)"
fi
if [ -z "$LINKED" ] && [ -f "$ROOT/supabase/.temp/project-ref" ]; then
  LINKED="$(tr -d '[:space:]' <"$ROOT/supabase/.temp/project-ref")"
fi
if [ -n "$LINKED" ] && ! is_ref "$LINKED"; then
  echo "error: the linked project's id in $ROOT/supabase/.temp is not a project ref." >&2
  echo "       Link again: supabase link --project-ref <ref>" >&2
  exit 1
fi

if [ -n "$REF_ARG" ]; then
  if ! is_ref "$REF_ARG"; then
    echo "error: --project-ref takes the 20-character id of the Supabase project." >&2
    exit 1
  fi
  if [ -n "$LINKED" ] && [ "$LINKED" != "$REF_ARG" ]; then
    echo "error: this checkout is linked to project $LINKED, not $REF_ARG." >&2
    echo "       Leave --project-ref out, or link the other project first." >&2
    exit 1
  fi
  REF="$REF_ARG"
elif [ -n "$LINKED" ]; then
  REF="$LINKED"
else
  echo "error: no linked project. Either link one:" >&2
  echo "         supabase link --project-ref <ref>" >&2
  echo "       or name it: scripts/setup-session-sweep.sh --project-ref <ref>" >&2
  exit 1
fi
# `supabase db query --linked` has no --project-ref flag; with no link file it
# takes the project from this variable.
export SUPABASE_PROJECT_ID="$REF"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/session-sweep-setup.XXXXXXXX")"
DDL_FILE="$TMP/extensions.sql"
CRON_FILE="$TMP/schedule.sql"
CHECK_FILE="$TMP/check.sql"
LOG="$TMP/cli.log"
trap 'rm -rf "$TMP"' EXIT

# Runs one SQL file against the project, through the Management API as the
# project's `postgres` role: the role the scheduled job then runs as.
run_sql() { # run_sql <file>
  supabase db query --linked -f "$1" >"$LOG" 2>&1
}

cd "$ROOT"

echo "Session sweep setup for project $REF."
echo ""

# --- 1. The extension (DDL, alone in its batch) -------------------------------
echo "1/3  In the database: pg_cron, if not there yet..."
# On a project where pg_cron is already on (the hive purge job enables it),
# running the DDL again sets off Supabase's own re-grant, which refuses with
# "dependent privileges exist". So look first, and only enable it when missing.
printf '%s\n' "select count(*) as present from pg_extension where extname = 'pg_cron';" >"$DDL_FILE"
if run_sql "$DDL_FILE" && grep -Eq '"present": *1|present.*\b1\b' "$LOG"; then
  rm -f "$DDL_FILE" "$LOG"
  echo "     already on."
  echo ""
else
printf '%s\n' \
  "create extension if not exists pg_cron with schema pg_catalog;" \
  "grant usage on schema cron to postgres;" \
  "grant all privileges on all tables in schema cron to postgres;" >"$DDL_FILE"
if ! run_sql "$DDL_FILE"; then
  echo "error: enabling pg_cron failed. The CLI said:" >&2
  cat "$LOG" >&2
  echo "       Nothing else was changed. Fix the cause (signed in? 'supabase login';" >&2
  echo "       linked? 'supabase link --project-ref $REF'), or enable pg_cron in the" >&2
  echo "       dashboard, and run the script again." >&2
  exit 1
fi
rm -f "$DDL_FILE" "$LOG"
echo "     done."
echo ""
fi

# --- 2. The schedule ----------------------------------------------------------
echo "2/3  In the database: the job $JOB ($SCHEDULE UTC)..."
printf '%s\n' \
  "do \$schedule\$" \
  "begin" \
  "  perform cron.unschedule(jobid) from cron.job where jobname = '$JOB';" \
  "  perform cron.schedule('$JOB', '$SCHEDULE', 'select public.close_idle_sessions()');" \
  "end" \
  "\$schedule\$;" >"$CRON_FILE"
if ! run_sql "$CRON_FILE"; then
  echo "error: scheduling the job failed. The CLI said:" >&2
  cat "$LOG" >&2
  exit 1
fi
rm -f "$CRON_FILE" "$LOG"
echo "     done."
echo ""

# --- 3. Check -----------------------------------------------------------------
echo "3/3  Checking what is there now..."
printf '%s\n' \
  "select jobname, schedule, command from cron.job where jobname = '$JOB';" >"$CHECK_FILE"
if run_sql "$CHECK_FILE"; then
  cat "$LOG"
  echo "     done."
else
  echo "     warning: the check itself failed; the steps above succeeded. The CLI said:" >&2
  cat "$LOG" >&2
fi

echo ""
echo "✓ session sweep is set up on $REF: job $JOB, every 15 minutes."
