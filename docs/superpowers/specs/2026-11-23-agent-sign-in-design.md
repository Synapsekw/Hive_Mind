---
type: spec
status: active
last-updated: 2026-11-23
tags: [project/hive-mind, spec, security, mcp]
---

# Agent sign-in without the legacy JWT secret — design

Third slice of Phase 3 (master spec §10). Closes
[[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]].

## Intent

The MCP server turns an agent token into a one-hour identity by signing a JWT itself with the
project's legacy JWT secret. That secret can sign an identity for **any** member, so it must
never be on a colleague's machine, and Supabase can retire it. The importer and the live tests
use the same secret to act as a person. After this slice nothing in the repo reads the secret,
and an agent's machine holds only its own token.

## Decisions taken with Danijel (2026-11-23)

- **The exchange is a Supabase Edge Function.** It holds a signing key of our own and is used
  by the local MCP server now and the remote connector later.
- **The importer signs in as the person**, with their email and password asked in the terminal.
  An agent token is never exchangeable for a person's identity.

Decided in the design (say so if any is wrong):

- **No fallback to the secret.** A build after this slice has no code path that reads
  `SUPABASE_JWT_SECRET`. Builds before it keep working until the secret is revoked, so each
  machine switches when it pulls.
- **The signing key is ES256, generated on the owner's machine and imported into the project**
  as a standby signing key (Supabase's documented way to mint one's own JWTs). The private half
  lives only in the function's secrets.
- **Revoking the legacy secret is not part of this slice.** It becomes possible; the owner does
  it when every machine has switched.
- **The live tests sign in as real people** with test credentials from `.env`; parts that need
  a person skip without them.

## Goals, non-goals, anti-goals

- **Goals**
  - `agent-session` Edge Function: agent token in, one-hour identity out.
  - The MCP server gets its identity from it; `SUPABASE_JWT_SECRET` leaves `mcp/`.
  - The importer signs in with email and password; the secret leaves `scripts/`.
  - The live tests use the exchange for agents and password sign-in for people.
  - A setup script that creates the key and stores it without showing it in a chat or a log.
  - Runbook, security page and gotcha 06 updated.
- **Non-goals:** the remote MCP connector; hosting; revoking the legacy secret; token expiry or
  rotation for agents; rate limiting beyond what Supabase gives the function; changing
  `agent_login` or any sharing rule (no migration).
- **Anti-goals**
  - The signing key, the legacy secret or a service-role key on an agent's machine, in a
    browser, a prompt, a log line or a commit.
  - An agent token yielding an identity without `agent_id` (a person's identity).
  - Permission logic in the function or in `mcp/`: the function states who the token belongs to,
    the database decides what that identity may do.

## Constraints found in the project

- `agent_login(p_token)` is callable by `anon`; it checks hash, revocation and expiry, stamps
  `last_used_at`, and returns `agent_id, user_id, member_id, workspace_id, hive_id, trust_tier`.
- The identity the database expects: `role: authenticated`, `aud: authenticated`, `sub` = the
  member's user id, plus `agent_id`, `workspace_id`, `trust_tier`. The sharing rules read
  those claims (`jwt_agent_id()`, `jwt_is_self_hosted()`).
- The project's current signing key is ES256 and its JWKS is public; a standby key is published
  there too, which is what lets our own tokens verify.
- The Supabase CLI is installed on the Mac and signed in; Docker and Deno are not. Functions
  deploy with `--use-api`. Node is 26, so `node --test` can load a `.ts` file directly.
- `pnpm test:live` (not in CI) is the only check against the real project.

## Design

### 1. The function `agent-session`

`POST {SUPABASE_URL}/functions/v1/agent-session`, header `apikey` (the publishable key), body
`{ "token": "<agent token>" }`. Deployed with JWT verification off: the caller has no JWT yet;
the agent token is the credential.

1. Refuse anything but POST with a JSON body holding one string `token` of 20 to 200
   characters (400). Bodies over 2 kB are refused (413).
2. Call `agent_login` as `anon` with the publishable key. Unknown, expired or revoked → 401
   `{ "error": "unknown, expired or revoked token" }`. The database unreachable → 502.
3. Sign an ES256 JWT with the private key from the secret `AGENT_SIGNING_JWK`, header `kid` =
   the key's id: `role`, `aud`, `sub`, `agent_id`, `workspace_id`, `trust_tier`, `iat`,
   `exp = iat + 3600`, `iss = {SUPABASE_URL}/auth/v1`.
4. Answer 200 `{ access_token, expires_at, agent_id, user_id, member_id, workspace_id, hive_id,
trust_tier }` with `Cache-Control: no-store`.

It never logs the token, the JWT or the key; a failure logs a short reason only. It sends no
CORS headers: it is not for browsers.

The logic is one module with no Deno import (`session.ts`: parse, call, sign with Web Crypto),
so it is tested under `node --test`; `index.ts` is the thin `Deno.serve` wrapper reading the
environment.

### 2. The MCP server

`db()` posts the agent token to the function and builds its client with the returned
`access_token`; it renews when less than a minute remains, as today. `SUPABASE_JWT_SECRET` and
`jose` leave `mcp/`. A refused token gives "Hive sign-in failed: unknown, expired or revoked
token"; a missing function (404) gives a message that names the function and the runbook.

### 3. The importer

`scripts/import-vault.mjs` no longer reads `SUPABASE_JWT_SECRET` or `HIVE_AGENT_TOKEN`. It asks
for email and password on the terminal (password not echoed; or `HIVE_PERSON_EMAIL` /
`HIVE_PERSON_PASSWORD` from the environment for unattended runs), signs in through Supabase Auth
(`/auth/v1/token?grant_type=password`), and finds the person's member row and hive with that
session (own oldest membership, as the web app does). `personJwt` is deleted.

### 4. The live tests

Agent identities come from the function. Person identities come from password sign-in with
`HIVE_PERSON_EMAIL`, `HIVE_PERSON_PASSWORD` (and `_2` for the second member). Checks that need a
person are skipped, with the reason printed, when those are absent. One new check: a token
signed with a wrong key is refused by the database.

### 5. Setting up the key

`scripts/setup-agent-signing.sh <project-ref>`, run by the owner in their own terminal:

1. Generates an ES256 key with `supabase gen signing-key` into a file only the owner can read.
2. Stores the private key as the function secret `AGENT_SIGNING_JWK` (read from the file, never
   printed).
3. Tells the owner to import that file's key in the dashboard (Project Settings → JWT Keys →
   create standby key → import) and waits for Enter.
4. Deploys the function (`supabase functions deploy agent-session --use-api --no-verify-jwt`).
5. Deletes the file.

### 6. Docs

`docs/hosted-db-bringup.md` (the setup, and that `.env` no longer needs the secret),
`docs/security.md` (where the key lives, what the function can and cannot do), `README.md`,
`.env.example`, gotcha 06 (closed; when the legacy secret may be revoked).

## Performance and data-fetching budget

No screen changes. An agent's sign-in becomes two hops (function, then `agent_login`) once per
hour per MCP process, in place of one. The function does one indexed lookup (`token_hash`).

## Independent units (for the plan)

1. The function: `session.ts`, `index.ts`, its tests, `supabase/config.toml`.
2. The MCP server's sign-in.
3. The importer's sign-in and its tests.
4. The live tests.
5. The setup script and the docs.
6. Deploy, live check, gates. Needs all.

1 to 5 share no file and meet only at the function's request and answer, written above.

## Known gaps (accepted)

- Until the legacy secret is revoked it can still sign identities; this slice only removes our
  need for it.
- Anyone can call the function; a guess must hit a token with 244 random bits. No lockout.
- The owner's password is typed into the importer; it is used once and not stored.
- The function's key can sign as any member's agent or as a person. It lives only in the
  function's secrets, and the function only ever signs what `agent_login` returned.
- The second member's person checks need a password for the test account.

## Review focus

- No path from an agent token to an identity without `agent_id`.
- The token, the JWT and the key appear in no log line and no error message.
- The function adds no claim it did not get from `agent_login`.
- Nothing in the repo reads `SUPABASE_JWT_SECRET`.
