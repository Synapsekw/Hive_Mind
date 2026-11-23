# Agent sign-in without the legacy JWT secret — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent's machine holds only its agent token; a Supabase Edge Function exchanges it
for a one-hour identity signed with a key of our own. Nothing in the repo reads
`SUPABASE_JWT_SECRET`.

**Architecture:** `supabase/functions/agent-session` calls `agent_login` as `anon` and signs an
ES256 JWT with a private key held in the function's secrets; the same key is imported into the
project as a standby signing key so the database accepts the token. The MCP server calls the
function; the importer and the live tests sign in as people through Supabase Auth.

**Tech stack:** Supabase Edge Functions (Deno), Web Crypto, TypeScript, node:test (Node 26 loads
`.ts` directly), `@supabase/supabase-js` in `mcp/`.

Spec: [`docs/superpowers/specs/2026-11-23-agent-sign-in-design.md`](../specs/2026-11-23-agent-sign-in-design.md).

## Global constraints

- No migration; `agent_login` and every sharing rule stay as they are. No permission logic in
  the function or in `mcp/`.
- The function signs only what `agent_login` returned, always with `agent_id`; there is no way
  to ask it for a person's identity.
- The agent token, the JWT, the signing key and a person's password appear in no log line, no
  error message, no test output and no commit. Tests use keys generated in the test.
- After this plan `grep -r SUPABASE_JWT_SECRET` finds nothing outside `docs/superpowers/`,
  `vault/` and the sentence in the docs that says it is no longer needed.
- Tests first, seen failing. Stage by path; conventional commits with a lower-case subject and
  the `Co-Authored-By` line. Subagents in a parallel batch do not commit.

## Contract shared between tasks

Request: `POST {SUPABASE_URL}/functions/v1/agent-session`, headers `apikey: <publishable key>`,
`Content-Type: application/json`, body `{ "token": string }`.

Answers:

| Status | Body                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ access_token, expires_at, agent_id, user_id, member_id, workspace_id, hive_id, trust_tier }` (`expires_at` in seconds since epoch) |
| 400    | `{ "error": "send a JSON body with a token" }`                                                                                        |
| 401    | `{ "error": "unknown, expired or revoked token" }`                                                                                    |
| 405    | `{ "error": "use POST" }`                                                                                                             |
| 413    | `{ "error": "request too large" }`                                                                                                    |
| 502    | `{ "error": "the hive is not reachable" }`                                                                                            |
| 500    | `{ "error": "sign-in is not set up" }` (the key is missing or unusable)                                                               |

JWT: header `{ alg: "ES256", typ: "JWT", kid }`; claims `role: "authenticated"`,
`aud: "authenticated"`, `sub: user_id`, `agent_id`, `workspace_id`, `trust_tier`, `iat`,
`exp = iat + 3600`, `iss = {SUPABASE_URL}/auth/v1`.

Function environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (both provided by Supabase),
`AGENT_SIGNING_JWK` (a private ES256 JWK with `kid`, as `supabase gen signing-key` writes it;
if the file holds an array, the first key).

Person sign-in (Tasks 3 and 4): `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`,
`apikey`, body `{ email, password }` → `{ access_token, user: { id } }`. Environment names:
`HIVE_PERSON_EMAIL`, `HIVE_PERSON_PASSWORD`, `HIVE_PERSON_EMAIL_2`, `HIVE_PERSON_PASSWORD_2`.

---

### Task 1: The function

**Files:** create `supabase/functions/agent-session/session.ts`, `index.ts`,
`tests/agent-session.test.mjs`; modify `supabase/config.toml`.

`session.ts` exports

```ts
export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};
export async function handle(
  req: Request,
  env: Env,
  fetchFn?: typeof fetch,
  now?: () => number,
): Promise<Response>;
```

and imports nothing outside the web platform (`Request`, `Response`, `fetch`, `crypto.subtle`).

- [ ] **Tests first** (`tests/agent-session.test.mjs`, importing `session.ts`; each generates
      its own P-256 key pair with `crypto.subtle` and passes a stub `fetchFn`):
  1. a good token → 200; the JWT verifies with the public key (ES256, raw `r||s` signature);
     header has `alg`, `typ`, `kid`; the claims are exactly the nine above with `exp - iat =
3600`; the body has the eight fields; `Cache-Control: no-store`;
  2. the stub saw one call: `POST {url}/rest/v1/rpc/agent_login`, `apikey` and
     `Authorization: Bearer` = the anon key, body `{ p_token }`;
  3. `agent_login` answering 400 with the database's message, or 200 with `[]` → 401 and no
     signature made;
  4. a stub that throws, or answers 500 → 502;
  5. GET → 405; no body, invalid JSON, a body without `token`, a non-string, a token of 19 or
     201 characters, extra keys → 400; a body over 2 kB → 413; none of these calls `fetchFn`;
  6. no key, an unparsable key, a public-only key → 500 and `fetchFn` not called... (the key is
     checked before the database is asked);
  7. a row from `agent_login` missing a field or with a wrong type → 502;
  8. no answer and no `console` output contains the token, the JWT (on failure) or key material
     (spy on `console.*`);
  9. a `trust_tier` or id returned by the database is copied, never taken from the request (a
     request carrying `agent_id`, `sub`, `role` is a 400 by rule 5).
- [ ] See them fail; implement `session.ts`. Import the JWK with
      `crypto.subtle.importKey("jwk", …, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])`;
      sign `base64url(header).base64url(claims)` with `{ name: "ECDSA", hash: "SHA-256" }`.
- [ ] `index.ts`:

```ts
import { handle } from "./session.ts";

Deno.serve((req) =>
  handle(req, {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    signingJwk: Deno.env.get("AGENT_SIGNING_JWK"),
  }),
);
```

- [ ] `supabase/config.toml`: `[functions.agent-session]` with `verify_jwt = false`.
- [ ] Make sure `pnpm typecheck`, `pnpm lint` and `pnpm test` still pass with the new folder
      (exclude `supabase/functions` from any TypeScript project that cannot know `Deno`; the test
      runs under the root `node --test` glob).

### Task 2: The MCP server

**Files:** modify `mcp/src/index.ts`, `mcp/package.json` (drop `jose` if nothing else uses it);
create `mcp/src/sign-in.ts` and a test for it if `mcp/` has a test setup, otherwise
`tests/mcp-sign-in.test.mjs` against the built or source module.

- [ ] **Tests first** for `signIn({ url, anonKey, token }, fetchFn)`: posts the contract's
      request; 200 → `{ accessToken, expiresAt, me }`; 401 → throws
      `Hive sign-in failed: unknown, expired or revoked token`; 404 → throws a message naming
      `agent-session` and `docs/hosted-db-bringup.md`; other failures → `Hive sign-in failed:
<status>`; a malformed 200 → throws; no message contains the token.
- [ ] `db()` uses `signIn`, builds the client with `Authorization: Bearer <access_token>`, and
      renews when less than 60 s remain (unchanged rule). Remove `SUPABASE_JWT_SECRET`, `SignJWT`
      and the direct `agent_login` call.
- [ ] `pnpm --filter @hive-mind/mcp typecheck && build` pass.

### Task 3: The importer

**Files:** modify `scripts/import-vault.mjs`, `tests/import-vault.test.mjs`, `package.json`
only if the `import:vault` script line must change.

- [ ] **Tests first:** `personSession({ url, anonKey, email, password }, fetchFn)` posts the
      password grant and returns `{ jwt, userId }`; a refusal throws `Sign-in failed` without the
      password or email in the message; `ownMembership(...)` reads the caller's oldest member row
      (`members?user_id=eq.<id>&order=created_at,id&limit=1&select=id,hive_id`) and throws
      `You are not in a hive` on an empty answer; credentials come from `HIVE_PERSON_EMAIL` /
      `HIVE_PERSON_PASSWORD` when set, otherwise from a prompt (password not echoed; the prompt is
      injected so the test supplies answers).
- [ ] Implement; delete `personJwt`, the `agent_login` call and the two environment names from
      the usage text. `--dry-run` still signs in (it reads the hive).
- [ ] The existing importer tests pass unchanged apart from sign-in.

### Task 4: The live tests

**Files:** modify `tests/mcp.integration.test.mjs`, `tests/two-members.integration.test.mjs`.

- [ ] `NEEDED` loses `SUPABASE_JWT_SECRET`. Agent JWTs come from `agent-session` (which also
      returns what `agent_login` returned). Person JWTs come from the password grant; when
      `HIVE_PERSON_EMAIL` / `HIVE_PERSON_PASSWORD` (or the `_2` pair) are absent, the checks that
      use that person call `t.skip("no person credentials: …")`.
- [ ] New checks: the function refuses a wrong token with 401; a JWT with a valid shape signed
      by a key generated in the test is refused by the REST API (401).
- [ ] These files do not run in `pnpm test`; `node --check` them and run prettier. They are
      executed in Task 6.

### Task 5: Setup script and docs

**Files:** create `scripts/setup-agent-signing.sh`; modify `.env.example`,
`docs/hosted-db-bringup.md`, `docs/security.md`, `README.md`,
`vault/decisions/2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret.md`,
`vault/moc/operations.md` (where it names the secret).

- [ ] The script (`set -euo pipefail`, `umask 077`, a `mktemp` file removed by a `trap`):
      generate the key into the file; `supabase secrets set --project-ref "$1"
AGENT_SIGNING_JWK="$(…the first key as one line of JSON…)"` without echoing it; print the
      dashboard steps and the file path, wait for Enter; deploy with
      `supabase functions deploy agent-session --project-ref "$1" --use-api --no-verify-jwt`;
      remove the file. It refuses to run without a project ref or without the CLI, and says it
      must be run in the owner's own terminal, not through an assistant.
- [ ] Docs as in the spec §6. `.env.example` loses `SUPABASE_JWT_SECRET`, gains the four
      optional `HIVE_PERSON_*` names with a note that they are for `pnpm test:live` and unattended
      imports only. Gotcha 06: status `closed`, what replaced it, and that the legacy secret may be
      revoked once every machine runs a build from after this slice.

### Task 6: Deploy, live check, gates, review

- [ ] `grep -rn SUPABASE_JWT_SECRET` over the repo: only the allowed places.
- [ ] Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] Whole-branch review with the spec's review focus; one fix wave.
- [ ] **With Danijel** (the one step that needs him): he runs
      `scripts/setup-agent-signing.sh tokyttkztrkjvkaksdnh` in his terminal and imports the key in
      the dashboard. Then, from the worktree, `pnpm test:live` with the Mac's `.env` **without**
      `SUPABASE_JWT_SECRET`: the agent checks pass through the function.
- [ ] If a token signed by a standby key is not accepted by the database, stop and report: the
      design rests on it and the alternative (rotating to the imported key) is the owner's call.
- [ ] `scripts/finish-task.sh`; walkthrough; `/wrapup`.

---

## Execution DAG

- **Edges:** Tasks 1 to 5 depend on nothing but the contract above. Task 6 → Tasks 1, 2, 3, 4, 5.
- **Batch A (parallel, five agents):** Task 1 (`supabase/functions/`, `supabase/config.toml`,
  `tests/agent-session.test.mjs`) ∥ Task 2 (`mcp/`, `tests/mcp-sign-in.test.mjs`) ∥ Task 3
  (`scripts/import-vault.mjs`, `tests/import-vault.test.mjs`) ∥ Task 4 (the two
  `*.integration.test.mjs`) ∥ Task 5 (`scripts/setup-agent-signing.sh`, `.env.example`, docs,
  vault). No file is shared; root `package.json` belongs to Task 3 only, and only if needed.
- **Batch B:** Task 6.
- **Critical path:** Task 1 → Task 6 (the live check waits on the owner's key import).
- One worktree; agents in Batch A do not commit; the orchestrator commits by path after all
  five report.

## Performance and data-fetching budget

No screen and no query changes. Agent sign-in: one function call that makes one indexed
`agent_login` call, once per hour per MCP process. Importer: one password sign-in and one
bounded read (`limit=1`) per run.

## Out of scope

The remote MCP connector, hosting, revoking the legacy secret, agent token expiry, rate
limiting, any migration.
