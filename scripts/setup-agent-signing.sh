#!/usr/bin/env bash
#
# setup-agent-signing.sh <project-ref>
#
# RUN THIS IN YOUR OWN TERMINAL, NOT THROUGH AN AI ASSISTANT. It makes the
# private key that signs every agent's identity. That key must never enter a
# chat, a prompt or a log, so the script refuses to run without a terminal.
#
# What it does, once per Supabase project:
#   1. makes an ES256 signing key in a private temporary folder;
#   2. stores it as the secret AGENT_SIGNING_JWK of the project's functions;
#   3. waits while you import the same key in the dashboard as a standby key;
#   4. deploys the `agent-session` function;
#   5. deletes the temporary folder, whatever happened.
#
# The key is never printed. Only its id (`kid`, not secret) is shown, so you
# can match it in the dashboard. Running the script again makes a NEW key: the
# function then signs with the new one, so import it too and remove the old
# standby key in the dashboard.
#
# Needs the Supabase CLI (signed in: `supabase login`) and node. No Docker.
#
# Usage: scripts/setup-agent-signing.sh tokyttkztrkjvkaksdnh

set -euo pipefail
umask 077

REF="${1:-}"
if [ -z "$REF" ] || [ "$#" -ne 1 ]; then
  echo "usage: scripts/setup-agent-signing.sh <project-ref>   (e.g. tokyttkztrkjvkaksdnh)" >&2
  exit 1
fi
if ! printf '%s' "$REF" | grep -Eq '^[a-z0-9]{20}$'; then
  echo "error: <project-ref> is the 20-character id of the Supabase project. got: '$REF'" >&2
  exit 1
fi
if [ ! -t 0 ] || [ ! -t 1 ]; then
  echo "error: run this in your own terminal, not through an AI assistant or a pipe." >&2
  echo "       It handles a private key that must not enter a chat or a log." >&2
  exit 1
fi
for TOOL in supabase node; do
  if ! command -v "$TOOL" >/dev/null 2>&1; then
    echo "error: '$TOOL' is not installed or not on the PATH." >&2
    exit 1
  fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$ROOT/supabase/functions/agent-session/index.ts" ]; then
  echo "error: $ROOT/supabase/functions/agent-session/index.ts not found." >&2
  echo "       Run this from a checkout that has the agent-session function." >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/hive-agent-signing.XXXXXXXX")"
COPIED=0
cleanup() {
  if [ "$COPIED" -eq 1 ]; then
    printf '' | pbcopy 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

KEY_FILE="$TMP/agent-signing-key.json" # the one private key, for the dashboard
ENV_FILE="$TMP/secrets.env"            # the same key, as `supabase secrets set` reads it
LOG="$TMP/cli.log"

# Prints a CLI log with anything that looks like key material taken out.
show_log() {
  node -e '
    const text = require("node:fs").readFileSync(process.argv[1], "utf8");
    process.stderr.write(
      text
        .replace(/"(d|p|q|dp|dq|qi)"\s*:\s*"[^"]*"/g, "\"$1\":\"[removed]\"")
        .replace(/AGENT_SIGNING_JWK=.*/g, "AGENT_SIGNING_JWK=[removed]"),
    );
  ' "$1" || true
}

echo "Agent sign-in setup for project $REF."
echo "Run this in your own terminal only, never through an AI assistant: it makes"
echo "a private key that must not enter a chat. The key is not printed."
echo ""

# --- 1. Make the key ---------------------------------------------------------
# `supabase gen signing-key` writes to the file named by auth.signing_keys_path
# in the project's config, or to stdout when there is none. It runs here against
# a throwaway project folder that names a file inside $TMP, with stdout sent to
# a file as well, so the key reaches neither the repo nor the terminal.
generate() { # generate <workdir> <config body>
  mkdir -p "$1/supabase"
  printf '%s\n' "$2" >"$1/supabase/config.toml"
  supabase gen signing-key --algorithm ES256 --workdir "$1" \
    </dev/null >"$1/stdout.txt" 2>"$1/stderr.log"
}

# Reads the first key from the keys file or from what the CLI printed, checks
# it, writes $KEY_FILE and $ENV_FILE, and prints the key id.
extract() { # extract <workdir>
  node -e '
    const fs = require("node:fs");
    const [dir, keyFile, envFile] = process.argv.slice(1);
    const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
    const parse = (text) => {
      for (const [open, close] of [["[", "]"], ["{", "}"]]) {
        const from = text.indexOf(open);
        const to = text.lastIndexOf(close);
        if (from < 0 || to <= from) continue;
        try {
          return JSON.parse(text.slice(from, to + 1));
        } catch {}
      }
      return undefined;
    };
    let found;
    for (const p of [`${dir}/supabase/signing_keys.json`, `${dir}/stdout.txt`]) {
      found = parse(read(p));
      if (found !== undefined) break;
    }
    const jwk = Array.isArray(found) ? found[0] : found;
    const text = (v) => typeof v === "string" && v.length > 0;
    if (!jwk || typeof jwk !== "object") {
      console.error("no key found in what the CLI wrote");
      process.exit(1);
    }
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !text(jwk.d) || !text(jwk.x) || !text(jwk.y)) {
      console.error("the CLI did not write a private ES256 (P-256) key");
      process.exit(1);
    }
    if (!text(jwk.kid)) {
      console.error("the key has no id (kid)");
      process.exit(1);
    }
    const line = JSON.stringify(jwk);
    const quote = String.fromCharCode(39);
    if (line.includes(quote) || line.includes("\n")) {
      console.error("the key holds a character that cannot be stored safely");
      process.exit(1);
    }
    fs.writeFileSync(keyFile, JSON.stringify(jwk, null, 2) + "\n", { mode: 0o600 });
    fs.writeFileSync(envFile, `AGENT_SIGNING_JWK=${quote}${line}${quote}\n`, { mode: 0o600 });
    console.log(jwk.kid);
  ' "$1" "$KEY_FILE" "$ENV_FILE"
}

echo "1/4  Making an ES256 signing key..."
KID=""
WORK="$TMP/gen-file"
if generate "$WORK" 'project_id = "agent-signing-setup"

[auth]
signing_keys_path = "./signing_keys.json"'; then
  KID="$(extract "$WORK" 2>"$TMP/extract.log" || true)"
fi
if [ -z "$KID" ]; then
  # Second try without a keys file: the CLI then prints the key, into a file.
  WORK="$TMP/gen-stdout"
  if generate "$WORK" 'project_id = "agent-signing-setup"'; then
    KID="$(extract "$WORK" 2>"$TMP/extract.log" || true)"
  fi
fi
if [ -z "$KID" ]; then
  echo "error: could not make the key. The CLI said:" >&2
  for F in "$TMP/gen-file/stderr.log" "$TMP/gen-stdout/stderr.log" "$TMP/extract.log"; do
    if [ -f "$F" ]; then show_log "$F"; fi
  done
  exit 1
fi
rm -rf "$TMP/gen-file" "$TMP/gen-stdout"
echo "     done. Key id (kid): $KID"
echo ""

# --- 2. Store it as the function's secret ------------------------------------
# From a file, so the key is not in the process list or the shell history.
echo "2/4  Storing it as the secret AGENT_SIGNING_JWK of project $REF..."
cd "$ROOT"
if ! supabase secrets set --project-ref "$REF" --env-file "$ENV_FILE" >"$LOG" 2>&1; then
  echo "error: 'supabase secrets set' failed. The CLI said:" >&2
  show_log "$LOG"
  echo "       Nothing was changed in the dashboard. Fix the cause (signed in? 'supabase login')" >&2
  echo "       and run the script again." >&2
  exit 1
fi
rm -f "$ENV_FILE" "$LOG"
echo "     done."
echo ""

# --- 3. Import the same key in the dashboard ---------------------------------
echo "3/4  Import the same key in the dashboard, so the database accepts what the"
echo "     function signs:"
echo ""
echo "       a. Open https://supabase.com/dashboard/project/$REF/settings/jwt"
echo "          (Project Settings -> JWT Keys)."
echo "       b. Create a standby key and choose to import an existing private key."
echo "       c. Paste the content of this file:"
echo "            $KEY_FILE"
echo "       d. Save, and check that the new standby key shows the id"
echo "            $KID"
echo ""
echo "     Do NOT rotate to the new key: it stays a standby key."
echo "     Do NOT revoke the legacy JWT secret yet: see docs/hosted-db-bringup.md."
echo ""
if command -v pbcopy >/dev/null 2>&1; then
  printf '     Copy the key to the clipboard now? It is cleared again afterwards. [y/N] '
  read -r ANSWER
  case "$ANSWER" in
    y | Y | yes | Yes)
      pbcopy <"$KEY_FILE"
      COPIED=1
      echo "     Copied. Paste it in the dashboard, nowhere else. A clipboard manager"
      echo "     that keeps a history would keep it too: remove it there afterwards."
      ;;
    *)
      echo "     Not copied. Open the file in an editor and copy it from there."
      echo "     Do not print it in a terminal."
      ;;
  esac
else
  echo "     Open the file in an editor and copy it from there. Do not print it in"
  echo "     a terminal."
fi
echo ""
printf '     Press Enter when the standby key is saved in the dashboard... '
read -r _
if [ "$COPIED" -eq 1 ]; then
  printf '' | pbcopy 2>/dev/null || true
  COPIED=0
  echo "     Clipboard cleared."
fi
rm -f "$KEY_FILE"
echo ""

# --- 4. Deploy the function ---------------------------------------------------
# --no-verify-jwt: the caller has no identity yet; the agent token is the credential.
echo "4/4  Deploying the agent-session function..."
if ! supabase functions deploy agent-session --project-ref "$REF" --use-api --no-verify-jwt; then
  echo "" >&2
  echo "error: the deploy failed. The key is stored and imported, so do NOT run this" >&2
  echo "       script again (it would make a new key). Fix the cause and run only:" >&2
  echo "         supabase functions deploy agent-session --project-ref $REF --use-api --no-verify-jwt" >&2
  exit 1
fi

echo ""
echo "✓ agent sign-in is set up on $REF (key id $KID). The key file is deleted."
echo ""
echo "  next:"
echo "    1. pnpm test:live       # agents sign in through the function"
echo "    2. remove SUPABASE_JWT_SECRET from .env on this machine; nothing reads it."
echo "       An agent's .env needs only SUPABASE_URL, SUPABASE_ANON_KEY and"
echo "       HIVE_AGENT_TOKEN."
echo "    3. revoke the legacy JWT secret only when every machine runs a build from"
echo "       after this change (docs/hosted-db-bringup.md)."
