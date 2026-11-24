#!/usr/bin/env bash
#
# setup-hive-purge.sh [--project-ref <ref>]
#
# Sets up the daily erase of hives whose seven days are over, once per Supabase
# project. Run it after the hive_deletion migration is applied and the
# `purge-hives` function is deployed.
#
# What it does:
#   1. finds the project: the linked one, or the one named with --project-ref;
#   2. in the database, as three separate files, none of which holds a secret:
#      a. enables pg_cron and pg_net if needed (the only file with DDL);
#      b. has the database make a random secret (256 bits, as 64 hex
#         characters) and store it in its secret store (Supabase Vault) as
#         `hive_purge_secret`, beside the function's address as
#         `hive_purge_url`, replacing an earlier value of the same name;
#      c. schedules the job `purge-hives` for 03:17 UTC every day, unscheduling
#         an existing job of that name first;
#   3. reads the secret back from the secret store into a private file;
#   4. stores it as the function secret HIVE_PURGE_SECRET;
#   5. deletes the temporary folder, whatever happened.
#
# The secret is made inside the database, so it is never part of the text of
# any SQL statement: not in the Postgres log, not in pg_stat_statements. On
# this machine it is never printed, never on a command line and never in the
# shell history: the CLI writes it into a file inside a private temporary
# folder (mode 700, files mode 600), the shell reads that file, and writes the
# one file `supabase secrets set` reads. The scheduled job's own text holds no
# secret either: it reads the address and the secret from the secret store each
# time it runs.
#
# Running it again makes a NEW secret and replaces the old one in both places.
# Between step 2b and step 4 the two differ; if a step in between fails, the
# scheduled call gets 401 (nothing is erased) until the script is run again.
#
# Needs the Supabase CLI (signed in: `supabase login`). No Docker.
#
# Usage: scripts/setup-hive-purge.sh
#        scripts/setup-hive-purge.sh --project-ref tokyttkztrkjvkaksdnh

set -euo pipefail
umask 077

JOB="purge-hives"
SCHEDULE="17 3 * * *"
SECRET_NAME="hive_purge_secret"
URL_NAME="hive_purge_url"
FUNCTION_SECRET="HIVE_PURGE_SECRET"

usage() {
  echo "usage: scripts/setup-hive-purge.sh [--project-ref <ref>]" >&2
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
if [ ! -f "$ROOT/supabase/functions/purge-hives/index.ts" ]; then
  echo "error: $ROOT/supabase/functions/purge-hives/index.ts not found." >&2
  echo "       Run this from a checkout that has the purge-hives function." >&2
  exit 1
fi

# --- 1. The project ----------------------------------------------------------
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
  # The secret must reach the function and the database of ONE project.
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
  echo "       or name it: scripts/setup-hive-purge.sh --project-ref <ref>" >&2
  exit 1
fi
# `supabase db query --linked` has no --project-ref flag; with no link file it
# takes the project from this variable.
export SUPABASE_PROJECT_ID="$REF"

FUNCTION_URL="https://$REF.supabase.co/functions/v1/purge-hives"

# None of the SQL files holds a secret. The two files that do are the CLI's
# answer to the read-back and the env file made from it.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hive-purge-setup.XXXXXXXX")"
DDL_FILE="$TMP/extensions.sql"
VAULT_FILE="$TMP/vault.sql"
CRON_FILE="$TMP/schedule.sql"
READ_FILE="$TMP/readback.sql"
CHECK_FILE="$TMP/check.sql"
ANSWER_FILE="$TMP/readback.out" # SECRET: what the CLI printed for the read-back
ENV_FILE="$TMP/secrets.env"     # SECRET: as `supabase secrets set` reads it
LOG="$TMP/cli.log"
SECRET=""

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

# Prints a CLI log with anything that could be the secret taken out: every run
# of 64 hex characters, whether or not this script knows the secret yet. Shell
# builtins only, so nothing secret is ever an argument of a process.
show_log() {
  local LC_ALL=C text
  if [ ! -f "$1" ]; then return 0; fi
  text="$(<"$1")"
  while [[ "$text" =~ [0-9a-f]{64} ]]; do
    text="${text//"${BASH_REMATCH[0]}"/[removed]}"
  done
  printf '%s\n' "$text" >&2
}

# Runs one SQL file against the project, through the Management API as the
# project's `postgres` role: the role the scheduled job then runs as, and the
# one that may read the secret store. What the CLI prints goes to the log file
# and is shown only on failure.
run_sql() { # run_sql <file>
  supabase db query --linked -f "$1" >"$LOG" 2>&1
}

sql_failed() { # sql_failed <what failed>
  echo "error: $1 failed. The CLI said:" >&2
  show_log "$LOG"
}

# Finds the secret in what the CLI printed for the read-back, whatever it put
# around it (a JSON envelope, a table, a csv): the one run of exactly 64 hex
# characters that is not part of a longer run. The same value more than once is
# still one secret; two different values, or none, is a failure. Sets SECRET.
# Shell builtins only.
take_secret() { # take_secret <file>
  local LC_ALL=C rest found="" match
  local shape='(^|[^0-9a-f])([0-9a-f]{64})($|[^0-9a-f])'
  rest="$(<"$1")"
  while [[ "$rest" =~ $shape ]]; do
    match="${BASH_REMATCH[2]}"
    if [ -n "$found" ] && [ "$found" != "$match" ]; then return 1; fi
    found="$match"
    rest="${rest#*"$match"}"
  done
  if [ -z "$found" ]; then return 1; fi
  SECRET="$found"
}

cd "$ROOT"

echo "Hive purge setup for project $REF."
echo "The secret is made in the database and is never printed."
echo ""

# --- 2a. The extensions ------------------------------------------------------
# The DDL, alone in its batch. pg_cron goes in pg_catalog and keeps its tables
# in the schema `cron` (supabase.com/docs/guides/cron/install); pg_net goes in
# `extensions` and puts its functions in the schema `net`
# (supabase.com/docs/guides/database/extensions/pg_net).
echo "1/6  In the database: pg_cron and pg_net, if not there yet..."
printf '%s\n' \
  "create extension if not exists pg_cron with schema pg_catalog;" \
  "grant usage on schema cron to postgres;" \
  "grant all privileges on all tables in schema cron to postgres;" \
  "create extension if not exists pg_net with schema extensions;" >"$DDL_FILE"
if ! run_sql "$DDL_FILE"; then
  sql_failed "enabling the extensions"
  echo "       Nothing else was changed. Fix the cause (signed in? 'supabase login';" >&2
  echo "       linked? 'supabase link --project-ref $REF'), or enable pg_cron and" >&2
  echo "       pg_net in the dashboard, and run the script again." >&2
  exit 1
fi
rm -f "$DDL_FILE" "$LOG"
echo "     done."
echo ""

# --- 2b. The secret store ----------------------------------------------------
# One `do` block that calls Vault's own functions
# (supabase.com/docs/guides/database/vault), no DDL. The secret is made here,
# in the database, and only ever held in a variable of the block: the
# statement's text, which is what a log or pg_stat_statements keeps, has no
# secret in it.
#
# It is the SHA-256 of three random UUIDs, as hex: gen_random_uuid() and
# sha256() are part of Postgres itself (13 and 11), so no extension and no
# schema is assumed, as pgcrypto's gen_random_bytes would need. A version 4
# UUID carries 122 bits from the server's cryptographic random source; three of
# them give more than the 256 bits the hash keeps.
echo "2/6  In the database's secret store: a new $SECRET_NAME, and $URL_NAME..."
printf '%s\n' \
  "do \$vault\$" \
  "declare" \
  "  v_id uuid;" \
  "  v_secret text := encode(sha256(convert_to(" \
  "    gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text," \
  "    'UTF8')), 'hex');" \
  "begin" \
  "  if v_secret !~ '^[0-9a-f]{64}\$' then" \
  "    raise exception 'the secret could not be made';" \
  "  end if;" \
  "" \
  "  select id into v_id from vault.secrets where name = '$SECRET_NAME';" \
  "  if v_id is null then" \
  "    perform vault.create_secret(v_secret, '$SECRET_NAME'," \
  "      'What the purge-hives job shows the purge-hives function.');" \
  "  else" \
  "    perform vault.update_secret(v_id, v_secret, '$SECRET_NAME'," \
  "      'What the purge-hives job shows the purge-hives function.');" \
  "  end if;" \
  "" \
  "  v_id := null;" \
  "  select id into v_id from vault.secrets where name = '$URL_NAME';" \
  "  if v_id is null then" \
  "    perform vault.create_secret('$FUNCTION_URL', '$URL_NAME'," \
  "      'The address of the purge-hives function.');" \
  "  else" \
  "    perform vault.update_secret(v_id, '$FUNCTION_URL', '$URL_NAME'," \
  "      'The address of the purge-hives function.');" \
  "  end if;" \
  "end" \
  "\$vault\$;" >"$VAULT_FILE"
if ! run_sql "$VAULT_FILE"; then
  sql_failed "making and storing the secret"
  echo "       The secret store and the function's secret are as they were. Fix the" >&2
  echo "       cause and run the script again." >&2
  exit 1
fi
rm -f "$VAULT_FILE" "$LOG"
echo "     done."
echo ""

# From here on the secret store holds a secret the function does not have yet.
mismatch() {
  echo "       The secret store already holds the new secret and the function does" >&2
  echo "       not, so a job scheduled by an earlier run is refused with 401 and" >&2
  echo "       nothing is erased. Fix the cause and run the script again: it makes a" >&2
  echo "       new secret and stores it in both places." >&2
}

# --- 2c. The schedule --------------------------------------------------------
# The job follows supabase.com/docs/guides/functions/schedule-functions and
# reads the address and the secret from vault.decrypted_secrets each time it
# runs. pg_net's own limit for a call is a few seconds; the function may work
# for longer on a day with many hives, so the call is given 150 seconds.
echo "3/6  In the database: the daily job $JOB ($SCHEDULE UTC)..."
printf '%s\n' \
  "do \$schedule\$" \
  "begin" \
  "  perform cron.unschedule(jobid) from cron.job where jobname = '$JOB';" \
  "  perform cron.schedule(" \
  "    '$JOB'," \
  "    '$SCHEDULE'," \
  "    \$job\$" \
  "    select net.http_post(" \
  "      url := (select decrypted_secret from vault.decrypted_secrets where name = '$URL_NAME')," \
  "      headers := jsonb_build_object(" \
  "        'Content-Type', 'application/json'," \
  "        'x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = '$SECRET_NAME')" \
  "      )," \
  "      body := '{}'::jsonb," \
  "      timeout_milliseconds := 150000" \
  "    );" \
  "    \$job\$" \
  "  );" \
  "end" \
  "\$schedule\$;" >"$CRON_FILE"
if ! run_sql "$CRON_FILE"; then
  sql_failed "scheduling the job"
  mismatch
  exit 1
fi
rm -f "$CRON_FILE" "$LOG"
echo "     done."
echo ""

# --- 3. Read the secret back -------------------------------------------------
# The statement names the secret, it does not hold it. What the CLI prints for
# it goes to a private file and nowhere else: not to the terminal, not into the
# log that is shown on failure. Only what the CLI says on stderr is ever shown,
# and that with every run of 64 hex characters taken out.
echo "4/6  Reading the new secret back into a private file..."
printf '%s\n' \
  "select decrypted_secret from vault.decrypted_secrets where name = '$SECRET_NAME';" \
  >"$READ_FILE"
if ! supabase db query --linked -f "$READ_FILE" >"$ANSWER_FILE" 2>"$LOG"; then
  echo "error: reading the secret back failed. The CLI said:" >&2
  show_log "$LOG"
  mismatch
  exit 1
fi
if ! take_secret "$ANSWER_FILE"; then
  echo "error: the CLI's answer did not hold exactly one secret (64 hex characters)." >&2
  echo "       The answer is not shown, since it may hold one in another shape." >&2
  mismatch
  exit 1
fi
rm -f "$READ_FILE" "$ANSWER_FILE" "$LOG"
echo "     done."
echo ""

# --- 4. The function's secret ------------------------------------------------
# From a file, so the secret is not in the process list or the shell history.
echo "5/6  Storing the function secret $FUNCTION_SECRET of project $REF..."
printf '%s=%s\n' "$FUNCTION_SECRET" "$SECRET" >"$ENV_FILE"
SECRET=""
if ! supabase secrets set --project-ref "$REF" --env-file "$ENV_FILE" >"$LOG" 2>&1; then
  echo "error: 'supabase secrets set' failed. The CLI said:" >&2
  show_log "$LOG"
  mismatch
  exit 1
fi
rm -f "$ENV_FILE" "$LOG"
echo "     done."
echo ""

# --- 5. Check ----------------------------------------------------------------
# Names only: the job, its schedule, and the two entries of the secret store.
echo "6/6  Checking what is there now (names only)..."
printf '%s\n' \
  "select 'job' as kind, jobname as name, schedule as detail from cron.job where jobname = '$JOB'" \
  "union all" \
  "select 'stored secret', name, 'present' from vault.secrets where name in ('$SECRET_NAME', '$URL_NAME')" \
  "order by 1, 2;" >"$CHECK_FILE"
if run_sql "$CHECK_FILE"; then
  show_log "$LOG"
  echo "     done."
else
  echo "     warning: the check itself failed; the steps above succeeded. The CLI said:" >&2
  show_log "$LOG"
fi

echo ""
echo "✓ hive purge is set up on $REF:"
echo "    function secret   $FUNCTION_SECRET"
echo "    stored secrets    $SECRET_NAME, $URL_NAME"
echo "    scheduled job     $JOB, daily at 03:17 UTC"
echo ""
echo "  next:"
echo "    1. a call without the secret must be refused:"
echo "         curl -s -o /dev/null -w '%{http_code}\\n' -X POST $FUNCTION_URL    # 401"
echo "    2. after the first run, see what the job's call answered:"
echo "         select status_code, content from net._http_response order by created desc limit 1;"
