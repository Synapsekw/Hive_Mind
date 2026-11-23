# Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner invites a person by email in Settings; a person with a confirmed account is
added at once, anyone else joins the hive when they first sign in with that email.

**Architecture:** One migration adds an `invitations` table (readable by the hive owner only)
and three functions: `invite_member`, `revoke_invitation`, `claim_invitations`. Settings calls
the first two through server actions; the sign-in callback and the home page call the third
through the person's own session. No email is sent and the web app gets no new secret.

**Tech stack:** Postgres (PGlite in tests), Next.js App Router (`web/`), `@supabase/ssr`,
CSS Modules on the generated theme tokens, node:test, Vitest, Playwright.

Spec: [`docs/superpowers/specs/2026-11-23-invitations-design.md`](../specs/2026-11-23-invitations-design.md).

## Global constraints

- The migration is minted with `scripts/new-migration.sh invitations`. No change to a shipped
  migration; `add_member` stays. No change to `mcp/`.
- **Joining requires `auth.users.email_confirmed_at` to be set** for the caller, and the
  invitation's email to equal the caller's email after lower-casing. Nothing else lets a person
  into a hive.
- Agents (`jwt_agent_id()` set) and self-hosted identities are refused by all three functions.
- Invitations are readable by the hive's owner only; no table grant beyond `select`.
- Limits: email at most 254 characters, stored lower-case; display name 1 to 60 characters;
  invitation lifetime 14 days; invitations list capped at 100.
- Exact database messages the app maps: `that person is already a member`,
  `that email is already invited`, `only the hive owner can invite members`,
  `invitation not found`.
- No permission logic in `web/`; server actions check arguments before any query, answer only
  what the contract says, and log only an error's code and message.
- Look and screen rules as in the settings plan (tokens only, `@supports not` fallback, fits
  1100 × 560, no pills). Follow `web/src/settings/` as it is.
- Tests first, seen failing. Stage by path; conventional commits with a lower-case subject,
  ending with the `Co-Authored-By` line. Subagents in a parallel batch do not commit.

## File structure

| File                                                                                      | Responsibility                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `supabase/migrations/<stamp>_invitations.sql`                                             | Table, policy, three functions                     |
| `scripts/local-db.mjs`                                                                    | `auth.users.email_confirmed_at` in the stub        |
| `tests/sharing-rules.test.mjs`                                                            | Database tests (appended)                          |
| `web/src/settings/types.ts`, `text.ts`, `fixture.ts` (+tests)                             | Contract: invitations, invite outcome              |
| `web/src/app/settings/load-settings.ts`, `write.ts`, `actions.ts`, `validate.ts` (+tests) | Read invitations; `inviteIn`, `revokeInvitationIn` |
| `web/src/app/auth/claim.ts` (+test)                                                       | `claimIn`                                          |
| `web/src/app/auth/confirm/route.ts`, `web/src/app/page.tsx`                               | Claim at sign-in and for a person with no hive     |
| `web/src/app/login/login-form.tsx` or `page.tsx`                                          | One line for invited people                        |
| `web/src/settings/Settings.tsx`, `settings.module.css`                                    | Invite form, invitations list, notice              |
| `web/src/app/dev/settings/*`, `web/e2e/settings.spec.ts`                                  | Sample data and browser tests                      |

## Contracts shared between tasks

Database (Task 1 produces; Task 3 consumes):

- `invite_member(p_hive uuid, p_email text, p_display_name text) returns text` → `'added'` or
  `'invited'`; raises the messages above.
- `revoke_invitation(p_invitation uuid) returns void`.
- `claim_invitations() returns integer`.
- `invitations` columns readable: `id, hive_id, email, display_name, created_at, expires_at,
accepted_at, revoked_at`.

`web/src/settings/types.ts` (Task 2): **remove** `AddReason`, `Added` and `addMember`; **add**

```ts
export type Invitation = {
  id: string;
  email: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  expiresAt: string;
};
export type InviteReason = "already-member" | "already-invited" | "failed";
export type Invited =
  | { ok: true; outcome: "added" | "invited" }
  | { ok: false; reason: InviteReason };
```

`SettingsData` gains `invitations: Invitation[]`. `SettingsActions` becomes
`createAgent`, `revokeAgent`, `inviteMember(email: string, name: string): Promise<Invited>`,
`revokeInvitation(id: string): Promise<Result>`.

`web/src/settings/text.ts` (Task 2): **remove** `addFailure`; **add**

```ts
export function inviteFailure(r: InviteReason): string;
// "That person is already a member." | "That email is already invited."
// | "That didn't work. Try again."
export function inviteNotice(
  name: string,
  email: string,
  address: string,
): string;
// `Invitation saved. Ask ${name} to open ${address}, enter ${email} and choose Email me a link.`
export const INVITE_HELP: string;
// "If they have an account they are added now. Otherwise they join when they first sign in with this email."
```

`fixtureSettings` gains two pending invitations in the owner shapes and none for `member`.

`web/src/app/settings/write.ts` (Task 3): `inviteIn(db, email: unknown, name: unknown):
Promise<Invited>`, `revokeInvitationIn(db, id: unknown): Promise<Result>`; `addMemberIn` removed.
`web/src/app/auth/claim.ts`: `claimIn(db): Promise<number>` (0 on any failure, never throws).

---

### Task 1: Migration, auth stub, database tests

**Files:** create `supabase/migrations/<stamp>_invitations.sql`; modify `scripts/local-db.mjs`,
`tests/sharing-rules.test.mjs` (append `// ------- invitations`).

- [ ] **Step 1: the stub.** In `scripts/local-db.mjs` give `auth.users` the column
      `email_confirmed_at timestamptz default now()` (existing tests keep confirmed users), and let
      `addUser(email, { confirmed = true } = {})` insert `null` when not confirmed. Run
      `pnpm test`: still green.
- [ ] **Step 2: failing tests.** Fresh users per test (`invite-…@example.com`), created with
      `addUser` or left absent. Helpers: `invite = (who, email, name, h = hive) => as(who, 'select
public.invite_member($1,$2,$3) as r', [h, email, name])`, `claim = (who) => as(who, 'select
public.claim_invitations() as n')`. Tests, each asserting state as well as the answer:
  1. owner invites an unknown email → `invited`; a row exists with the email lower-cased, expiry
     about 14 days ahead; no member row.
  2. owner invites a confirmed account → `added`; member row with the given name and a `Main`
     workspace; no invitation row.
  3. an unconfirmed account is treated as unknown → `invited`, no member row.
  4. refusals with nothing changed: a non-owner member, another hive's owner, an agent of the
     owner (`only the hive owner can invite members`); an existing member
     (`that person is already a member`); the same email twice, second time in upper case
     (`that email is already invited`).
  5. claim: the invited person, confirmed, gets `n = 1`, a member row with the invitation's
     name and role `member`, a `Main` workspace, the invitation accepted; a second claim gives
     0 and changes nothing.
  6. claim does nothing (`n = 0`, no member row) for: an unconfirmed account with the invited
     email; a different confirmed person; a revoked invitation; an expired one (set
     `expires_at` in the past as superuser).
  7. claim is refused for an agent identity and returns 0 for a role with no `sub`... (raise
     `sign in as a person` for both; assert the message).
  8. an expired invitation can be made again (`invited`), and exactly one pending row remains.
  9. `revoke_invitation`: owner only (member, other owner, agent refused with
     `invitation not found` or the owner message, nothing changed); revoking twice →
     `invitation not found`.
  10. only the owner selects from `invitations`: a member, the invited person, an agent and
      another hive's owner get zero rows; `insert`, `update`, `delete` on the table are refused
      for `authenticated`.
  11. audit: `member.invited`, `member.added`, `member.joined`, `member.invitation_revoked`
      rows exist with the hive id; a non-owner reads none of them.
  12. a person invited to two hives joins both with one claim (`n = 2`).
- [ ] **Step 3:** run `node --test tests/sharing-rules.test.mjs`; the new tests fail
      (`function public.invite_member … does not exist`).
- [ ] **Step 4: mint and write the migration** (`scripts/new-migration.sh invitations`):

```sql
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  hive_id uuid not null references public.hives on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254
                             and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  invited_by uuid references public.members on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_member uuid references public.members on delete set null,
  revoked_at timestamptz
);
create unique index invitations_pending_idx on public.invitations (hive_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_email_idx on public.invitations (email)
  where accepted_at is null and revoked_at is null;

alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_hive_owner(hive_id) and public.jwt_agent_id() is null);
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;

create function public.invite_member(p_hive uuid, p_email text, p_display_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_me uuid;
  v_user uuid;
  v_member uuid;
  v_invitation uuid;
begin
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted()
     or not public.is_hive_owner(p_hive) then
    raise exception 'only the hive owner can invite members';
  end if;
  select m.id into v_me from public.members m
   where m.hive_id = p_hive and m.user_id = (select auth.uid());

  if exists (select 1 from public.members m join auth.users u on u.id = m.user_id
              where m.hive_id = p_hive and lower(u.email) = v_email) then
    raise exception 'that person is already a member';
  end if;

  select u.id into v_user from auth.users u
   where lower(u.email) = v_email and u.email_confirmed_at is not null
   order by u.email_confirmed_at limit 1;
  if v_user is not null then
    insert into public.members (hive_id, user_id, display_name)
      values (p_hive, v_user, v_name) returning id into v_member;
    insert into public.workspaces (hive_id, member_id, name) values (p_hive, v_member, 'Main');
    insert into public.audit_log (hive_id, member_id, action, detail)
      values (p_hive, v_me, 'member.added',
              jsonb_build_object('member', v_member, 'email', v_email));
    return 'added';
  end if;

  -- An invitation that ran out no longer blocks a new one.
  update public.invitations set revoked_at = now()
   where hive_id = p_hive and email = v_email
     and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists (select 1 from public.invitations
              where hive_id = p_hive and email = v_email
                and accepted_at is null and revoked_at is null) then
    raise exception 'that email is already invited';
  end if;
  insert into public.invitations (hive_id, email, display_name, invited_by)
    values (p_hive, v_email, v_name, v_me) returning id into v_invitation;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (p_hive, v_me, 'member.invited',
            jsonb_build_object('invitation', v_invitation, 'email', v_email));
  return 'invited';
end
$$;

create function public.revoke_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hive uuid;
  v_email text;
begin
  if public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'only the hive owner can invite members';
  end if;
  update public.invitations i set revoked_at = now()
   where i.id = p_invitation and i.accepted_at is null and i.revoked_at is null
     and public.is_hive_owner(i.hive_id)
   returning i.hive_id, i.email into v_hive, v_email;
  if v_hive is null then
    raise exception 'invitation not found';
  end if;
  insert into public.audit_log (hive_id, member_id, action, detail)
    values (v_hive,
            (select m.id from public.members m
              where m.hive_id = v_hive and m.user_id = (select auth.uid())),
            'member.invitation_revoked',
            jsonb_build_object('invitation', p_invitation, 'email', v_email));
end
$$;

-- Join every hive that invited the caller's own, confirmed email address.
create function public.claim_invitations() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_member uuid;
  v_joined integer := 0;
  inv record;
begin
  if v_uid is null or public.jwt_agent_id() is not null or public.jwt_is_self_hosted() then
    raise exception 'sign in as a person';
  end if;
  select lower(u.email) into v_email from auth.users u
   where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;
  for inv in
    select i.id, i.hive_id, i.display_name from public.invitations i
     where i.email = v_email and i.accepted_at is null and i.revoked_at is null
       and i.expires_at > now()
     for update
  loop
    select m.id into v_member from public.members m
     where m.hive_id = inv.hive_id and m.user_id = v_uid;
    if v_member is null then
      insert into public.members (hive_id, user_id, display_name)
        values (inv.hive_id, v_uid, inv.display_name) returning id into v_member;
      insert into public.workspaces (hive_id, member_id, name)
        values (inv.hive_id, v_member, 'Main');
      insert into public.audit_log (hive_id, member_id, action, detail)
        values (inv.hive_id, v_member, 'member.joined',
                jsonb_build_object('invitation', inv.id));
      v_joined := v_joined + 1;
    end if;
    update public.invitations set accepted_at = now(), accepted_member = v_member
     where id = inv.id;
  end loop;
  return v_joined;
end
$$;

revoke all on function public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid), public.claim_invitations() from public, anon;
grant execute on function public.invite_member(uuid, text, text),
  public.revoke_invitation(uuid), public.claim_invitations() to authenticated;
```

Where the SQL does not match the shipped schema (a column, how `is_hive_owner` treats agents,
whether `audit_log` has insert triggers), follow the schema and keep the contract: the returned
values, the messages, who is refused.

- [ ] **Step 5:** all database tests pass; `pnpm test` green; prettier on the changed JS.

Commit: `feat(db): invitations honoured at first sign-in`.

### Task 2: Contract change

**Files:** modify `web/src/settings/types.ts`, `text.ts`, `text.test.ts`, `fixture.ts`,
`fixture.test.ts`.

- [ ] Tests first for `inviteFailure`, `inviteNotice`, `INVITE_HELP` and the fixture's
      invitations (two for the owner shapes with fixed ids and dates, none for `member`); see them
      fail; change the contract exactly as written above. `pnpm typecheck` **will fail** in
      `web/src/app/settings/`, `Settings.tsx` and the dev page until Tasks 3 and 4 land: that is
      expected; report the list of errors and do not fix those files.

Commit (with Tasks 3 and 4, once the tree typechecks): `feat(web): invitations contract`.

### Task 3: Loading, actions, claiming at sign-in

**Files:** modify `web/src/app/settings/load-settings.ts`, `write.ts`, `actions.ts` and their
tests; create `web/src/app/auth/claim.ts`, `claim.test.ts`; modify
`web/src/app/auth/confirm/route.ts`, `web/src/app/page.tsx`, the sign-in page copy;
`web/src/app/settings/page.tsx` (action names).

- [ ] **Tests first:**
  - loader: the invitations read is `from("invitations")`,
    `select("id, email, display_name, created_at, expires_at")`, `eq("hive_id", …)`,
    `is("accepted_at", null)`, `is("revoked_at", null)`, `gt("expires_at", <ISO of now>)`,
    newest first, `limit(100)`; rows map to `Invitation`; a failing read or a malformed row →
    `error`; an empty answer → `[]`.
  - `inviteIn`: argument checks before any call; no session → `failed`; calls
    `rpc("invite_member", { p_hive, p_email, p_display_name })`; `data` `"added"` /
    `"invited"` → that outcome; any other data → `failed`; message containing
    `already a member` → `already-member`; containing `already invited` → `already-invited`;
    else `failed`.
  - `revokeInvitationIn`: uuid check; `rpc("revoke_invitation", { p_invitation })`.
  - `claimIn`: returns the integer; error, non-number, negative, a throwing client → 0;
    never throws.
  - the old `addMemberIn` tests are deleted with the function.
- [ ] **Implement.** In `/auth/confirm`, after a session exists and before the redirect:
      `await claimIn(supabase)`. In `web/src/app/page.tsx`, in the `no-hive` branch:
      `if ((await claimIn(db)) > 0) redirect("/")` (from `next/navigation`), else the existing
      notice. Add the one line for invited people to the sign-in page.
- [ ] `pnpm --filter @hive-mind/web test` passes for these files.

### Task 4: The Members part of the screen, dev page, browser tests

**Files:** modify `web/src/settings/Settings.tsx`, `settings.module.css`,
`web/src/app/dev/settings/DevSettings.tsx`, `page.tsx`, `web/e2e/settings.spec.ts`.

- [ ] **Browser tests first** (replace the add-member tests):
  1. owner: "Invite a member" opens the form with `INVITE_HELP`; a bad email or empty name is
     refused with no call;
  2. `?outcome=added`: the member row appears, "{name} added.", form closed;
  3. default (`invited`): the invitation appears under **Invitations** with email, "Invited"
     and "Expires" dates; the notice shows `inviteNotice(name, email, origin + "/login")`;
     **Copy address** puts `origin + "/login"` on the clipboard; **Dismiss** removes the notice;
  4. `?reason=already-member`, `?reason=already-invited`, `?fail=1`: the three sentences, form
     stays open with its values;
  5. **Revoke** on an invitation removes it (one step) and calls `revokeInvitation(id)`;
     `?fail=1` keeps it with "That didn't work. Try again.";
  6. `?member=1`: no form, no Invitations section;
  7. the page still does not scroll at 1100 × 560 with the form open and two invitations.
- [ ] See them fail; implement; `router.refresh()` after each success as today. The Invitations
      list follows the agents list's row style. Screenshot default, form open and notice in dark and
      light at both sizes into the scratchpad; look and fix.

Commit (Tasks 2, 3, 4 together or by path once green):
`feat(web): invite members and join at first sign-in`.

### Task 5: Hosted database, docs, gates

- [ ] Apply the migration to the hosted project through the Supabase MCP
      (`apply_migration`, name `invitations`), then re-stamp its version to the repo's
      ([[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]); check both the
      functions and the table exist and that an anonymous call is refused.
- [ ] Docs: `README.md` (inviting), `docs/security.md` (the two project settings and why
      "Confirm email" matters; what the owner can see), `docs/hosted-db-bringup.md` (the settings
      as a checklist item; the migration in "Current state"), `docs/ui-concept.md` §4 Settings.
- [ ] Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, all browser tests.
- [ ] Whole-branch review, one fix wave, `scripts/finish-task.sh`.
- [ ] Hand to Danijel: check the two Supabase settings, then the by-hand test with a real
      mailbox.

---

## Execution DAG

- **Edges:** Task 3 → Task 2. Task 4 → Task 2. Task 5 → Tasks 1, 3, 4. Task 1 depends on
  nothing; Task 3 uses Task 1 only through the written contract.
- **Batch A (parallel):** Task 1 ∥ Task 2 — `supabase/`, `scripts/local-db.mjs`, `tests/`
  against `web/src/settings/{types,text,fixture}`.
- **Batch B (parallel):** Task 3 ∥ Task 4 — `web/src/app/**` against
  `web/src/settings/Settings.tsx`, its stylesheet, `web/src/app/dev/settings/` and
  `web/e2e/settings.spec.ts`. One shared edge: `web/src/app/dev/settings/` belongs to Task 4
  only; `web/src/app/settings/page.tsx` to Task 3 only.
- **Batch C:** Task 5.
- **Critical path:** Task 2 → Task 4 → Task 5.
- One worktree; tasks in a batch touch disjoint files and do not commit. The tree does not
  typecheck between Task 2 and the end of Batch B, so Tasks 2, 3 and 4 are committed together.

## Performance and data-fetching budget

- **Settings first paint:** one more read in the existing `Promise.all` (invitations: partial
  unique index leads with `hive_id`; capped at 100).
- **Invite, revoke:** one rpc, one refresh. The notice and the form are client state.
- **Sign-in:** one rpc in `/auth/confirm`. **Home:** one rpc only when the person has no hive,
  then at most one redirect. The claim reads through `invitations_email_idx`.
- No tabs, filters or sorts.

## Out of scope

Sending email, invitation links, roles, resending, removing members, closing sign-ups, a
sign-up page, any MCP change.
