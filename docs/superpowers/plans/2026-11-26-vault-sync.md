---
type: plan
status: ready
last-updated: 2026-11-26
tags: [project/hive-mind, plan, db, sync, web]
spec: "[[2026-11-26-vault-sync-design]]"
---

# Vault sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled job on Danijel's Mac keeps one Hive workspace equal to one vault folder:
notes and files, additions, changes, moves and deletions, one way, with every rule enforced by
the database.

**Architecture:** A sync key, made by a person in Settings, is backed by an `agents` row, so the
identity it signs in as is an agent and every existing agent wall holds (no sharing, no accepting,
no deleting, one workspace). On top of that it carries a `sync_key_id` claim. It may not use the
tables directly: restrictive policies refuse it everywhere. Its extra powers (moving and deleting
the notes and files it keeps, adopting imported notes, written dates) are granted only inside
`sync_*` security-definer functions that check the key is live. Only Storage uploads go to
the tables directly, under the existing upload policy. The Mac side is a TypeScript package
`sync/`, run straight from source by Node (type stripping). It reuses the web app's pure import
modules (`parseNote`, `noteDates`, wiki links, `mimeFor`). It talks to the database through a
`Store` interface, so its logic is tested against an in-memory stand-in.

**Tech Stack:** Postgres (Supabase) migrations tested in PGlite with `node:test`; Supabase Edge
Function (Deno, Web APIs only); Node ≥ 23.6 TypeScript run without a build; Next.js 16 / React
19 web app, vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-vault-sync-design.md`. Where this plan refines it
(§ "Refinements of the spec" below), the plan governs and the spec is updated in Task 1.

## Global Constraints

- Migrations only via `scripts/new-migration.sh vault_sync`: **one** migration file for the whole
  feature. Tasks 1 to 3 add to the same file while it is unshipped. Never edit any other
  migration. Redefine an existing function with `create or replace` in the new file, copying its
  latest body (named in each step) and changing only what the step says.
- Every new function: `security definer set search_path = ''`, then
  `revoke all on function … from public, anon;` and `grant execute … to authenticated;`. The
  exception is `sync_login`, which is granted to `anon, authenticated`, as `agent_login` is
  called.
- Sharing is decided only in the database. The sync never sets `visibility`, `shared_with`,
  `quarantined`, topics, gallery folders, or a link's acceptance other than the same-owner
  acceptance `links_before_insert` already gives.
- A synced note's `body`, `title`, `frontmatter`, `path` and `folder_id` are changed only by
  the sync identity of a key of the same member and workspace. Everyone else is refused with
  `this note is kept by your vault: edit it in your vault`.
- Limits (exact values):
  - plan page: 2,000 entries;
  - notes batch: 50 notes and 1,000,000 bytes of text;
  - a note: 1,000,000 bytes;
  - a file: 52,428,800 bytes;
  - files batch: 200;
  - link pairs per call: 2,000;
  - uploads per run: 2,000,000,000 bytes;
  - path: 4,000 characters;
  - runs kept: 200 per key;
  - runs shown: 20;
  - guard: more than 25 items **or** more than 2% of the workspace's synced items;
  - schedule: every 900 seconds, plus at load.
- Skipped by the job:
  - any path part starting with `.`;
  - video extensions `mp4 mov m4v webm mkv avi wmv flv mpg mpeg 3gp`;
  - paths matching `.hivesyncignore`.
- The key format is `hsync_` followed by 64 lowercase hex characters. It is shown once and
  stored only as its SHA-256 hex. On the Mac it lives only in the Keychain, under service
  `hive-sync` and account `default`.
- Nothing logs or returns a key, a JWT, a note's text, or a database error's message. Errors
  carry a fixed phrase and a code.
- Commit identity `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage files by explicit path.
  Each commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with a
  header of at most 100 characters.
- All gates pass before closing: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Refinements of the spec

These are settled here. Task 1 writes them into the spec.

1. **The sync identity is an agent plus a claim.** `create_sync_key` makes an `agents` row (name
   `Hive sync`, provider `hive-sync`, tier `vendor`). Its `token_hash` is the hash of a random
   value that is never given out, so `agent_login` can never match it. The key's own hash lives
   in `sync_keys`.
2. **No storage dedupe by fingerprint.** `files.storage_path` is unique, so two vault paths with
   the same content are two objects. An object's place is
   `<member>/<workspace>/vault/<first 32 hex of sha256(vault_path + "\n" + content sha)>/<name>`.
   That place is fixed by path and content, so a retried upload lands on the same object.
3. **Old objects are removed later.** When a synced file changes or is deleted, its old object's
   path goes into `sync_orphans`. `purge-hives`, already running daily with the secret key,
   removes those objects (Task 5). The sync identity itself never deletes an object.
4. **Audit:**
   - Deletes are recorded by the existing delete-audit triggers. Their `agent_id` is the sync
     key's agent, and `sync_keys.agent_id` is unique, so the key can be found from it.
   - Moves write `note.moved` and `file.moved` entries, with `sync_key_id` in `detail`.
5. **Synced writes carry no session.** The sync's notes and files have `session_id` null. In the
   gallery's "By session" view, synced files form their own group, "From your vault", ahead of
   "No session".
6. **Generated notes.** A "Vault files" note (`<folder>/Vault files.md`) has
   `sync_generated = true`. It is never treated as gone. `sync_finish` deletes it once no file
   lives in it.
7. **Keys rotate without re-upload.** "Synced" means kept by any key, live or revoked, of the
   same member and workspace. A new key takes over the old key's notes and files.
8. **Too-big and unreadable paths are never deleted.** The job leaves them out of the manifest
   and also drops them from the gone list before calling `sync_delete`.
9. **A single delete never needs a confirm.** The guard trips at more than 25 items, or at more
   than 2% of synced items when that is more than one item. Without that, every single delete
   in a small workspace would wait for a confirm.
10. **The sync key's agent row stays out of the Agents tab** (filtered by provider `hive-sync`).
    While a key is live, deleting its workspace is refused ("still has an agent in use"); revoke
    the key first.

## File structure

| Path                                                       | Responsibility                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `supabase/migrations/<stamp>_vault_sync.sql`               | All tables, columns, policies, triggers and `sync_*` functions |
| `tests/sync.test.mjs`                                      | PGlite tests of every rule in the migration                    |
| `tests/helpers/sync.mjs`                                   | `syncFor(t, name)`: make a key, sign in, give the claims       |
| `supabase/functions/_shared/body.ts`                       | `readBody(req, max)`, moved out of `agent-session/session.ts`  |
| `supabase/functions/_shared/identity.ts`                   | `signIdentity` takes optional extra claims                     |
| `supabase/functions/sync-session/{index,session}.ts`       | A sync key in, a one-hour identity with `sync_key_id` out      |
| `tests/sync-session.test.mjs`                              | The function, with a stand-in `fetch`                          |
| `supabase/functions/purge-hives/purge.ts`                  | Also removes `sync_orphans` objects                            |
| `sync/package.json`, `sync/tsconfig.json`                  | The `@hive-mind/sync` package (no build; `tsc --noEmit`)       |
| `sync/src/skip.ts`                                         | Skip rules and `.hivesyncignore`                               |
| `sync/src/walk.ts`                                         | Walk the folder into entries                                   |
| `sync/src/cache.ts`                                        | Fingerprints, the cache file, link targets of notes            |
| `sync/src/homes.ts`                                        | Which note a file lives in                                     |
| `sync/src/links.ts`                                        | Wiki-link pairs between notes, by path                         |
| `sync/src/store.ts`                                        | The `Store` interface and its types                            |
| `sync/src/run.ts`                                          | One run: walk, plan, notes, links, files, deletes, finish      |
| `sync/src/rest-store.ts`                                   | `Store` over the REST API and Storage                          |
| `sync/src/session.ts`                                      | Sign in at `sync-session`, refresh before expiry               |
| `sync/src/mac.ts`                                          | Keychain, launchd plist, notification, lock                    |
| `sync/src/config.ts`                                       | Config and state files under Application Support               |
| `sync/src/cli.ts`                                          | `setup`, `now`, `status`, `--confirm-deletes`, `uninstall`     |
| `sync/test/*.test.ts`                                      | Unit tests, the stand-in store                                 |
| `web/src/settings/SyncTab.tsx` (+ text, types, tabs)       | Settings → Sync                                                |
| `web/src/app/settings/{load-settings,write,actions}.ts`    | Sync reads and the two writes                                  |
| `web/src/vault/*`, `web/src/app/vault/load-vault.ts`       | "From your vault" marker on synced notes                       |
| `web/src/gallery/*`, `web/src/app/gallery/load-gallery.ts` | "Home note set by your vault"; the "From your vault" group     |

## Execution DAG

| Task | Depends on  | Produces                                                                        |
| ---- | ----------- | ------------------------------------------------------------------------------- |
| 1    | none        | tables, columns, `jwt_sync_key`, keys, `sync_login`, triggers, walls, `syncFor` |
| 2    | 1           | `sync_open_run`, `sync_plan`, `sync_put_notes`, `sync_link_notes`               |
| 3    | 2           | `sync_put_files`, `sync_delete`, `sync_finish`, `sync_orphans`, `file_set_home` |
| 4    | 1           | `sync-session` Edge Function                                                    |
| 5    | 3           | `purge-hives` removes orphan objects                                            |
| 6    | none        | `sync/` package skeleton, `skip`, `walk`, `cache`                               |
| 7    | 6           | `homes`, `links`, `store`, `run` + stand-in store                               |
| 8    | 3, 4, 7     | `rest-store`, `session`, `mac`, `config`, `cli`                                 |
| 9    | 3           | Settings → Sync tab                                                             |
| 10   | 1           | Vault and gallery markers, "From your vault" group                              |
| 11   | 5, 8, 9, 10 | Hosted rollout and the first live run, by hand with Danijel                     |

Parallel batches (each concurrent task in its own worktree, per AGENTS.md #1/#6; merge each into
`task/vault-sync` before the next batch):

- **Batch A:** 1, 6
- **Batch B:** 2, 4, 7, 10
- **Batch C:** 3
- **Batch D:** 5, 8, 9
- **Batch E:** 11

**Critical path:** 1 → 2 → 3 → 8 → 11.

Tasks 1, 2 and 3 all write the same migration and test file, so they run strictly in order.

## Performance and data-fetching budget

- **Settings → Sync first paint:**
  - Two bounded reads, inside the Settings loader's existing parallel batch: live and revoked
    keys of the person (at most 20), and the newest 20 runs of the person's keys, indexed on
    `(key_id, started_at desc)`.
  - Opening the tab makes 0 requests; switching tabs is client state.
- **Making or revoking a key:** one RPC, then the existing `router.refresh()` of Settings.
- **Vault and gallery markers:** one more column in reads that already happen (`synced_by` and
  `vault_path` as booleans); 0 new requests.
- **`sync_plan`:**
  - It reads one workspace's synced notes by `(workspace_id, path)` (existing index) and its
    files by `files_vault_path_idx (workspace_id, vault_path)`.
  - Manifest rows are keyed `(run_id, path)`.
  - A run with no change is: 1 sign-in, 1 `sync_open_run`, 7 plan pages for 14,000 entries, and
    1 `sync_finish`.

---

### Task 1: Sync keys, the sync identity and its walls

**Files:**

- Create: `supabase/migrations/<stamp>_vault_sync.sql` (via `scripts/new-migration.sh vault_sync`)
- Create: `tests/sync.test.mjs`, `tests/helpers/sync.mjs`
- Modify: `docs/superpowers/specs/2026-11-26-vault-sync-design.md` (add a "Refinements" section
  listing the 10 refinements of this plan, word for word)

**Interfaces:**

- Consumes: `tests/helpers/hive.mjs` `setupHive()` (`as`, `person`, `agentFor`, `addNote`,
  `saveFile`, `members`, `ws`, `hive`, `db`).
- Produces (SQL):
  - tables `sync_keys`, `sync_runs`, `sync_manifest`, `sync_orphans`;
  - columns `notes.synced_by uuid`, `notes.sync_sha256 text`, `notes.sync_generated boolean`,
    `files.vault_path text`, `files.synced_by uuid`, `files.sync_sha256 text`;
  - `jwt_has_sync_claim() → boolean`, `jwt_sync_key() → uuid`, `_sync_family(uuid) → setof uuid`,
    `_sync_live() → sync_keys`;
  - `create_sync_key(p_workspace uuid) → table(key_id uuid, key text)`, `revoke_sync_key(p_key uuid)`;
  - `sync_login(p_key text) → table(sync_key_id, agent_id, user_id, member_id, workspace_id,
hive_id uuid, trust_tier trust_tier)`.
- Produces (JS): `tests/helpers/sync.mjs`:
  - `syncFor(t, name) → { keyId, key, claims }`, where `claims` is the JWT claims object for
    `t.as`;
  - `markSynced(t, table, id, keyId, sha = null)`.

Refinement 9 belongs to the guard (Task 3) but is written into the spec here. The guard trips at
more than 25 items, or at more than 2% of synced items **when that is more than one item**.
Deleting one file never needs a confirm.

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh vault_sync`
Expected: prints `supabase/migrations/<stamp>_vault_sync.sql`. Use that path everywhere below.

- [ ] **Step 2: Write the test helper**

`tests/helpers/sync.mjs`:

```js
// A sync key for one member's first workspace, signed in the way sync-session signs it.
export async function syncFor(t, name) {
  const made = (
    await t.as(t.person(name), `select * from public.create_sync_key($1)`, [
      t.ws[name],
    ])
  )[0];
  const login = (
    await t.as(null, `select * from public.sync_login($1)`, [made.key])
  )[0];
  return {
    keyId: made.key_id,
    key: made.key,
    claims: {
      sub: login.user_id,
      role: "authenticated",
      agent_id: login.agent_id,
      workspace_id: login.workspace_id,
      trust_tier: login.trust_tier,
      sync_key_id: login.sync_key_id,
    },
  };
}

// Marks a row as kept by a key, as the service would: no signed-in caller.
export async function markSynced(t, table, id, keyId, sha = null) {
  await t.db.query(
    `update public.${table} set synced_by = $2, sync_sha256 = $3 where id = $1`,
    [id, keyId, sha],
  );
}
```

- [ ] **Step 3: Write the failing tests**

`tests/sync.test.mjs`. Check one existing refusal in `tests/file-links.test.mjs` to see how the
suite asserts one (`assert.rejects(promise, /words/)`), and use the same form.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHive } from "./helpers/hive.mjs";
import { syncFor, markSynced } from "./helpers/sync.mjs";

test("a person makes a sync key for an own workspace; it is shown once", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  assert.match(s.key, /^hsync_[0-9a-f]{64}$/);
  const rows = await t.as(
    t.person("dani"),
    `select id, revoked_at from public.sync_keys`,
  );
  assert.equal(rows.length, 1);
  await assert.rejects(
    t.as(t.person("dani"), `select key_hash from public.sync_keys`),
    /permission denied/,
  );
});

test("only a person makes a key, and only for their own workspace", async () => {
  const t = await setupHive();
  const agent = await t.agentFor("dani");
  await assert.rejects(
    t.as(agent, `select * from public.create_sync_key($1)`, [t.ws.dani]),
    /only a person makes a sync key/,
  );
  await assert.rejects(
    t.as(t.person("ahmed"), `select * from public.create_sync_key($1)`, [
      t.ws.dani,
    ]),
    /that workspace is not yours/,
  );
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(s.claims, `select * from public.create_sync_key($1)`, [t.ws.dani]),
    /only a person makes a sync key/,
  );
});

test("a new key revokes the old one; a revoked key does not sign in", async () => {
  const t = await setupHive();
  const first = await syncFor(t, "dani");
  await syncFor(t, "dani");
  await assert.rejects(
    t.as(null, `select * from public.sync_login($1)`, [first.key]),
    /unknown or revoked sync key/,
  );
  const second = await syncFor(t, "dani");
  await t.as(t.person("dani"), `select public.revoke_sync_key($1)`, [
    second.keyId,
  ]);
  await assert.rejects(
    t.as(null, `select * from public.sync_login($1)`, [second.key]),
    /unknown or revoked sync key/,
  );
  await assert.rejects(
    t.as(t.person("ahmed"), `select public.revoke_sync_key($1)`, [first.keyId]),
    /that sync key is not yours/,
  );
});

test("a sync key is not an agent token", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(null, `select * from public.agent_login($1)`, [s.key]),
    /unknown, expired or revoked token/,
  );
});

test("the sync identity cannot touch a table directly", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Mine");
  const s = await syncFor(t, "dani");
  assert.equal((await t.as(s.claims, `select id from public.notes`)).length, 0);
  assert.equal(
    (await t.as(s.claims, `select id from public.sync_keys`)).length,
    0,
  );
  await assert.rejects(
    t.as(
      s.claims,
      `insert into public.notes (hive_id, member_id, workspace_id, path, title)
       values ($1, $2, $3, 'x.md', 'x')`,
      [t.hive, t.members.dani, t.ws.dani],
    ),
    /row-level security/,
  );
});

test("the sync identity is refused every person-only function", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await assert.rejects(t.as(s.claims, `select public.create_hive('x', 'x')`));
  await assert.rejects(
    t.as(s.claims, `select * from public.create_agent($1, 'a', 'other')`, [
      t.ws.dani,
    ]),
    /agents cannot create agents/,
  );
});

test("the sync identity may upload only under its own workspace", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  await t.as(
    s.claims,
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [`${t.members.dani}/${t.ws.dani}/vault/aa/x.pdf`],
  );
  await assert.rejects(
    t.as(
      s.claims,
      `insert into storage.objects (bucket_id, name) values ('files', $1)`,
      [`${t.members.ahmed}/${t.ws.ahmed}/vault/aa/x.pdf`],
    ),
  );
});

test("a synced note is read-only to the person and their agents", async () => {
  const t = await setupHive();
  const n = await t.addNote("dani", "Kept");
  const s = await syncFor(t, "dani");
  await markSynced(t, "notes", n.id, s.keyId);
  await assert.rejects(
    t.as(t.person("dani"), `update public.notes set body = 'x' where id = $1`, [
      n.id,
    ]),
    /this note is kept by your vault: edit it in your vault/,
  );
  await assert.rejects(
    t.as(
      t.person("dani"),
      `update public.notes set path = 'moved.md' where id = $1`,
      [n.id],
    ),
    /this note is kept by your vault/,
  );
  const agent = await t.agentFor("dani");
  await assert.rejects(
    t.as(agent, `update public.notes set body = 'x' where id = $1`, [n.id]),
    /this note is kept by your vault/,
  );
  // Sharing stays the person's, and so does deleting.
  await t.as(
    t.person("dani"),
    `update public.notes set visibility = 'hive' where id = $1`,
    [n.id],
  );
  await t.as(t.person("dani"), `delete from public.notes where id = $1`, [
    n.id,
  ]);
});

test("nobody but the sync marks a note or a file as kept", async () => {
  const t = await setupHive();
  const n = await t.addNote("dani", "Mine");
  const s = await syncFor(t, "dani");
  await assert.rejects(
    t.as(
      t.person("dani"),
      `update public.notes set synced_by = $2 where id = $1`,
      [n.id, s.keyId],
    ),
    /only the sync marks a note as kept by your vault/,
  );
  const f = await t.saveFile(t.person("dani"), "dani", "a.pdf");
  const row = (
    await t.db.query(
      `select vault_path, synced_by from public.files where id = $1`,
      [f.id],
    )
  ).rows[0];
  assert.equal(row.vault_path, null);
  assert.equal(row.synced_by, null);
});
```

The connected-app refusal is covered by the existing `*_no_app` policies and by the
`jwt_oauth_client()` check in `create_sync_key`. Add one more test, modelled on the app-pass
case in `tests/sharing-rules.test.mjs`: copy how that file builds an app pass's claims. It
asserts `create_sync_key` refuses an app pass with `/only a person makes a sync key/`.

- [ ] **Step 4: Run the tests to see them fail**

Run: `node --test tests/sync.test.mjs`
Expected: FAIL. `create_sync_key` does not exist.

- [ ] **Step 5: Write the migration's first part**

Put this in the minted file. `notes_before_write` is the body from
`20261124153504_note_dates.sql`, changed only where marked `-- sync:`. `tag_session` is the body
from `20261124181505_sessions.sql`, with one new block marked `-- sync:`.

```sql
-- Hive Mind: vault sync. A scheduled job on a person's computer keeps one workspace equal to one
-- vault folder. It signs in with a sync key: the key is backed by an agent row, so every wall
-- an agent meets holds for it too, and it carries a sync_key_id claim. Its extra powers (moving
-- and deleting the notes and files it keeps, adopting imported notes, written dates) exist only
-- inside the sync_* functions below, which check the key is live. Restrictive policies keep it
-- off every table; only storage uploads under its own workspace go through directly.
-- Spec: docs/superpowers/specs/2026-11-26-vault-sync-design.md.

-- ------------------------------------------------------------------ tables

create table public.sync_keys (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  agent_id uuid not null unique references public.agents on delete cascade,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create unique index sync_keys_one_live on public.sync_keys (member_id, workspace_id)
  where revoked_at is null;
create index sync_keys_member_idx on public.sync_keys (member_id, created_at desc);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.sync_keys on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  added integer not null default 0,
  changed integer not null default 0,
  moved integer not null default 0,
  deleted integer not null default 0,
  skipped integer not null default 0,
  too_big integer not null default 0,
  too_big_paths text[] not null default '{}',
  refused_deletes text[] not null default '{}',
  -- The refused list of the run before, when the job was told to let it through.
  confirmable text[] not null default '{}',
  error text
);
create index sync_runs_key_idx on public.sync_runs (key_id, started_at desc);

-- One run's manifest, page by page. Nobody reads it through the API.
create table public.sync_manifest (
  run_id uuid not null references public.sync_runs on delete cascade,
  path text not null,
  sha256 text not null,
  size bigint not null,
  home text,
  primary key (run_id, path)
);

-- Stored objects no row uses any more, removed daily by purge-hives with the secret key.
create table public.sync_orphans (
  storage_path text primary key,
  hive_id uuid not null references public.hives on delete cascade,
  at timestamptz not null default now()
);

-- No action on delete: a key goes only with its workspace, member or hive, and their notes and
-- files go in the same statement or before it (purge_hive).
alter table public.notes
  add column synced_by uuid references public.sync_keys,
  add column sync_sha256 text,
  add column sync_generated boolean not null default false;
alter table public.files
  add column vault_path text,
  add column synced_by uuid references public.sync_keys,
  add column sync_sha256 text;
create unique index files_vault_path_idx on public.files (workspace_id, vault_path)
  where vault_path is not null;
create index notes_synced_by_idx on public.notes (synced_by) where synced_by is not null;
create index files_synced_by_idx on public.files (synced_by) where synced_by is not null;

alter table public.sync_keys enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_manifest enable row level security;
alter table public.sync_orphans enable row level security;

-- The key's hash is never read through the API.
revoke all on public.sync_keys from anon, authenticated;
grant select (id, member_id, workspace_id, agent_id, created_at, last_used_at, revoked_at)
  on public.sync_keys to authenticated;
revoke all on public.sync_runs, public.sync_manifest, public.sync_orphans
  from anon, authenticated;
grant select on public.sync_runs to authenticated;

create policy sync_keys_select on public.sync_keys for select to authenticated
  using (member_id in (select public.my_member_ids()) and public.jwt_agent_id() is null);
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (public.jwt_agent_id() is null and key_id in (
    select k.id from public.sync_keys k where k.member_id in (select public.my_member_ids())));

-- ------------------------------------------------------------- the identity

-- The token says it is the sync's, whether or not its key is still live.
create function public.jwt_has_sync_claim() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ? 'sync_key_id', false)
$$;

-- The live key this token was signed for, or null: the key's agent, workspace and member must
-- be the token's own.
create function public.jwt_sync_key() returns uuid
language sql stable security definer set search_path = '' as $$
  select k.id from public.sync_keys k
    join public.members m on m.id = k.member_id
   where public.jwt_has_sync_claim()
     and k.id::text = auth.jwt() ->> 'sync_key_id'
     and k.revoked_at is null
     and k.agent_id = public.jwt_agent_id()
     and k.workspace_id::text = auth.jwt() ->> 'workspace_id'
     and m.user_id = (select auth.uid())
$$;

-- Every key, live or revoked, of the same member and workspace: what one of them synced, the
-- next one keeps.
create function public._sync_family(p_key uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select o.id from public.sync_keys k
    join public.sync_keys o on o.member_id = k.member_id and o.workspace_id = k.workspace_id
   where k.id = p_key
$$;

create function public._sync_live() returns public.sync_keys
language plpgsql stable security definer set search_path = '' as $$
declare
  k public.sync_keys;
begin
  select * into k from public.sync_keys where id = public.jwt_sync_key();
  if k.id is null then
    raise exception 'this sync key is not live' using errcode = '42501';
  end if;
  return k;
end
$$;

-- -------------------------------------------------------------------- keys

create function public.create_sync_key(p_workspace uuid)
returns table (key_id uuid, key text)
language plpgsql security definer set search_path = '' as $$
declare
  v_member uuid;
  v_key text := 'hsync_' || replace(gen_random_uuid()::text, '-', '')
                         || replace(gen_random_uuid()::text, '-', '');
  v_agent uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null or public.jwt_agent_id() is not null
     or public.jwt_oauth_client() is not null or public.jwt_is_self_hosted()
     or public.jwt_has_sync_claim() then
    raise exception 'only a person makes a sync key' using errcode = '42501';
  end if;
  select w.member_id into v_member from public.workspaces w
   where w.id = p_workspace and w.member_id in (select public.my_member_ids());
  if v_member is null then
    raise exception 'that workspace is not yours' using errcode = '42501';
  end if;
  update public.agents a set revoked_at = now()
    from public.sync_keys k
   where k.agent_id = a.id and k.member_id = v_member and k.workspace_id = p_workspace
     and k.revoked_at is null;
  update public.sync_keys set revoked_at = now()
   where member_id = v_member and workspace_id = p_workspace and revoked_at is null;
  -- The agent's own token is a value nobody is ever given: agent_login cannot match it.
  insert into public.agents (member_id, workspace_id, name, provider, trust_tier, token_hash)
  values (v_member, p_workspace, 'Hive sync', 'hive-sync', 'vendor',
          encode(sha256(convert_to('unusable:' || gen_random_uuid()::text
                                   || gen_random_uuid()::text, 'UTF8')), 'hex'))
  returning id into v_agent;
  insert into public.sync_keys (member_id, workspace_id, agent_id, key_hash)
  values (v_member, p_workspace, v_agent, encode(sha256(convert_to(v_key, 'UTF8')), 'hex'))
  returning id into v_id;
  return query select v_id, v_key;
end
$$;

create function public.revoke_sync_key(p_key uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys;
begin
  if (select auth.uid()) is null or public.jwt_agent_id() is not null
     or public.jwt_oauth_client() is not null or public.jwt_has_sync_claim() then
    raise exception 'only a person revokes a sync key' using errcode = '42501';
  end if;
  select * into k from public.sync_keys
   where id = p_key and member_id in (select public.my_member_ids());
  if k.id is null then
    raise exception 'that sync key is not yours' using errcode = '42501';
  end if;
  update public.sync_keys set revoked_at = coalesce(revoked_at, now()) where id = k.id;
  update public.agents set revoked_at = coalesce(revoked_at, now()) where id = k.agent_id;
end
$$;

-- sync-session exchanges a key for the identity to sign. Default error code (P0001): the REST
-- API answers 400, which the function reads as "refused".
create function public.sync_login(p_key text)
returns table (sync_key_id uuid, agent_id uuid, user_id uuid, member_id uuid,
               workspace_id uuid, hive_id uuid, trust_tier public.trust_tier)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_key is null or p_key !~ '^hsync_[0-9a-f]{64}$' then
    raise exception 'unknown or revoked sync key';
  end if;
  select k.id into v_id from public.sync_keys k join public.agents a on a.id = k.agent_id
   where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
     and k.revoked_at is null and a.revoked_at is null;
  if v_id is null then
    raise exception 'unknown or revoked sync key';
  end if;
  update public.sync_keys set last_used_at = now() where id = v_id;
  return query
    select k.id, k.agent_id, m.user_id, m.id, k.workspace_id, m.hive_id, a.trust_tier
      from public.sync_keys k
      join public.members m on m.id = k.member_id
      join public.agents a on a.id = k.agent_id
     where k.id = v_id;
end
$$;

-- --------------------------------------------------------------- triggers

create or replace function public.notes_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.workspaces;
  agent uuid := public.jwt_agent_id();
  -- sync: the live key of a sync identity, else null.
  sync_key uuid := public.jwt_sync_key();
  k public.sync_keys;
  -- An agent or an app: its dates are the real moment. sync: the sync is not limited; it
  -- sends the file's dates, as an import does.
  limited boolean := (public.jwt_agent_id() is not null and public.jwt_sync_key() is null)
                  or public.jwt_oauth_client() is not null
                  or public.jwt_is_self_hosted();
  person boolean;
  earliest constant timestamptz := timestamptz '1990-01-01 00:00:00+00';
begin
  person := not limited and (select auth.uid()) is not null;
  if sync_key is not null then
    select * into k from public.sync_keys where id = sync_key;
  end if;

  if tg_op = 'INSERT' then
    select * into w from public.workspaces where id = new.workspace_id;
    if not found or w.member_id <> new.member_id then
      raise exception 'workspace does not belong to this member';
    end if;
    new.hive_id := w.hive_id;
    new.version := 1;
    new.written_by_agent := agent;
    -- sync: what the sync writes is kept by its key; nobody else marks a note so.
    if sync_key is not null then
      if new.member_id <> k.member_id or new.workspace_id <> k.workspace_id then
        raise exception 'the sync writes only in its own workspace';
      end if;
      new.synced_by := sync_key;
    else
      new.synced_by := null;
      new.sync_sha256 := null;
      new.sync_generated := false;
    end if;
    if agent is not null then
      if new.visibility is not null or new.shared_with <> '{}' then
        raise exception 'agents cannot set sharing';
      end if;
      new.quarantined := public.jwt_is_self_hosted();
    end if;
    if limited then
      new.created_at := now();
      new.updated_at := now();
    elsif person then
      new.created_at := greatest(
        least(coalesce(new.created_at, now()), now()), earliest);
      new.updated_at := least(
        greatest(coalesce(new.updated_at, now()), new.created_at), now());
    end if;
    return new;
  end if;

  if new.member_id <> old.member_id or new.workspace_id <> old.workspace_id
     or new.hive_id <> old.hive_id then
    raise exception 'a note cannot move to another member, workspace or hive';
  end if;
  -- sync: the sync changes only the notes its key's family keeps, or adopts a note of its own
  -- member and workspace that nobody keeps yet.
  if sync_key is not null then
    if not (old.synced_by in (select public._sync_family(sync_key))
            or (old.synced_by is null and new.synced_by = sync_key
                and old.member_id = k.member_id and old.workspace_id = k.workspace_id))
       or new.synced_by is null
       or new.synced_by not in (select public._sync_family(sync_key)) then
      raise exception 'the sync only changes the notes it keeps';
    end if;
  elsif (select auth.uid()) is not null then
    -- sync: a signed-in caller that is not the sync. The service (no caller) is not held.
    if new.synced_by is distinct from old.synced_by
       or new.sync_sha256 is distinct from old.sync_sha256
       or new.sync_generated <> old.sync_generated then
      raise exception 'only the sync marks a note as kept by your vault';
    end if;
    if old.synced_by is not null and (
         new.title <> old.title or new.body <> old.body
      or new.frontmatter <> old.frontmatter or new.path <> old.path
      or new.folder_id is distinct from old.folder_id) then
      raise exception 'this note is kept by your vault: edit it in your vault';
    end if;
  end if;
  if agent is not null and sync_key is null and new.path <> old.path then
    raise exception 'agents cannot move a note';
  end if;
  if agent is not null and (
       new.visibility is distinct from old.visibility
    or new.shared_with <> old.shared_with
    or new.quarantined <> old.quarantined
    or (sync_key is null and new.folder_id is distinct from old.folder_id)) then
    raise exception 'agents cannot change sharing';
  end if;
  if limited then
    new.created_at := old.created_at;
  elsif person and new.created_at is distinct from old.created_at then
    if new.created_at is null then
      new.created_at := old.created_at;
    else
      new.created_at := greatest(least(new.created_at, now()), earliest);
    end if;
  end if;
  if new.title <> old.title or new.body <> old.body or new.frontmatter <> old.frontmatter then
    new.version := old.version + 1;
    if person and new.updated_at is distinct from old.updated_at then
      new.updated_at := least(
        greatest(coalesce(new.updated_at, now()), new.created_at, earliest),
        now());
    else
      new.updated_at := now();
    end if;
    new.written_by_agent := agent;
  else
    new.version := old.version;
    if limited then
      new.updated_at := old.updated_at;
    elsif person and (new.updated_at is distinct from old.updated_at
                      or new.created_at is distinct from old.created_at) then
      if new.updated_at is null then
        new.updated_at := old.updated_at;
      elsif new.updated_at is distinct from old.updated_at then
        new.updated_at := greatest(new.updated_at, earliest);
      end if;
      new.updated_at := least(greatest(new.updated_at, new.created_at), now());
    end if;
  end if;
  return new;
end
$$;

-- The three sync columns of a file are the sync's alone. A person's or an agent's insert has
-- them emptied; an update by any other signed-in caller that changes them is refused.
create function public.files_sync_columns() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sync_key uuid := public.jwt_sync_key();
begin
  if sync_key is not null then
    if tg_op = 'INSERT' then
      new.synced_by := sync_key;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.vault_path := null;
    new.synced_by := null;
    new.sync_sha256 := null;
  elsif (select auth.uid()) is not null and (
       new.vault_path is distinct from old.vault_path
    or new.synced_by is distinct from old.synced_by
    or new.sync_sha256 is distinct from old.sync_sha256) then
    raise exception 'only the sync changes where a vault file is kept';
  end if;
  return new;
end
$$;
create trigger files_sync_columns before insert or update on public.files
  for each row execute function public.files_sync_columns();
revoke all on function public.files_sync_columns() from public, anon, authenticated;

create or replace function public.tag_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_closing text := current_setting('hive.closing_session', true);
begin
  if v_closing is not null and v_closing <> '' then
    new.session_id := v_closing::uuid;
    return new;
  end if;
  -- sync: what the sync writes belongs to no session.
  if public.jwt_has_sync_claim() then
    if tg_op = 'INSERT' then
      new.session_id := null;
    else
      new.session_id := case
        when new.session_id is null and old.session_id is not null
             and not exists (select 1 from public.sessions s where s.id = old.session_id)
        then null
        else old.session_id
      end;
    end if;
    return new;
  end if;
  if public.jwt_agent_id() is not null then
    if tg_op = 'INSERT' then
      new.session_id := public._agent_session();
    else
      perform public._agent_session();
      new.session_id := case
        when new.session_id is null and old.session_id is not null
             and not exists (select 1 from public.sessions s where s.id = old.session_id)
        then null  -- the foreign key emptying a deleted session's reference
        else old.session_id
      end;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.session_id := case
      when new.session_id is null and old.session_id is not null
           and not exists (select 1 from public.sessions s where s.id = old.session_id)
      then null  -- the foreign key emptying a deleted session's reference
      else old.session_id
    end;
    return new;
  end if;
  -- A person: only their own open upload session.
  if new.session_id is not null and not exists (
       select 1 from public.sessions s
        where s.id = new.session_id and s.agent_id is null and s.ended_at is null
          and s.member_id = new.member_id and s.workspace_id = new.workspace_id
          and s.member_id in (select public.my_member_ids())) then
    raise exception 'not your upload session';
  end if;
  return new;
end
$$;

-- ------------------------------------------------------------- the walls

-- Restrictive, so no other policy can let the sync identity through: on every table of the
-- public schema with row-level security, the four sync tables included. It reaches the tables
-- only through the sync_* functions. A table added later needs its own *_no_sync policy.
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (not public.jwt_has_sync_claim()) with check (not public.jwt_has_sync_claim())',
      t.relname || '_no_sync', t.relname);
  end loop;
end
$$;

-- An app pass sees no sync rows either.
create policy sync_keys_no_app on public.sync_keys as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null) with check (public.jwt_oauth_client() is null);
create policy sync_runs_no_app on public.sync_runs as restrictive for all to authenticated
  using (public.jwt_oauth_client() is null) with check (public.jwt_oauth_client() is null);

-- ------------------------------------------------------------------ grants

revoke all on function public.jwt_sync_key() from public, anon;
revoke all on function public._sync_family(uuid) from public, anon, authenticated;
revoke all on function public._sync_live() from public, anon, authenticated;
revoke all on function public.create_sync_key(uuid) from public, anon;
revoke all on function public.revoke_sync_key(uuid) from public, anon;
revoke all on function public.sync_login(text) from public;
grant execute on function public.jwt_has_sync_claim() to authenticated;
grant execute on function public.jwt_sync_key() to authenticated;
grant execute on function public.create_sync_key(uuid) to authenticated;
grant execute on function public.revoke_sync_key(uuid) to authenticated;
grant execute on function public.sync_login(text) to anon, authenticated;
```

Policies and triggers call `jwt_has_sync_claim()` and `jwt_sync_key()` under the caller's role,
which is why `authenticated` holds execute on both. `_sync_family` and `_sync_live` are called
only from security-definer functions. If PGlite reports `permission denied for function
_sync_family` from inside `notes_before_write`, the trigger runs as the definer and the
cause is elsewhere. Do not grant it to `authenticated`; find the caller that is not a definer.

- [ ] **Step 6: Run the tests to see them pass**

Run: `node --test tests/sync.test.mjs`
Expected: PASS, 10 tests.

Then run `pnpm test` from the root. Expected: every existing suite still passes. Watch
`tests/sharing-rules.test.mjs` and `tests/sessions.test.mjs`: they exercise the two replaced
triggers.

- [ ] **Step 7: Update the spec and commit**

In the spec, add a section after "Out of scope": `## Refinements (from the plan)`, holding the 10
numbered refinements of this plan's "Refinements of the spec" section, with refinement 9 (the
guard's one-item rule) included.

```bash
git add supabase/migrations/*_vault_sync.sql tests/sync.test.mjs tests/helpers/sync.mjs docs/superpowers/specs/2026-11-26-vault-sync-design.md
git commit -m "feat(db): sync keys and the sync identity, walled off from every table"
```

### Task 2: The plan, notes and links

**Files:**

- Modify: `supabase/migrations/<stamp>_vault_sync.sql` (append)
- Modify: `tests/sync.test.mjs` (append)

**Interfaces:**

- Consumes: Task 1 (`_sync_live`, `_sync_family`, tables, `syncFor`, `markSynced`).
- Produces:
  - `sync_open_run(p_confirm boolean) → jsonb {run_id, storage_prefix}`. `storage_prefix` is
    `<member>/<workspace>/vault/`.
  - `sync_plan(p_run uuid, p_entries jsonb, p_last boolean) → jsonb`.
    - Entries are `[{path, sha256, size, home?}]`.
    - Before the last page it answers `{received}`.
    - On the last page it answers `{new: text[], changed: text[], moved: [{from, to}],
gone: text[], rehome: [{path, home}], kept: integer}`.
  - `sync_put_notes(p_run uuid, p_notes jsonb) → jsonb {written: [{path, id}], failed: [{path,
code}]}`.
    - Notes are `[{path, title, body, frontmatter, sha256, from?, created_at?, updated_at?}]`.
  - `sync_link_notes(p_run uuid, p_pairs jsonb) → integer` (links made). Pairs are
    `[{from, to}]`, given as note paths.
  - Internal: `_sync_run(uuid)`, `_sync_path_ok(text)`, `_sync_folder(sync_keys, text)`,
    `_sync_date(text)`.

- [ ] **Step 1: Write the failing tests** (append to `tests/sync.test.mjs`)

```js
const sha = (c) => c.repeat(64);
const openRun = async (t, s, confirm = false) =>
  (await t.as(s.claims, `select public.sync_open_run($1) as r`, [confirm]))[0]
    .r;
const plan = async (t, s, run, entries) =>
  (
    await t.as(s.claims, `select public.sync_plan($1, $2, true) as p`, [
      run,
      JSON.stringify(entries),
    ])
  )[0].p;
const putNotes = async (t, s, run, notes) =>
  (
    await t.as(s.claims, `select public.sync_put_notes($1, $2) as r`, [
      run,
      JSON.stringify(notes),
    ])
  )[0].r;
const note = (path, c, extra = {}) => ({
  path,
  title: path.replace(/\.md$/, ""),
  body: `body ${c}`,
  frontmatter: {},
  sha256: sha(c),
  ...extra,
});

test("a run opens only with a live key, and names its storage folder", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  assert.equal(r.storage_prefix, `${t.members.dani}/${t.ws.dani}/vault/`);
  await t.as(t.person("dani"), `select public.revoke_sync_key($1)`, [s.keyId]);
  await assert.rejects(openRun(t, s), /this sync key is not live/);
});

test("the plan lists new, changed, moved and gone, and adopts imported notes", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Imported", { path: "a/Imported.md" });
  await t.addNote("dani", "Uploads", { path: "Uploads.md" });
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  let p = await plan(t, s, run, [
    { path: "a/Imported.md", sha256: sha("1"), size: 4 },
    { path: "b/New.md", sha256: sha("2"), size: 4 },
  ]);
  // The imported note is adopted with no fingerprint yet, so it is "changed".
  assert.deepEqual(p.new, ["b/New.md"]);
  assert.deepEqual(p.changed, ["a/Imported.md"]);
  assert.deepEqual(p.gone, []);
  await putNotes(t, s, run, [
    note("a/Imported.md", "1"),
    note("b/New.md", "2"),
  ]);

  run = (await openRun(t, s)).run_id;
  p = await plan(t, s, run, [
    { path: "a/Imported.md", sha256: sha("1"), size: 4 },
    { path: "c/New.md", sha256: sha("2"), size: 4 },
  ]);
  assert.deepEqual(p.moved, [{ from: "b/New.md", to: "c/New.md" }]);
  assert.deepEqual(p.new, []);
  assert.deepEqual(p.changed, []);
  // Uploads.md was never synced: it is not gone.
  assert.deepEqual(p.gone, []);
  assert.equal(p.kept, 2);
});

test("two new paths with the moved content are not a move", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  await plan(t, s, run, [{ path: "x.md", sha256: sha("3"), size: 1 }]);
  await putNotes(t, s, run, [note("x.md", "3")]);
  run = (await openRun(t, s)).run_id;
  const p = await plan(t, s, run, [
    { path: "y.md", sha256: sha("3"), size: 1 },
    { path: "z.md", sha256: sha("3"), size: 1 },
  ]);
  assert.deepEqual(p.moved, []);
  assert.deepEqual(p.gone, ["x.md"]);
  assert.deepEqual(p.new, ["y.md", "z.md"]);
});

test("pages are refused when malformed or too long", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  await assert.rejects(
    plan(t, s, run, [{ path: "../x.md", sha256: sha("1"), size: 1 }]),
    /a manifest entry is not usable/,
  );
  await assert.rejects(
    plan(t, s, run, [{ path: "x.md", sha256: "nope", size: 1 }]),
    /a manifest entry is not usable/,
  );
  await assert.rejects(
    plan(t, s, run, [{ path: "x.md", sha256: sha("1") }]),
    /a manifest entry is not usable/,
  );
  const many = Array.from({ length: 2001 }, (_, i) => ({
    path: `n${i}.md`,
    sha256: sha("1"),
    size: 1,
  }));
  await assert.rejects(plan(t, s, run, many), /a page holds at most 2000/);
});

test("another member's run cannot be used", async () => {
  const t = await setupHive();
  const a = await syncFor(t, "dani");
  const b = await syncFor(t, "ahmed");
  const run = (await openRun(t, a)).run_id;
  await assert.rejects(plan(t, b, run, []), /no such run/);
});

test("synced notes: a move keeps the note, dates come from the vault, no session", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let run = (await openRun(t, s)).run_id;
  const r = await putNotes(t, s, run, [
    note("old/A.md", "4", { created_at: "2024-03-01T12:00:00Z" }),
  ]);
  const id = r.written[0].id;
  run = (await openRun(t, s)).run_id;
  await putNotes(t, s, run, [note("new/A.md", "4", { from: "old/A.md" })]);
  const row = (
    await t.db.query(
      `select n.path, n.created_at, n.session_id, n.visibility, n.synced_by,
              f.path as folder
         from public.notes n left join public.folders f on f.id = n.folder_id
        where n.id = $1`,
      [id],
    )
  ).rows[0];
  assert.equal(row.path, "new/A.md");
  assert.equal(row.folder, "new");
  assert.equal(row.session_id, null);
  assert.equal(row.visibility, null);
  assert.equal(row.synced_by, s.keyId);
  assert.equal(
    new Date(row.created_at).toISOString(),
    "2024-03-01T12:00:00.000Z",
  );
  const audit = await t.db.query(
    `select detail from public.audit_log where action = 'note.moved'`,
  );
  assert.equal(audit.rows[0].detail.sync_key_id, s.keyId);
});

test("a move from a note the sync does not keep writes a new note instead", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Mine", { path: "Mine.md" });
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  const r = await putNotes(t, s, run, [
    note("Elsewhere.md", "5", { from: "Mine.md" }),
  ]);
  assert.equal(r.written.length, 1);
  const still = await t.db.query(
    `select count(*)::int as n from public.notes
      where path = 'Mine.md' and synced_by is null`,
  );
  assert.equal(still.rows[0].n, 1);
});

test("a new key keeps what the old key synced", async () => {
  const t = await setupHive();
  const first = await syncFor(t, "dani");
  let run = (await openRun(t, first)).run_id;
  await putNotes(t, first, run, [note("K.md", "a")]);
  const second = await syncFor(t, "dani");
  run = (await openRun(t, second)).run_id;
  const p = await plan(t, second, run, [
    { path: "K.md", sha256: sha("a"), size: 1 },
  ]);
  assert.deepEqual(p.new, []);
  assert.deepEqual(p.changed, []);
});

test("a batch over 50 notes or 1 MB of text is refused whole", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  const many = Array.from({ length: 51 }, (_, i) => note(`n${i}.md`, "6"));
  await assert.rejects(
    putNotes(t, s, run, many),
    /a batch holds at most 50 notes/,
  );
  const big = note("big.md", "7", { body: "x".repeat(1_000_001) });
  await assert.rejects(
    putNotes(t, s, run, [big]),
    /a batch holds at most 1 MB/,
  );
});

test("wiki links between synced notes are made and accepted at once", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const run = (await openRun(t, s)).run_id;
  await putNotes(t, s, run, [note("A.md", "8"), note("B.md", "9")]);
  const made = (
    await t.as(s.claims, `select public.sync_link_notes($1, $2) as n`, [
      run,
      JSON.stringify([
        { from: "A.md", to: "B.md" },
        { from: "B.md", to: "A.md" },
      ]),
    ])
  )[0].n;
  assert.equal(made, 1);
  const l = await t.db.query(`select status from public.links`);
  assert.equal(l.rows[0].status, "accepted");
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/sync.test.mjs`
Expected: the new tests FAIL (`sync_open_run` does not exist). Task 1's tests still pass.

- [ ] **Step 3: Append the functions**

```sql
-- ------------------------------------------------------------------- runs

-- The caller's open run. Raises for any other id.
create function public._sync_run(p_run uuid) returns public.sync_runs
language plpgsql stable security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs;
begin
  select * into r from public.sync_runs
   where id = p_run and key_id = k.id and finished_at is null;
  if r.id is null then
    raise exception 'no such run' using errcode = '22023';
  end if;
  return r;
end
$$;

create function public.sync_open_run(p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  v_prev text[];
  v_run uuid;
begin
  if coalesce(p_confirm, false) then
    select r.refused_deletes into v_prev from public.sync_runs r
     where r.key_id in (select public._sync_family(k.id))
     order by r.started_at desc limit 1;
  end if;
  insert into public.sync_runs (key_id, confirmable)
  values (k.id, coalesce(v_prev, '{}'))
  returning id into v_run;
  return jsonb_build_object(
    'run_id', v_run,
    'storage_prefix', k.member_id::text || '/' || k.workspace_id::text || '/vault/');
end
$$;

-- A vault path the sync may name: relative, "/" separated, no empty, "." or ".." part, no
-- backslash, 1 to 4000 characters.
create function public._sync_path_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    length(p) between 1 and 4000
    and p !~ '(^|/)\.{1,2}(/|$)' and p !~ '//' and p !~ '^/' and p !~ '/$'
    and position(E'\\' in p) = 0, false)
$$;

-- ------------------------------------------------------------------- plan

create function public.sync_plan(p_run uuid, p_entries jsonb, p_last boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_n integer;
  v_out jsonb;
begin
  if coalesce(jsonb_typeof(p_entries), '') <> 'array' then
    raise exception 'a manifest entry is not usable' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_entries);
  if v_n > 2000 then
    raise exception 'a page holds at most 2000 entries' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) e
     where coalesce(jsonb_typeof(e), '') <> 'object'
        or not public._sync_path_ok(e ->> 'path')
        or coalesce(e ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        or coalesce(jsonb_typeof(e -> 'size'), '') <> 'number'
        or not coalesce((e ->> 'size')::numeric between 0 and 52428800, false)
        or (coalesce(jsonb_typeof(e -> 'home'), 'null') <> 'null'
            and not public._sync_path_ok(e ->> 'home'))) then
    raise exception 'a manifest entry is not usable' using errcode = '22023';
  end if;
  insert into public.sync_manifest (run_id, path, sha256, size, home)
  select p_run, e ->> 'path', e ->> 'sha256', (e ->> 'size')::bigint, e ->> 'home'
    from jsonb_array_elements(p_entries) e
  on conflict (run_id, path) do update
    set sha256 = excluded.sha256, size = excluded.size, home = excluded.home;
  if not coalesce(p_last, false) then
    return jsonb_build_object('received', v_n);
  end if;

  -- Adoption: a note of the key's member and workspace at a manifest path, kept by nobody.
  -- It has no fingerprint yet, so it is planned as changed and its text is sent once.
  update public.notes n set synced_by = k.id, sync_sha256 = null
    from public.sync_manifest m
   where m.run_id = p_run and m.path ~* '\.md$'
     and n.workspace_id = k.workspace_id and n.member_id = k.member_id
     and n.path = m.path and n.synced_by is null;

  with fam as (select f as id from public._sync_family(k.id) f),
  m as (select path, sha256, home, (path ~* '\.md$') as note
          from public.sync_manifest where run_id = p_run),
  kept as (
    select n.path, n.sync_sha256 as sha, true as note, null::text as home
      from public.notes n
     where n.workspace_id = k.workspace_id and n.synced_by in (select id from fam)
       and not n.sync_generated
    union all
    select f.vault_path, f.sync_sha256, false,
           (select x.path from public.notes x where x.id = f.note_id)
      from public.files f
     where f.workspace_id = k.workspace_id and f.synced_by in (select id from fam)),
  fresh as (select m.* from m where not exists (
              select 1 from kept where kept.path = m.path and kept.note = m.note)),
  lost as (select kept.* from kept where not exists (
              select 1 from m where m.path = kept.path and m.note = kept.note)),
  pairs as (
    select l.path as from_path, f.path as to_path
      from lost l join fresh f on f.sha256 = l.sha and f.note = l.note
     where (select count(*) from fresh f2 where f2.sha256 = l.sha and f2.note = l.note) = 1
       and (select count(*) from lost l2 where l2.sha = l.sha and l2.note = l.note) = 1)
  select jsonb_build_object(
    'new', coalesce((select jsonb_agg(path order by path) from fresh
                      where path not in (select to_path from pairs)), '[]'),
    'changed', coalesce((select jsonb_agg(m.path order by m.path)
                           from m join kept on kept.path = m.path and kept.note = m.note
                          where kept.sha is distinct from m.sha256), '[]'),
    'moved', coalesce((select jsonb_agg(jsonb_build_object('from', from_path, 'to', to_path)
                                        order by to_path) from pairs), '[]'),
    'gone', coalesce((select jsonb_agg(path order by path) from lost
                       where path not in (select from_path from pairs)), '[]'),
    'rehome', coalesce((select jsonb_agg(jsonb_build_object('path', m.path, 'home', m.home)
                                         order by m.path)
                          from m join kept on kept.path = m.path and not kept.note
                         where not m.note and kept.sha = m.sha256
                           and m.home is not null and m.home is distinct from kept.home), '[]'),
    'kept', (select count(*) from kept))
  into v_out;
  return v_out;
end
$$;

-- ------------------------------------------------------------------ notes

-- The folder row of a vault path's folder, made when missing; null at the top.
create function public._sync_folder(k public.sync_keys, p_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_dir text := case when strpos(p_path, '/') > 0
                     then regexp_replace(p_path, '/[^/]*$', '') end;
  v_id uuid;
begin
  if v_dir is null then return null; end if;
  insert into public.folders (workspace_id, member_id, path)
  values (k.workspace_id, k.member_id, v_dir)
  on conflict (workspace_id, path) do nothing;
  select id into v_id from public.folders where workspace_id = k.workspace_id and path = v_dir;
  return v_id;
end
$$;

-- A date the job sent: an ISO text of at most 40 characters, else null.
create function public._sync_date(p text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p is null or length(p) > 40 then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end
$$;

create function public.sync_put_notes(p_run uuid, p_notes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  e jsonb;
  n public.notes;
  v_path text;
  v_from text;
  v_folder uuid;
  v_id uuid;
  v_written jsonb := '[]';
  v_failed jsonb := '[]';
begin
  if coalesce(jsonb_typeof(p_notes), '') <> 'array' then
    raise exception 'a note is not usable' using errcode = '22023';
  end if;
  if jsonb_array_length(p_notes) > 50 then
    raise exception 'a batch holds at most 50 notes' using errcode = '22023';
  end if;
  if (select coalesce(sum(octet_length(coalesce(x ->> 'title', ''))
                          + octet_length(coalesce(x ->> 'body', ''))
                          + octet_length(coalesce((x -> 'frontmatter')::text, ''))), 0)
        from jsonb_array_elements(p_notes) x) > 1000000 then
    raise exception 'a batch holds at most 1 MB of text' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_notes) x
     where coalesce(jsonb_typeof(x), '') <> 'object'
        or not public._sync_path_ok(x ->> 'path') or (x ->> 'path') !~* '\.md$'
        or (x ? 'from' and not public._sync_path_ok(x ->> 'from'))
        or coalesce(jsonb_typeof(x -> 'title'), '') <> 'string'
        or not coalesce(length(x ->> 'title') between 1 and 1000, false)
        or coalesce(jsonb_typeof(x -> 'body'), '') <> 'string'
        or coalesce(jsonb_typeof(x -> 'frontmatter'), '') <> 'object'
        or coalesce(x ->> 'sha256', '') !~ '^[0-9a-f]{64}$') then
    raise exception 'a note is not usable' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_notes) loop
    v_path := e ->> 'path';
    v_from := e ->> 'from';
    begin
      v_folder := public._sync_folder(k, v_path);
      n := null;
      if v_from is not null then
        select * into n from public.notes x
         where x.workspace_id = k.workspace_id and x.path = v_from
           and x.synced_by in (select public._sync_family(k.id));
      end if;
      if n.id is null then
        v_from := null;
        select * into n from public.notes x
         where x.workspace_id = k.workspace_id and x.member_id = k.member_id
           and x.path = v_path
           and (x.synced_by is null or x.synced_by in (select public._sync_family(k.id)));
      end if;
      if n.id is null then
        insert into public.notes (hive_id, member_id, workspace_id, path, title, body,
                                  frontmatter, folder_id, sync_sha256, created_at, updated_at)
        values ((select w.hive_id from public.workspaces w where w.id = k.workspace_id),
                k.member_id, k.workspace_id, v_path, e ->> 'title', e ->> 'body',
                e -> 'frontmatter', v_folder, e ->> 'sha256',
                public._sync_date(e ->> 'created_at'),
                coalesce(public._sync_date(e ->> 'updated_at'),
                         public._sync_date(e ->> 'created_at')))
        returning id into v_id;
      else
        update public.notes set
          path = v_path, folder_id = v_folder,
          title = e ->> 'title', body = e ->> 'body', frontmatter = e -> 'frontmatter',
          synced_by = k.id, sync_sha256 = e ->> 'sha256',
          created_at = coalesce(public._sync_date(e ->> 'created_at'), n.created_at),
          updated_at = coalesce(public._sync_date(e ->> 'updated_at'), n.updated_at)
         where id = n.id
        returning id into v_id;
        if v_from is not null and v_from <> v_path then
          insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
          values (n.hive_id, k.member_id, k.agent_id, 'note.moved', n.id,
                  jsonb_build_object('from', v_from, 'to', v_path, 'sync_key_id', k.id));
        end if;
      end if;
      v_written := v_written || jsonb_build_array(jsonb_build_object('path', v_path, 'id', v_id));
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('path', v_path, 'code', sqlstate));
    end;
  end loop;
  return jsonb_build_object('written', v_written, 'failed', v_failed);
end
$$;

-- ------------------------------------------------------------------ links

create function public.sync_link_notes(p_run uuid, p_pairs jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_n integer := 0;
  p record;
begin
  if coalesce(jsonb_typeof(p_pairs), '') <> 'array' or jsonb_array_length(p_pairs) > 2000 then
    raise exception 'a batch holds at most 2000 links' using errcode = '22023';
  end if;
  for p in
    select distinct on (least(a.id, b.id), greatest(a.id, b.id)) a.id as a_id, b.id as b_id
      from jsonb_array_elements(p_pairs) e
      join public.notes a on a.workspace_id = k.workspace_id and a.path = e ->> 'from'
                         and a.synced_by in (select public._sync_family(k.id))
      join public.notes b on b.workspace_id = k.workspace_id and b.member_id = k.member_id
                         and b.path = e ->> 'to'
     where a.id <> b.id
       and not exists (select 1 from public.links l
                        where least(l.from_note, l.to_note) = least(a.id, b.id)
                          and greatest(l.from_note, l.to_note) = greatest(a.id, b.id))
  loop
    begin
      -- links_before_insert accepts a link between two notes of one owner at once.
      insert into public.links (hive_id, from_note, to_note, tier, score)
      values ((select hive_id from public.notes where id = p.a_id), p.a_id, p.b_id, 2, 0.8);
      v_n := v_n + 1;
    exception when others then
      null;  -- a pair another run linked meanwhile
    end;
  end loop;
  return v_n;
end
$$;

revoke all on function public._sync_run(uuid) from public, anon, authenticated;
revoke all on function public._sync_path_ok(text) from public, anon;
revoke all on function public._sync_folder(public.sync_keys, text) from public, anon, authenticated;
revoke all on function public._sync_date(text) from public, anon;
revoke all on function public.sync_open_run(boolean) from public, anon;
revoke all on function public.sync_plan(uuid, jsonb, boolean) from public, anon;
revoke all on function public.sync_put_notes(uuid, jsonb) from public, anon;
revoke all on function public.sync_link_notes(uuid, jsonb) from public, anon;
grant execute on function public.sync_open_run(boolean) to authenticated;
grant execute on function public.sync_plan(uuid, jsonb, boolean) to authenticated;
grant execute on function public.sync_put_notes(uuid, jsonb) to authenticated;
grant execute on function public.sync_link_notes(uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Run to see them pass**

Run: `node --test tests/sync.test.mjs`
Expected: PASS, 20 tests. Then `pnpm test`: all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_vault_sync.sql tests/sync.test.mjs
git commit -m "feat(db): sync plan, notes and wiki links for the sync identity"
```

### Task 3: Files, deletes, the guard and the run record

**Files:**

- Modify: `supabase/migrations/<stamp>_vault_sync.sql` (append)
- Modify: `tests/sync.test.mjs` (append)

**Interfaces:**

- Consumes: Task 2 (`_sync_run`, `_sync_path_ok`, `_sync_folder`, `openRun`/`plan`/`putNotes`
  test helpers).
- Produces:
  - `sync_put_files(p_run uuid, p_files jsonb) → jsonb {written: [{path, id}], failed: [{path,
code}]}`.
    - Files are `[{path, name, size, sha256, mime, home, storage_path?, from?}]`.
    - Without `storage_path`, only the home and the path change (a rehome or a move).
  - `sync_delete(p_run uuid, p_paths text[]) → jsonb {deleted, refused}`.
  - `sync_finish(p_run uuid, p_counts jsonb, p_too_big text[], p_error text) → void`.
    - `p_counts` has the keys `added changed moved deleted skipped too_big`.
  - `file_set_home` refuses synced files: `your vault sets where this file lives`.
  - Internal: `_sync_orphan(text, uuid)`, `_sync_home(sync_keys, text) → uuid`.

- [ ] **Step 1: Write the failing tests** (append)

```js
const putFiles = async (t, s, run, files) =>
  (
    await t.as(s.claims, `select public.sync_put_files($1, $2) as r`, [
      run,
      JSON.stringify(files),
    ])
  )[0].r;
const store = async (t, s, prefix, key, name) => {
  const path = `${prefix}${key}/${name}`;
  await t.as(
    s.claims,
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [path],
  );
  return path;
};
const del = async (t, s, run, paths) =>
  (
    await t.as(s.claims, `select public.sync_delete($1, $2) as r`, [run, paths])
  )[0].r;

test("a synced file lives in the note that links it, else in Vault files", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  await putNotes(t, s, r.run_id, [note("deck/Notes.md", "b")]);
  const a = await store(t, s, r.storage_prefix, "a".repeat(32), "deck.html");
  const b = await store(t, s, r.storage_prefix, "b".repeat(32), "loose.pdf");
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "deck/deck.html",
      name: "deck.html",
      size: 10,
      sha256: sha("c"),
      mime: "text/html",
      home: "deck/Notes.md",
      storage_path: a,
    },
    {
      path: "deck/loose.pdf",
      name: "loose.pdf",
      size: 10,
      sha256: sha("d"),
      mime: "application/pdf",
      home: "deck/Vault files.md",
      storage_path: b,
    },
  ]);
  assert.equal(out.written.length, 2);
  const rows = (
    await t.db.query(
      `select f.vault_path, f.mime, n.path as home, n.sync_generated
         from public.files f join public.notes n on n.id = f.note_id
        order by f.vault_path`,
    )
  ).rows;
  assert.equal(rows[0].home, "deck/Notes.md");
  // A page type is never declared, whatever the job sends.
  assert.equal(rows[0].mime, "application/octet-stream");
  assert.equal(rows[1].home, "deck/Vault files.md");
  assert.equal(rows[1].sync_generated, true);
});

test("a file record needs its stored object under the run's folder", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "x.pdf",
      name: "x.pdf",
      size: 1,
      sha256: sha("e"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: `${r.storage_prefix}${"e".repeat(32)}/x.pdf`,
    },
  ]);
  assert.equal(out.written.length, 0);
  assert.equal(out.failed.length, 1);
});

test("a changed file's old object becomes an orphan", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const one = await store(t, s, r.storage_prefix, "1".repeat(32), "a.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "a.pdf",
      name: "a.pdf",
      size: 1,
      sha256: sha("1"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: one,
    },
  ]);
  r = await openRun(t, s);
  const two = await store(t, s, r.storage_prefix, "2".repeat(32), "a.pdf");
  await putFiles(t, s, r.run_id, [
    {
      path: "a.pdf",
      name: "a.pdf",
      size: 2,
      sha256: sha("2"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: two,
    },
  ]);
  const o = await t.db.query(`select storage_path from public.sync_orphans`);
  assert.deepEqual(
    o.rows.map((x) => x.storage_path),
    [one],
  );
});

test("the person cannot change a synced file's home note", async () => {
  const t = await setupHive();
  const mine = await t.addNote("dani", "Other");
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  const p = await store(t, s, r.storage_prefix, "f".repeat(32), "f.pdf");
  const out = await putFiles(t, s, r.run_id, [
    {
      path: "f.pdf",
      name: "f.pdf",
      size: 1,
      sha256: sha("f"),
      mime: "application/pdf",
      home: "Vault files.md",
      storage_path: p,
    },
  ]);
  await assert.rejects(
    t.as(t.person("dani"), `select public.file_set_home($1, $2)`, [
      out.written[0].id,
      mine.id,
    ]),
    /your vault sets where this file lives/,
  );
});

test("deletes: a few go through, a mass delete is refused until confirmed once", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  let r = await openRun(t, s);
  const notes = Array.from({ length: 30 }, (_, i) => note(`d/${i}.md`, "9"));
  await putNotes(t, s, r.run_id, notes);
  r = await openRun(t, s);
  assert.deepEqual(await del(t, s, r.run_id, ["d/0.md"]), {
    deleted: 1,
    refused: 0,
  });
  const many = notes.slice(1).map((n) => n.path);
  assert.deepEqual(await del(t, s, r.run_id, many), {
    deleted: 0,
    refused: 29,
  });
  // The confirm lets exactly that list through, on the next run only.
  r = await openRun(t, s, true);
  assert.deepEqual(await del(t, s, r.run_id, [...many, "x.md"]), {
    deleted: 0,
    refused: 30,
  });
  r = await openRun(t, s, true);
  assert.deepEqual(await del(t, s, r.run_id, many), {
    deleted: 29,
    refused: 0,
  });
  const audit = await t.db.query(
    `select count(*)::int as n from public.audit_log where action = 'note.deleted'`,
  );
  assert.equal(audit.rows[0].n, 30);
});

test("the sync deletes only what it keeps", async () => {
  const t = await setupHive();
  await t.addNote("dani", "Uploads", { path: "Uploads.md" });
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  assert.deepEqual(await del(t, s, r.run_id, ["Uploads.md"]), {
    deleted: 0,
    refused: 0,
  });
  const n = await t.db.query(`select count(*)::int as n from public.notes`);
  assert.equal(n.rows[0].n, 1);
});

test("a run's record: counts, too-big files, readable only by its member", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  const r = await openRun(t, s);
  await t.as(s.claims, `select public.sync_finish($1, $2, $3, $4)`, [
    r.run_id,
    JSON.stringify({
      added: 3,
      changed: 1,
      moved: 0,
      deleted: 0,
      skipped: 2,
      too_big: 1,
    }),
    ["big.mov"],
    null,
  ]);
  const mine = await t.as(t.person("dani"), `select * from public.sync_runs`);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].added, 3);
  assert.deepEqual(mine[0].too_big_paths, ["big.mov"]);
  assert.equal(
    (await t.as(t.person("ahmed"), `select * from public.sync_runs`)).length,
    0,
  );
  const m = await t.db.query(
    `select count(*)::int as n from public.sync_manifest`,
  );
  assert.equal(m.rows[0].n, 0);
  await assert.rejects(
    t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
      r.run_id,
    ]),
    /no such run/,
  );
});

test("runs are trimmed to the last 200 of a key", async () => {
  const t = await setupHive();
  const s = await syncFor(t, "dani");
  for (let i = 0; i < 201; i++) {
    const r = await openRun(t, s);
    await t.as(s.claims, `select public.sync_finish($1, '{}', '{}', null)`, [
      r.run_id,
    ]);
  }
  const n = await t.db.query(`select count(*)::int as n from public.sync_runs`);
  assert.equal(n.rows[0].n, 200);
});
```

Add one more test, modelled on the purge test in `tests/purge-hives.test.mjs` or
`tests/sharing-rules.test.mjs` (search for `purge_hive(`). It makes a key and one synced
note and file, purges the hive, and asserts `sync_keys`, `sync_runs` and `sync_orphans` hold no
row of that hive.

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/sync.test.mjs`
Expected: the new tests FAIL (`sync_put_files` does not exist).

- [ ] **Step 3: Append the functions**

`file_set_home` is the body from `20261124184944_file_links.sql`, with one added check marked
`-- sync:`.

```sql
-- ------------------------------------------------------------------ files

-- An object path no row uses any more, queued for purge-hives.
create function public._sync_orphan(p_path text, p_hive uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.sync_orphans (storage_path, hive_id)
  select p_path, p_hive
   where p_path is not null
     and not exists (select 1 from public.files f where f.storage_path = p_path)
  on conflict (storage_path) do nothing
$$;

-- The note a file lives in, by path. A missing "Vault files" note of a folder is made, kept by
-- the sync and marked as generated; any other missing note is a failure for that file.
create function public._sync_home(k public.sync_keys, p_home text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.notes
   where workspace_id = k.workspace_id and member_id = k.member_id and path = p_home;
  if v_id is not null then return v_id; end if;
  if p_home !~ '(^|/)Vault files\.md$' then
    raise exception 'no such home note' using errcode = 'P0002';
  end if;
  insert into public.notes (hive_id, member_id, workspace_id, path, title, body, folder_id,
                            sync_generated)
  values ((select w.hive_id from public.workspaces w where w.id = k.workspace_id),
          k.member_id, k.workspace_id, p_home, 'Vault files',
          'Files in this folder of your vault that no note links to.',
          public._sync_folder(k, p_home), true)
  returning id into v_id;
  return v_id;
end
$$;

create function public.sync_put_files(p_run uuid, p_files jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_prefix text := k.member_id::text || '/' || k.workspace_id::text || '/vault/';
  e jsonb;
  f public.files;
  v_path text;
  v_from text;
  v_store text;
  v_mime text;
  v_home uuid;
  v_id uuid;
  v_written jsonb := '[]';
  v_failed jsonb := '[]';
begin
  if coalesce(jsonb_typeof(p_files), '') <> 'array' or jsonb_array_length(p_files) > 200 then
    raise exception 'a batch holds at most 200 files' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_files) x
     where coalesce(jsonb_typeof(x), '') <> 'object'
        or not public._sync_path_ok(x ->> 'path') or (x ->> 'path') ~* '\.md$'
        or (x ? 'from' and not public._sync_path_ok(x ->> 'from'))
        or not public._sync_path_ok(x ->> 'home') or (x ->> 'home') !~* '\.md$'
        or not coalesce(length(x ->> 'name') between 1 and 255, false)
        or position('/' in x ->> 'name') > 0
        or coalesce(jsonb_typeof(x -> 'size'), '') <> 'number'
        or not coalesce((x ->> 'size')::numeric between 0 and 52428800, false)
        or coalesce(x ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
        or not coalesce(length(x ->> 'mime') between 1 and 100, false)
        or (x ? 'storage_path'
            and (left(x ->> 'storage_path', length(v_prefix)) <> v_prefix
                 or substr(x ->> 'storage_path', length(v_prefix) + 1)
                    !~ '^[0-9a-f]{32}/[^/]{1,255}$'))) then
    raise exception 'a file is not usable' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_files) loop
    v_path := e ->> 'path';
    v_from := e ->> 'from';
    v_store := e ->> 'storage_path';
    -- A type a browser would render as a page is never declared (gallery v2).
    v_mime := case when lower(e ->> 'mime') in ('text/html', 'image/svg+xml',
                         'application/xhtml+xml', 'text/xml', 'application/xml')
                   then 'application/octet-stream' else e ->> 'mime' end;
    begin
      if v_store is not null and not exists (
           select 1 from storage.objects o where o.bucket_id = 'files' and o.name = v_store) then
        raise exception 'the file was not stored' using errcode = 'P0002';
      end if;
      v_home := public._sync_home(k, e ->> 'home');
      select * into f from public.files x
       where x.workspace_id = k.workspace_id and x.vault_path = coalesce(v_from, v_path)
         and x.synced_by in (select public._sync_family(k.id));
      if f.id is null and v_from is not null then
        v_from := null;
        select * into f from public.files x
         where x.workspace_id = k.workspace_id and x.vault_path = v_path
           and x.synced_by in (select public._sync_family(k.id));
      end if;
      if f.id is null then
        if v_store is null then
          raise exception 'the file was not stored' using errcode = 'P0002';
        end if;
        insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path,
                                  name, mime, size_bytes, vault_path, sync_sha256)
        values ((select w.hive_id from public.workspaces w where w.id = k.workspace_id),
                k.member_id, k.workspace_id, v_home, v_store, e ->> 'name', v_mime,
                (e ->> 'size')::bigint, v_path, e ->> 'sha256')
        returning id into v_id;
      else
        update public.files set
          note_id = v_home, vault_path = v_path, synced_by = k.id,
          storage_path = coalesce(v_store, f.storage_path),
          name = case when v_store is null then f.name else e ->> 'name' end,
          mime = case when v_store is null then f.mime else v_mime end,
          kind = case when v_store is null then f.kind
                      else public.file_kind(e ->> 'name', v_mime) end,
          size_bytes = case when v_store is null then f.size_bytes
                            else (e ->> 'size')::bigint end,
          sync_sha256 = case when v_store is null then f.sync_sha256 else e ->> 'sha256' end
         where id = f.id
        returning id into v_id;
        if v_store is not null and v_store <> f.storage_path then
          perform public._sync_orphan(f.storage_path, f.hive_id);
        end if;
        if v_from is not null and v_from <> v_path then
          insert into public.audit_log (hive_id, member_id, agent_id, action, detail)
          values (f.hive_id, k.member_id, k.agent_id, 'file.moved',
                  jsonb_build_object('file_id', f.id, 'from', v_from, 'to', v_path,
                                     'sync_key_id', k.id));
        end if;
      end if;
      delete from public.sync_orphans where storage_path = coalesce(v_store, '');
      v_written := v_written || jsonb_build_array(jsonb_build_object('path', v_path, 'id', v_id));
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('path', v_path, 'code', sqlstate));
    end;
  end loop;
  return jsonb_build_object('written', v_written, 'failed', v_failed);
end
$$;

-- ---------------------------------------------------------------- deletes

-- Deletes the notes and files at these vault paths that the key's family keeps. A batch of
-- more than 25, or of more than 2% of what is kept (when that is more than one item), is
-- refused whole and recorded on the run. The next run lets exactly that list through when it
-- was opened with confirm.
create function public.sync_delete(p_run uuid, p_paths text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  v_paths text[];
  v_n integer;
  v_total integer;
  v_notes integer;
  v_files integer;
  f record;
begin
  if p_paths is null or cardinality(p_paths) > 20000
     or exists (select 1 from unnest(p_paths) p where not public._sync_path_ok(p)) then
    raise exception 'a path is not usable' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct p order by p), '{}') into v_paths
    from unnest(p_paths) p
   where exists (select 1 from public.notes n
                  where n.workspace_id = k.workspace_id and n.path = p and not n.sync_generated
                    and n.synced_by in (select public._sync_family(k.id)))
      or exists (select 1 from public.files x
                  where x.workspace_id = k.workspace_id and x.vault_path = p
                    and x.synced_by in (select public._sync_family(k.id)));
  v_n := cardinality(v_paths);
  if v_n = 0 then
    return jsonb_build_object('deleted', 0, 'refused', 0);
  end if;
  select (select count(*) from public.notes n
           where n.workspace_id = k.workspace_id and not n.sync_generated
             and n.synced_by in (select public._sync_family(k.id)))
       + (select count(*) from public.files x
           where x.workspace_id = k.workspace_id
             and x.synced_by in (select public._sync_family(k.id)))
    into v_total;
  if (v_n > 25 or (v_n > 1 and v_n * 50 > v_total))
     and not (r.confirmable @> p_paths) then
    update public.sync_runs set refused_deletes = p_paths where id = r.id;
    return jsonb_build_object('deleted', 0, 'refused', cardinality(p_paths));
  end if;

  for f in
    delete from public.files x
     where x.workspace_id = k.workspace_id and x.vault_path = any(v_paths)
       and x.synced_by in (select public._sync_family(k.id))
    returning x.storage_path, x.hive_id
  loop
    perform public._sync_orphan(f.storage_path, f.hive_id);
  end loop;
  get diagnostics v_files = row_count;
  delete from public.notes n
   where n.workspace_id = k.workspace_id and n.path = any(v_paths) and not n.sync_generated
     and n.synced_by in (select public._sync_family(k.id));
  get diagnostics v_notes = row_count;
  return jsonb_build_object('deleted', v_n, 'refused', 0);
end
$$;

-- ----------------------------------------------------------------- finish

-- A count the job sent: a whole number from 0 to 1,000,000, else 0.
create function public._sync_count(v jsonb) returns integer
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1000000
              then floor((v #>> '{}')::numeric)::integer else 0 end
$$;

create function public.sync_finish(p_run uuid, p_counts jsonb, p_too_big text[], p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  k public.sync_keys := public._sync_live();
  r public.sync_runs := public._sync_run(p_run);
  c jsonb := case when jsonb_typeof(p_counts) = 'object' then p_counts else '{}' end;
begin
  update public.sync_runs set
    finished_at = now(),
    added = public._sync_count(c -> 'added'),
    changed = public._sync_count(c -> 'changed'),
    moved = public._sync_count(c -> 'moved'),
    deleted = public._sync_count(c -> 'deleted'),
    skipped = public._sync_count(c -> 'skipped'),
    too_big = public._sync_count(c -> 'too_big'),
    too_big_paths = coalesce((select array_agg(left(p, 4000))
                                from (select unnest(p_too_big) p limit 200) x), '{}'),
    error = left(p_error, 500)
   where id = r.id;
  -- This run's manifest, and any an interrupted run of the family left behind.
  delete from public.sync_manifest m
   where m.run_id in (select x.id from public.sync_runs x
                       where x.key_id in (select public._sync_family(k.id)));
  -- A generated "Vault files" note no file lives in any more.
  delete from public.notes n
   where n.workspace_id = k.workspace_id and n.sync_generated
     and n.synced_by in (select public._sync_family(k.id))
     and not exists (select 1 from public.files f where f.note_id = n.id);
  delete from public.sync_runs x
   where x.key_id = k.id
     and x.id not in (select y.id from public.sync_runs y where y.key_id = k.id
                       order by y.started_at desc limit 200);
end
$$;

-- --------------------------------------------------------- the home note

create or replace function public.file_set_home(p_file uuid, p_note uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.files;
begin
  if public.jwt_oauth_client() is not null then
    raise exception 'an app pass cannot do this';
  end if;
  if public.jwt_agent_id() is not null
     or public.jwt_is_self_hosted() or (select auth.uid()) is null then
    raise exception 'only a person changes where a file lives';
  end if;
  select * into f from public.files
   where id = p_file and member_id in (select public.my_member_ids());
  if not found then raise exception 'no such file'; end if;
  -- sync: the vault decides where a file it keeps lives.
  if f.synced_by is not null then
    raise exception 'your vault sets where this file lives';
  end if;
  if p_note is not null and not exists (
       select 1 from public.notes n where n.id = p_note and n.member_id = f.member_id) then
    raise exception 'a file can only live in your own note';
  end if;
  if f.note_id is not distinct from p_note then return; end if;
  update public.files set note_id = p_note where id = f.id;
  insert into public.audit_log (hive_id, member_id, action, detail)
  values (f.hive_id, f.member_id, 'file.home_changed',
          jsonb_build_object('file_id', f.id, 'from', f.note_id, 'to', p_note));
end
$$;

revoke all on function public._sync_orphan(text, uuid) from public, anon, authenticated;
revoke all on function public._sync_home(public.sync_keys, text) from public, anon, authenticated;
revoke all on function public._sync_count(jsonb) from public, anon;
revoke all on function public.sync_put_files(uuid, jsonb) from public, anon;
revoke all on function public.sync_delete(uuid, text[]) from public, anon;
revoke all on function public.sync_finish(uuid, jsonb, text[], text) from public, anon;
grant execute on function public.sync_put_files(uuid, jsonb) to authenticated;
grant execute on function public.sync_delete(uuid, text[]) to authenticated;
grant execute on function public.sync_finish(uuid, jsonb, text[], text) to authenticated;
```

Check `files_set_kind` in `20261124184944_file_links.sql`. If it is a `before insert` trigger
only, the explicit `kind =` in the update above is what keeps the kind right on a change. If it
also fires on update, drop the `kind =` line.

The deletes rely on the existing `notes_deleted_audit` and `files_deleted_audit` triggers for
the audit entries (refinement 4). The mass-delete test asserts 30 `note.deleted` rows.

- [ ] **Step 4: Run to see them pass**

Run: `node --test tests/sync.test.mjs`, then `pnpm test`.
Expected: PASS, 29 tests in `sync.test.mjs`; every other suite still passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_vault_sync.sql tests/sync.test.mjs
git commit -m "feat(db): sync files, guarded deletes and the run record"
```

### Task 4: The `sync-session` Edge Function

**Files:**

- Create: `supabase/functions/_shared/body.ts`
- Modify: `supabase/functions/agent-session/session.ts` (import `readBody` from `_shared/body.ts`;
  delete its own copy)
- Modify: `supabase/functions/_shared/identity.ts` (`signIdentity` gains `extra`)
- Create: `supabase/functions/sync-session/index.ts`, `supabase/functions/sync-session/session.ts`
- Modify: `supabase/config.toml` (add `[functions.sync-session]` `verify_jwt = false`)
- Create: `tests/sync-session.test.mjs`

**Interfaces:**

- Consumes: `sync_login(p_key)` (Task 1), REST path `/rest/v1/rpc/sync_login`, which answers
  400 on a refused key.
- Produces:
  - `POST /functions/v1/sync-session`, body exactly `{"key": "hsync_<64 hex>"}`.
    - 200: `{access_token, expires_at, sync_key_id, workspace_id}`.
    - 401: `{error: "unknown or revoked sync key"}`.
    - 400 / 405 / 413 / 500 / 502: the same fixed phrases as `agent-session`.
  - `readBody(req: Request, max: number): Promise<string | 400 | 413>` in `_shared/body.ts`.
  - `signIdentity(signing, identity, base, nowMs, extra?: Record<string, string>)`. `extra` is
    merged under the fixed claims and can never replace one.

- [ ] **Step 1: Write the failing test**

Read `tests/agent-session.test.mjs` first: it shows how a JWK is made for tests, how `fetch` is
stood in, and how a signed token is verified. `tests/sync-session.test.mjs` copies that
scaffolding (its key and verify helpers) and adds these cases:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/sync-session/session.ts";
// makeJwk, verify, decode: copied from tests/agent-session.test.mjs (same names).

const KEY = "hsync_" + "a".repeat(64);
const ROW = {
  sync_key_id: "11111111-1111-4111-8111-111111111111",
  agent_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  member_id: "44444444-4444-4444-8444-444444444444",
  workspace_id: "55555555-5555-4555-8555-555555555555",
  hive_id: "66666666-6666-4666-8666-666666666666",
  trust_tier: "vendor",
};
const post = (body) =>
  new Request("https://x/functions/v1/sync-session", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const env = async () => ({
  url: "https://p.supabase.co",
  anonKey: "pk",
  signingJwk: JSON.stringify(await makeJwk()),
});

test("a live key gets a one-hour identity with the sync claim", async () => {
  let asked;
  const res = await handle(
    post({ key: KEY }),
    await env(),
    async (url, init) => {
      asked = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify([ROW]), { status: 200 });
    },
    () => 1_000_000_000_000,
  );
  assert.equal(res.status, 200);
  assert.equal(asked.url, "https://p.supabase.co/rest/v1/rpc/sync_login");
  assert.deepEqual(asked.body, { p_key: KEY });
  const out = await res.json();
  const claims = decode(out.access_token);
  assert.equal(claims.sync_key_id, ROW.sync_key_id);
  assert.equal(claims.agent_id, ROW.agent_id);
  assert.equal(claims.sub, ROW.user_id);
  assert.equal(claims.workspace_id, ROW.workspace_id);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(out.sync_key_id, ROW.sync_key_id);
});

test("a refused key is 401 and the database's words are not repeated", async () => {
  const res = await handle(
    post({ key: KEY }),
    await env(),
    async () =>
      new Response(JSON.stringify({ message: "unknown or revoked sync key" }), {
        status: 400,
      }),
  );
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unknown or revoked sync key" });
});

test("only exactly {key} with a well-formed key is read", async () => {
  const e = await env();
  const never = async () => assert.fail("the database was asked");
  for (const body of [
    { key: "hive_" + "a".repeat(64) },
    { key: KEY, sync_key_id: "x" },
    { token: KEY },
    "not json",
  ]) {
    const res = await handle(post(body), e, never);
    assert.equal(res.status, 400);
  }
});

test("a row with a malformed sync_key_id is a broken answer, not an identity", async () => {
  const res = await handle(
    post({ key: KEY }),
    await env(),
    async () =>
      new Response(JSON.stringify([{ ...ROW, sync_key_id: "nope" }]), {
        status: 200,
      }),
  );
  assert.equal(res.status, 502);
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/sync-session.test.mjs`
Expected: FAIL. The module `sync-session/session.ts` is not found.

- [ ] **Step 3: Move `readBody` to `_shared/body.ts`**

Cut `readBody` from `agent-session/session.ts` into `_shared/body.ts`. Give it a `max`
parameter in place of `MAX_BODY_BYTES`, and keep the body otherwise unchanged:

```ts
// A request's body as text, or the status to refuse it with. The cap is on the bytes actually
// read; Content-Length is only a way to refuse sooner. Web platform only.
export async function readBody(
  req: Request,
  max: number,
): Promise<string | 400 | 413> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return 413;
  if (req.body === null) return 400;

  const reader = req.body.getReader();
  const bytes = new Uint8Array(max);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > max) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } catch {
    return 400;
  }
}
```

In `agent-session/session.ts`: `import { readBody } from "../_shared/body.ts";`, and call
`readBody(req, MAX_BODY_BYTES)`.

Run: `node --test tests/agent-session.test.mjs`
Expected: PASS, unchanged.

- [ ] **Step 4: Let `signIdentity` take extra claims**

In `_shared/identity.ts`, change the signature and the claims object only:

```ts
export async function signIdentity(
  signing: SigningKey,
  identity: Identity,
  base: string,
  nowMs: number,
  extra: Record<string, string> = {},
): Promise<{ accessToken: string; exp: number }> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + LIFETIME_SECONDS;
  const accessToken = await sign(signing, {
    // Extra claims first: none of them can replace a claim below.
    ...extra,
    role: "authenticated",
    // ... every existing claim, unchanged ...
  });
  return { accessToken, exp };
}
```

- [ ] **Step 5: Write `sync-session`**

`supabase/functions/sync-session/index.ts`: the same as `agent-session/index.ts`, importing
`handle` from `./session.ts`.

`supabase/functions/sync-session/session.ts`:

```ts
// sync-session: a sync key in, a one-hour identity out.
//
// The same shape as agent-session: the function states who a key belongs to, the database
// decides what that identity may do. It signs only what `sync_login` returned, always with
// `agent_id` and `sync_key_id`, and takes nothing else from the request. It never logs or
// returns the key, the signing key or (on failure) the JWT.
//
// Web platform only, so the same file runs in the Edge runtime and under `node --test`.

import { readBody } from "../_shared/body.ts";
import { identityFrom, loadKey, signIdentity } from "../_shared/identity.ts";

export type Env = {
  url: string;
  anonKey: string;
  signingJwk: string | undefined;
};

const MAX_BODY_BYTES = 1024;
const KEY = /^hsync_[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATABASE_TIMEOUT_MS = 10_000;

const BAD_REQUEST = "send a JSON body with a key";
const REFUSED = "unknown or revoked sync key";
const UNREACHABLE = "the hive is not reachable";
const NOT_SET_UP = "sign-in is not set up";

function answer(
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function fail(
  status: number,
  error: string,
  reason: string,
  extra?: Record<string, string>,
) {
  console.error(`sync-session: ${reason}`);
  return answer(status, { error }, extra);
}

function keyFrom(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "key") return null;
  const key = (parsed as Record<string, unknown>).key;
  return typeof key === "string" && KEY.test(key) ? key : null;
}

export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  if (req.method !== "POST")
    return fail(405, "use POST", "not a POST", { Allow: "POST" });
  const body = await readBody(req, MAX_BODY_BYTES);
  if (body === 413) return fail(413, "request too large", "body too large");
  if (body === 400) return fail(400, BAD_REQUEST, "unreadable body");
  const key = keyFrom(body);
  if (key === null) return fail(400, BAD_REQUEST, "no usable key in body");

  const base = env.url.replace(/\/+$/, "");
  if (!base || !env.anonKey)
    return fail(500, NOT_SET_UP, "project address or key missing");
  const signing = await loadKey(env.signingJwk);
  if (signing === null)
    return fail(500, NOT_SET_UP, "signing key missing or unusable");

  let rows: unknown;
  try {
    const res = await fetchFn(`${base}/rest/v1/rpc/sync_login`, {
      method: "POST",
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${env.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_key: key }),
      redirect: "error",
      signal: AbortSignal.timeout(DATABASE_TIMEOUT_MS),
    });
    if (res.status === 400) {
      await res.body?.cancel().catch(() => {});
      return fail(401, REFUSED, "sync_login answered 400");
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      return fail(502, UNREACHABLE, `sync_login answered ${res.status}`);
    }
    rows = await res.json();
  } catch {
    return fail(502, UNREACHABLE, "sync_login could not be reached");
  }

  const identity = identityFrom(rows);
  if (identity === "none")
    return fail(401, REFUSED, "sync_login returned no row");
  if (identity === "malformed")
    return fail(502, UNREACHABLE, "sync_login returned a malformed row");
  const keyId = (rows as Record<string, unknown>[])[0].sync_key_id;
  if (typeof keyId !== "string" || !UUID.test(keyId)) {
    return fail(502, UNREACHABLE, "sync_login returned a malformed row");
  }

  let accessToken: string;
  let exp: number;
  try {
    ({ accessToken, exp } = await signIdentity(signing, identity, base, now(), {
      sync_key_id: keyId,
    }));
  } catch {
    return fail(500, NOT_SET_UP, "signing failed");
  }
  return answer(200, {
    access_token: accessToken,
    expires_at: exp,
    sync_key_id: keyId,
    workspace_id: identity.workspace_id,
  });
}
```

Add to `supabase/config.toml`, next to the other functions:

```toml
[functions.sync-session]
verify_jwt = false
```

- [ ] **Step 6: Run the tests**

Run: `node --test tests/sync-session.test.mjs tests/agent-session.test.mjs tests/identity.test.mjs`
Expected: PASS. Then `pnpm typecheck && pnpm lint`. Prettier may reflow the long lines above;
run `pnpm format` on the changed files.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/body.ts supabase/functions/_shared/identity.ts supabase/functions/agent-session/session.ts supabase/functions/sync-session supabase/config.toml tests/sync-session.test.mjs
git commit -m "feat(functions): sync-session signs a sync key's identity"
```

### Task 5: `purge-hives` removes orphaned objects

**Files:**

- Modify: `supabase/migrations/<stamp>_vault_sync.sql` (append two service-only functions)
- Modify: `supabase/functions/purge-hives/purge.ts`
- Modify: `tests/purge-hives.test.mjs`, `tests/sync.test.mjs`

**Interfaces:**

- Consumes: `sync_orphans` (Task 1), filled by `sync_put_files` and `sync_delete` (Task 3).
- Produces:
  - `sync_orphan_paths(p_limit integer) → setof text`: the oldest orphans, a day old or more,
    with no files row. Service role only.
  - `sync_orphans_removed(p_paths text[]) → integer`. Service role only.
  - The purge answer gains a third count: `{ok, purged, failed, orphans}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sync.test.mjs`:

```js
test("orphans are listed for the service only, a day after they were made", async () => {
  const t = await setupHive();
  await t.db.query(
    `insert into public.sync_orphans (storage_path, hive_id, at)
     values ('a/old', $1, now() - interval '2 days'), ('a/new', $1, now())`,
    [t.hive],
  );
  await assert.rejects(
    t.as(t.person("dani"), `select * from public.sync_orphan_paths(10)`),
    /permission denied/,
  );
  const listed = await t.db.query(
    `select * from public.sync_orphan_paths(10) as p`,
  );
  assert.deepEqual(
    listed.rows.map((r) => r.p),
    ["a/old"],
  );
  const n = await t.db.query(
    `select public.sync_orphans_removed(array['a/old']) as n`,
  );
  assert.equal(n.rows[0].n, 1);
});
```

In `tests/purge-hives.test.mjs`, find the test for a run with nothing due. Copy it into a new
test where the stand-in `fetch` answers `sync_orphan_paths` with `["m/w/vault/x/a.pdf"]`. Assert
three things:

- one `DELETE` to `/storage/v1/object/files` with `{"prefixes":["m/w/vault/x/a.pdf"]}`;
- one call to `sync_orphans_removed` with `{"p_paths":["m/w/vault/x/a.pdf"]}`;
- the answer `{ ok: true, purged: 0, failed: 0, orphans: 1 }`.

Update every existing assertion on the answer's shape to include `orphans: 0`.

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/sync.test.mjs tests/purge-hives.test.mjs`
Expected: FAIL on the new tests.

- [ ] **Step 3: Append the functions to the migration**

```sql
-- ----------------------------------------------------------------- orphans

-- For purge-hives only (the secret key): stored objects no row uses, a day old or more, so an
-- upload a run is still recording is never taken.
create function public.sync_orphan_paths(p_limit integer) returns setof text
language sql stable security definer set search_path = '' as $$
  select o.storage_path from public.sync_orphans o
   where o.at < now() - interval '1 day'
     and not exists (select 1 from public.files f where f.storage_path = o.storage_path)
   order by o.at
   limit least(greatest(coalesce(p_limit, 0), 0), 1000)
$$;

create function public.sync_orphans_removed(p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  delete from public.sync_orphans where storage_path = any(coalesce(p_paths, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.sync_orphan_paths(integer) from public, anon, authenticated;
revoke all on function public.sync_orphans_removed(text[]) from public, anon, authenticated;
grant execute on function public.sync_orphan_paths(integer) to service_role;
grant execute on function public.sync_orphans_removed(text[]) to service_role;
```

If `service_role` does not exist in PGlite (`scripts/local-db.mjs` makes the roles), check how
`hives_due_for_purge` is granted in `20261124091833_hive_deletion.sql` and copy that.

- [ ] **Step 4: Remove orphans at the end of a purge run**

In `purge.ts`, after the hives loop and before the final `note(...)`, add one bounded pass using
the `rpc`, `call`, `drop`, `jsonOf` and `spent` helpers already in the file:

```ts
// 3. Objects the vault sync no longer uses: at most one page of 1000, in batches. A failure
//    leaves them listed for the next run; it never fails the run.
let orphans = 0;
if (!spent()) {
  try {
    const res = await rpc("sync_orphan_paths", { p_limit: 1000 });
    const listed =
      res.status === 200 ? await jsonOf(res) : (await drop(res), null);
    const paths = Array.isArray(listed)
      ? listed.filter((p): p is string => typeof p === "string" && p !== "")
      : [];
    for (let i = 0; i < paths.length && !spent(); i += BATCH) {
      const prefixes = paths.slice(i, i + BATCH);
      const gone = await call(`${base}/storage/v1/object/${BUCKET}`, "DELETE", {
        prefixes,
      });
      await drop(gone);
      if (!gone.ok) {
        note(`removing orphaned objects answered ${gone.status}`);
        break;
      }
      const done = await rpc("sync_orphans_removed", { p_paths: prefixes });
      await drop(done);
      orphans += prefixes.length;
    }
  } catch {
    note("orphaned objects could not be removed");
  }
}
```

Change the final lines to
`note(\`purged ${purged}, failed ${failed}, continuing ${continuing}, orphans ${orphans}\`)`and`return answer(200, { ok: true, purged, failed, orphans })`. Add one line to the header comment
for step 3. A `setof text`RPC answers a JSON array of strings; if the stand-in in the existing
tests answers objects, follow what`jsonOf` returns there.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/sync.test.mjs tests/purge-hives.test.mjs`, then `pnpm test`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_vault_sync.sql supabase/functions/purge-hives/purge.ts tests/purge-hives.test.mjs tests/sync.test.mjs
git commit -m "feat(functions): purge-hives removes objects the vault sync left behind"
```

### Task 6: The `sync/` package: skip rules, walk, fingerprints

**Files:**

- Create: `sync/package.json`, `sync/tsconfig.json`, `sync/README.md`
- Create: `sync/src/skip.ts`, `sync/src/walk.ts`, `sync/src/cache.ts`
- Create: `sync/test/skip.test.ts`, `sync/test/walk.test.ts`, `sync/test/cache.test.ts`
- Modify: `pnpm-workspace.yaml` (add `- sync`), root `package.json` `test` script

**Interfaces:**

- Consumes: `web/src/import/parse.ts` `parseNote(raw, relPath)` and
  `web/src/import/wikilinks.ts` `wikiTargets(body, frontmatter)`. Both are pure, browser-safe
  and imported by relative path with the `.ts` extension. The probe of 2026-11-26 ran them under
  Node 26 with no build.
- Produces:
  - `skip.ts`: `VIDEO: Set<string>`, `type Ignore = (path: string) => boolean`,
    `parseIgnore(text: string): Ignore`, `loadIgnore(root: string): Ignore`,
    `isSkipped(path: string, ignore: Ignore): boolean`.
  - `walk.ts`: `type Entry = { path: string; abs: string; size: number; mtimeMs: number }`,
    `walk(root: string, ignore: Ignore): { entries: Entry[]; unreadable: string[]; skipped:
number }`.
  - `cache.ts`: `type Cached = { size: number; mtimeMs: number; sha256: string; targets?:
string[] }`, `type Cache = { version: 1; entries: Record<string, Cached> }`,
    `loadCache(file): Cache`, `saveCache(file, cache): void`, `sha256Hex(bytes: Uint8Array |
string): string`, `fingerprint(e: Entry, old: Cache): Promise<Cached>`,
    `noteTargets(raw: string, path: string): string[]`, `isNote(path: string): boolean`.

- [ ] **Step 1: Package skeleton**

`sync/package.json`:

```json
{
  "name": "@hive-mind/sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=23.6"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "start": "node src/cli.ts"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.9.3"
  }
}
```

`sync/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`pnpm-workspace.yaml` gains `- sync` under `packages:`. In the root `package.json`, the `test`
script gains `node --test "sync/test/*.test.ts"` after the existing `node --test …` part:

```json
"test": "node --test \"tests/**/*.test.mjs\" \".claude/hooks/*.test.mjs\" && node --test \"sync/test/*.test.ts\" && pnpm --filter @hive-mind/web test",
```

Run: `pnpm install`
Expected: the lockfile gains `sync` with its two dev dependencies.

`sync/README.md`, short: what the job does, `node sync/src/cli.ts setup`, the subcommands, where
the logs, cache and config live, and that it needs Node 23.6 or newer.

- [ ] **Step 2: Write the failing tests**

`sync/test/skip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSkipped, parseIgnore } from "../src/skip.ts";

const none = parseIgnore("");

test("dot parts and videos are skipped; HTML and everything else is kept", () => {
  assert.equal(isSkipped(".obsidian/app.json", none), true);
  assert.equal(isSkipped("a/.trash/x.md", none), true);
  assert.equal(isSkipped("a/.DS_Store", none), true);
  assert.equal(isSkipped("talks/demo.MOV", none), true);
  assert.equal(isSkipped("talks/demo.mp4", none), true);
  assert.equal(isSkipped("decks/pitch.html", none), false);
  assert.equal(isSkipped("notes/a.md", none), false);
  assert.equal(isSkipped("img/a.svg", none), false);
});

test(".hivesyncignore: names, folders, globs, anchors and comments", () => {
  const ig = parseIgnore(
    "# comment\n\nscratch/\n*.tmp\n/outputs/drafts\nlogs/**/*.log\n!keep.md\n",
  );
  assert.equal(isSkipped("scratch/a.md", ig), true);
  assert.equal(isSkipped("x/scratch/a.md", ig), true);
  assert.equal(isSkipped("scratch.md", ig), false);
  assert.equal(isSkipped("a/b.tmp", ig), true);
  assert.equal(isSkipped("outputs/drafts/a.md", ig), true);
  assert.equal(isSkipped("x/outputs/drafts/a.md", ig), false);
  assert.equal(isSkipped("logs/2026/11/a.log", ig), true);
  // Negation is not supported: the line is ignored, nothing is re-included.
  assert.equal(isSkipped("keep.md", ig), false);
});
```

`sync/test/walk.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walk } from "../src/walk.ts";
import { parseIgnore } from "../src/skip.ts";

test("walk lists files by relative path, sorted, skipping and not following links", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  mkdirSync(join(root, "b"));
  mkdirSync(join(root, ".obsidian"));
  writeFileSync(join(root, "b", "z.md"), "z");
  writeFileSync(join(root, "a.pdf"), "pdf");
  writeFileSync(join(root, ".obsidian", "x.json"), "{}");
  writeFileSync(join(root, "clip.mov"), "v");
  symlinkSync(join(root, "a.pdf"), join(root, "link.pdf"));
  const { entries, skipped } = walk(root, parseIgnore(""));
  assert.deepEqual(
    entries.map((e) => e.path),
    ["a.pdf", "b/z.md"],
  );
  assert.equal(entries[0].size, 3);
  assert.equal(skipped, 3);
});

test("paths are NFC, whatever form the disk gives", () => {
  const root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  writeFileSync(join(root, "Café.md"), "x");
  const { entries } = walk(root, parseIgnore(""));
  assert.equal(entries[0].path, "Café.md");
});
```

`sync/test/cache.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  fingerprint,
  loadCache,
  noteTargets,
  saveCache,
  sha256Hex,
} from "../src/cache.ts";

const entryOf = (root: string, path: string) => {
  const abs = join(root, path);
  const st = statSync(abs);
  return { path, abs, size: st.size, mtimeMs: st.mtimeMs };
};

test("a file whose size and time match is not read again", async () => {
  const root = mkdtempSync(join(tmpdir(), "hive-sync-"));
  writeFileSync(join(root, "a.pdf"), "one");
  const e = entryOf(root, "a.pdf");
  const first = await fingerprint(e, { version: 1, entries: {} });
  assert.equal(first.sha256, sha256Hex("one"));
  const cached = {
    version: 1 as const,
    entries: { "a.pdf": { ...first, sha256: "f".repeat(64) } },
  };
  assert.equal((await fingerprint(e, cached)).sha256, "f".repeat(64));
  assert.equal(
    (await fingerprint({ ...e, size: 4 }, cached)).sha256,
    sha256Hex("one"),
  );
});

test("a note's targets: wiki links, embeds and relative markdown links", () => {
  const t = noteTargets(
    '---\nrelated: "[[Other]]"\n---\nSee [[Plan#Goals|plan]], ![[deck.html]] and [pdf](../files/a%20b.pdf) and [w](https://x.y/a.pdf).',
    "notes/n.md",
  );
  assert.deepEqual(t.sort(), [
    "../files/a b.pdf",
    "Other",
    "Plan",
    "deck.html",
  ]);
});

test("the cache survives a round trip and a broken file reads as empty", () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-sync-"));
  const file = join(dir, "cache.json");
  saveCache(file, {
    version: 1,
    entries: { "a.md": { size: 1, mtimeMs: 2, sha256: "a".repeat(64) } },
  });
  assert.equal(loadCache(file).entries["a.md"].size, 1);
  writeFileSync(file, "{nope");
  assert.deepEqual(loadCache(file), { version: 1, entries: {} });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `node --test "sync/test/*.test.ts"`
Expected: FAIL. `../src/skip.ts` is not found.

- [ ] **Step 4: Implement**

`sync/src/skip.ts`:

```ts
// What the sync leaves out: any path part starting with "." (.obsidian, .git, .trash,
// .DS_Store), video files, and what `.hivesyncignore` at the vault's root names. The ignore
// file is a subset of gitignore: blank lines and `#` comments are skipped, `!` lines are
// ignored (nothing is re-included), a trailing `/` means a folder, a pattern holding a `/` is
// anchored at the root, `*` stays inside one part, `**` crosses parts, `?` is one character.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const VIDEO = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "3gp",
]);

export type Ignore = (path: string) => boolean;

type Rule = { re: RegExp; dirOnly: boolean; anchored: boolean };

function toRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function parseIgnore(text: string): Ignore {
  const rules: Rule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    line = line.replace(/^\/+/, "");
    if (line) rules.push({ re: toRegex(line), dirOnly, anchored });
  }
  return (path) => {
    const parts = path.split("/");
    for (const r of rules) {
      for (let i = 1; i <= parts.length; i++) {
        if (r.dirOnly && i === parts.length) continue;
        const candidate = r.anchored
          ? parts.slice(0, i).join("/")
          : parts[i - 1]!;
        if (r.re.test(candidate)) return true;
      }
    }
    return false;
  };
}

export function loadIgnore(root: string): Ignore {
  try {
    return parseIgnore(readFileSync(join(root, ".hivesyncignore"), "utf8"));
  } catch {
    return parseIgnore("");
  }
}

export function isSkipped(path: string, ignore: Ignore): boolean {
  const parts = path.split("/");
  if (parts.some((p) => p.startsWith("."))) return true;
  const name = parts[parts.length - 1]!;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && VIDEO.has(name.slice(dot + 1).toLowerCase())) return true;
  return ignore(path);
}
```

`sync/src/walk.ts`:

```ts
// Every file under the vault folder the sync takes, by its path relative to the folder: "/"
// separated and NFC, the form the app keeps (macOS may hand back either form). Symbolic links
// are not followed. A folder that cannot be read is reported, never taken as empty.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isSkipped, type Ignore } from "./skip.ts";

export type Entry = {
  path: string;
  abs: string;
  size: number;
  mtimeMs: number;
};

export function walk(
  root: string,
  ignore: Ignore,
): { entries: Entry[]; unreadable: string[]; skipped: number } {
  const entries: Entry[] = [];
  const unreadable: string[] = [];
  let skipped = 0;
  const visit = (absDir: string, relDir: string) => {
    let names: string[];
    try {
      names = readdirSync(absDir);
    } catch {
      unreadable.push(relDir);
      return;
    }
    for (const raw of names) {
      const name = raw.normalize("NFC");
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = join(absDir, raw);
      if (isSkipped(rel, ignore)) {
        skipped++;
        continue;
      }
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        unreadable.push(rel);
        continue;
      }
      if (st.isSymbolicLink()) skipped++;
      else if (st.isDirectory()) visit(abs, rel);
      else if (st.isFile())
        entries.push({ path: rel, abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  visit(root, "");
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, unreadable, skipped };
}
```

A dot folder counts as one skipped item (it is not descended), which is why the first walk test
expects 3: `.obsidian`, `clip.mov` and `link.pdf`.

`sync/src/cache.ts`:

```ts
// The fingerprint of each file (size, modified time, SHA-256), kept between runs so a file
// whose size and time are unchanged is not read again; for a note, also the targets it links
// to, which decide where files live. Losing the cache costs one slower run, nothing else.
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parseNote } from "../../web/src/import/parse.ts";
import { wikiTargets, MAX_TARGETS } from "../../web/src/import/wikilinks.ts";
import type { Entry } from "./walk.ts";

export type Cached = {
  size: number;
  mtimeMs: number;
  sha256: string;
  targets?: string[];
};
export type Cache = { version: 1; entries: Record<string, Cached> };

export const isNote = (path: string): boolean => /\.md$/i.test(path);

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256OfFile(abs: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(abs)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** What a note links to: its wiki links and embeds, and its relative markdown links. */
export function noteTargets(raw: string, path: string): string[] {
  const note = parseNote(raw, path);
  const out = new Set(wikiTargets(note.body, note.frontmatter));
  for (const m of note.body.matchAll(MARKDOWN_LINK)) {
    let target = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    target = target.split("#")[0]!;
    try {
      target = decodeURIComponent(target);
    } catch {
      // Kept as written.
    }
    if (target) out.add(target);
    if (out.size >= MAX_TARGETS) break;
  }
  return [...out];
}

export async function fingerprint(e: Entry, old: Cache): Promise<Cached> {
  const was = old.entries[e.path];
  if (was && was.size === e.size && was.mtimeMs === e.mtimeMs) return was;
  if (isNote(e.path)) {
    const raw = readFileSync(e.abs);
    return {
      size: e.size,
      mtimeMs: e.mtimeMs,
      sha256: sha256Hex(raw),
      targets: noteTargets(raw.toString("utf8"), e.path),
    };
  }
  return {
    size: e.size,
    mtimeMs: e.mtimeMs,
    sha256: await sha256OfFile(e.abs),
  };
}

export function loadCache(file: string): Cache {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed?.version === 1 &&
      parsed.entries &&
      typeof parsed.entries === "object"
    ) {
      return parsed as Cache;
    }
  } catch {
    // Missing or unreadable: one slower run.
  }
  return { version: 1, entries: {} };
}

export function saveCache(file: string, cache: Cache): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
  renameSync(tmp, file);
}
```

Check that `wikilinks.ts` exports `MAX_TARGETS` (it does: `export const MAX_TARGETS = 2000`).

- [ ] **Step 5: Run the tests and the typecheck**

Run: `node --test "sync/test/*.test.ts"`, then `pnpm --filter @hive-mind/sync typecheck`.
Expected: PASS. If `tsc` reports errors inside `web/src/import/*.ts` under these stricter
options, do not change the web files. Either add `"noUncheckedIndexedAccess": false` (the
default), or narrow the import with a small `sync/src/web.ts` that re-exports the four functions
with their types, and report what was needed.

Run: `pnpm lint` (run `pnpm format` on new files first).

- [ ] **Step 6: Commit**

```bash
git add sync/package.json sync/tsconfig.json sync/README.md sync/src/skip.ts sync/src/walk.ts sync/src/cache.ts sync/test/skip.test.ts sync/test/walk.test.ts sync/test/cache.test.ts pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "feat(sync): the vault walk, skip rules and fingerprint cache"
```

### Task 7: One run, against a stand-in store

**Files:**

- Create: `sync/src/homes.ts`, `sync/src/links.ts`, `sync/src/store.ts`, `sync/src/run.ts`
- Create: `sync/test/fake-store.ts`, `sync/test/homes.test.ts`, `sync/test/links.test.ts`,
  `sync/test/run.test.ts`

**Interfaces:**

- Consumes:
  - Task 6: `walk`, `loadIgnore`, `fingerprint`, `loadCache`, `saveCache`, `isNote`,
    `sha256Hex`.
  - From the web app: `web/src/import/parse.ts` `parseNote`, `web/src/import/dates.ts`
    `noteDates(frontmatter, path, lastModified, now)`, `web/src/import/wikilinks.ts`
    `buildIndex`/`resolveTarget`, and `web/src/gallery/mime.ts` `mimeFor(name)`.
- Produces:
  - `homes.ts`: `VAULT_FILES = "Vault files.md"`, `vaultFilesNote(filePath): string`,
    `chooseHomes(notes: {path: string; targets: string[]}[], files: string[]): Map<string,
string>`.
  - `links.ts`: `notePairs(changed: {path; targets}[], allNotePaths: string[]): {from; to}[]`.
  - `store.ts`: the `Store` interface and the types `ManifestEntry`, `PlanResult`, `NoteUp`,
    `FileUp`, `PutResult` and `Counts`, plus the error classes `KeyRefused`, `Unreachable` and
    `FolderMissing`. These shapes are exactly the JSON of the Task 2/3 functions.
  - `run.ts`:
    - `runOnce(o: RunOptions): Promise<Report>`.
    - `RunOptions = { root; cachePath; store; confirmDeletes; now?; uploadBudget?; log? }`.
    - `Report = { counts: Counts; tooBig: string[]; refusedDeletes: number; failed: string[];
deferred: number }`.
    - Constants `PAGE = 2000`, `BATCH_NOTES = 50`, `BATCH_BYTES = 1_000_000`,
      `MAX_NOTE_BYTES = 1_000_000`, `MAX_FILE_BYTES = 52_428_800`, `BATCH_FILES = 200`,
      `BATCH_LINKS = 2000`, `UPLOAD_BUDGET = 2_000_000_000`.

- [ ] **Step 1: The store types**

`sync/src/store.ts`:

```ts
// What a run asks of the hive. The shapes are the JSON of the database's sync_* functions
// (supabase/migrations/*_vault_sync.sql); rest-store.ts speaks them over the REST API, the
// tests' stand-in keeps them in memory.
export type ManifestEntry = {
  path: string;
  sha256: string;
  size: number;
  home?: string;
};
export type Moved = { from: string; to: string };
export type PlanResult = {
  new: string[];
  changed: string[];
  moved: Moved[];
  gone: string[];
  rehome: { path: string; home: string }[];
  kept: number;
};
export type NoteUp = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  sha256: string;
  from?: string;
  created_at?: string;
  updated_at?: string;
};
export type FileUp = {
  path: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
  home: string;
  storage_path?: string;
  from?: string;
};
export type PutResult = {
  written: { path: string; id: string }[];
  failed: { path: string; code: string }[];
};
export type Counts = {
  added: number;
  changed: number;
  moved: number;
  deleted: number;
  skipped: number;
  too_big: number;
};

export interface Store {
  openRun(confirm: boolean): Promise<{ runId: string; storagePrefix: string }>;
  /** One page of the manifest; the last page answers the plan, the others null. */
  plan(
    runId: string,
    page: ManifestEntry[],
    last: boolean,
  ): Promise<PlanResult | null>;
  putNotes(runId: string, notes: NoteUp[]): Promise<PutResult>;
  linkNotes(runId: string, pairs: Moved[]): Promise<number>;
  /** Stores an object; one that is already there counts as stored. */
  upload(
    storagePath: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  putFiles(runId: string, files: FileUp[]): Promise<PutResult>;
  deletePaths(
    runId: string,
    paths: string[],
  ): Promise<{ deleted: number; refused: number }>;
  finish(
    runId: string,
    counts: Counts,
    tooBig: string[],
    error: string | null,
  ): Promise<void>;
}

/** The key was refused or revoked: stop, and say so once. */
export class KeyRefused extends Error {}
/** The hive could not be reached or answered an error: the next run tries again. */
export class Unreachable extends Error {}
/** The vault folder is missing or unreadable: nothing is compared. */
export class FolderMissing extends Error {}
```

- [ ] **Step 2: Write the failing tests**

`sync/test/homes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseHomes, vaultFilesNote } from "../src/homes.ts";

test("a file lives in the first note, by path, that links to it", () => {
  const homes = chooseHomes(
    [
      { path: "b/Second.md", targets: ["deck.html"] },
      { path: "a/First.md", targets: ["../decks/deck.html"] },
      { path: "c/Other.md", targets: ["files/a b.pdf"] },
    ],
    ["decks/deck.html", "c/files/a b.pdf", "loose/x.png"],
  );
  assert.equal(homes.get("decks/deck.html"), "a/First.md");
  assert.equal(homes.get("c/files/a b.pdf"), "c/Other.md");
  assert.equal(homes.get("loose/x.png"), "loose/Vault files.md");
});

test("a name shared by two files means the one nearest the note", () => {
  const homes = chooseHomes(
    [{ path: "p/N.md", targets: ["img.png"] }],
    ["p/img.png", "q/img.png"],
  );
  assert.equal(homes.get("p/img.png"), "p/N.md");
  assert.equal(homes.get("q/img.png"), "q/Vault files.md");
});

test("a file at the top lives in the top Vault files note", () => {
  assert.equal(vaultFilesNote("x.pdf"), "Vault files.md");
});
```

`sync/test/links.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { notePairs } from "../src/links.ts";

test("wiki links resolve to note paths, by the web app's rules", () => {
  const pairs = notePairs(
    [{ path: "a/A.md", targets: ["B", "deck.html", "Missing", "A"] }],
    ["a/A.md", "b/B.md"],
  );
  assert.deepEqual(pairs, [{ from: "a/A.md", to: "b/B.md" }]);
});
```

`sync/test/fake-store.ts`: an in-memory `Store` with the database's semantics. The plan follows
the rules of `sync_plan` (new, changed, moved with unique fingerprints, gone, rehome). `deletePaths`
follows the rules of `sync_delete`: the guard, and the one-run confirm through a
`confirmable` list kept from the run before when `openRun(true)`. `upload` keeps objects in a
`Map`. Calls are recorded in `calls: string[]` (`"plan"`, `"putNotes"`, `"upload"`, `"putFiles"`,
`"deletePaths"`, `"finish"`), so order can be asserted.

```ts
import type {
  Counts,
  FileUp,
  ManifestEntry,
  Moved,
  NoteUp,
  PlanResult,
  PutResult,
  Store,
} from "../src/store.ts";

type Kept = { sha: string; note: boolean; home?: string };

export class FakeStore implements Store {
  kept = new Map<string, Kept>();
  objects = new Map<string, Uint8Array>();
  notes = new Map<string, NoteUp>();
  calls: string[] = [];
  runs: {
    confirmable: string[];
    refused: string[];
    finished?: { counts: Counts; error: string | null };
  }[] = [];
  private manifest: ManifestEntry[] = [];
  failUploadOnce = new Set<string>();

  async openRun(confirm: boolean) {
    const prev = this.runs[this.runs.length - 1];
    this.runs.push({
      confirmable: confirm && prev ? prev.refused : [],
      refused: [],
    });
    this.manifest = [];
    return { runId: String(this.runs.length - 1), storagePrefix: "m/w/vault/" };
  }

  async plan(
    _run: string,
    page: ManifestEntry[],
    last: boolean,
  ): Promise<PlanResult | null> {
    this.calls.push("plan");
    this.manifest.push(...page);
    if (!last) return null;
    const isNote = (p: string) => /\.md$/i.test(p);
    const m = new Map(this.manifest.map((e) => [e.path, e]));
    const fresh = this.manifest.filter((e) => !this.kept.has(e.path));
    const lost = [...this.kept].filter(([p]) => !m.has(p));
    const moved: Moved[] = [];
    for (const [from, k] of lost) {
      const to = fresh.filter(
        (f) => f.sha256 === k.sha && isNote(f.path) === k.note,
      );
      const twins = lost.filter(
        ([, l]) => l.sha === k.sha && l.note === k.note,
      );
      if (to.length === 1 && twins.length === 1)
        moved.push({ from, to: to[0]!.path });
    }
    const movedTo = new Set(moved.map((x) => x.to));
    const movedFrom = new Set(moved.map((x) => x.from));
    return {
      new: fresh
        .map((e) => e.path)
        .filter((p) => !movedTo.has(p))
        .sort(),
      changed: this.manifest
        .filter(
          (e) =>
            this.kept.has(e.path) && this.kept.get(e.path)!.sha !== e.sha256,
        )
        .map((e) => e.path)
        .sort(),
      moved,
      gone: lost
        .map(([p]) => p)
        .filter((p) => !movedFrom.has(p))
        .sort(),
      rehome: this.manifest
        .filter((e) => {
          const k = this.kept.get(e.path);
          return (
            k && !k.note && k.sha === e.sha256 && e.home && e.home !== k.home
          );
        })
        .map((e) => ({ path: e.path, home: e.home! })),
      kept: this.kept.size,
    };
  }

  async putNotes(_run: string, notes: NoteUp[]): Promise<PutResult> {
    this.calls.push("putNotes");
    for (const n of notes) {
      if (n.from) this.kept.delete(n.from);
      this.kept.set(n.path, { sha: n.sha256, note: true });
      this.notes.set(n.path, n);
    }
    return {
      written: notes.map((n) => ({ path: n.path, id: n.path })),
      failed: [],
    };
  }

  async linkNotes(_run: string, pairs: Moved[]) {
    this.calls.push("linkNotes");
    return pairs.length;
  }

  async upload(path: string, bytes: Uint8Array) {
    this.calls.push("upload");
    if (this.failUploadOnce.delete(path)) throw new Error("network");
    this.objects.set(path, bytes);
  }

  async putFiles(_run: string, files: FileUp[]): Promise<PutResult> {
    this.calls.push("putFiles");
    for (const f of files) {
      const was = this.kept.get(f.from ?? f.path);
      if (f.from) this.kept.delete(f.from);
      this.kept.set(f.path, {
        sha: f.storage_path ? f.sha256 : was!.sha,
        note: false,
        home: f.home,
      });
    }
    return {
      written: files.map((f) => ({ path: f.path, id: f.path })),
      failed: [],
    };
  }

  async deletePaths(_run: string, paths: string[]) {
    this.calls.push("deletePaths");
    const run = this.runs[this.runs.length - 1]!;
    const mine = paths.filter((p) => this.kept.has(p));
    const n = mine.length;
    const trips = n > 25 || (n > 1 && n * 50 > this.kept.size);
    if (trips && !paths.every((p) => run.confirmable.includes(p))) {
      run.refused = paths;
      return { deleted: 0, refused: paths.length };
    }
    for (const p of mine) this.kept.delete(p);
    return { deleted: n, refused: 0 };
  }

  async finish(
    _run: string,
    counts: Counts,
    _tooBig: string[],
    error: string | null,
  ) {
    this.calls.push("finish");
    this.runs[this.runs.length - 1]!.finished = { counts, error };
  }
}
```

`sync/test/run.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOnce } from "../src/run.ts";
import { FolderMissing } from "../src/store.ts";
import { FakeStore } from "./fake-store.ts";

const vault = () => {
  const root = mkdtempSync(join(tmpdir(), "hive-vault-"));
  const cachePath = join(
    mkdtempSync(join(tmpdir(), "hive-cache-")),
    "cache.json",
  );
  return {
    root,
    cachePath,
    write: (p: string, text: string) => {
      mkdirSync(join(root, p, ".."), { recursive: true });
      writeFileSync(join(root, p), text);
    },
  };
};

test("first run: notes before files, files in their linking note, report counts", async () => {
  const v = vault();
  v.write(
    "decks/Pitch.md",
    "---\ncreated: 2025-02-03\n---\nSee ![[pitch.html]] and [[Plan]]",
  );
  v.write("Plan.md", "plan");
  v.write("decks/pitch.html", "<html></html>");
  v.write("loose.pdf", "%PDF");
  v.write("big.mov", "video");
  const store = new FakeStore();
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(r.counts, {
    added: 4,
    changed: 0,
    moved: 0,
    deleted: 0,
    skipped: 1,
    too_big: 0,
  });
  const order = store.calls.filter((c) => c !== "upload");
  assert.deepEqual(order, [
    "plan",
    "putNotes",
    "linkNotes",
    "putFiles",
    "finish",
  ]);
  assert.equal(store.kept.get("decks/pitch.html")!.home, "decks/Pitch.md");
  assert.equal(store.kept.get("loose.pdf")!.home, "Vault files.md");
  assert.equal(
    store.notes.get("decks/Pitch.md")!.created_at,
    "2025-02-03T12:00:00.000Z",
  );
  // The object's place is fixed by path and content; HTML is stored as bytes.
  const [key] = [...store.objects.keys()].filter((k) =>
    k.endsWith("/pitch.html"),
  );
  assert.match(key!, /^m\/w\/vault\/[0-9a-f]{32}\/pitch\.html$/);
});

test("second run with no change sends only the plan and the finish", async () => {
  const v = vault();
  v.write("A.md", "a");
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  store.calls = [];
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(store.calls, ["plan", "finish"]);
});

test("a rename is a move, an edit is a change, a removal a delete", async () => {
  const v = vault();
  v.write("A.md", "a");
  v.write("B.md", "b");
  v.write("C.md", "c");
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  renameSync(join(v.root, "A.md"), join(v.root, "A2.md"));
  v.write("B.md", "b changed");
  unlinkSync(join(v.root, "C.md"));
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.equal(r.counts.moved, 1);
  assert.equal(r.counts.changed, 1);
  // One delete of three kept items is 33%, but a single item never trips the guard.
  assert.equal(r.counts.deleted, 1);
  assert.equal(store.notes.get("A2.md")!.from, "A.md");
});

test("a mass delete is held back until the next run is told to let it through", async () => {
  const v = vault();
  for (let i = 0; i < 30; i++) v.write(`n/${i}.md`, `note ${i}`);
  const store = new FakeStore();
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  rmSync(join(v.root, "n"), { recursive: true });
  v.write("keep.md", "k");
  let r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.equal(r.refusedDeletes, 30);
  assert.equal(store.kept.has("n/0.md"), true);
  r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: true,
  });
  assert.equal(r.counts.deleted, 30);
});

test("a missing folder stops before anything is compared", async () => {
  const store = new FakeStore();
  await assert.rejects(
    runOnce({
      root: "/nonexistent/vault",
      cachePath: "/tmp/x.json",
      store,
      confirmDeletes: false,
    }),
    FolderMissing,
  );
  assert.deepEqual(store.calls, []);
});

test("files over 50 MB and notes over 1 MB are listed, never uploaded or deleted", async () => {
  const v = vault();
  v.write("huge.md", "x".repeat(1_000_001));
  v.write("ok.md", "ok");
  const store = new FakeStore();
  store.kept.set("huge.md", { sha: "0".repeat(64), note: true });
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.deepEqual(r.tooBig, ["huge.md"]);
  assert.equal(store.kept.has("huge.md"), true);
  assert.equal(r.counts.too_big, 1);
});

test("an interrupted run is finished by the next, with nothing duplicated", async () => {
  const v = vault();
  v.write("a.pdf", "1");
  v.write("b.pdf", "2");
  const store = new FakeStore();
  // The first upload of b.pdf fails, whatever its object's key is.
  const real = store.upload.bind(store);
  let failedOnce = false;
  store.upload = async (p, bytes, type) => {
    if (!failedOnce && p.endsWith("/b.pdf")) {
      failedOnce = true;
      throw new Error("network");
    }
    return real(p, bytes, type);
  };
  await assert.rejects(
    runOnce({
      root: v.root,
      cachePath: v.cachePath,
      store,
      confirmDeletes: false,
    }),
  );
  assert.equal(store.runs[0]!.finished!.error, "the run stopped: Error");
  await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
  });
  assert.equal(store.objects.size, 2);
  assert.equal(store.kept.size, 2);
});

test("uploads stop at the run's budget; the rest goes up next run", async () => {
  const v = vault();
  v.write("a.pdf", "11111");
  v.write("b.pdf", "22222");
  const store = new FakeStore();
  const r = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
    uploadBudget: 6,
  });
  assert.equal(r.deferred, 1);
  assert.equal(store.objects.size, 1);
  const again = await runOnce({
    root: v.root,
    cachePath: v.cachePath,
    store,
    confirmDeletes: false,
    uploadBudget: 6,
  });
  assert.equal(again.deferred, 0);
  assert.equal(store.objects.size, 2);
});
```

In the "interrupted" test, one failed upload rejects the run, `finish` records
`the run stopped: Error`, and the next run completes with two objects and two kept files.
`failUploadOnce` in the stand-in is unused by these tests; drop it if nothing needs it.

- [ ] **Step 3: Run to see them fail**

Run: `node --test "sync/test/*.test.ts"`
Expected: the new tests FAIL (modules not found). Task 6's tests pass.

- [ ] **Step 4: Implement `homes.ts` and `links.ts`**

`sync/src/homes.ts`:

```ts
// Which note a file lives in: the first note, in path order, that links to it (`![[name]]`,
// `[[name]]` or a relative markdown link); with none, the "Vault files" note of its folder,
// which exists in the app only. A target names a file by its relative path, its path from the
// vault's root, the end of its path, or its bare name; a bare name two files share means the
// one in the note's own folder, else the one with the shortest path.
export const VAULT_FILES = "Vault files.md";

const dirOf = (p: string): string =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const fold = (p: string): string => p.normalize("NFC").toLowerCase();

export function vaultFilesNote(filePath: string): string {
  const dir = dirOf(filePath);
  return dir ? `${dir}/${VAULT_FILES}` : VAULT_FILES;
}

function resolve(base: string, rel: string): string | null {
  const parts = base ? base.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return null;
    } else parts.push(part);
  }
  return parts.join("/");
}

export function chooseHomes(
  notes: { path: string; targets: string[] }[],
  files: string[],
): Map<string, string> {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const f of files) {
    byPath.set(fold(f), f);
    const name = fold(f.slice(f.lastIndexOf("/") + 1));
    byName.set(name, [...(byName.get(name) ?? []), f]);
  }
  const find = (notePath: string, target: string): string | null => {
    const t = target.trim();
    if (!t) return null;
    const dir = dirOf(notePath);
    if (t.startsWith("./") || t.startsWith("../")) {
      const r = resolve(dir, t);
      return r === null ? null : (byPath.get(fold(r)) ?? null);
    }
    const exact = byPath.get(fold(t.replace(/^\/+/, "")));
    if (exact) return exact;
    const near = byPath.get(fold(dir ? `${dir}/${t}` : t));
    if (near) return near;
    if (t.includes("/")) {
      const end = fold(`/${t}`);
      const hits = files.filter((f) => fold(`/${f}`).endsWith(end));
      return (
        hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0] ?? null
      );
    }
    const named = byName.get(fold(t)) ?? [];
    const here = named.filter((f) => dirOf(f) === dir);
    const pool = here.length ? here : named;
    return (
      [...pool].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0] ??
      null
    );
  };

  const homes = new Map<string, string>();
  for (const note of [...notes].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const target of note.targets) {
      const file = find(note.path, target);
      if (file && !homes.has(file)) homes.set(file, note.path);
    }
  }
  for (const f of files) if (!homes.has(f)) homes.set(f, vaultFilesNote(f));
  return homes;
}
```

`sync/src/links.ts`:

```ts
// The wiki links of the notes a run wrote, as pairs of note paths, by the web app's rules for
// which note a target means (web/src/import/wikilinks.ts). The database makes the links;
// two notes of one owner need no handshake.
import { buildIndex, resolveTarget } from "../../web/src/import/wikilinks.ts";
import type { Moved } from "./store.ts";

export function notePairs(
  changed: { path: string; targets: string[] }[],
  allNotePaths: string[],
): Moved[] {
  const index = buildIndex(allNotePaths.map((p) => ({ id: p, path: p })));
  const seen = new Set<string>();
  const out: Moved[] = [];
  for (const note of changed) {
    for (const target of note.targets) {
      const to = resolveTarget(index, note.path, target);
      if (!to || to === note.path) continue;
      const key = `${note.path}\n${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: note.path, to });
    }
  }
  return out;
}
```

- [ ] **Step 5: Implement `run.ts`**

```ts
// One run of the sync: walk the vault, fingerprint, compare with the hive, then notes, their
// wiki links, files, deletes, and the record. Every step can be repeated: an interrupted run's
// next run compares again and carries on, with nothing duplicated (an object's place is fixed by
// its path and content). Nothing here logs a path or a note's text.
import { readFileSync, statSync } from "node:fs";
import { noteDates } from "../../web/src/import/dates.ts";
import { parseNote } from "../../web/src/import/parse.ts";
import { mimeFor } from "../../web/src/gallery/mime.ts";
import {
  fingerprint,
  isNote,
  loadCache,
  saveCache,
  sha256Hex,
  type Cache,
  type Cached,
} from "./cache.ts";
import { chooseHomes } from "./homes.ts";
import { notePairs } from "./links.ts";
import { loadIgnore } from "./skip.ts";
import {
  FolderMissing,
  type Counts,
  type FileUp,
  type ManifestEntry,
  type NoteUp,
  type PlanResult,
  type Store,
} from "./store.ts";
import { walk, type Entry } from "./walk.ts";

export const PAGE = 2000;
export const BATCH_NOTES = 50;
export const BATCH_BYTES = 1_000_000;
export const MAX_NOTE_BYTES = 1_000_000;
export const MAX_FILE_BYTES = 52_428_800;
export const BATCH_FILES = 200;
export const BATCH_LINKS = 2000;
export const UPLOAD_BUDGET = 2_000_000_000;

export type RunOptions = {
  root: string;
  cachePath: string;
  store: Store;
  confirmDeletes: boolean;
  now?: () => number;
  uploadBudget?: number;
  log?: (line: string) => void;
};

export type Report = {
  counts: Counts;
  tooBig: string[];
  refusedDeletes: number;
  failed: string[];
  deferred: number;
};

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
const utf8 = (s: string): number => Buffer.byteLength(s, "utf8");

/** An object's last part: the name in characters Storage takes in a key. */
export function storageName(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .slice(-200);
  return safe.replace(/^[ .]+/, "") || "file";
}

/** An object's folder, fixed by the file's path and content. */
export function objectKey(path: string, sha256: string): string {
  return sha256Hex(`${path}\n${sha256}`).slice(0, 32);
}

function isReadableDir(root: string): boolean {
  try {
    return statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function readNote(e: Entry, sha256: string, now: number): NoteUp {
  const parsed = parseNote(readFileSync(e.abs, "utf8"), e.path);
  const dates = noteDates(parsed.frontmatter, e.path, e.mtimeMs, now);
  return {
    path: e.path,
    title: (
      parsed.title ||
      nameOf(e.path).replace(/\.md$/i, "") ||
      "Untitled"
    ).slice(0, 1000),
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    sha256,
    ...(dates.written_at ? { created_at: dates.written_at } : {}),
    ...(dates.modified_at ? { updated_at: dates.modified_at } : {}),
  };
}

const noteBytes = (n: NoteUp): number =>
  utf8(n.title) + utf8(n.body) + utf8(JSON.stringify(n.frontmatter));

/** Batches of at most 50 notes and 1 MB of text; a note that alone is over goes by itself. */
export function noteBatches(notes: NoteUp[]): NoteUp[][] {
  const out: NoteUp[][] = [];
  let cur: NoteUp[] = [];
  let bytes = 0;
  for (const n of notes) {
    const b = noteBytes(n);
    if (cur.length && (cur.length === BATCH_NOTES || bytes + b > BATCH_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(n);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function runOnce(o: RunOptions): Promise<Report> {
  const now = o.now ?? Date.now;
  const budget = o.uploadBudget ?? UPLOAD_BUDGET;
  // A missing folder must never read as "everything was deleted".
  if (!isReadableDir(o.root)) throw new FolderMissing();

  const walked = walk(o.root, loadIgnore(o.root));
  if (walked.unreadable.includes("")) throw new FolderMissing();
  const old = loadCache(o.cachePath);
  const cache: Cache = { version: 1, entries: {} };
  const byPath = new Map<string, Entry>();
  const prints = new Map<string, Cached>();
  const tooBig: string[] = [];
  const unreadable = new Set(walked.unreadable);
  for (const e of walked.entries) {
    if (e.size > (isNote(e.path) ? MAX_NOTE_BYTES : MAX_FILE_BYTES)) {
      tooBig.push(e.path);
      continue;
    }
    try {
      const c = await fingerprint(e, old);
      prints.set(e.path, c);
      cache.entries[e.path] = c;
      byPath.set(e.path, e);
    } catch {
      unreadable.add(e.path);
    }
  }
  saveCache(o.cachePath, cache);

  const notes = [...prints]
    .filter(([p]) => isNote(p))
    .map(([path, c]) => ({ path, targets: c.targets ?? [] }));
  const files = [...prints.keys()].filter((p) => !isNote(p));
  const homes = chooseHomes(notes, files);
  const manifest: ManifestEntry[] = [...prints].map(([path, c]) => ({
    path,
    sha256: c.sha256,
    size: c.size,
    ...(isNote(path) ? {} : { home: homes.get(path)! }),
  }));

  const counts: Counts = {
    added: 0,
    changed: 0,
    moved: 0,
    deleted: 0,
    skipped: walked.skipped,
    too_big: tooBig.length,
  };
  const failed: string[] = [];
  let refusedDeletes = 0;
  let deferred = 0;

  const { runId, storagePrefix } = await o.store.openRun(o.confirmDeletes);
  try {
    let plan: PlanResult | null = null;
    const pages = manifest.length ? chunks(manifest, PAGE) : [[]];
    for (let i = 0; i < pages.length; i++) {
      plan = await o.store.plan(runId, pages[i]!, i === pages.length - 1);
    }
    if (!plan) throw new Error("no plan");
    const added = new Set(plan.new);
    const changed = new Set(plan.changed);
    const tally = (path: string, from?: string) => {
      if (from) counts.moved++;
      else if (added.has(path)) counts.added++;
      else if (changed.has(path)) counts.changed++;
    };

    // Notes first, so a file's home note exists when the file is recorded.
    const noteUps: NoteUp[] = [];
    for (const path of [...plan.new, ...plan.changed].filter(isNote)) {
      try {
        noteUps.push(
          readNote(byPath.get(path)!, prints.get(path)!.sha256, now()),
        );
      } catch {
        unreadable.add(path);
      }
    }
    for (const m of plan.moved.filter((x) => isNote(x.to))) {
      try {
        noteUps.push({
          ...readNote(byPath.get(m.to)!, prints.get(m.to)!.sha256, now()),
          from: m.from,
        });
      } catch {
        unreadable.add(m.to);
      }
    }
    for (const batch of noteBatches(noteUps)) {
      const r = await o.store.putNotes(runId, batch);
      const sent = new Map(batch.map((n) => [n.path, n]));
      for (const w of r.written) tally(w.path, sent.get(w.path)?.from);
      failed.push(...r.failed.map((f) => f.path));
    }

    const pairs = notePairs(
      noteUps.map((n) => ({
        path: n.path,
        targets: prints.get(n.path)?.targets ?? [],
      })),
      notes.map((n) => n.path),
    );
    for (const chunk of chunks(pairs, BATCH_LINKS))
      await o.store.linkNotes(runId, chunk);

    // Then files: upload, then record, at most the run's budget of bytes.
    const fileUps: FileUp[] = [];
    let spent = 0;
    for (const path of [...plan.new, ...plan.changed].filter(
      (p) => !isNote(p),
    )) {
      const e = byPath.get(path)!;
      const sha = prints.get(path)!.sha256;
      if (spent + e.size > budget) {
        deferred++;
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(e.abs);
      } catch {
        unreadable.add(path);
        continue;
      }
      if (sha256Hex(bytes) !== sha) {
        unreadable.add(path); // changed while the run read it: the next run takes it
        continue;
      }
      const name = nameOf(path);
      const storage_path = `${storagePrefix}${objectKey(path, sha)}/${storageName(name)}`;
      await o.store.upload(storage_path, bytes, mimeFor(name));
      spent += e.size;
      fileUps.push({
        path,
        name,
        size: e.size,
        sha256: sha,
        mime: mimeFor(name),
        home: homes.get(path)!,
        storage_path,
      });
    }
    for (const m of plan.moved.filter((x) => !isNote(x.to))) {
      const name = nameOf(m.to);
      fileUps.push({
        path: m.to,
        name,
        size: byPath.get(m.to)!.size,
        sha256: prints.get(m.to)!.sha256,
        mime: mimeFor(name),
        home: homes.get(m.to)!,
        from: m.from,
      });
    }
    for (const r of plan.rehome) {
      const name = nameOf(r.path);
      fileUps.push({
        path: r.path,
        name,
        size: byPath.get(r.path)!.size,
        sha256: prints.get(r.path)!.sha256,
        mime: mimeFor(name),
        home: r.home,
      });
    }
    for (const batch of chunks(fileUps, BATCH_FILES)) {
      const r = await o.store.putFiles(runId, batch);
      const sent = new Map(batch.map((f) => [f.path, f]));
      for (const w of r.written)
        if (sent.get(w.path)?.storage_path || sent.get(w.path)?.from)
          tally(w.path, sent.get(w.path)?.from);
      failed.push(...r.failed.map((f) => f.path));
    }

    // Deletes last. A too-big or unreadable path is still in the vault: never deleted.
    const gone = plan.gone.filter(
      (p) => !unreadable.has(p) && !tooBig.includes(p),
    );
    if (gone.length) {
      const d = await o.store.deletePaths(runId, gone);
      counts.deleted = d.deleted;
      refusedDeletes = d.refused;
    }
    await o.store.finish(
      runId,
      counts,
      tooBig,
      failed.length ? `${failed.length} items failed` : null,
    );
  } catch (e) {
    const what = e instanceof Error ? e.constructor.name : "unknown";
    await o.store
      .finish(runId, counts, tooBig, `the run stopped: ${what}`)
      .catch(() => {});
    throw e;
  }
  return { counts, tooBig, refusedDeletes, failed, deferred };
}
```

A walk that cannot read the root itself reports `""` in `unreadable`. The check after `walk`
treats that as a missing folder too.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `node --test "sync/test/*.test.ts"` and `pnpm --filter @hive-mind/sync typecheck`, then
`pnpm format` on `sync/` and `pnpm lint`.
Expected: PASS. If the first-run test's `skipped` differs (the walk counts `big.mov`), fix the
test's expectation to what the walk truly skipped, and say so in the report.

- [ ] **Step 7: Commit**

```bash
git add sync/src/homes.ts sync/src/links.ts sync/src/store.ts sync/src/run.ts sync/test/fake-store.ts sync/test/homes.test.ts sync/test/links.test.ts sync/test/run.test.ts
git commit -m "feat(sync): one run of the vault sync against a stand-in store"
```

### Task 8: The real store, sign-in, the Mac side and the CLI

**Files:**

- Create: `sync/src/session.ts`, `sync/src/rest-store.ts`, `sync/src/mac.ts`,
  `sync/src/config.ts`, `sync/src/cli.ts`
- Create: `sync/test/session.test.ts`, `sync/test/rest-store.test.ts`, `sync/test/mac.test.ts`,
  `sync/test/cli.test.ts`
- Modify: `sync/README.md`

**Interfaces:**

- Consumes:
  - Task 4: `POST {url}/functions/v1/sync-session` `{key}`, which answers `{access_token,
expires_at}` or 401.
  - Tasks 2, 3: the RPCs `sync_open_run {p_confirm}`, `sync_plan {p_run, p_entries, p_last}`,
    `sync_put_notes {p_run, p_notes}`, `sync_link_notes {p_run, p_pairs}`, `sync_put_files
{p_run, p_files}`, `sync_delete {p_run, p_paths}`, `sync_finish {p_run, p_counts,
p_too_big, p_error}`.
  - Storage: `POST {url}/storage/v1/object/files/{path}`.
  - Task 7: `Store`, `runOnce`, `KeyRefused`, `Unreachable`, `FolderMissing`.
- Produces:
  - `session.ts`: `syncSession(cfg: {url; anonKey; key}, fetchFn?, now?): { token():
Promise<string> }`. It refreshes when less than 300 s are left.
  - `rest-store.ts`: `restStore(cfg: {url; anonKey}, session, fetchFn?): Store`.
  - `mac.ts`:
    - `LABEL = "ai.hive-mind.sync"`, `plist({node, cli, log}): string`;
    - `installAgent(text)`, `removeAgent()`;
    - `keychainRead(): string | null`, `keychainStore(): boolean`, `keychainDelete()`;
    - `notify(phrase: Phrase)`;
    - `acquireLock(file): (() => void) | null`.
  - `config.ts`:
    - `paths` (dir, config, state, cache, lock, log);
    - `type Config = {url; anonKey; folder}`, `type State = {failuresInRow; notified:
string[]; last?: {...}}`;
    - `loadConfig`, `saveConfig`, `loadState`, `saveState`.
  - `cli.ts`: `parseArgs(argv): Command` (pure) and `main(argv)`.

- [ ] **Step 1: Write the failing tests**

`sync/test/session.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncSession } from "../src/session.ts";
import { KeyRefused, Unreachable } from "../src/store.ts";

const KEY = "hsync_" + "b".repeat(64);

test("signs in once and refreshes five minutes before the hour is up", async () => {
  let calls = 0;
  let clock = 1_000_000;
  const s = syncSession(
    { url: "https://p.supabase.co/", anonKey: "pk", key: KEY },
    async (url, init) => {
      calls++;
      assert.equal(url, "https://p.supabase.co/functions/v1/sync-session");
      assert.deepEqual(JSON.parse(String(init!.body)), { key: KEY });
      return new Response(
        JSON.stringify({
          access_token: `t${calls}`,
          expires_at: clock / 1000 + 3600,
        }),
        { status: 200 },
      );
    },
    () => clock,
  );
  assert.equal(await s.token(), "t1");
  assert.equal(await s.token(), "t1");
  clock += 3_400_000;
  assert.equal(await s.token(), "t2");
});

test("a 401 is a refused key; anything else is unreachable", async () => {
  const refused = syncSession(
    { url: "https://p", anonKey: "pk", key: KEY },
    async () => new Response("{}", { status: 401 }),
  );
  await assert.rejects(refused.token(), KeyRefused);
  const down = syncSession(
    { url: "https://p", anonKey: "pk", key: KEY },
    async () => {
      throw new TypeError("fetch failed");
    },
  );
  await assert.rejects(down.token(), Unreachable);
});
```

`sync/test/rest-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { restStore } from "../src/rest-store.ts";
import { KeyRefused, Unreachable } from "../src/store.ts";

const session = { token: async () => "jwt" };
const cfg = { url: "https://p.supabase.co", anonKey: "pk" };

test("RPCs go to /rest/v1/rpc with the identity and the named arguments", async () => {
  const seen: { url: string; auth: string; body: unknown }[] = [];
  const store = restStore(cfg, session, async (url, init) => {
    const h = new Headers(init!.headers);
    seen.push({
      url: String(url),
      auth: h.get("Authorization")!,
      body: JSON.parse(String(init!.body)),
    });
    return new Response(
      JSON.stringify({ run_id: "r1", storage_prefix: "m/w/vault/" }),
      { status: 200 },
    );
  });
  assert.deepEqual(await store.openRun(true), {
    runId: "r1",
    storagePrefix: "m/w/vault/",
  });
  assert.equal(seen[0]!.url, "https://p.supabase.co/rest/v1/rpc/sync_open_run");
  assert.equal(seen[0]!.auth, "Bearer jwt");
  assert.deepEqual(seen[0]!.body, { p_confirm: true });
});

test("a refused identity is KeyRefused; a server error is Unreachable with no words kept", async () => {
  const refused = restStore(
    cfg,
    session,
    async () => new Response("{}", { status: 403 }),
  );
  await assert.rejects(refused.openRun(false), KeyRefused);
  const broken = restStore(
    cfg,
    session,
    async () =>
      new Response(
        JSON.stringify({ code: "22023", message: "a path: secret/x.md" }),
        { status: 400 },
      ),
  );
  await assert.rejects(broken.openRun(false), (e: Error) => {
    assert.ok(e instanceof Unreachable);
    assert.equal(e.message, "sync_open_run answered 400 (22023)");
    return true;
  });
});

test("an upload whose object is already there counts as stored", async () => {
  const urls: string[] = [];
  const store = restStore(cfg, session, async (url, init) => {
    urls.push(String(url));
    assert.equal(new Headers(init!.headers).get("x-upsert"), "false");
    return new Response(
      JSON.stringify({ statusCode: "409", error: "Duplicate" }),
      { status: 400 },
    );
  });
  await store.upload(
    "m/w/vault/ab/Deck v2.html",
    new Uint8Array([1]),
    "application/octet-stream",
  );
  assert.equal(
    urls[0],
    "https://p.supabase.co/storage/v1/object/files/m/w/vault/ab/Deck%20v2.html",
  );
});
```

`sync/test/mac.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, plist } from "../src/mac.ts";

test("the launchd agent runs every 15 minutes and at login", () => {
  const text = plist({
    node: "/opt/node",
    cli: "/repo/sync/src/cli.ts",
    log: "/l/hive-sync.log",
  });
  assert.match(
    text,
    /<key>Label<\/key>\s*<string>ai\.hive-mind\.sync<\/string>/,
  );
  assert.match(text, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  assert.match(text, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(
    text,
    /<string>\/opt\/node<\/string>\s*<string>\/repo\/sync\/src\/cli\.ts<\/string>\s*<string>now<\/string>\s*<string>--scheduled<\/string>/,
  );
});

test("a second run waits for the lock; a stale lock is taken over", () => {
  const file = join(mkdtempSync(join(tmpdir(), "hive-lock-")), "lock");
  const release = acquireLock(file);
  assert.ok(release);
  assert.equal(acquireLock(file), null);
  release!();
  const again = acquireLock(file);
  assert.ok(again);
  again!();
});
```

`sync/test/cli.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.ts";

test("subcommands and flags", () => {
  assert.deepEqual(parseArgs(["now"]), {
    cmd: "now",
    confirmDeletes: false,
    scheduled: false,
  });
  assert.deepEqual(parseArgs(["--confirm-deletes"]), {
    cmd: "now",
    confirmDeletes: true,
    scheduled: false,
  });
  assert.deepEqual(parseArgs(["now", "--scheduled"]), {
    cmd: "now",
    confirmDeletes: false,
    scheduled: true,
  });
  assert.deepEqual(
    parseArgs([
      "setup",
      "--url",
      "https://p",
      "--publishable-key",
      "pk",
      "--folder",
      "/v",
    ]),
    {
      cmd: "setup",
      url: "https://p",
      anonKey: "pk",
      folder: "/v",
    },
  );
  assert.deepEqual(parseArgs(["status"]), { cmd: "status" });
  assert.deepEqual(parseArgs(["uninstall"]), { cmd: "uninstall" });
  assert.deepEqual(parseArgs(["nope"]), { cmd: "help" });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test "sync/test/*.test.ts"`
Expected: the four new files FAIL (modules not found).

- [ ] **Step 3: Implement `session.ts` and `rest-store.ts`**

`sync/src/session.ts`:

```ts
// Signs in at sync-session with the key and keeps the one-hour identity, asking again five
// minutes before it ends, so a long first run never sends an expired one. The key goes only to
// that address; nothing here logs it or the token.
import { KeyRefused, Unreachable } from "./store.ts";

const EARLY_MS = 300_000;

export function syncSession(
  cfg: { url: string; anonKey: string; key: string },
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): { token(): Promise<string> } {
  const base = cfg.url.replace(/\/+$/, "");
  let held: { token: string; until: number } | null = null;
  return {
    async token() {
      if (held && held.until - EARLY_MS > now()) return held.token;
      let res: Response;
      try {
        res = await fetchFn(`${base}/functions/v1/sync-session`, {
          method: "POST",
          headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({ key: cfg.key }),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new Unreachable("sync-session could not be reached");
      }
      if (res.status === 401) throw new KeyRefused("the sync key was refused");
      if (res.status !== 200)
        throw new Unreachable(`sync-session answered ${res.status}`);
      const body = (await res.json()) as {
        access_token?: unknown;
        expires_at?: unknown;
      };
      if (
        typeof body.access_token !== "string" ||
        typeof body.expires_at !== "number"
      ) {
        throw new Unreachable("sync-session answered something else");
      }
      held = { token: body.access_token, until: body.expires_at * 1000 };
      return held.token;
    },
  };
}
```

`sync/src/rest-store.ts`:

```ts
// The Store over Supabase's REST API and Storage, as the sync identity. Every permission is the
// database's: this file only carries the calls. An error keeps the function's name, the status
// and the database's error code, never its message (which may quote a path).
import type {
  Counts,
  FileUp,
  ManifestEntry,
  Moved,
  NoteUp,
  PlanResult,
  PutResult,
  Store,
} from "./store.ts";
import { KeyRefused, Unreachable } from "./store.ts";

type Session = { token(): Promise<string> };

export function restStore(
  cfg: { url: string; anonKey: string },
  session: Session,
  fetchFn: typeof fetch = fetch,
): Store {
  const base = cfg.url.replace(/\/+$/, "");
  const headers = async (extra: Record<string, string>) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${await session.token()}`,
    ...extra,
  });
  const rpc = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    let res: Response;
    try {
      res = await fetchFn(`${base}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: await headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(args),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      if (e instanceof KeyRefused) throw e;
      throw new Unreachable(`${name} could not be reached`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      throw new KeyRefused(`${name} refused the sync key`);
    }
    if (res.status !== 200) {
      let code = "";
      try {
        const body = (await res.json()) as { code?: unknown };
        if (typeof body.code === "string" && /^[0-9A-Z]{5}$/.test(body.code))
          code = ` (${body.code})`;
      } catch {
        // No code to keep.
      }
      throw new Unreachable(`${name} answered ${res.status}${code}`);
    }
    return (await res.json()) as T;
  };

  return {
    async openRun(confirm) {
      const r = await rpc<{ run_id: string; storage_prefix: string }>(
        "sync_open_run",
        { p_confirm: confirm },
      );
      return { runId: r.run_id, storagePrefix: r.storage_prefix };
    },
    async plan(runId, page: ManifestEntry[], last) {
      const r = await rpc<PlanResult | { received: number }>("sync_plan", {
        p_run: runId,
        p_entries: page,
        p_last: last,
      });
      return last ? (r as PlanResult) : null;
    },
    putNotes: (runId, notes: NoteUp[]) =>
      rpc<PutResult>("sync_put_notes", { p_run: runId, p_notes: notes }),
    linkNotes: (runId, pairs: Moved[]) =>
      rpc<number>("sync_link_notes", { p_run: runId, p_pairs: pairs }),
    putFiles: (runId, files: FileUp[]) =>
      rpc<PutResult>("sync_put_files", { p_run: runId, p_files: files }),
    deletePaths: (runId, paths) =>
      rpc<{ deleted: number; refused: number }>("sync_delete", {
        p_run: runId,
        p_paths: paths,
      }),
    async finish(runId, counts: Counts, tooBig, error) {
      await rpc<null>("sync_finish", {
        p_run: runId,
        p_counts: counts,
        p_too_big: tooBig,
        p_error: error,
      });
    },
    async upload(storagePath, bytes, contentType) {
      const path = storagePath.split("/").map(encodeURIComponent).join("/");
      let res: Response;
      try {
        res = await fetchFn(`${base}/storage/v1/object/files/${path}`, {
          method: "POST",
          headers: await headers({
            "Content-Type": contentType,
            "x-upsert": "false",
          }),
          body: bytes,
          redirect: "error",
          signal: AbortSignal.timeout(600_000),
        });
      } catch (e) {
        if (e instanceof KeyRefused) throw e;
        throw new Unreachable("an upload could not be sent");
      }
      if (res.ok) {
        await res.body?.cancel().catch(() => {});
        return;
      }
      let duplicate = res.status === 409;
      try {
        const body = (await res.json()) as { statusCode?: unknown };
        duplicate ||= String(body.statusCode) === "409";
      } catch {
        // Not JSON.
      }
      if (duplicate) return; // the same path and content, stored by an earlier run
      if (res.status === 401 || res.status === 403)
        throw new KeyRefused("an upload was refused");
      throw new Unreachable(`an upload answered ${res.status}`);
    },
  };
}
```

Storage answers a refused policy with 400 or 403 and `statusCode: "403"`. Check `body.statusCode`
for `"403"` as well before treating a 400 as Unreachable, and add a test case for it.

- [ ] **Step 4: Implement `config.ts` and `mac.ts`**

`sync/src/config.ts`:

```ts
// Where the sync keeps its own things on this Mac. The project address and the publishable key
// are not secrets; the sync key is never here (it is in the Keychain).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const dir = join(homedir(), "Library", "Application Support", "hive-sync");
export const paths = {
  dir,
  config: join(dir, "config.json"),
  state: join(dir, "state.json"),
  cache: join(dir, "cache.json"),
  lock: join(dir, "run.lock"),
  log: join(homedir(), "Library", "Logs", "hive-sync.log"),
  agent: join(homedir(), "Library", "LaunchAgents", "ai.hive-mind.sync.plist"),
};

export type Config = { url: string; anonKey: string; folder: string };
export type State = {
  failuresInRow: number;
  /** Phrases already shown, so each is shown once until things change. */
  notified: string[];
  last?: {
    at: string;
    ok: boolean;
    added: number;
    changed: number;
    moved: number;
    deleted: number;
    tooBig: number;
    refused: number;
  };
};

const read = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};
const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
};

export const loadConfig = (): Config | null => read<Config>(paths.config);
export const saveConfig = (c: Config) => write(paths.config, c);
export const loadState = (): State =>
  read<State>(paths.state) ?? { failuresInRow: 0, notified: [] };
export const saveState = (s: State) => write(paths.state, s);
```

`sync/src/mac.ts`:

```ts
// The Mac's own parts: the Keychain item that holds the key, the launchd agent that runs the
// sync, a notification, and the lock that keeps two runs apart. The key never goes on a
// command line: `security` asks for it itself.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
import { paths } from "./config.ts";

export const LABEL = "ai.hive-mind.sync";
const SERVICE = "hive-sync";
const ACCOUNT = "default";

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function plist(o: { node: string; cli: string; log: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(o.node)}</string>
    <string>${xml(o.cli)}</string>
    <string>now</string>
    <string>--scheduled</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(o.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(o.log)}</string>
</dict>
</plist>
`;
}

const uid = () => String(process.getuid?.() ?? "");

export function installAgent(text: string): void {
  mkdirSync(dirname(paths.agent), { recursive: true });
  writeFileSync(paths.agent, text);
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], {
    stdio: "ignore",
  });
  execFileSync("launchctl", ["bootstrap", `gui/${uid()}`, paths.agent]);
}

export function removeAgent(): void {
  spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], {
    stdio: "ignore",
  });
  try {
    unlinkSync(paths.agent);
  } catch {
    // Not there.
  }
}

export function keychainRead(): string | null {
  try {
    const key = execFileSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return /^hsync_[0-9a-f]{64}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** Asks for the key on the terminal (security's own prompt) and stores it. */
export function keychainStore(): boolean {
  const r = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w"],
    {
      stdio: "inherit",
    },
  );
  return r.status === 0;
}

export function keychainDelete(): void {
  spawnSync(
    "security",
    ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT],
    { stdio: "ignore" },
  );
}

/** The only words a notification may carry: fixed phrases with numbers, never a path. */
export type Phrase =
  | "Your sync key was refused. Run hive-sync setup."
  | "Your vault folder is missing. Nothing was synced."
  | "Hive sync has failed 3 times in a row. See the log."
  | `Hive sync held back ${number} deletions. Run hive-sync --confirm-deletes to let them through.`;

export function notify(phrase: Phrase): void {
  spawnSync(
    "osascript",
    ["-e", `display notification "${phrase}" with title "Hive sync"`],
    {
      stdio: "ignore",
    },
  );
}

/** The lock, or null while another run holds it. A lock whose process is gone is taken over. */
export function acquireLock(file: string): (() => void) | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const fd = openSync(file, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(file);
        } catch {
          // Already gone.
        }
      };
    } catch {
      const pid = Number(readFileSync(file, "utf8"));
      let alive = false;
      try {
        if (pid > 0 && pid !== process.pid) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {
        alive = false;
      }
      if (alive || pid === process.pid) return null;
      unlinkSync(file);
    }
  }
  return null;
}
```

In the lock test, the second `acquireLock` in the same process finds its own pid and answers
null. That is the "another run holds it" case for a test; a real second run is another process.

- [ ] **Step 5: Implement `cli.ts`**

```ts
#!/usr/bin/env node
// hive-sync: keeps one Hive workspace equal to one vault folder on this Mac.
//
//   node sync/src/cli.ts setup [--url U] [--publishable-key K] [--folder F]
//   node sync/src/cli.ts now [--confirm-deletes]
//   node sync/src/cli.ts --confirm-deletes
//   node sync/src/cli.ts status
//   node sync/src/cli.ts uninstall
//
// The log gets one line per run: the time and the counts, never a path or a note's text.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  loadState,
  paths,
  saveConfig,
  saveState,
  type State,
} from "./config.ts";
import {
  acquireLock,
  installAgent,
  keychainDelete,
  keychainRead,
  keychainStore,
  notify,
  plist,
  removeAgent,
} from "./mac.ts";
import { restStore } from "./rest-store.ts";
import { runOnce } from "./run.ts";
import { syncSession } from "./session.ts";
import { FolderMissing, KeyRefused } from "./store.ts";

export type Command =
  | { cmd: "now"; confirmDeletes: boolean; scheduled: boolean }
  | { cmd: "setup"; url?: string; anonKey?: string; folder?: string }
  | { cmd: "status" }
  | { cmd: "uninstall" }
  | { cmd: "help" };

export function parseArgs(argv: string[]): Command {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const [first] = argv;
  if (first === "now" || first === "--confirm-deletes") {
    return {
      cmd: "now",
      confirmDeletes: flag("--confirm-deletes"),
      scheduled: flag("--scheduled"),
    };
  }
  if (first === "setup") {
    const out: Command = { cmd: "setup" };
    const url = value("--url");
    const anonKey = value("--publishable-key");
    const folder = value("--folder");
    if (url) out.url = url;
    if (anonKey) out.anonKey = anonKey;
    if (folder) out.folder = folder;
    return out;
  }
  if (first === "status") return { cmd: "status" };
  if (first === "uninstall") return { cmd: "uninstall" };
  return { cmd: "help" };
}

const log = (line: string) => {
  mkdirSync(dirname(paths.log), { recursive: true });
  appendFileSync(paths.log, `${new Date().toISOString()} ${line}\n`);
};

const once = (state: State, phrase: Parameters<typeof notify>[0]) => {
  if (state.notified.includes(phrase)) return;
  notify(phrase);
  state.notified.push(phrase);
};

async function now(confirmDeletes: boolean): Promise<number> {
  const config = loadConfig();
  const key = keychainRead();
  if (!config || !key) {
    log("not set up: run hive-sync setup");
    return 2;
  }
  const release = acquireLock(paths.lock);
  if (!release) {
    log("another run is still going; this one is skipped");
    return 0;
  }
  const state = loadState();
  try {
    const store = restStore(config, syncSession({ ...config, key }));
    const r = await runOnce({
      root: config.folder,
      cachePath: paths.cache,
      store,
      confirmDeletes,
    });
    const c = r.counts;
    log(
      `ok added ${c.added} changed ${c.changed} moved ${c.moved} deleted ${c.deleted} skipped ${c.skipped} too-big ${c.too_big} held-back ${r.refusedDeletes} failed ${r.failed.length} deferred ${r.deferred}`,
    );
    state.failuresInRow = 0;
    state.notified = [];
    if (r.refusedDeletes > 0) {
      notify(
        `Hive sync held back ${r.refusedDeletes} deletions. Run hive-sync --confirm-deletes to let them through.`,
      );
    }
    state.last = {
      at: new Date().toISOString(),
      ok: true,
      added: c.added,
      changed: c.changed,
      moved: c.moved,
      deleted: c.deleted,
      tooBig: c.too_big,
      refused: r.refusedDeletes,
    };
    return 0;
  } catch (e) {
    if (e instanceof KeyRefused) {
      log("stopped: the sync key was refused");
      once(state, "Your sync key was refused. Run hive-sync setup.");
    } else if (e instanceof FolderMissing) {
      log("stopped: the vault folder is missing or unreadable");
      once(state, "Your vault folder is missing. Nothing was synced.");
    } else {
      state.failuresInRow++;
      log(`stopped: ${e instanceof Error ? e.message : "unknown"}`);
      if (state.failuresInRow === 3)
        notify("Hive sync has failed 3 times in a row. See the log.");
    }
    if (state.last) state.last.ok = false;
    return 1;
  } finally {
    saveState(state);
    release();
  }
}

async function setup(c: Extract<Command, { cmd: "setup" }>): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string, given?: string, fallback?: string) =>
    given ??
    ((await rl.question(`${q}${fallback ? ` [${fallback}]` : ""}: `)).trim() ||
      fallback ||
      "");
  const was = loadConfig();
  const url = await ask(
    "Hive address (https://….supabase.co)",
    c.url,
    was?.url,
  );
  const anonKey = await ask("Publishable key", c.anonKey, was?.anonKey);
  const folder = resolve(await ask("Vault folder", c.folder, was?.folder));
  rl.close();
  if (!existsSync(folder)) {
    console.error("That folder does not exist.");
    return 2;
  }
  console.log(
    "Paste the sync key from Settings → Sync when asked (it is not shown).",
  );
  if (!keychainStore()) {
    console.error("The key was not stored in the Keychain.");
    return 2;
  }
  const key = keychainRead();
  if (!key) {
    console.error("That is not a sync key (hsync_ followed by 64 characters).");
    return 2;
  }
  try {
    await syncSession({ url, anonKey, key }).token();
  } catch {
    console.error("The hive refused that key, or could not be reached.");
    return 2;
  }
  saveConfig({ url, anonKey, folder });
  saveState({ failuresInRow: 0, notified: [] });
  const cli = fileURLToPath(import.meta.url);
  installAgent(plist({ node: process.execPath, cli, log: paths.log }));
  console.log(
    "Hive sync is set up: it runs now, every 15 minutes, and at login.",
  );
  return 0;
}

function status(): number {
  const config = loadConfig();
  const state = loadState();
  console.log(
    config ? `Folder: ${config.folder}\nHive: ${config.url}` : "Not set up.",
  );
  console.log(`Key in Keychain: ${keychainRead() ? "yes" : "no"}`);
  if (state.last) {
    const l = state.last;
    console.log(
      `Last run: ${l.at} ${l.ok ? "ok" : "stopped"} (added ${l.added}, changed ${l.changed}, moved ${l.moved}, deleted ${l.deleted}, too big ${l.tooBig}, held back ${l.refused})`,
    );
  }
  console.log("Runs every 15 minutes and at login.");
  if (existsSync(paths.log)) {
    const lines = readFileSync(paths.log, "utf8")
      .trimEnd()
      .split("\n")
      .slice(-5);
    console.log(`Log (${paths.log}):\n${lines.join("\n")}`);
  }
  return 0;
}

function uninstall(): number {
  removeAgent();
  keychainDelete();
  rmSync(paths.dir, { recursive: true, force: true });
  console.log(
    "Hive sync is removed from this Mac. Revoke its key in Settings → Sync.",
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const c = parseArgs(argv);
  if (c.cmd === "now") return now(c.confirmDeletes);
  if (c.cmd === "setup") return setup(c);
  if (c.cmd === "status") return status();
  if (c.cmd === "uninstall") return uninstall();
  console.log(
    "Usage: hive-sync setup | now [--confirm-deletes] | --confirm-deletes | status | uninstall",
  );
  return c.cmd === "help" ? 0 : 2;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

`state.notified = []` after a good run lets a later refusal be shown again. The guard's notice is
sent on every run that holds deletes back, because each such run stores a new list.

- [ ] **Step 6: Run the tests, the typecheck and lint**

Run: `node --test "sync/test/*.test.ts"`, `pnpm --filter @hive-mind/sync typecheck`,
`pnpm format` on `sync/`, then `pnpm lint`.
Expected: PASS.

Finish `sync/README.md` with the subcommands, the files under Application Support and the log.

- [ ] **Step 7: Commit**

```bash
git add sync/src/session.ts sync/src/rest-store.ts sync/src/mac.ts sync/src/config.ts sync/src/cli.ts sync/test/session.test.ts sync/test/rest-store.test.ts sync/test/mac.test.ts sync/test/cli.test.ts sync/README.md
git commit -m "feat(sync): the hive-sync command, its Keychain key and launchd agent"
```

### Task 9: Settings → Sync

Load the `frontend-design` skill first and read `docs/ui-concept.md` (AGENTS.md #3). The tab
follows the Agents tab's look and parts (`AgentsTab.tsx`, `RowMenu.tsx`, `TokenDialog.tsx`,
`settings.module.css`). There is no new visual language.

**Files:**

- Modify: `web/src/settings/types.ts`, `web/src/settings/tabs.ts`, `web/src/settings/text.ts`,
  `web/src/settings/Settings.tsx`, `web/src/settings/fixture.ts`
- Create: `web/src/settings/SyncTab.tsx`, `web/src/settings/sync.test.ts`
- Modify: `web/src/app/settings/load-settings.ts`, `web/src/app/settings/write.ts`,
  `web/src/app/settings/actions.ts`
- Modify: `web/src/settings/tabs.test.ts`, `web/src/app/settings/load-settings.test.ts`,
  `web/src/app/settings/write.test.ts`, `web/e2e/settings.spec.ts`

**Interfaces:**

- Consumes:
  - `sync_keys` (columns `id, workspace_id, created_at, last_used_at, revoked_at`);
  - `sync_runs` (`id, key_id, started_at, finished_at, added, changed, moved, deleted, skipped,
too_big, too_big_paths, refused_deletes, error`);
  - `create_sync_key(p_workspace)`, `revoke_sync_key(p_key)` (Tasks 1, 3).
- Produces:
  - Types:
    - `SyncKey = {id; workspaceId; createdAt; lastUsedAt: string | null; status: "active" |
"revoked"}`;
    - `SyncRun = {id; keyId; startedAt; finishedAt: string | null; added; changed; moved;
deleted; skipped; tooBig; tooBigPaths: string[]; heldBack: number; error: string |
null}`.
  - `SettingsData` gains `syncKeys: SyncKey[]` and `syncRuns: SyncRun[]`.
  - `SettingsActions` gains `createSyncKey(workspaceId) → Created` and `revokeSyncKey(keyId)
→ Result`.
  - `Tab` gains `"sync"`, shown to every member after Workspaces. Its count is the live keys.

- [ ] **Step 1: Write the failing tests**

`web/src/settings/tabs.test.ts`, change the expectations:

```ts
expect(tabsFor(true)).toEqual([
  "agents",
  "workspaces",
  "sync",
  "topics",
  "people",
  "hive",
]);
expect(tabsFor(false)).toEqual(["agents", "workspaces", "sync", "people"]);
expect(tabFromParam("sync", false)).toBe("sync");
```

and add a case to the `tabCount` test: with `syncKeys` holding one active and one revoked key,
`tabCount("sync", d, 0)` is `1`.

`web/src/app/settings/write.test.ts`, following the file's existing stand-in `db` for
`createIn`:

```ts
test("createSyncKeyIn returns the key once and checks the workspace id first", async () => {
  const calls: unknown[] = [];
  const db = standIn({
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return {
        data: [{ key_id: KEY_ID, key: "hsync_" + "c".repeat(64) }],
        error: null,
      };
    },
  });
  expect(await createSyncKeyIn(db, "not-a-uuid")).toEqual({ ok: false });
  expect(calls).toEqual([]);
  expect(await createSyncKeyIn(db, WS_ID)).toEqual({
    ok: true,
    token: "hsync_" + "c".repeat(64),
  });
  expect(calls).toEqual([["create_sync_key", { p_workspace: WS_ID }]]);
});

test("revokeSyncKeyIn revokes by id", async () => {
  const calls: unknown[] = [];
  const db = standIn({
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { data: null, error: null };
    },
  });
  expect(await revokeSyncKeyIn(db, KEY_ID)).toEqual({ ok: true });
  expect(calls).toEqual([["revoke_sync_key", { p_key: KEY_ID }]]);
});
```

Use whatever the file already names its stand-in builder, ids and signed-in helper; the names
above are placeholders for those existing helpers, not new ones.

`web/src/app/settings/load-settings.test.ts`, three assertions:

- the agents query filters out `provider = hive-sync`;
- `sync_keys` is read with `.limit(20)`, newest first;
- `sync_runs` is read for the person's key ids with `.order("started_at", { ascending: false })`
  and `.limit(20)`.

Then `toSyncRun` maps a row to the type above, with `heldBack =
refused_deletes.length` and `tooBigPaths` capped at 200.

`web/src/settings/sync.test.ts` (pure helpers in `SyncTab.tsx`'s companion module
`web/src/settings/text.ts`):

```ts
import { describe, expect, test } from "vitest";
import { setupCommand, runSummary } from "./text";

describe("sync text", () => {
  test("the setup command names the address, the publishable key and no secret", () => {
    const c = setupCommand("https://p.supabase.co", "sb_publishable_x");
    expect(c).toBe(
      'node sync/src/cli.ts setup --url https://p.supabase.co --publishable-key sb_publishable_x --folder "<your vault folder>"',
    );
  });
  test("a run's summary is counts only", () => {
    expect(
      runSummary({
        added: 3,
        changed: 1,
        moved: 0,
        deleted: 2,
        tooBig: 1,
        heldBack: 0,
        error: null,
      }),
    ).toBe("3 added · 1 changed · 2 deleted · 1 too big");
    expect(
      runSummary({
        added: 0,
        changed: 0,
        moved: 0,
        deleted: 0,
        tooBig: 0,
        heldBack: 40,
        error: null,
      }),
    ).toBe("No changes · 40 deletions held back");
  });
});
```

`web/e2e/settings.spec.ts`, against `/dev/settings` with the fixture:

- opens the Sync tab and sees a row per workspace;
- "Make a sync key" shows the key dialog with the setup command;
- "Done" closes it;
- the latest run's too-big list is shown.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @hive-mind/web test -- settings`
Expected: FAIL (no `sync` tab, no `createSyncKeyIn`, no `setupCommand`).

- [ ] **Step 3: Implement**

- **`types.ts`:** add the two types and the two `SettingsData` fields, plus the two actions on
  `SettingsActions`.
- **`tabs.ts`:**
  - `Tab` gains `"sync"`, and `TAB_NAMES.sync = "Sync"`.
  - `tabsFor` returns `["agents", "workspaces", "sync", "topics", "people", "hive"]` for an
    owner and `["agents", "workspaces", "sync", "people"]` for a member.
  - The `tabCount` case `"sync"` is `d.syncKeys.filter((k) => k.status === "active").length`.
- **`text.ts`** (the screen's words live here; `no-literals.test.ts` enforces it):

```ts
export const SYNC_INTRO =
  "Keep one workspace equal to a vault folder on your Mac. The folder is the source: notes from it are read-only here.";
export const SYNC_MAKE = "Make a sync key";
export const SYNC_REVOKE = "Revoke sync key";
export const SYNC_NONE = "No sync key";
export const SYNC_LAST_USED = "Last used";
export const SYNC_NEVER = "Not used yet";
export const SYNC_RUNS = "Recent runs";
export const SYNC_TOO_BIG = "Too big to sync (over 50 MB, or a note over 1 MB)";
export const SYNC_NEW_KEY_REVOKES =
  "Making a key revokes this workspace's current one. The Mac then needs the new key.";
export const SYNC_KEY_TITLE = "Your sync key";
export const SYNC_KEY_STEP =
  "Run this in the Hive Mind folder on your Mac, then paste the key when asked:";

export function setupCommand(url: string, publishableKey: string): string {
  return `node sync/src/cli.ts setup --url ${url} --publishable-key ${publishableKey} --folder "<your vault folder>"`;
}

export function runSummary(r: {
  added: number;
  changed: number;
  moved: number;
  deleted: number;
  tooBig: number;
  heldBack: number;
  error: string | null;
}): string {
  const parts = [
    r.added && `${r.added} added`,
    r.changed && `${r.changed} changed`,
    r.moved && `${r.moved} moved`,
    r.deleted && `${r.deleted} deleted`,
    r.tooBig && `${r.tooBig} too big`,
  ].filter(Boolean) as string[];
  const head = parts.length ? parts.join(" · ") : "No changes";
  const held = r.heldBack ? ` · ${r.heldBack} deletions held back` : "";
  const err = r.error ? ` · stopped: ${r.error}` : "";
  return `${head}${held}${err}`;
}
```

- **`TokenDialog.tsx`:** it is shown for agent tokens. Give it an optional `variant: "agent" |
"sync"` prop:
  - `"sync"` titles it `SYNC_KEY_TITLE` and shows `SYNC_KEY_STEP` with
    `setupCommand(url, publishableKey)` in place of the MCP line;
  - its guarantees stay as they are (shown once, Done only, nothing stored or logged).
  - The project address and the publishable key come from the same public env the web app
    already reads for Supabase (`NEXT_PUBLIC_SUPABASE_URL` and its publishable key; see
    `web/src/lib/supabase/`).
- **`SyncTab.tsx`:**
  - One row per own workspace: its name, the key state (`SYNC_NONE`, or made and last used),
    and a `RowMenu` with `SYNC_MAKE` or `SYNC_REVOKE`.
  - Making a key when one is live first says `SYNC_NEW_KEY_REVOKES` in the same confirm
    pattern `AgentsTab` uses for revoking.
  - Below the rows: `SYNC_RUNS`, the last 20 runs, each with its time, duration and
    `runSummary(...)`. Then `SYNC_TOO_BIG`, with the latest run's `tooBigPaths` as a plain list.
  - All of this is client state over `SettingsData`. Opening the tab makes no request.
- **`Settings.tsx`:** render `SyncTab` for `tab === "sync"`. It holds the sync key in the same
  state slot and guard as an agent's token (reload, close and Back are held off while it is
  shown).
- **`load-settings.ts`:**
  - In the existing parallel batch, the agents query gains `.neq("provider", "hive-sync")`.
  - Add two reads:

```ts
db
  .from("sync_keys")
  .select("id, workspace_id, created_at, last_used_at, revoked_at")
  .order("created_at", { ascending: false })
  .limit(20),
```

- Then, after that batch, one read of runs for the returned key ids, when there are any:

```ts
db
  .from("sync_runs")
  .select("id, key_id, started_at, finished_at, added, changed, moved, deleted, skipped, too_big, too_big_paths, refused_deletes, error")
  .in("key_id", keyIds)
  .order("started_at", { ascending: false })
  .limit(20),
```

- Map the rows with `toSyncKey` and `toSyncRun`, written beside `toAgent` in the same
  defensive style: every field checked, a malformed row dropped.
- **`write.ts`:** `createSyncKeyIn(db, workspaceId)` and `revokeSyncKeyIn(db, keyId)`, written
  exactly as `createIn` and `revokeIn` are (uuid check, `signedIn`, `rpc`, `failed`, a fixed
  log phrase, the key returned once and never logged).
- **`actions.ts`:** `createSyncKey` and `revokeSyncKey` server actions through `withSession`,
  with `{ ok: false }` as the fallback.
- **`fixture.ts`:** two workspaces, one live key used an hour ago, one revoked key, and three
  runs. The latest run has `too_big_paths: ["talks/keynote.key"]` and one held-back delete
  list of 40. Add the dev page's actions for the two new calls.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @hive-mind/web test`, then
`pnpm --filter @hive-mind/web exec playwright test e2e/settings.spec.ts`.
Expected: PASS. If port 3100 is taken by another worktree's server, run Playwright with a
config pointed at a free port, as the earlier rail fix did. Do not stop another session's
server.

Screenshot the Sync tab in two themes (Honey and Paper) at desktop and phone width, look at
them, and fix what reads badly before committing (memory: look first).

- [ ] **Step 5: Commit**

```bash
git add web/src/settings/types.ts web/src/settings/tabs.ts web/src/settings/text.ts web/src/settings/Settings.tsx web/src/settings/SyncTab.tsx web/src/settings/TokenDialog.tsx web/src/settings/fixture.ts web/src/settings/sync.test.ts web/src/settings/tabs.test.ts web/src/app/settings/load-settings.ts web/src/app/settings/load-settings.test.ts web/src/app/settings/write.ts web/src/app/settings/write.test.ts web/src/app/settings/actions.ts web/e2e/settings.spec.ts
git commit -m "feat(settings): Sync tab: make and revoke a sync key, see recent runs"
```

### Task 10: The vault's markers in Vault and Gallery

Load `frontend-design` and read `docs/ui-concept.md` first.

**Files:**

- Modify: `web/src/app/vault/load-vault.ts`, `web/src/vault/types.ts`, `web/src/vault/Preview.tsx`,
  `web/src/vault/fixture.ts`, `web/src/vault/sentences.ts` (or the file the vault keeps its
  words in)
- Modify: `web/src/app/gallery/load-gallery.ts`, `web/src/gallery/types.ts`,
  `web/src/gallery/FilePanel.tsx`, `web/src/gallery/Gallery.tsx` (the session grouping),
  `web/src/gallery/text.ts`, `web/src/gallery/fixture.ts`
- Tests: `web/src/app/vault/load-vault.test.ts`, `web/src/app/gallery/load-gallery.test.ts`,
  `web/e2e/vault-open.spec.ts`, `web/e2e/gallery.spec.ts`

**Interfaces:**

- Consumes: `notes.synced_by`, `files.vault_path`, `files.synced_by` (Task 1).
- Produces:
  - The vault note type gains `fromVault: boolean`.
  - The gallery file type gains `fromVault: boolean`.
  - The "By session" groups gain a group with `session: "vault"`.

- [ ] **Step 1: Write the failing tests**

- `load-vault.test.ts`: a note row with `synced_by` set maps to `fromVault: true`, and one
  without it to `false`. `NOTE_COLUMNS` includes `synced_by`.
- `load-gallery.test.ts`: a file row with `vault_path` set maps to `fromVault: true`.
  `vault_path` is read and never passed to the browser as a path: only the boolean.
- `web/src/gallery/filters.test.ts`, or whichever test covers the grouping that
  `SessionStream` draws:
  - files with `fromVault` and no session form one group headed "From your vault", placed
    before "No session";
  - other files with no session stay under "No session".
- `vault-open.spec.ts`: on `/dev/vault`, the fixture's synced note shows "From your vault on
  your Mac · edit it in your vault". Its menu has no item that changes its path or text.
- `gallery.spec.ts`: on `/dev/gallery`, a synced file's panel shows "Home note set by your
  vault" in place of the "Change home note" button.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @hive-mind/web test -- vault gallery`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`load-vault.ts`:** add `synced_by` to `NOTE_COLUMNS`. In the mapper:
  `fromVault: typeof r.synced_by === "string"`. The key id itself is not passed on.
- **`Preview.tsx`:** where the note's header shows its source line, a `fromVault` note shows
  the marker words. Hide any control in `NoteMenu.tsx` that would change a note's text or path
  (if one exists; today the menu shares, attaches topics and deletes, and all of that stays).
  The database refuses such a change anyway; the screen just does not offer it.
- **`load-gallery.ts`:** add `vault_path` to the file columns. In the mapper:
  `fromVault: typeof r.vault_path === "string"`. Drop `vault_path` after mapping, so it never
  reaches the browser.
- **`FilePanel.tsx`:** when `file.fromVault`, pass `home` as a short text line with the gallery
  text constant `HOME_FROM_VAULT = "Home note set by your vault"` in place of the button.
- **Grouping** (where `Group[]` is built for `SessionStream`): split the no-session files into
  `fromVault` and the rest. Add `{ session: "vault", files }` before the `null` group when it is
  not empty. `SessionStream` draws the heading `VAULT_GROUP = "From your vault"` for it.
- **Fixtures:**
  - the vault fixture: one note with `fromVault: true`;
  - the gallery fixture: two files with `fromVault: true`, one of them an `.html` deck.

- [ ] **Step 4: Run the tests and look**

Run: `pnpm --filter @hive-mind/web test`, then the two e2e specs (see Task 9's note on ports).
Screenshot the marked note and the gallery group in Honey and Paper. Look at them and fix what
reads badly.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/vault/load-vault.ts web/src/app/vault/load-vault.test.ts web/src/vault web/src/app/gallery/load-gallery.ts web/src/app/gallery/load-gallery.test.ts web/src/gallery web/e2e/vault-open.spec.ts web/e2e/gallery.spec.ts
git commit -m "feat(web): mark what the vault keeps in Vault and Gallery"
```

Before staging the two folders, run `git status`, and stage only files this task changed.

### Task 11: Hosted rollout and the first live run (with Danijel)

This task changes the hosted database and runs against the real vault. Each step marked
**(ask)** needs Danijel's yes in chat first.

**Files:**

- Modify: `docs/hosted-db-bringup.md` ("Current state": the vault_sync migration, the
  `sync-session` function, the purge change)
- Modify: `docs/superpowers/specs/2026-11-26-vault-sync-design.md` (`status: shipped` once
  merged)
- Create: a vault session note through `/wrapup`

- [ ] **Step 1: Close the branch.** Run every gate (`pnpm typecheck && pnpm lint && pnpm test &&
pnpm build`), then `scripts/finish-task.sh` from the worktree. Expected: `task/vault-sync` is
      merged into `develop` and the worktree is removed.
- [ ] **Step 2 (ask): Apply the migration to the hosted database.** Use the same command
      `docs/hosted-db-bringup.md` records for the gallery migrations (`supabase db push` with the
      linked project). Expected: `supabase migration list` shows the vault_sync stamp on both
      sides.
- [ ] **Step 3 (ask): Deploy the two functions.**

```bash
supabase functions deploy sync-session --use-api --no-verify-jwt --project-ref tokyttkztrkjvkaksdnh
supabase functions deploy purge-hives --use-api --no-verify-jwt --project-ref tokyttkztrkjvkaksdnh
```

Check: `curl -s -o /dev/null -w '%{http_code}' -X POST https://tokyttkztrkjvkaksdnh.supabase.co/functions/v1/sync-session -d '{}'`
answers `400`. `sync-session` reuses `AGENT_SIGNING_JWK` and `HIVE_PUBLISHABLE_KEY`, which are
already set as function secrets; no new secret.

- [ ] **Step 4 (ask): Deploy the web app** from `develop` by the Netlify procedure in memory
      (`netlify-deploy-from-clean-path`): draft from a detached scratchpad worktree, check `/login`
      200, `/gallery` 307 and `/mcp` 401, then publish.
- [ ] **Step 5: Danijel makes the key.** In Settings → Sync he chooses "Make a sync key" for
      workspace `Main`, then runs the shown command in `~/Dev/Hive_Mind` with `--folder
"$HOME/Dev/DRA Vault/DRA (Drones, Robotics, AI)"`, and pastes the key into the Keychain
      prompt. The key is his to paste: never ask for it in chat.
- [ ] **Step 6: Watch the first runs.** Run `node sync/src/cli.ts status` and read the log
      lines.
  - Expected on the first run: 1,641 notes adopted, sent once and planned as changed. Their
    text is unchanged, so no new version unless it differs.
  - Expected: 3 notes and about 12,500 files to go up, at most about 2 GB a run. `file-index.md`
    is listed as too big.
  - Check in the app: `Uploads.md` is untouched, a synced note shows the marker, and synced
    files sit under "From your vault".
- [ ] **Step 7: The hand checks** (the spec's §4).
  - Add, edit, rename and delete one file each in the vault. After the next run (or
    `node sync/src/cli.ts now`), the app shows each change. The renamed note keeps its links
    and sharing.
  - In a copy folder, trip the guard: move 30 notes out, then run. Expected: a notification,
    and nothing deleted. Then `node sync/src/cli.ts --confirm-deletes`: the 30 go. Move them
    back afterwards; they return as new notes.
- [ ] **Step 8: Wrap up.**
  - Mark the spec shipped and update `docs/hosted-db-bringup.md`.
  - Run `/wrapup`. Its "How to test" section holds Steps 5 to 7, and the north-star's stale
    Branch line is fixed there.
  - Commit and push `develop`. Promote to `main` only when Danijel asks.

## Self-review (done while writing)

- **Spec coverage:**

  | Spec item                         | Task                                                |
  | --------------------------------- | --------------------------------------------------- |
  | `hive-sync` subcommands           | 8                                                   |
  | launchd every 15 min and at login | 8                                                   |
  | Keychain                          | 8                                                   |
  | fingerprint cache                 | 6                                                   |
  | skip rules                        | 6                                                   |
  | 50 MB listing                     | 7                                                   |
  | lock                              | 8                                                   |
  | logs                              | 8                                                   |
  | notifications                     | 8                                                   |
  | migration                         | 1, 2, 3, 5                                          |
  | `sync-session`                    | 4                                                   |
  | Settings → Sync                   | 9                                                   |
  | Vault marker                      | 10                                                  |
  | Gallery marker                    | 10                                                  |
  | the run's eight steps             | 7                                                   |
  | interruption-safety               | 7, test "an interrupted run"                        |
  | first-run numbers                 | 11                                                  |
  | keys                              | 1                                                   |
  | what the identity may do          | 1: walls; 2, 3: functions                           |
  | columns                           | 1                                                   |
  | read-only notes                   | 1                                                   |
  | adoption                          | 2                                                   |
  | guard                             | 3                                                   |
  | audit                             | 2 (moves), 3 (deletes, file moves)                  |
  | runs and trimming                 | 3                                                   |
  | purge                             | 3 (test), with cascades from Task 1                 |
  | errors                            | 7 (runner), 8 (CLI)                                 |
  | status                            | 8, 9                                                |
  | budget                            | header                                              |
  | tests                             | every task                                          |
  | dedupe by fingerprint             | replaced by refinement 2 (`storage_path` is unique) |
  | audit `sync_key_id` on deletes    | through the agent id (refinement 4)                 |

- **Type consistency:**
  - The `Store` method names and JSON keys match the SQL function arguments: `p_run`,
    `p_entries`, `p_last`, `p_notes`, `p_pairs`, `p_files`, `p_paths`, `p_counts`,
    `p_too_big`, `p_error`, `p_confirm`, `p_key`, `p_workspace`.
  - The JSON keys sent are `path`, `sha256`, `size`, `home`, `from`, `storage_path`, `name`,
    `mime`, `title`, `body`, `frontmatter`, `created_at` and `updated_at`.
  - `Counts` keys equal `sync_finish`'s `_sync_count` keys.
- **Known risks for the implementer:**
  - PGlite's support for `auth.jwt() ? 'sync_key_id'` (jsonb `?`): if it fails, use
    `auth.jwt() -> 'sync_key_id' is not null`.
  - Storage's refusal shape (Task 8 note).
  - `files_set_kind` firing on update (Task 3 note).
  - The Settings e2e port (Task 9 note).
