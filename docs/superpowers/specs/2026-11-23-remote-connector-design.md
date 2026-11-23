---
type: spec
status: draft
date: 2026-11-23
tags: [project/hive-mind, mcp, hosting, oauth]
related:
  - "[[2026-11-16-hive-mind-design]]"
  - "[[2026-11-23-agent-sign-in-design]]"
  - "[[2026-11-23-invitations-design]]"
---

# Remote connector, sign-in window and hosting

Fourth slice of Phase 3. A colleague connects Claude or ChatGPT to the hive in two minutes with
nothing installed: paste one address, sign in, approve.

## 1. Goal and the test of success

1. The owner invites a colleague in Settings (built).
2. In Claude or ChatGPT the colleague adds a custom connector with the address
   `https://<site>/mcp`, the same for everyone.
3. A Hive Mind window opens. The colleague signs in by email, sees which app asks to connect,
   picks a workspace and clicks **Approve**.
4. The app can use the seven hive tools as that colleague's agent.

Done means: this works by hand in **Claude (web and desktop) and in ChatGPT**, on the hosted web
app, and the four gates pass. If either app cannot be made to work, the slice is reported as
incomplete.

Decisions taken with Danijel on 2026-11-23: sign-in window (OAuth) now, no personal connector
address; the web app is hosted on Netlify under a free `netlify.app` address; both apps proven.

## 2. Why the app's subscription cannot sign the person in

Claude and ChatGPT call our server; they pass no account identity. The colleague must prove which
Hive Mind member they are, so the window signs them in to Hive Mind itself. "Sign in with your
Claude or ChatGPT plan" belongs to Phase 6 (hosted chat) and needs the vendors' programmes.

## 3. Parts

| Part              | Where                                          | What it does                                                                               |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Web app, hosted   | Netlify, from `main`                           | Everything it does today, plus the approval window and the public `/mcp` address           |
| OAuth server      | Supabase Auth (beta feature, dashboard switch) | Discovery, client registration, authorisation codes, access and refresh tokens             |
| Approval window   | `web/src/app/oauth/consent`                    | Signs the person in, shows the asking app, takes the workspace and the decision            |
| Connector         | Edge Function `supabase/functions/mcp`         | MCP over HTTP: swaps the app's pass for an agent identity, runs the tools                  |
| Tools, one source | `mcp/src/tools.ts`                             | The seven tools, independent of transport; used by the stdio server and by the connector   |
| Database          | one migration                                  | Connected apps as agents, the swap function, and the refusal of app passes everywhere else |

The signing key stays where it is: in the Edge Functions' secrets. It is not copied to Netlify.

## 4. The flow

1. The app calls `https://<site>/mcp` with no pass. The answer is `401` with a
   `WWW-Authenticate` header naming the resource metadata at
   `https://<site>/.well-known/oauth-protected-resource`, which names the Supabase Auth server.
2. The app discovers the auth server, registers itself (dynamic client registration) and sends
   the person to Supabase's authorise address. Supabase redirects to
   `https://<site>/oauth/consent?authorization_id=…`.
3. The window: not signed in → the existing email sign-in, returning to the same address
   afterwards (the link in the email lands on the consent page too). Signed in, no hive → the
   existing "you are not in a hive" message; nothing to approve.
4. Signed in with a hive → the page shows the app's name and the host it returns to, a workspace
   picker (the person's workspaces in their own hive, `Main` preselected) and **Approve** /
   **Deny**.
5. **Approve** (server action): reads the authorisation details again on the server, calls
   `connect_app`, then `approveAuthorization`, and redirects to the address Supabase returns.
   **Deny** calls `denyAuthorization` and redirects likewise. If `connect_app` fails, nothing is
   approved.
6. The app exchanges its code for a pass and calls `/mcp` with it. The connector calls
   `connector_login` with that pass, receives the agent's claims, signs a one-hour agent identity
   with the existing key (same claims as `agent-session`, including the `session_id` no session
   has) and runs the tool with it.

`/mcp` and `/.well-known/oauth-protected-resource` on the site are thin route handlers. `/mcp`
forwards the request, body and `Authorization` header to the function and returns its answer; it
holds no secret and decides nothing. The connector answers plain JSON responses, no long-lived
stream, no server-side session (stateless), so a forward is enough.

## 5. Database (one migration, `connected_apps`)

- `agents.oauth_client_id text` (null for token agents); unique on `(member_id,
oauth_client_id)`. `agents.token_hash` becomes nullable; a check requires exactly one of
  `token_hash`, `oauth_client_id`.
- `jwt_oauth_client()` returns the `client_id` claim of the caller's identity, or null.
- `connect_app(p_client_id text, p_name text, p_redirect_host text, p_workspace uuid) returns
uuid`: a person only (no `agent_id`, no `client_id`), the workspace must be the caller's own.
  Creates the agent or, for the same member and client, updates its workspace and name and
  clears `revoked_at`. Trust tier: `vendor` when the redirect host is one of a fixed list in the
  migration (`claude.ai`, `claude.com`, `chatgpt.com`, `openai.com` and their subdomains),
  otherwise `self_hosted`, so an unknown program's writes are held for review. Writes
  `agent.connected` to the audit log.
- `connector_login()` returns the same columns as `agent_login`: the caller must carry a
  `client_id`; it finds the caller's agent for that client, not revoked, and stamps
  `last_used_at`. No agent → it raises, and the connector answers 401.
- **An app's pass is refused everywhere else.** A pass says "I am this person", so without this
  rule the app could change sharing. Every table in `public` and `storage.objects` gets a
  restrictive policy that fails when `jwt_oauth_client()` is not null, and every function that
  `authenticated` may execute refuses such a caller, except `connector_login`.
- `revoke_agent` works unchanged: a revoked connected app fails `connector_login` on its next
  call, since the identity is made per call. Approving again in the window reconnects it.

Tests in `tests/sharing-rules.test.mjs`: an app pass can read or write no table and no stored
file; a catalogue test lists every function `authenticated` may execute and proves each refuses
an app pass except `connector_login`, so a function added later cannot be forgotten;
`connect_app` refuses agents, app passes and other people's workspaces; the tier rule; reconnect
after revoke; `connector_login` for no agent, a revoked agent and another member's agent.

## 6. Connector function

`supabase/functions/mcp/` follows `agent-session`: a pure `handle(req, env, fetchFn, now)` in its
own file, tested under Node, and a thin `index.ts`. It shares the signing code with
`agent-session` (moved to `supabase/functions/_shared/`).

- No or malformed `Authorization` → 401 with `WWW-Authenticate`. `connector_login` refused → 401.
  Database or network trouble → 502. Body over the limit → 413.
- `GET` on the metadata path of the function returns the resource metadata as well, so the
  function can also be used at its own address.
- Secrets: `AGENT_SIGNING_JWK`, `HIVE_PUBLISHABLE_KEY` (both exist) and `HIVE_PUBLIC_URL` (the
  site address used in the metadata). `verify_jwt = false`; the function checks the pass itself
  through `connector_login`, which lets the database verify signature and expiry.
- The tools come from `mcp/src/tools.ts`: `registerTools(server, session)` where `session` gives
  a database client and the agent's identity. `mcp/src/index.ts` keeps the stdio transport and
  the token sign-in. How the function build takes the shared file (a relative import with an
  import map, or a checked copy made by a script) is settled in the first build task; either way
  one source and a test that fails if the two drift.
- The MCP server does not check permissions; the database decides, as today.

## 7. Web app

Kept small because another session is reworking the look.

- `oauth/consent/page.tsx` (server) and its client form, `oauth/consent/actions.ts`,
  `oauth/consent/decide.ts` (the testable core, like `vault/write.ts`). Styled with the existing
  login screen's parts; no new visual language.
- `mcp/route.ts` and `.well-known/oauth-protected-resource/route.ts`.
- `proxy.ts`: `/mcp` and `/.well-known/` are open; `/oauth/consent` needs a sign-in and comes
  back to itself with its query intact. The login and `/auth/confirm` routes carry a `next`
  address, accepted only when it is a path on this site.
- Settings: a connected app is an agent and already appears in the list with its revoke button.
  The only change is the wording for an agent without a token ("Connected app").
- New environment variable for the web app: `HIVE_CONNECTOR_URL` (the function's address,
  server-side). No secret is added to the web app.

## 8. Hosting

- Netlify site built from `web/` in the pnpm workspace; `netlify.toml` in the repo. `main` is
  production. A branch deploy of `develop` is the test site.
- **First build task is a proof:** the app builds and runs on Netlify with Next.js 16 (sign-in,
  a server action, `proxy.ts`). If it does not, the build stops and Danijel is told.
- Supabase settings, made once by Danijel in the dashboard and written into
  `docs/hosted-db-bringup.md` and `supabase/config.toml`: OAuth server on, dynamic registration
  on, authorisation path `/oauth/consent`, Site URL and redirect list for the site. For the hand
  test the Site URL is the `develop` test site; at promotion it becomes the production address.
- A script, `scripts/setup-connector.sh <project-ref> <site-url>`, sets `HIVE_PUBLIC_URL` and
  deploys the function, in the style of `setup-agent-signing.sh`.

## 9. Security

- The pass is held by the vendor's servers, not shown to the model. It can do one thing in the
  database: become the limited agent the person approved.
- **To verify before merge:** whether a pass is accepted by Supabase Auth's own account
  endpoints (change of email or password). If it is and it cannot be closed (for example by an
  access-token hook that changes the audience), the build stops and Danijel decides.
- Dynamic registration lets any program register. It gains nothing until a signed-in member
  approves it in the window, and an unknown program is `self_hosted`.
- The window shows the app's own name, which a program chooses for itself; the host it returns
  to is shown beside it and decides the tier.
- `next` addresses are same-site paths only (no open redirect).
- Text from the hive stays wrapped as data in every tool answer.
- `docs/security.md` gains a section on the connector; the audit log records `agent.connected`.

## 10. Performance and data budget

- Approval window: first paint is one page load with the session check, the authorisation
  details and one bounded read of the person's workspaces. Picking a workspace is client state.
  Approve is one server action (two writes, one redirect).
- A tool call: one forward, one `connector_login` (indexed on `(member_id, oauth_client_id)`),
  one local signature, then the tool's own queries, unchanged and already bounded.
- No polling, no stream held open.

## 11. Independent units

1. Migration and its tests.
2. Tools extracted to `mcp/src/tools.ts` (stdio server unchanged in behaviour).
3. Connector function (needs 1's function names and 2's interface, not their code, to start).
4. Web: approval window, the two routes, `next` handling.
5. Hosting: `netlify.toml`, the setup script, runbook and docs.

The Netlify proof comes first and alone. Then 1, 2, 4 and 5 run in parallel; 3 follows 2.

## 12. Testing

- Database: section 5.
- Connector: `tests/mcp-connector.test.mjs` on `handle` (401 shapes, metadata, the swap, the
  claims signed, 502/413, a tool call end to end against PGlite).
- Web: unit tests for `decide.ts`, the routes and the `next` rule; browser tests for the window
  on a `/dev` fixture (approve, deny, no hive, error).
- Live: `pnpm test:live` gains checks that an unauthenticated call gets the 401 and metadata.
- By hand, before the slice is called done: Claude web, Claude desktop, ChatGPT.

## 13. What Danijel does

Creates a Netlify account and connects the repository; sets the web app's environment variables
there; flips the Supabase switches in section 8; runs `setup-connector.sh` in his own terminal;
tests in Claude and in ChatGPT (a plan with developer mode for custom connectors).

## 14. Not in this slice

Emailed invitations; a custom domain; rate limiting and lockout on the connector; a list of
approved apps per hive for the owner; showing connected apps differently in Settings beyond the
wording; a production Supabase project separate from the dev one.

Decided on 2026-11-23 for later: signed desktop apps for Mac and Windows that wrap this same web
app, so a member may use either. The web app stays the base; the sign-in window and the
connector are web addresses in both cases.

## 15. Risks

- The Supabase OAuth server is in beta; its behaviour may differ from its documentation.
- ChatGPT's connector may need something Claude's does not (discovery paths, registration
  details). Both are tested by hand; differences are fixed in this slice.
- The email sign-in link opens in a new tab, away from the window the app opened. The approval
  completes from whichever tab holds it; to be confirmed by hand in both apps.
- Netlify's Next.js runtime and Next.js 16: proven first.
