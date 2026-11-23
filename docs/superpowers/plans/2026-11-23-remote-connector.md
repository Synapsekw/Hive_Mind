# Remote connector, sign-in window and hosting — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A colleague adds `https://<site>/mcp` to Claude or ChatGPT, signs in to Hive Mind in
the window that opens, approves, and the app works as their agent.

**Architecture:** Supabase Auth's OAuth 2.1 server issues the app a pass that says "this
person". The web app (Netlify) hosts the approval window and forwards `/mcp` to a new Edge
Function. The function swaps the pass for the usual limited agent identity through one database
function and runs the hive tools with it. The database refuses the pass everywhere else.

**Tech stack:** Next.js 16 on Netlify, Supabase (Postgres RLS, Auth OAuth server, Edge
Functions/Deno), `@modelcontextprotocol/sdk` 1.32 (web-standard HTTP transport), node:test with
PGlite, Vitest, Playwright.

Spec: [`docs/superpowers/specs/2026-11-23-remote-connector-design.md`](../specs/2026-11-23-remote-connector-design.md).

## Changes from the spec, found while planning

- **Six tools remotely, not seven.** `hive_save_file` reads a file from the agent's own disk; a
  hosted connector has no access to a colleague's disk. It stays in the local server only.
- **No `HIVE_PUBLIC_URL` and no setup script.** The web route, which knows its own address,
  writes the `WWW-Authenticate` header and the metadata. The function is not a supported
  address on its own. Deploying it is one CLI command, documented in the runbook.
- **The Auth-endpoint check happens after the merge to `develop`, before promotion to `main`.**
  It needs a real pass, which exists only once Danijel has set up Netlify and the switches.
- **Settings needs no change.** A connected app is stored with provider `Connected app`, which
  the agents list already prints.
- **The tools file is copied, not imported, into the function**, by a script, with a test that
  fails when the two differ.

## Global constraints

- Sharing is decided in the database. No permission logic in `mcp/`, the function or the web
  routes. No tool for visibility, links' acceptance, deletion, membership or tokens.
- The pass, the agent identity, the signing key and agent tokens appear in no log line, error
  text, test output or commit. Tests generate their own keys. Never print `.env` values.
- Migrations only via `scripts/new-migration.sh connected_apps`; never edit a shipped one.
- Every sharing change has a test in `tests/sharing-rules.test.mjs`.
- Text read from the hive is wrapped as data in every tool answer (`asData`).
- Web changes stay inside `web/src/app/oauth`, `web/src/app/mcp`, `web/src/app/.well-known`,
  `web/src/app/login`, `web/src/app/dev/consent`, `web/src/proxy.ts` and `web/e2e`. No change
  to shared styles, themes or shell: another session is reworking the look. The window reuses
  `login.module.css` classes.
- No hard-coded user-facing sentences in components where the folder has a `no-literals` test;
  follow the neighbouring `text.ts` / `sentences.ts` pattern.
- Tests first, seen failing. Stage by path; conventional commits, lower-case subject, ending
  with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Subagents in a parallel
  batch do not commit; the orchestrator commits by path.
- Browser tests use port 3100, shared with the UI session: a port failure is re-run, not
  debugged.

## Contract shared between tasks

**Database (Task 2 produces):**

```sql
public.jwt_oauth_client() returns text            -- the caller's client_id claim, or null
public.connect_app(p_client_id text, p_name text, p_redirect_host text, p_workspace uuid)
  returns uuid                                     -- the agent's id; a person only
public.connector_login()
  returns table (agent_id uuid, user_id uuid, member_id uuid, workspace_id uuid,
                 hive_id uuid, trust_tier public.trust_tier)   -- an app pass only
```

`connector_login` raises `no connected agent for this app` (PostgREST answers 400) when the
caller has no live agent for its `client_id`.

**Shared signing (Task 4 produces)**, `supabase/functions/_shared/identity.ts`:

```ts
export type Identity = {
  agent_id: string;
  user_id: string;
  member_id: string;
  workspace_id: string;
  hive_id: string;
  trust_tier: string;
};
export type SigningKey = { key: CryptoKey; kid: string };
export function loadKey(raw: string | undefined): Promise<SigningKey | null>;
export function identityFrom(rows: unknown): Identity | "none" | "malformed";
export function signIdentity(
  signing: SigningKey,
  identity: Identity,
  base: string,
  nowMs: number,
): Promise<{ accessToken: string; exp: number }>;
```

`signIdentity` writes exactly the claims `agent-session` writes today (including the random
`session_id`, `iss = ${base}/auth/v1`, one hour).

**Tools (Task 3 produces)**, `mcp/src/tools.ts`, no relative imports, no `node:` imports:

```ts
export type Me = {
  agent_id: string;
  member_id: string;
  workspace_id: string;
  hive_id: string;
  trust_tier: string;
};
export type GetSession = () => Promise<{ db: SupabaseClient; me: Me }>;
export const asData, done, fail; // as in index.ts today
export function registerTools(server: McpServer, session: GetSession): void; // six tools
```

**Connector (Task 5 produces)**, `supabase/functions/mcp/connector.ts`:

```ts
export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};
export function handle(
  req: Request,
  env: Env,
  fetchFn?: typeof fetch,
  now?: () => number,
): Promise<Response>;
```

- No `Authorization: Bearer …` → `401 {"error":"sign in to the hive"}`.
- `connector_login` answers 400 or 401 → `401`, same body. Other 4xx/5xx or unreachable → `502`.
- Body over 2 MB → `413`. Key missing → `500`.
- Otherwise the MCP answer as `application/json` (stateless, `enableJsonResponse: true`).

**Web routes (Task 6 produces):**

- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`
  → `{ "resource": "<origin>/mcp", "authorization_servers": ["<SUPABASE_URL>/auth/v1"],
"bearer_methods_supported": ["header"] }`.
- `/mcp` (GET, POST, DELETE): without a bearer header answers 401 itself; otherwise forwards
  to `HIVE_CONNECTOR_URL` and returns status and body. Every 401 carries
  `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.

---

### Task 1: Netlify proof

**Files:** Create `netlify.toml`; modify `web/package.json` only if the runtime needs a
dependency.

**Interfaces:** Produces a working Netlify build configuration. Consumes nothing.

- [ ] **Step 1:** Write `netlify.toml` at the repo root: `[build] base = ""`,
      `command = "pnpm --filter @hive-mind/web build"`, `publish = "web/.next"`,
      `[build.environment] NODE_VERSION = "22"`, and `[[plugins]] package =
  "@netlify/plugin-nextjs"` if the CLI does not detect Next.js by itself.
- [ ] **Step 2:** Run `npx netlify-cli build --offline` from the repo root (no account needed).
      Expected: the Next.js runtime packages the app without error and reports `proxy.ts` as
      middleware/edge handler.
- [ ] **Step 3:** Run `npx netlify-cli serve --offline --port 3200` with the variables of
      `web/.env.local`; open `/login` (renders), `/` (redirects to `/login`), and check a
      server action route responds. Stop the server.
- [ ] **Step 4:** If any step fails on Next.js 16 support, **stop the whole build** and report
      the exact error to Danijel. Otherwise record the CLI and runtime versions in the task
      report. No commit by the subagent.

### Task 2: Migration `connected_apps` and its tests

**Files:** Create `supabase/migrations/<stamp>_connected_apps.sql` (via
`scripts/new-migration.sh connected_apps`); modify `tests/sharing-rules.test.mjs`,
`scripts/local-db.mjs` only if a stub is missing.

**Interfaces:** Produces the three functions of the contract.

- [ ] **Step 1: failing tests.** Add to `tests/sharing-rules.test.mjs`, using a helper
      `const appPass = (name, client = "client-a") => ({ sub: users[name], role:
  "authenticated", client_id: client })`:
  - "an app pass reads and writes nothing": for every table in `public` (query
    `pg_tables`), `select` returns no rows and an `insert`/`update`/`delete` attempt is
    refused or touches nothing; same for `storage.objects`.
  - "every function refuses an app pass except connector_login": list from `pg_proc` every
    function in `public` on which `authenticated` has `EXECUTE`
    (`has_function_privilege('authenticated', oid, 'execute')`), minus trigger functions and
    an explicit allow-list of pure helpers that read no data (`jwt_agent_id`,
    `jwt_is_self_hosted`, `jwt_oauth_client`, `note_topic`); for each remaining one except
    `connector_login`, a call as an app pass raises or returns nothing a person's call would.
    The test fails when a function is in neither group and unguarded.
  - `connect_app`: a person connects an app to their own workspace and gets an agent with
    `oauth_client_id`, `token_hash` null, provider `Connected app`; refused for an agent
    identity, for an app pass, for a workspace of another member; host `claude.ai`,
    `x.claude.ai`, `chatgpt.com`, `auth.openai.com` → `vendor`; `evil-claude.ai`,
    `claude.ai.evil.com`, empty → `self_hosted`; a second call for the same client updates
    workspace and name, keeps the id, clears `revoked_at`; an `agent.connected` audit row.
  - `connector_login`: returns the row for the caller's client; raises for a person without
    `client_id`, for an unknown client, for a revoked agent, and never returns another
    member's agent with the same `client_id`; stamps `last_used_at`.
  - "a connected app's agent identity behaves as any vendor agent" (writes in its workspace,
    cannot change sharing): one assertion reusing the existing agent helpers.
- [ ] **Step 2:** Run `node --test tests/sharing-rules.test.mjs`; the new tests fail.
- [ ] **Step 3: the migration.**
  - `alter table public.agents add column oauth_client_id text; alter column token_hash drop
not null;` check `num_nonnulls(token_hash, oauth_client_id) = 1`; unique index on
    `(member_id, oauth_client_id) where oauth_client_id is not null`.
  - `jwt_oauth_client()`: `nullif(current_setting('request.jwt.claims', true)::jsonb ->>
'client_id', '')`, `stable`, `set search_path = ''`, written like `jwt_agent_id()`.
  - For every table in `public` and for `storage.objects`: `create policy <table>_no_app on
… as restrictive for all to authenticated using (public.jwt_oauth_client() is null) with
check (public.jwt_oauth_client() is null);` written out table by table (no dynamic SQL).
  - Functions: add `if public.jwt_oauth_client() is not null then raise exception 'an app
pass cannot do this'; end if;` to every data function `authenticated` may execute
    (`create or replace`, body otherwise copied unchanged from its latest definition). Where
    one helper is the common gate (`my_member_ids`, `my_hive_ids`), guard there by returning
    no rows and guard the callers that use `auth.uid()` directly. `agent_login` (called as
    `anon`) is unchanged.
  - `connect_app` and `connector_login` as in the contract, `security definer`,
    `set search_path = ''`, `revoke all … from public, anon` and `grant execute … to
authenticated`. `connect_app` checks `auth.uid()` not null, `jwt_agent_id()` null,
    `jwt_oauth_client()` null, `length(p_client_id) between 1 and 200`,
    `length(p_name) between 1 and 120`, and that the workspace belongs to a member row of the
    caller. Host rule: `p_redirect_host` lower-cased equals, or ends with `'.' ||`, one of
    `claude.ai`, `claude.com`, `chatgpt.com`, `openai.com`.
- [ ] **Step 4:** Run the file again: all pass. Run `pnpm test`: nothing else broke (the web
      unit tests that stub `token_hash` may need the nullable type).
- [ ] **Step 5:** No commit (parallel batch).

### Task 3: Tools in one file

**Files:** Create `mcp/src/tools.ts`, `tests/mcp-tools.test.mjs`; modify `mcp/src/index.ts`.

**Interfaces:** Produces `registerTools`, `asData`, `done`, `fail`, `Me`, `GetSession`.

- [ ] **Step 1: failing test** `tests/mcp-tools.test.mjs`: build an `McpServer`, call
      `registerTools(server, session)` with a stub session, connect it to an
      `InMemoryTransport` pair with an SDK `Client`, and assert `listTools` returns exactly
      `hive_overview, hive_search, hive_read, hive_write, hive_append, hive_propose_link`
      with the same descriptions and input schemas as today (snapshot the current ones from
      the built server first), and that a `hive_read` answer is wrapped in `<hive-data>`.
- [ ] **Step 2:** Run it: fails (no `tools.ts`).
- [ ] **Step 3:** Move the six tool registrations and `asData`/`done`/`fail` from
      `index.ts` to `tools.ts` unchanged, replacing each `await db()` with
      `await session()`. `tools.ts` imports only `@modelcontextprotocol/sdk/server/mcp.js`,
      `@supabase/supabase-js` (types) and `zod`. `index.ts` keeps the environment, `db()`,
      `hive_save_file` (using the exported helpers) and the stdio transport, and calls
      `registerTools(server, db)`.
- [ ] **Step 4:** `pnpm --filter @hive-mind/mcp build && node --test tests/mcp-tools.test.mjs
  tests/mcp-sign-in.test.mjs`: pass. Add the SDK, `zod` and `@supabase/supabase-js` to the
      root `devDependencies` (same versions as `mcp/`) so files outside `mcp/` resolve them.
- [ ] **Step 5:** No commit.

### Task 4: Shared signing code

**Files:** Create `supabase/functions/_shared/identity.ts`; modify
`supabase/functions/agent-session/session.ts`. Test: `tests/agent-session.test.mjs` (unchanged,
must stay green) plus three direct tests of `signIdentity` in
`tests/identity.test.mjs`.

**Interfaces:** Produces the `identity.ts` contract.

- [ ] **Step 1:** Write `tests/identity.test.mjs`: `signIdentity` with a generated key yields
      a JWT that verifies with the public key, carries exactly the claim names `role, aud,
  sub, agent_id, workspace_id, trust_tier, session_id, iat, exp, iss`, `exp = iat + 3600`,
      and two calls give different `session_id`. Run: fails.
- [ ] **Step 2:** Move `base64url`, `base64urlJson`, `importSigningKey`, `loadKey`,
      `identityFrom`, `sign` and the claim object into `identity.ts`; `session.ts` imports
      them (`../_shared/identity.ts`) and behaves identically.
- [ ] **Step 3:** `node --test tests/identity.test.mjs tests/agent-session.test.mjs`: all
      pass, none edited.
- [ ] **Step 4:** No commit.

### Task 5: The connector function

**Files:** Create `supabase/functions/mcp/connector.ts`, `supabase/functions/mcp/index.ts`,
`supabase/functions/mcp/deno.json`, `supabase/functions/mcp/tools.ts` (generated copy),
`scripts/sync-connector-tools.mjs`, `tests/mcp-connector.test.mjs`; modify
`supabase/config.toml` (`[functions.mcp] verify_jwt = false`), `package.json` (script
`sync:tools`), `.prettierignore` only if the copy needs it.

**Interfaces:** Consumes Task 3's `registerTools`, Task 4's `identity.ts`, Task 2's
`connector_login`. Produces `handle`.

- [ ] **Step 1: failing tests** `tests/mcp-connector.test.mjs`, in the style of
      `agent-session.test.mjs` (stub `fetchFn`, generated key):
  - no header, a non-Bearer header, an empty bearer → 401 with the fixed body; the stub
    database is never called.
  - `connector_login` 400 → 401; 403/404/429/500 and a thrown fetch → 502; no row → 401;
    malformed row → 502.
  - the pass is sent to `connector_login` as `Authorization: Bearer <pass>` with the
    publishable key as `apikey`, and to nothing else; no response body or log line contains
    the pass or the signed identity (spy on `console.error`).
  - a valid pass and an MCP `initialize` request → 200 JSON-RPC result naming the server
    `hive-mind`; `tools/list` → the six tools; `tools/call hive_overview` → the stub
    database receives requests carrying a bearer JWT that verifies with the test public key
    and holds the row's `agent_id`.
  - body over 2 MB → 413; `signingJwk` undefined → 500 before the database is asked.
  - "the function's tools file is the server's": `supabase/functions/mcp/tools.ts` equals
    `mcp/src/tools.ts` byte for byte after the import rewrite the script applies.
- [ ] **Step 2:** Run: fails.
- [ ] **Step 3: implement.**
  - `scripts/sync-connector-tools.mjs`: copies `mcp/src/tools.ts` to
    `supabase/functions/mcp/tools.ts` under a header comment "generated, edit
    mcp/src/tools.ts"; `--check` exits 1 on a difference. Bare imports stay as they are and
    are mapped by `deno.json`: `"imports": { "@modelcontextprotocol/sdk/":
"npm:@modelcontextprotocol/sdk@1.32.2/", "@supabase/supabase-js":
"npm:@supabase/supabase-js@2", "zod": "npm:zod@3" }`.
  - `connector.ts`: read the bearer; `loadKey`; call `${base}/rest/v1/rpc/connector_login`
    (POST, empty JSON body, 10 s timeout, `redirect: "error"`); `identityFrom`;
    `signIdentity`; `createClient(env.url, env.anonKey, { auth: { persistSession: false,
autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}`
}, fetch: fetchFn } })`; a new `McpServer({ name: "hive-mind", version: "0.1.0" })`,
    `registerTools(server, async () => ({ db, me: identity }))`, and a
    `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
enableJsonResponse: true })` from
    `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`; return
    `transport.handleRequest(req)`; close server and transport afterwards. Failures use a
    `fail(status, error, reason)` that logs one fixed phrase, as in `session.ts`.
  - `index.ts`: as `agent-session/index.ts`, same three environment values.
- [ ] **Step 4:** `node --test tests/mcp-connector.test.mjs`: pass. `pnpm typecheck` clean.
- [ ] **Step 5:** No commit.

### Task 6: Web — approval window, routes, return after sign-in

**Files:** Create `web/src/app/oauth/consent/page.tsx`, `ConsentForm.tsx`, `actions.ts`,
`decide.ts`, `decide.test.ts`, `text.ts`; `web/src/app/mcp/route.ts`, `route.test.ts`;
`web/src/app/.well-known/oauth-protected-resource/[[...rest]]/route.ts`, `route.test.ts`;
`web/src/app/dev/consent/page.tsx`; `web/e2e/consent.spec.ts`. Modify `web/src/proxy.ts`
(+ its test if one exists), `web/src/app/login/page.tsx`, `login-form.tsx`,
`web/src/app/auth/confirm/route.ts` only if `next` is not already carried, `.env.example`.

**Interfaces:** Consumes `connect_app` (by name and arguments) and the route contract.

- [ ] **Step 1: failing unit tests.**
  - `decide.test.ts` for `decideIn(db, { authorizationId, decision, workspaceId })` →
    `{ ok: true, redirect: string } | { ok: false }`: approve reads
    `db.auth.oauth.getAuthorizationDetails`, calls `rpc("connect_app", { p_client_id,
p_name, p_redirect_host, p_workspace })` with values taken from those details (never
    from the form), then `approveAuthorization`, and returns its `redirect_url`; if
    `connect_app` errors, `approveAuthorization` is not called; deny calls only
    `denyAuthorization`; a malformed id or workspace, missing session or any error →
    `{ ok: false }`; `p_redirect_host` is the lower-cased host of `redirect_uri`, empty when
    it does not parse.
  - `mcp/route.test.ts`: no bearer → 401 with the `WWW-Authenticate` header built from the
    request's origin, connector not called; with bearer → forwards method, body and the
    headers `authorization, content-type, accept, mcp-protocol-version, mcp-session-id` to
    `HIVE_CONNECTOR_URL`, returns status and body; a 401 from the connector gets the header
    added; `HIVE_CONNECTOR_URL` unset → 503; a body over 2 MB → 413; cookies are never
    forwarded.
  - well-known `route.test.ts`: the JSON of the contract for both paths; 404 when
    `NEXT_PUBLIC_SUPABASE_URL` is unset.
  - proxy: `/mcp` and `/.well-known/…` pass without a session and without touching cookies;
    `/oauth/consent?authorization_id=x` without a session redirects to
    `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dx`.
  - login: the form sends `emailRedirectTo` = `/auth/confirm?next=<safe next>` and after a
    password sign-in goes to the safe `next`.
- [ ] **Step 2:** `pnpm --filter @hive-mind/web test`: the new tests fail.
- [ ] **Step 3: implement.**
  - `page.tsx` (server): await `searchParams`; no `authorization_id` → the "nothing to
    approve" line; `createServerSupabase()`; `getAuthorizationDetails`; a result without
    `authorization_id` (already approved) → `redirect(redirect_url)`; `ownHive(db)`; `null` →
    the not-in-a-hive line; workspaces of the member: `from("workspaces").select("id,
name").eq("member_id", hive.memberId).order("created_at").limit(50)`; render
    `ConsentForm` with app name, return host, workspaces, preselecting the one named `Main`
    or the first.
  - `ConsentForm.tsx` (client): app name and "returns to <host>", a `<select>` of
    workspaces, **Approve** and **Deny**; a line that says the app will read what the member
    can read and write only into the chosen workspace, and that sharing stays the member's
    decision; calls the action, then `window.location.assign(redirect)`; a visible error
    line on `{ ok: false }`. Sentences live in `text.ts`. Classes from
    `../../login/login.module.css`.
  - `actions.ts`: `"use server"`; `decide(authorizationId, decision, workspaceId)` →
    `decideIn(await createServerSupabase(), …)`, catching to `{ ok: false }`.
  - Routes and proxy as tested. `/mcp` uses `export const dynamic = "force-dynamic"`.
  - `dev/consent/page.tsx`: the form on fixtures with `?state=ok|nohive|error|deny`, like the
    other `/dev` pages.
- [ ] **Step 4:** `web/e2e/consent.spec.ts` on `/dev/consent`: the app name and host show;
      the workspace can be changed; Approve leads to the fixture redirect; Deny likewise; the
      error state shows its line; keyboard reaches both buttons. Run
      `pnpm --filter @hive-mind/web test && pnpm --filter @hive-mind/web test:e2e`.
- [ ] **Step 5:** No commit.

### Task 7: Runbook, docs, config, live checks

**Files:** Modify `docs/hosted-db-bringup.md`, `docs/security.md`, `docs/agent-integration.md`,
`docs/README.md`, `mcp/README.md`, `.env.example`, `supabase/config.toml`
(`[auth.oauth_server] enabled = true`, `authorization_url_path = "/oauth/consent"`,
`allow_dynamic_registration = true`), `tests/mcp.integration.test.mjs`.

**Interfaces:** Consumes the route contract.

- [ ] **Step 1:** Live check, skipped unless `HIVE_SITE_URL` is set: `POST <site>/mcp`
      without a header → 401 with `resource_metadata`; the metadata address answers the
      contract's JSON; the Supabase discovery address in it answers 200.
- [ ] **Step 2:** Runbook section "Hosting and the connector": Netlify (connect the repo,
      base and build command from `netlify.toml`, the variables
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `HIVE_CONNECTOR_URL`,
      production branch `main`, branch deploy `develop`); Supabase switches (OAuth server on,
      dynamic registration on, authorisation path, Site URL and redirect list, and that the
      Site URL moves from the `develop` site to the `main` site at promotion); deploying the
      function (`supabase functions deploy mcp --use-api --no-verify-jwt --project-ref
  <ref>`); adding the connector in Claude and in ChatGPT, step by step.
- [ ] **Step 3:** `docs/security.md`: the connector section (what the pass can do, the
      refusal rule, dynamic registration, the tier by return host, the open Auth-endpoint
      check, no rate limit). `docs/agent-integration.md`: the remote route is built, six
      tools, `hive_save_file` local only. `mcp/README.md`: the same in two lines.
- [ ] **Step 4:** `pnpm lint` clean. No commit.

### Task 8: Integrate, apply, review

- [ ] Commit each task's files by path, one commit per task.
- [ ] `pnpm sync:tools --check`, then `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
      and the browser tests: all green, output read.
- [ ] Apply the migration to project `tokyttkztrkjvkaksdnh` through the Supabase MCP and
      re-stamp `supabase_migrations.schema_migrations.version` to the repo's stamp. Confirm
      the hosted agent still works: `hive_overview` through this session's hive tools.
- [ ] Deploy the function: `supabase functions deploy mcp --use-api --no-verify-jwt
  --project-ref tokyttkztrkjvkaksdnh`; `curl` it without a header → 401.
- [ ] Independent review by a fresh agent given the diff and the spec (not this plan's
      conclusions), with the security questions: can a pass reach anything but
      `connector_login`; can the consent action be driven to connect another person's
      workspace or a forged client; open redirects through `next` or `redirect_url`; anything
      secret in logs; SSRF or header smuggling in the `/mcp` forward. One fix wave, gates
      again.
- [ ] `scripts/finish-task.sh`; `ExitWorktree({ action: "keep" })`; remove the empty folder.

### Task 9: With Danijel, on `develop` (after the merge)

- [ ] Netlify account, site, variables; Supabase switches; first deploy of `develop`.
- [ ] `HIVE_SITE_URL=<site> pnpm test:live`.
- [ ] Hand test: Claude web, Claude desktop, ChatGPT. Then the Auth-endpoint check with a
      real pass (does `GET` and `PUT /auth/v1/user` accept it); if it does, close it or stop
      and decide with Danijel before promotion.
- [ ] `/wrapup`. The slice is complete only when both apps have passed.

## Execution DAG

```
T1 (proof) ──► T2 ─┐
               T3 ─┼─► T5 ─┐
               T4 ─┘       ├─► T8 ─► T9
               T6 ─────────┤
               T7 ─────────┘
```

- **Batch 0:** T1 alone. A failure stops everything.
- **Batch 1 (parallel, disjoint files):** T2, T3, T4, T6, T7.
- **Batch 2:** T5 (needs T3 and T4 in the tree; uses T2 only by name).
- **Batch 3:** T8, then T9 with Danijel.
- **Critical path:** T1 → T3 → T5 → T8 → T9. T2 is the largest single task and bounds batch 1.
- Shared files in batch 1: only `.env.example` (T6 adds `HIVE_CONNECTOR_URL`, T7 adds
  `HIVE_SITE_URL`); T7 owns the file and adds both, T6 does not touch it. Root
  `package.json` is edited by T3 (devDependencies) and T5 (script), in different batches.

## Performance and data-fetching budget

- **Approval window, first paint:** one server render: session check, authorisation details,
  `ownHive` (one indexed query), workspaces of one member (indexed on `member_id`, limit 50).
  Choosing a workspace is client state, 0 round-trips. Approve or deny is one server action:
  one details read, one `connect_app`, one approve call, then a redirect.
- **A tool call:** one forward through the web route, one `connector_login` (unique index on
  `(member_id, oauth_client_id)`, one row updated), one local signature, then the tool's own
  queries, unchanged and already bounded. No stream held open, no polling, no cache.
- **Restrictive policies** add one stable function call per statement, not per row scan of
  another table.

## Out of scope

Emailed invitations; a custom domain; rate limiting; saving files through the connector; an
owner's list of approved apps; desktop apps; a separate production Supabase project.
