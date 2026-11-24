# Hive Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can start a hive (at most 5 owned) and switch between their hives
from the top of the rail; every screen shows the chosen hive.

**Architecture:** The chosen hive lives in an httpOnly cookie read inside `ownHive`, the one
function every screen already asks. Two server actions switch and create. One migration caps
and checks `create_hive`.

**Tech Stack:** Postgres (PGlite, `node --test`), Next.js 16 server actions and cookies,
Vitest, Playwright.

Spec: `docs/superpowers/specs/2026-11-24-hive-switcher-design.md`. Read it first.

## Global Constraints

- Sharing and membership are decided in the database. The cookie only picks among rows the
  database returned for the person.
- Never edit a shipped migration. SQL goes in `supabase/migrations/20261124082437_hive_cap.sql`
  (minted, empty).
- Security-definer functions: `set search_path = ''`, schema-qualified names. A vertical tab in
  SQL is `\x0B`, never `\v`.
- User-facing strings live in the module's text file (`no-literals.test.ts`).
- No new colours, fonts or layout tokens; reuse rail and account-popover classes.
- Subagents do not run git and do not commit. Never print or edit `.env` files.
- TDD. Browser tests use the repo's Playwright config (port 3100).

## Contracts (fixed)

```sql
public.create_hive(p_name text, p_display_name text) returns uuid   -- same signature
-- refusals, in this order after the existing person-only guards:
--   'a hive needs a name' | 'that hive name is too long' (> 60)
--   'you need a name in the hive' | 'that name is too long' (> 60)
--   'you already own 5 hives'
-- audit_log: action 'hive.created', hive_id, member_id = new member, detail {"name": <name>}
```

```ts
// web/src/app/chosen-hive.ts
export const HIVE_COOKIE = "hm_hive";
// null outside a request or when the value is not a uuid
export async function chosenHiveId(): Promise<string | null>;
// { name, value, httpOnly: true, sameSite: "lax", secure: production, path: "/", maxAge: one year }
export function hiveCookie(id: string, production: boolean): CookieToSet;
export function noHiveCookie(production: boolean): CookieToSet; // same, maxAge 0

// web/src/app/own-hive.ts (signatures unchanged; one new optional field)
// ownHive(db, userId?, opts?: { profile?: true; chosen?: string | null })
//   opts.chosen given: used instead of chosenHiveId() (tests)
export type Membership = {
  id: string; // hive id
  name: string;
  role: string;
  memberId: string;
  displayName: string;
};
// oldest first, at most 50
export async function myHives(db, userId?): Promise<Membership[] | "error">;

// web/src/app/account.ts
export type Account = {
  name: string;
  role: string;
  hive: string;
  initials: string;
  hiveId: string;
  hives: { id: string; name: string; role: string; current: boolean }[];
};

// web/src/app/hives/actions.ts ("use server")
export async function switchHive(hiveId: string): Promise<{ ok: boolean }>;
export type Created =
  | { ok: true }
  | { ok: false; reason: "name" | "display-name" | "limit" | "failed" };
export async function createHive(
  name: string,
  displayName: string,
): Promise<Created>;
// web/src/app/hives/write.ts holds the testable cores:
//   switchHiveIn(db, jar, id), createHiveIn(db, jar, name, displayName)
```

---

### Task 1: Migration and database tests

**Files:** `supabase/migrations/20261124082437_hive_cap.sql`, `tests/sharing-rules.test.mjs`;
check `scripts/demo.mjs`, `scripts/local-db.mjs`, other `tests/*.mjs` for `create_hive` calls
the new checks would refuse.

**Interfaces:** Produces the SQL contract.

- [ ] Read the current `create_hive` in `20261123150712_connected_apps.sql` and the trim
      constant and advisory-lock pattern in `20261123174149_emailed_invitations.sql`.
- [ ] Failing tests: empty and whitespace-only hive name; 61-character name; 60 passes; the
      same four for the display name; names are stored trimmed, and a name beginning and
      ending in "v" keeps both; the sixth owned hive is refused, and being a plain member of
      other hives does not count; an agent, an app pass and anon are still refused; the audit
      row; the owner's "Main" workspace still exists.
- [ ] Implement; `pnpm test` green. Report tests added and anything changed.

### Task 2: Hive selection and actions

**Files:** create `web/src/app/chosen-hive.ts`, `web/src/app/hives/{actions.ts,write.ts}` with
tests; modify `web/src/app/own-hive.ts`, `account.ts` and their tests,
`web/src/app/join/actions.ts` (set the cookie to the joined hive),
`web/src/app/auth/signout/route.ts` (clear it), `web/src/app/oauth/consent/load.ts` and the
consent page (name the hive), and their tests.

**Interfaces:** Consumes the SQL contract. Produces the TS contract.

- [ ] Failing tests:
  - `ownHive`: no cookie gives the oldest; a cookie naming a hive the person is in gives that
    one; a cookie naming another hive, or junk, gives the oldest; one read with `limit(50)`;
    error and empty cases as today; `opts.chosen` overrides the cookie
  - `myHives`: oldest first, malformed rows dropped
  - `loadAccount`: `hiveId`, and `hives` with exactly one `current`
  - `switchHiveIn`: a non-uuid makes no query and sets no cookie; not a member sets no cookie
    and answers `{ok:false}`; a member gets the cookie with the contract's attributes; no
    session answers `{ok:false}`
  - `createHiveIn`: empty and over-long texts are refused before any query with the right
    reason; the database's `you already own 5 hives` maps to `limit`; any other error maps to
    `failed` and its message is not returned; success sets the cookie to the returned id
  - join sets the cookie to the joined hive; sign-out clears it
- [ ] Implement. `chosenHiveId()` wraps `cookies()` from `next/headers` in try/catch.
- [ ] `pnpm --filter @hive-mind/web test` and typecheck green. Report.

### Task 3: Rail switcher and New hive form

**Files:** create `web/src/shell/HiveSwitcher.tsx`, `web/src/shell/hiveText.ts` with tests;
modify `web/src/shell/Shell.tsx`, `shell.module.css` (only if no class fits), the home page's
no-hive state, a dev page under `web/src/app/dev/` for the rail with several hives,
`web/e2e/rail.spec.ts`.

**Interfaces:** Consumes `Account`, `switchHive`, `createHive` from the contract. Task 2
builds them at the same time, so: read the hive list from `useAccount()` treating `hives` and
`hiveId` as possibly absent, and take the two actions as props, so the dev page passes
in-memory ones. The orchestrator wires the real actions in afterwards.

- [ ] Before any UI: load the `frontend-design` skill, read `docs/ui-concept.md` (rail) and
      `AccountMenu.tsx` (the disclosure pattern to follow).
- [ ] Unit tests for the strings; browser tests on the dev page: the hive's name shows at the
      top of the rail; the list shows every hive with role and one tick; choosing another
      calls switch and reloads; New hive opens the form with the display name prefilled; each
      refusal shows its line; a successful create goes to `/`; Escape closes and returns
      focus; keyboard order; one hive only still shows the button and New hive; 390 px wide.
- [ ] Implement. Run unit tests, typecheck and the rail e2e spec. Report.

### Task 4: Docs

**Files:** `docs/security.md` (the cookie picks, the database decides; the cap; the audit
entry; agents and app connections are per hive), `docs/ui-concept.md` (rail switcher, New
hive), `README.md`, `docs/hosted-db-bringup.md` ("Current state": migration not applied yet),
`docs/prd.md` if it describes single-hive use.

- [ ] Plain language, as shipped per the spec. `pnpm lint` green.

---

## Execution DAG

- Dependencies: all four tasks depend only on the contracts above. Task 3 uses types that
  Task 2 defines; Task 2 owns `account.ts`, and Task 3 does not edit it.
- **Batch 1 (parallel):** Tasks 1, 2, 3, 4. File sets do not overlap.
- **Batch 2 (orchestrator):** integrate (the real actions passed to the switcher), review
  against the spec, four gates and all browser tests, commit, `scripts/finish-task.sh`.
- **Batch 3 (orchestrator):** apply the migration to the hosted project, record the version,
  deploy the site, smoke test.
- Critical path: Task 3, then integration and gates.

## Performance and data budget

- First paint: the membership read is the same indexed query with `limit 50`; no new query.
- Switch: one read and one cookie, then a reload. Create: one rpc, then `/`.
- Opening the switcher: client state only.
