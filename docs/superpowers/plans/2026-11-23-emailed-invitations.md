# Emailed Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server emails invitations; a person joins a hive only by pressing Join; sign-ups
can then be closed.

**Architecture:** A migration replaces silent joining with `my_invitations` /
`accept_invitation` and adds `invitation_to_email`, the one database call of a new Edge Function
`invite-email`, which makes a sign-in link with the secret key and mails it through Resend. The
web app gains `/join` and a Send again button.

**Tech stack:** Postgres (PGlite in tests), Deno Edge Function written against web-platform APIs
(runs under `node --test`), Next.js 16, Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-11-23-emailed-invitations-design.md`. Read it first.

## Global constraints

- Sharing and membership are decided in the database; the function and the web app check nothing.
- The secret key, `RESEND_API_KEY`, tokens and email addresses never reach a log line, a browser
  or a commit. A failure is logged as one fixed phrase.
- New migration only via `scripts/new-migration.sh emailed_invitations`; never edit a shipped one.
- Every function `authenticated` may execute refuses `jwt_agent_id()`, `jwt_is_self_hosted()` and
  `jwt_oauth_client()` (the catalogue test in `tests/sharing-rules.test.mjs` enforces it).
- Supabase dynamic client registration stays off; do not touch `[auth.oauth_server]`.
- Settings look: one new button and changed text only. Reuse existing CSS classes.
- Subagents do not commit and do not run git; the orchestrator stages by path and commits.
- Exact messages (tests and the web app match on them):
  `only the hive owner can invite members`, `that person is already a member`,
  `that email is already invited`, `too many invitations today`, `invitation not found`,
  `wait before sending again`, `too many emails for this invitation`, `sign in as a person`.

## Contracts

```sql
invite_member(p_hive uuid, p_email text, p_display_name text) returns uuid   -- invitation id
invitation_to_email(p_invitation uuid) returns text                          -- the address
my_invitations() returns table (id uuid, hive_name text, invited_by text, expires_at timestamptz)
accept_invitation(p_invitation uuid) returns uuid                            -- hive id
revoke_invitation(p_invitation uuid) returns void                            -- unchanged
-- dropped: claim_invitations(); add_member: execute revoked from authenticated
```

```
POST <supabase>/functions/v1/invite-email
  Authorization: Bearer <the owner's session access token>
  { "invitation": "<uuid>" }
200 { "ok": true }
400 { "error": "send a JSON body with an invitation" }
401 { "error": "sign in" }                  no bearer
403 { "error": "not allowed" }              the database refused
429 { "error": "wait before sending again" }   either limit
502 { "error": "the email could not be sent" } Auth or Resend failed
503 { "error": "email is not set up" }      a secret is missing
405 for anything but POST; 413 over 2 KB
```

```ts
// web/src/settings/types.ts
export type InviteReason =
  "already-member" | "already-invited" | "too-many" | "failed";
export type Invited =
  { ok: true; id: string; sent: boolean } | { ok: false; reason: InviteReason };
export type Sent = { ok: true } | { ok: false; reason: "wait" | "failed" };
// SettingsActions gains: resendInvitation(id: string): Promise<Sent>;

// web/src/join/types.ts
export type Waiting = {
  id: string;
  hiveName: string;
  invitedBy: string;
  expiresAt: string;
};
```

---

### Task 1: Migration and sharing-rule tests

**Files:** create `supabase/migrations/<minted>_emailed_invitations.sql`; modify
`tests/sharing-rules.test.mjs`, `tests/import-vault.test.mjs`, `scripts/demo.mjs`,
`scripts/local-db.mjs` (only if a stub is missing).

**Produces:** the SQL contracts above. **Consumes:** nothing.

- [ ] Mint the migration with `scripts/new-migration.sh emailed_invitations`.
- [ ] Write failing tests first, in a new section "Emailed invitations":
  - `invite_member` returns a uuid, writes `member.invited`, never creates a member even when a
    confirmed account with that email exists; refuses non-owner, agent, self-hosted, app pass,
    bad email, bad name, existing member, open invitation; an expired invitation no longer
    blocks; the 21st invitation of a hive within 24 hours raises `too many invitations today`.
  - `invitation_to_email`: owner gets the address and both columns are stamped; second call
    within 2 minutes raises `wait before sending again`; `email_count` 5 raises
    `too many emails for this invitation`; another hive's owner, a member, an agent, an app
    pass, a revoked, accepted or expired invitation all raise `invitation not found` (or the
    owner-only message for agent identities).
  - `my_invitations`: lists only the caller's own confirmed email's open, unexpired invitations
    with hive name and inviter's display name; an unconfirmed account gets none.
  - `accept_invitation`: creates member + `Main` workspace, sets `accepted_at` and
    `accepted_member`, writes `member.joined`; someone else's, expired, revoked or already
    accepted is `invitation not found`; an unconfirmed caller is refused; a caller already in
    the hive spends the invitation and leaves the member row untouched.
  - `claim_invitations` does not exist; `add_member` raises permission denied for
    `authenticated`.
- [ ] Existing tests that set up members through `add_member` as a person: switch the shared
      setup to a helper that inserts the member and its `Main` workspace as the database superuser.
      Replace the old `add_member` behaviour tests with the one refusal test. Remove the old
      `claim_invitations` and "added at once" tests; keep every other invitation test green.
- [ ] Write the migration: header comment in the style of `20261123105237_invitations.sql`;
      `alter table`; `drop function invite_member(uuid, text, text)` then create; the three new
      functions (`security definer`, `set search_path = ''`); `drop function claim_invitations()`;
      `revoke execute on function public.add_member(uuid, text, text) from authenticated`;
      `revoke all ... from public, anon` and `grant execute ... to authenticated` for the new ones.
      The daily cap counts `invitations` rows of the hive with `created_at > now() - interval '24
hours'`. `invitation_to_email` locks the row (`for update`) before checking the limits.
- [ ] Update `scripts/demo.mjs` and `tests/import-vault.test.mjs` to the helper or direct insert.
- [ ] Run `node --test tests/sharing-rules.test.mjs tests/import-vault.test.mjs`: all pass.

### Task 2: The mail function

**Files:** create `supabase/functions/invite-email/index.ts`,
`supabase/functions/invite-email/send.ts`, `tests/invite-email.test.mjs`; modify
`supabase/config.toml` (`[functions.invite-email] verify_jwt = false`, with a comment).

**Consumes:** `invitation_to_email` over PostgREST (`POST <url>/rest/v1/rpc/invitation_to_email`,
`apikey` publishable key, the caller's bearer). **Produces:** the HTTP contract above.

- [ ] Model on `supabase/functions/agent-session/{index.ts,session.ts}` and
      `tests/agent-session.test.mjs`: `export function handle(req, env, fetchFn = fetch)`, web
      platform APIs only, body cap, fixed-phrase logging (`invite-email: <reason>`), 10 s timeouts.
- [ ] `Env = { url, anonKey, secretKey, resendKey, from, siteUrl }`. `index.ts` reads
      `SUPABASE_URL`, `HIVE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY`,
      `HIVE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `HIVE_INVITE_FROM`,
      `HIVE_SITE_URL`.
- [ ] Tests first, with a stub `fetch` that records calls: 405, 413, 400 (not JSON, no uuid),
      401, 503 when any secret is missing (and no call is made), database refusal mapped to 403 and
      the two limit messages to 429, database unreachable 502; happy path makes exactly three calls
      in order (rpc with the caller's bearer; `POST /auth/v1/admin/generate_link` with the secret key
      as both `apikey` and bearer and body `{ type: "invite", email }`; `POST
https://api.resend.com/emails`); when generate_link answers 422 with `error_code`
      `email_exists` a second generate_link with `type: "magiclink"` follows; the Resend body has
      `from`, `to: [email]`, the fixed subject, `text` and `html` both containing
      `<siteUrl>/join?token_hash=<hashed_token>&type=<invite|magiclink>` with the token
      URL-encoded; Resend or Auth failure is 502; no log line and no response contains the email,
      the token hash or any key (assert over captured `console.error` calls); the secret key is
      never sent to Resend and the Resend key never to Supabase.
- [ ] Email: subject `You have been invited to a hive on Hive Mind`; text and html say who can
      see what only after sign-in, the link, that it works once and for a limited time, and that an
      unexpected invitation can be ignored. No hive name, no person's name. Escape nothing
      user-supplied because nothing user-supplied is included; the site URL comes from the secret.
- [ ] `hashed_token` is read from the generate_link answer's top level `hashed_token`, falling
      back to `properties.hashed_token`. Verify the field against the Supabase Auth docs
      (`mcp__supabase-dev__search_docs`, "generateLink") before relying on it.
- [ ] Run `node --test tests/invite-email.test.mjs`: all pass.

### Task 3: Settings — invite and Send again

**Files:** modify `web/src/settings/{types.ts,text.ts,text.test.ts,Settings.tsx,fixture.ts}`,
`web/src/app/settings/{write.ts,write.test.ts,actions.ts}`, `web/src/app/dev/settings/*` (its
fake actions), `web/e2e/settings.spec.ts`.

**Consumes:** `invite_member` (uuid) and the function's HTTP contract. **Produces:** the types
above.

- [ ] Tests first in `write.test.ts`: `inviteIn` calls `invite_member`, then `sendIn`; answers
      `{ ok: true, id, sent: true }`; mail failure gives `sent: false`; `too many invitations today`
      maps to `too-many`; the old `added` outcome is gone. `resendIn(db, id, fetchFn)`: uuid check;
      reads the access token with `db.auth.getSession()` only after `db.auth.getUser()` confirmed
      the person; POSTs to `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/invite-email` with `apikey` and
      the bearer, 15 s timeout; 200 is ok, 429 is `wait`, anything else `failed`; the token and the
      email are never logged.
- [ ] `actions.ts`: `inviteMember` unchanged in shape, new `resendInvitation`.
- [ ] `text.ts`: notice texts "Invitation sent to <email>." and "Invitation saved, but the email
      could not be sent. Use Send again."; failures "Too many invitations today. Try again
      tomorrow." and for resend "Sent a moment ago. Wait two minutes and try again."; `INVITE_HELP`
      rewritten: the person gets an email and joins by pressing Join. Remove the text that told the
      owner to pass on the address by hand, and the "added" wording.
- [ ] `Settings.tsx`: a "Send again" button in each invitation row beside Revoke, same class as
      Revoke's quiet style, busy and failed states handled like revoke; the result announced
      through the existing live region. Nothing else moves.
- [ ] Update the fixture, the dev page's fake actions and `settings.spec.ts` for the new button
      and texts. Run `pnpm --filter @hive-mind/web test` and the settings browser spec.

### Task 4: `/join`, confirm route, proxy, login text

**Files:** create `web/src/app/join/{page.tsx,actions.ts,join.ts,join.test.ts}`,
`web/src/join/{Join.tsx,types.ts,text.ts,fixture.ts,join.module.css}`,
`web/src/app/dev/join/page.tsx`, `web/e2e/join.spec.ts`; modify `web/src/proxy.ts` (+ test),
`web/src/app/auth/confirm/route.ts` (+ test), `web/src/app/page.tsx`,
`web/src/app/login/login-form.tsx`; delete `web/src/app/auth/claim.ts`, `claim.test.ts`.

**Consumes:** `my_invitations`, `accept_invitation`. **Produces:** nothing others use.

- [ ] Load `frontend-design`, read `docs/ui-concept.md`; model the page on
      `web/src/app/oauth/consent/` (its `Frame`, form, actions split, tests, and `/dev/consent`):
      same frame and button styles, no new look.
- [ ] `join.ts` (pure, tested): `continueIn(db, tokenHash, type)` accepts only type `invite` or
      `magiclink` and a token of 20 to 200 URL-safe characters, calls `verifyOtp`, answers ok or
      `expired`; `waitingIn(db)` maps `my_invitations` rows to `Waiting[]` (shape-checked, capped at
      20); `acceptIn(db, id)` uuid-checks and calls `accept_invitation`.
- [ ] `page.tsx`: the three states of the spec. The token is read from the query and passed to
      the Continue form as hidden fields; the page itself never calls `verifyOtp` (a GET must not
      spend the link). Response header `Referrer-Policy: no-referrer` for this route (in
      `next.config.ts` headers) so the token is not sent on.
- [ ] `actions.ts`: `continueWithLink(formData)` then `redirect("/join")` or back to
      `/join?error=expired`; `join(id)` then `redirect("/")`.
- [ ] Proxy: `/join` is open; a signed-out visitor with no `token_hash` goes to
      `/login?next=/join`. Tests for both.
- [ ] `/auth/confirm`: remove the claim. `web/src/app/page.tsx`: where a signed-in person has no
      hive, call `my_invitations` and `redirect("/join")` when there are any (find the existing
      no-hive branch; add a test beside the page's loader tests).
- [ ] Login text per the spec; expired-link text in `web/src/join/text.ts`.
- [ ] `/dev/join` renders `Join.tsx` on the fixture (two invitations, empty, expired); browser
      test covers the three states and keyboard use. Run web unit tests and the join spec.

### Task 5: Docs

**Files:** modify `docs/security.md` (§3 invitation bullets and accepted gaps, §audit),
`docs/hosted-db-bringup.md` (new "Invitation email" section), `docs/README.md`, `README.md` if it
describes inviting, `.env.example` (comment only: the function's secrets are not `.env` values).

- [ ] Security: describe the flow as built; state what closes each former gap; new accepted
      gaps: a link in a mailbox signs its holder in (as any sign-in link does); the owner can cause
      up to 5 emails per invitation and 20 invitations a day to arbitrary addresses; `add_member`
      is no longer callable by people.
- [ ] Runbook, in order: Resend domain and API key (sending access only); Supabase dashboard →
      Authentication → SMTP with Resend's SMTP details (needed for sign-in links); Email OTP
      expiration 86400; function secrets `RESEND_API_KEY`, `HIVE_INVITE_FROM`, `HIVE_SITE_URL` set in
      the dashboard (Edge Functions → Secrets) so no key passes through a chat or shell history;
      deploy `invite-email`; apply the migration; test; then switch "Allow new users to sign up"
      off. Note that the legacy keys must stay enabled while the function falls back to
      `SUPABASE_SERVICE_ROLE_KEY`.

### Task 6: Integrate, review, gates (orchestrator)

- [ ] Review each task's diff against the spec; run a security review of the migration, the
      function and `/join`; fix findings.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the browser tests on port
      3100 (shared with the UI session: check it is free first).
- [ ] Commit by path; `scripts/finish-task.sh`.
- [ ] After the merge, with Danijel: apply the migration to the hosted project, deploy the
      function and the site, he sets the secrets and SMTP, hand tests of the spec, then sign-ups off.

## Execution DAG

- Dependencies: T1, T2, T3, T4 and T5 depend on nothing but the contracts in this plan. T6
  depends on all five.
- Batch 1 (five agents at once, disjoint files, one worktree): T1, T2, T3, T4, T5.
  T3 and T4 both live under `web/` but share no file; `next.config.ts` belongs to T4 and
  `web/src/settings/*` to T3.
- Batch 2: T6.
- Critical path: T1 (largest: test setup refactor) → T6.

## Performance and data-fetching budget

As in the spec: Settings first paint unchanged; invite is one database call and one function
call; `/join` is one indexed call; `/` gains one call only for a person with no hive; no
unbounded reads, no in-page toggles.
