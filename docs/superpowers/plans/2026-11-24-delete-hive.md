# Delete a Hive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner marks a hive for deletion; for 7 days it is read-only with a banner and can
be cancelled; then a scheduled job erases it and leaves a permanent record.

**Architecture:** One migration adds the closing state, a freeze trigger on every hive table,
request/cancel/preview functions and service-only purge functions. An Edge Function called by
the database's scheduler removes stored objects and calls the purge. The web app adds a
Settings section, a banner in the root layout and two actions.

**Tech Stack:** Postgres (PGlite, `node --test`), Deno Edge Function tested under
`node --test`, Next.js 16, Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-11-24-delete-hive-design.md`. Read it first.

## Global Constraints

- Sharing and permissions are decided in the database; no permission logic in `web/` or `mcp/`.
- Never edit a shipped migration. SQL goes in
  `supabase/migrations/20261124091833_hive_deletion.sql` (minted, empty).
- Security-definer functions: `set search_path = ''`, schema-qualified names. A vertical tab in
  SQL is `\x0B`, never `\v`.
- The service-role key and every secret stay server-side: never in a browser, a log line, a
  test fixture, a commit or a report. Scripts print names and shapes, never values.
- User-facing strings live in the module's text file.
- No new colours, fonts or layout tokens.
- Subagents do not run git and do not commit. Never read or edit `.env` files.
- TDD. Browser tests: if port 3100 is held by another worktree's server, run Playwright with a
  temporary copy of the config on another port and delete the copy afterwards.

## Contracts (fixed)

```sql
alter table public.hives
  add column closing_at timestamptz,
  add column delete_after timestamptz,
  add column closing_by uuid;            -- auth user id, no foreign key

public.hive_is_closing(p_hive uuid) returns boolean        -- stable, security definer
-- trigger function public.hive_frozen(): raise exception 'this hive is being deleted'
--   attached before insert or update or delete, for each row, to every table that holds
--   hive data; passes when the hive row no longer exists (the cascade of an erase)

public.hive_deletion_preview(p_hive uuid)
  returns table (members integer, notes integer, files integer)
public.request_hive_deletion(p_hive uuid, p_name text) returns timestamptz   -- delete_after
public.cancel_hive_deletion(p_hive uuid) returns void
-- all three: 'an app pass cannot do this' / 'only a person can delete a hive'
--   not a member, or no such hive: 'hive not found'
--   a member who is not an owner: 'only the owner can delete a hive'
-- request: name differs from the stored one (compared after trimming p_name):
--            'that is not the name of this hive'
--          already closing: returns the existing delete_after, no change, no audit row
--          else closing_at = now(), delete_after = now() + interval '7 days',
--               closing_by = auth.uid(); audit 'hive.deletion_requested'
-- cancel:  not closing: 'this hive is not being deleted'
--          else the three columns null; audit 'hive.deletion_cancelled'
-- audit rows: hive_id, member_id = the caller's member, detail {"delete_after": <timestamp>}

create table public.deleted_hives (
  hive_id uuid primary key, name text not null,
  requested_by uuid, requested_at timestamptz, purged_at timestamptz not null default now(),
  members integer not null, notes integer not null, files integer not null
);  -- row-level security on, no policy

public.hives_due_for_purge() returns table (id uuid)   -- delete_after <= now(), oldest first, limit 20
public.purge_hive(p_hive uuid) returns void
--   'hive not found' | 'this hive is not due' ; inserts deleted_hives, deletes the hive
-- both: execute for service_role only (revoked from public, anon, authenticated)
```

```
Edge Function purge-hives   (supabase/functions/purge-hives/{index.ts,purge.ts}, verify_jwt = false)
  POST, header x-purge-secret == env HIVE_PURGE_SECRET (constant-time compare)
  405 other methods | 503 a secret missing | 401 wrong or missing header
  200 {"ok":true,"purged":n,"failed":m}
  env: HIVE_PURGE_SECRET, SUPABASE_URL, HIVE_SECRET_KEY (fallback SUPABASE_SERVICE_ROLE_KEY)
  per hive: read public.files storage_path where hive_id = id in pages of 1000,
            remove from bucket "files" in batches of 100, then rpc purge_hive
```

```ts
// web/src/app/own-hive.ts: OwnHive and Membership gain  deleteAfter: string | null
//   the membership read selects  hive:hives!hive_id(name, delete_after)
// web/src/app/account.ts: Account gains  closing: string | null  (the current hive's date)
//   and each entry of hives gains  closing: boolean
// web/src/app/hives/actions.ts
export type Requested = { ok: true } | { ok: false; reason: "name" | "failed" };
export async function requestHiveDeletion(
  hiveId: string,
  typedName: string,
): Promise<Requested>;
export async function cancelHiveDeletion(
  hiveId: string,
): Promise<{ ok: boolean }>;
// web/src/shell/HiveActions.tsx: HiveActions gains optional cancelHiveDeletion
// settings loader result gains, beside data:  deletion: { members; notes; files } | null
//   (null for a person who is not an owner, or when the preview read fails)
```

---

### Task 1: Migration and database tests

**Files:** `supabase/migrations/20261124091833_hive_deletion.sql`,
`tests/sharing-rules.test.mjs`; `scripts/local-db.mjs` only if the test harness needs a
service-role helper.

- [ ] Read the schema (`20261120000001_schema.sql`) to list every table that holds hive data
      and how each reaches its hive (own `hive_id`, or through a note, workspace or member).
      Read `agent-session` and `connector_login` paths to see what they write on sign-in.
- [ ] Failing tests:
  - preview, request and cancel: owner succeeds; a plain member, a non-member, another hive's
    owner, an agent, an app pass and anon are each refused with the contract's message; a wrong
    name is refused; the name is compared after trimming; asking twice changes nothing and
    writes one audit row; cancelling a hive that is not closing is refused; audit rows
  - the freeze, for a closing hive: for each frozen table one insert, one update and one
    delete, as the owner, as a member and as that member's agent, each refused with
    `this hive is being deleted`; the security-definer writers too (`invite_member`,
    `accept_invitation`, `respond_to_link`, `unlink`, creating and revoking an agent,
    `connect_app`, sharing changes on a note and a folder, releasing a held note); a new
    stored object under a member of the hive is refused
  - not frozen: every read that worked before still works (notes, map, inbox, vault lists,
    files); agent sign-in and the connector's sign-in still work; a notification can be marked
    read; another hive of the same person is untouched
  - cancel lifts the freeze: a write succeeds again
  - `purge_hive`: refused before the date and for a hive that is not closing; at the date it
    leaves no row of the hive in any table, writes `deleted_hives` with the right counts, and
    leaves other hives whole; `hives_due_for_purge` lists only due hives, oldest first, at
    most 20; neither is executable by `authenticated`, `anon` or `public`; `deleted_hives` is
    unreadable through the API roles
- [ ] Implement. `pnpm test` green. Report tests added, anything changed, and every table you
      attached the trigger to and why any hive table was left out.

### Task 2: Edge Function `purge-hives` and its setup script

**Files:** create `supabase/functions/purge-hives/index.ts`, `purge.ts`,
`tests/purge-hives.test.mjs`, `scripts/setup-hive-purge.sh`; modify `supabase/config.toml`
(`[functions.purge-hives] verify_jwt = false`).

- [ ] Read `supabase/functions/invite-email/{index.ts,send.ts}` and
      `tests/invite-email.test.mjs` (the pattern: web-platform code with injected `fetch` and
      env, tested under `node --test`), and `scripts/setup-agent-signing.sh` (the pattern for a
      setup script that never prints a secret).
- [ ] Failing tests: 405; 503 with each secret missing; 401 with no header, a wrong one, and a
      header of another length; nothing is fetched before the secret is accepted; no hives due
      gives `purged 0`; one hive with 250 files makes one page read, three storage removals
      and then `purge_hive`; a storage failure skips `purge_hive` for that hive, counts it as
      failed and still handles the next hive; a `purge_hive` failure is counted as failed; the
      answer and the logs carry no hive name, path, secret or key; each outbound call has a
      timeout.
- [ ] Implement to the contract.
- [ ] `scripts/setup-hive-purge.sh`: needs a linked project; generates a random secret; sets
      the function secret through a temporary env file that is removed; stores the secret and
      the function's address in the database's secret store (`vault.create_secret`, replacing
      an existing one of the same name); enables `pg_cron` and `pg_net` if needed; schedules
      `purge-hives` daily (unscheduling an existing job of that name first) with
      `net.http_post` reading the secret from `vault.decrypted_secrets` at run time; prints
      what it did by name only. `bash -n` passes; add it to the hooks/script tests only if the
      repo already tests scripts that way.
- [ ] `pnpm test` green. Report.

### Task 3: Web

**Files:** modify `web/src/app/own-hive.ts`, `account.ts`, `web/src/app/hives/{actions,write}.ts`,
`web/src/shell/{HiveActions.tsx,HiveSwitcher.tsx,hiveText.ts}`, `web/src/app/layout.tsx`,
`web/src/app/settings/{load-settings.ts,page.tsx}`, `web/src/settings/{Settings.tsx,text.ts,types.ts,fixture.ts}`,
the dev pages for settings and rail, and their tests; create `web/src/shell/ClosingBanner.tsx`;
`web/e2e/settings.spec.ts`, `web/e2e/rail.spec.ts`.

- [ ] Before any UI: load the `frontend-design` skill, read `docs/ui-concept.md` and how
      Settings lays out its sections and how the vault's Delete asks for confirmation.
- [ ] Failing unit tests: `ownHive`/`myHives`/`loadAccount` carry the date and the `closing`
      marks; `requestHiveDeletionIn` (non-uuid and empty name make no query; the database's
      name refusal maps to `name`; others to `failed`; no message returned) and
      `cancelHiveDeletionIn`; the settings loader calls the preview in its parallel batch for
      owners only and survives its failure; the strings.
- [ ] Implement. Banner: rendered in the root layout when `account.closing` is set, above the
      page, `role="status"`, with the date in the person's locale and, for an owner with the
      action available, **Cancel deletion** (asks once in place, then reloads). Settings
      section: owners only; counts; the name field; **Delete hive** enabled only on an exact
      match; after success a full reload; while closing it shows the date and
      **Cancel deletion** instead. Switcher: "being deleted" beside a closing hive.
- [ ] Browser tests on the dev pages: section hidden for a member; counts shown; button
      disabled until the name matches; refusal lines; success reloads; closing state with
      cancel; banner on a closing hive with and without the cancel button; banner absent
      otherwise; switcher mark; 390 px.
- [ ] Unit tests, typecheck and the two e2e specs green. Report.

### Task 4: Docs

**Files:** `docs/security.md` (who may delete, the 7 days, the freeze and what stays open, the
erase, the permanent record, the purge secret and where it lives, known gaps),
`docs/ui-concept.md`, `README.md`, `docs/hosted-db-bringup.md` ("Current state": not applied
yet; a new section "Hive deletion" with the rollout steps from the spec), `.env.example` only
if a variable is needed locally.

---

## Execution DAG

- Dependencies: Tasks 1 to 4 depend only on the contracts above. Task 3 owns every file under
  `web/`; Tasks 1 and 2 share no file (`tests/sharing-rules.test.mjs` is Task 1's,
  `tests/purge-hives.test.mjs` is Task 2's).
- **Batch 1 (parallel):** Tasks 1, 2, 3, 4.
- **Batch 2 (orchestrator):** review each against the spec; an independent security review of
  the migration and the Edge Function; fix findings; four gates and all browser tests; commit;
  `scripts/finish-task.sh`.
- **Batch 3 (orchestrator):** rollout per the spec.
- Critical path: Task 1 (the freeze and its tests), then the security review.

## Performance and data budget

- First paint: no new query; `delete_after` rides on the membership read.
- Settings: three counts in the existing parallel batch, owners only, over indexed columns.
- Request and cancel: one rpc, then a reload.
- Each write in any hive: one primary-key lookup of the hive row.
- The erase: outside requests, at most 20 hives a run, files in pages of 1000.
