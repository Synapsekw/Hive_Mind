#!/usr/bin/env bash
#
# setup-agent-signing.sh <project-ref>
#
# RUN THIS IN YOUR OWN TERMINAL, NOT THROUGH AN AI ASSISTANT. It makes the
# private key that signs every agent's identity. That key must never enter a
# chat, a prompt or a log, so the script refuses to run without a terminal.
#
# What it does, once per Supabase project:
#   1. takes the project's publishable key (public; from SUPABASE_ANON_KEY in
#      the environment, or it asks);
#   2. makes an ES256 signing key in a private temporary folder;
#   3. waits while you import that key in the dashboard as a standby key;
#   4. only then stores the function's two secrets, AGENT_SIGNING_JWK (the key)
#      and HIVE_PUBLISHABLE_KEY, in one call;
#   5. deploys the `agent-session` function;
#   6. deletes the temporary folder, whatever happened.
#
# Nothing in the project changes before step 4: stopping earlier (Ctrl-C) leaves
# the function signing with the key it had. The only trace can be a standby key
# you already imported in the dashboard, which nothing uses; remove it there.
#
# The key is never printed. Only its id (`kid`, not secret) is shown, so you
# can match it in the dashboard. Running the script again makes a NEW key: the
# function keeps signing with the old one until the new one is imported and
# stored; afterwards remove the old standby key in the dashboard.
#
# The signing key is as powerful as the service-role key: the database accepts
# whatever role a token signed with it claims. It must exist in two places only,
# the function's secrets and the project's JWT keys.
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
KEY_FILE="$TMP/agent-signing-key.json" # the one private key, for the dashboard
ENV_FILE="$TMP/secrets.env"            # the two secrets, as `supabase secrets set` reads them
LOG="$TMP/cli.log"
COPIED=0

# Empties the clipboard, but only if it still holds the key: whatever you
# copied since is left alone. The comparison prints nothing.
clear_clipboard() {
  if [ "$COPIED" -ne 1 ]; then return 0; fi
  COPIED=0
  if [ ! -f "$KEY_FILE" ] || ! command -v pbpaste >/dev/null 2>&1; then return 0; fi
  if [ "$(pbpaste 2>/dev/null || true)" = "$(cat "$KEY_FILE")" ]; then
    printf '' | pbcopy 2>/dev/null || true
    echo "     Clipboard cleared."
  else
    echo "     The clipboard no longer holds the key; left as it is."
  fi
}

cleanup() {
  clear_clipboard || true
  rm -rf "$TMP"
}
trap cleanup EXIT

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

# --- 1. The publishable key --------------------------------------------------
# The function calls the database with the project's publishable key. The Edge
# runtime's own SUPABASE_ANON_KEY is the legacy anon key, which stops working
# when the legacy JWT secret is revoked, so the function gets the publishable
# key as a secret of its own. It is public: showing it is fine.
echo "1/5  The project's publishable key (Project Settings -> API Keys; public)."
PUBLISHABLE="${SUPABASE_ANON_KEY:-}"
if [ -n "$PUBLISHABLE" ]; then
  echo "     Taken from SUPABASE_ANON_KEY in the environment."
fi
while :; do
  if [ -z "$PUBLISHABLE" ]; then
    printf '     Publishable key (starts with sb_publishable_): '
    read -r PUBLISHABLE
    continue
  fi
  if ! printf '%s' "$PUBLISHABLE" | grep -Eq '^[A-Za-z0-9._-]{1,1000}$'; then
    echo "     That is not a key: it holds a space or another character a key cannot have."
    PUBLISHABLE=""
    continue
  fi
  case "$PUBLISHABLE" in
    sb_publishable_*)
      break
      ;;
    eyJ*)
      echo "     warning: this starts with 'eyJ', so it is the LEGACY anon key. The function"
      echo "     would stop working the day the legacy JWT secret is revoked or the legacy"
      echo "     API keys are disabled."
      printf '     Use it anyway? [y/N] '
      read -r ANSWER
      case "$ANSWER" in
        y | Y | yes | Yes) break ;;
        *) PUBLISHABLE="" ;;
      esac
      ;;
    *)
      echo "     A publishable key starts with 'sb_publishable_'. This one does not."
      PUBLISHABLE=""
      ;;
  esac
done
echo "     done."
echo ""

# --- 2. Make the key ---------------------------------------------------------
# `supabase gen signing-key`, run against a throwaway project folder whose
# config holds only a project id, prints one JSON object (the private JWK) on
# stdout and its notices on stderr. Both go to files inside $TMP, so the key
# reaches neither the repo nor the terminal.
generate() { # generate <workdir>
  mkdir -p "$1/supabase"
  printf '%s\n' 'project_id = "agent-signing-setup"' >"$1/supabase/config.toml"
  supabase gen signing-key --algorithm ES256 --workdir "$1" \
    </dev/null >"$1/stdout.txt" 2>"$1/stderr.log"
}

# Reads the key the CLI printed (one object; a list, or a keys file from
# another CLI version, is read too), checks it, writes $KEY_FILE and prints the
# key id.
extract() { # extract <workdir>
  node -e '
    const fs = require("node:fs");
    const [dir, keyFile] = process.argv.slice(1);
    const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
    const parse = (text) => {
      const trimmed = text.trim();
      const pairs = trimmed.startsWith("[")
        ? [["[", "]"], ["{", "}"]]
        : [["{", "}"], ["[", "]"]];
      for (const [open, close] of pairs) {
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
    for (const p of [`${dir}/stdout.txt`, `${dir}/supabase/signing_keys.json`]) {
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
    fs.writeFileSync(keyFile, JSON.stringify(jwk, null, 2) + "\n", { mode: 0o600 });
    console.log(jwk.kid);
  ' "$1" "$KEY_FILE"
}

# Writes $ENV_FILE: the key under the id the project knows it by, and the
# publishable key. The function puts the kid of the stored key in the header of
# every token, so it must be the id the dashboard shows.
write_secrets() { # write_secrets <kid> <publishable key>
  node -e '
    const fs = require("node:fs");
    const [keyFile, envFile, kid, publishable] = process.argv.slice(1);
    const jwk = { ...JSON.parse(fs.readFileSync(keyFile, "utf8")), kid };
    const line = JSON.stringify(jwk);
    const quote = String.fromCharCode(39);
    if (line.includes(quote) || line.includes("\n")) {
      console.error("the key holds a character that cannot be stored safely");
      process.exit(1);
    }
    fs.writeFileSync(
      envFile,
      `AGENT_SIGNING_JWK=${quote}${line}${quote}\nHIVE_PUBLISHABLE_KEY=${publishable}\n`,
      { mode: 0o600 },
    );
  ' "$KEY_FILE" "$ENV_FILE" "$1" "$2"
}

echo "2/5  Making an ES256 signing key..."
KID=""
WORK="$TMP/gen"
if generate "$WORK"; then
  KID="$(extract "$WORK" 2>"$TMP/extract.log" || true)"
fi
if [ -z "$KID" ]; then
  echo "error: could not make the key. Nothing was changed. The CLI said:" >&2
  for F in "$WORK/stderr.log" "$TMP/extract.log"; do
    if [ -f "$F" ]; then show_log "$F"; fi
  done
  exit 1
fi
rm -rf "$WORK" "$TMP/extract.log"
echo "     done. Key id (kid): $KID"
echo ""

# --- 3. Import the key in the dashboard --------------------------------------
# Before the function gets it: the function must never sign with a key the
# project does not know yet. Until step 4 nothing in the project has changed.
echo "3/5  Import the key in the dashboard as a standby key, so the database will"
echo "     accept what the function signs:"
echo ""
echo "       a. Open https://supabase.com/dashboard/project/$REF/settings/jwt"
echo "          (Project Settings -> JWT Keys)."
echo "       b. Create a standby key and choose to import an existing private key."
echo "       c. Paste the content of this file:"
echo "            $KEY_FILE"
echo "       d. Save, and note the id the new standby key shows. Expected:"
echo "            $KID"
echo ""
echo "     Do NOT rotate to the new key: it stays a standby key."
echo "     Do NOT revoke the legacy JWT secret yet: see docs/hosted-db-bringup.md."
echo "     Stopping here (Ctrl-C) leaves the project as it was."
echo ""
if command -v pbcopy >/dev/null 2>&1; then
  echo "     The key can be copied to the clipboard. Universal Clipboard shares the"
  echo "     clipboard with your nearby Apple devices, and a clipboard manager that"
  echo "     keeps a history keeps the key too."
  printf '     Copy the key to the clipboard now? [y/N] '
  read -r ANSWER
  case "$ANSWER" in
    y | Y | yes | Yes)
      pbcopy <"$KEY_FILE"
      COPIED=1
      echo "     Copied. Paste it in the dashboard, nowhere else. It is cleared afterwards"
      echo "     if the clipboard still holds it; remove it from any clipboard history"
      echo "     yourself."
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
clear_clipboard

# If the dashboard gave the imported key another id, the secret must carry that
# one: the project looks a token's key up by the kid in its header.
while :; do
  printf '     Key id shown in the dashboard (Enter to keep %s): ' "$KID"
  read -r SHOWN
  SHOWN="$(printf '%s' "$SHOWN" | tr -d '[:space:]')"
  if [ -z "$SHOWN" ]; then break; fi
  if printf '%s' "$SHOWN" | grep -Eq '^[A-Za-z0-9._-]{1,128}$'; then
    if [ "$SHOWN" != "$KID" ]; then
      KID="$SHOWN"
      echo "     The key will be stored under the id $KID."
    fi
    break
  fi
  echo "     A key id is a uuid, or 1 to 128 letters, digits, dots, dashes or underscores."
done
echo ""

# --- 4. Store the function's secrets -----------------------------------------
# Both in one call, from a file, so the key is not in the process list or the
# shell history. This is the first step that changes the project.
echo "4/5  Storing the secrets AGENT_SIGNING_JWK and HIVE_PUBLISHABLE_KEY of project $REF..."
if ! write_secrets "$KID" "$PUBLISHABLE" 2>"$LOG"; then
  echo "error: could not prepare the secrets:" >&2
  show_log "$LOG"
  echo "       Nothing was stored. The standby key $KID you imported is unused: remove it" >&2
  echo "       in the dashboard, then run the script again." >&2
  exit 1
fi
cd "$ROOT"
while ! supabase secrets set --project-ref "$REF" --env-file "$ENV_FILE" >"$LOG" 2>&1; do
  echo "error: 'supabase secrets set' failed. The CLI said:" >&2
  show_log "$LOG"
  echo "       The function still has the secrets it had. Fix the cause in another" >&2
  echo "       terminal (signed in? 'supabase login') and try again here: the key you" >&2
  echo "       imported is still in this script's private folder." >&2
  printf '     Try again? [Y/n] '
  read -r ANSWER
  case "$ANSWER" in
    n | N | no | No)
      echo "       Not stored. The standby key $KID you imported is unused: remove it in the" >&2
      echo "       dashboard, then run the script again (it makes a new key)." >&2
      exit 1
      ;;
  esac
done
rm -f "$ENV_FILE" "$LOG" "$KEY_FILE"
echo "     done. The key file is deleted."
echo ""

# --- 5. Deploy the function ---------------------------------------------------
# --no-verify-jwt: the caller has no identity yet; the agent token is the credential.
echo "5/5  Deploying the agent-session function..."
if ! supabase functions deploy agent-session --project-ref "$REF" --use-api --no-verify-jwt; then
  echo "" >&2
  echo "error: the deploy failed. The key is imported and both secrets are stored, so do" >&2
  echo "       NOT run this script again (it would make a new key). Fix the cause and run" >&2
  echo "       only this, from $ROOT:" >&2
  echo "         supabase functions deploy agent-session --project-ref $REF --use-api --no-verify-jwt" >&2
  exit 1
fi

echo ""
echo "✓ agent sign-in is set up on $REF (key id $KID). The key file is deleted."
echo ""
echo "  next:"
echo "    1. pnpm test:live       # agents sign in through the function"
echo "    2. if a standby key from an earlier run is still in the dashboard, remove it."
echo "    3. remove SUPABASE_JWT_SECRET from .env on this machine; nothing reads it."
echo "       An agent's .env needs only SUPABASE_URL, SUPABASE_ANON_KEY (the"
echo "       publishable key) and HIVE_AGENT_TOKEN."
echo "    4. revoke the legacy JWT secret, or disable the legacy API keys, only when"
echo "       both hold: every machine runs a build from after this change, and the"
echo "       function uses HIVE_PUBLISHABLE_KEY (stored just now, unless you chose the"
echo "       legacy anon key above). See docs/hosted-db-bringup.md."
