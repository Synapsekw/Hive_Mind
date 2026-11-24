# Link Behaviours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A declined pair of notes can never be proposed again, decline answers proposals only,
and ending an accepted link is a separate Unlink action in the vault.

**Architecture:** The rules live in one new migration (trigger check, unique pair index,
`respond_to_link` rewritten, new `unlink` and `note_links`). The vault reads `note_links` with
the open note and calls `unlink` through a server action. The MCP server only changes a
description.

**Tech Stack:** Postgres (PGlite in tests, `node --test`), Next.js server actions, Vitest,
Playwright, TypeScript MCP server.

Spec: `docs/superpowers/specs/2026-11-24-link-behaviours-design.md`. Read it first.

## Global Constraints

- Sharing is decided in the database. No permission logic in `web/` or `mcp/`.
- Never edit a shipped migration. All SQL goes in
  `supabase/migrations/20261124074246_link_behaviours.sql` (already minted, empty).
- Security-definer functions use `set search_path = ''` and schema-qualified names.
- Every new function refuses an app pass (`public.jwt_oauth_client() is not null`) and, where a
  person must decide, an agent (`public.jwt_agent_id() is not null`) or no user.
- Revoke execute from `public` and `anon`; grant to `authenticated` (follow the pattern at the
  end of `20261123174149_emailed_invitations.sql`).
- Web: no new colours, fonts or layout; reuse the vault's classes. User-facing strings live in
  the module's text file (`no-literals.test.ts` enforces it).
- Subagents do not run git and do not commit. The orchestrator commits.
- TDD: write the failing test, see it fail, implement, see it pass.
- Browser tests use port 3100; do not start a second dev server on it.

## Contracts (fixed; every task builds against these)

```sql
-- trigger public.links_before_insert(): before anything else
--   an existing row for the pair, either direction:
--     status = 'declined'  -> raise exception 'this link was declined'
--     otherwise            -> raise exception 'these notes already have a link'
create unique index links_pair_idx on public.links
  (least(from_note, to_note), greatest(from_note, to_note));
alter table public.links
  add column ended_at timestamptz,
  add column ended_by uuid references public.members on delete set null;

public.respond_to_link(p_link uuid, p_accept boolean) returns public.link_status
  -- decline of an accepted link: raise 'this link is accepted; unlink it instead'
  -- decline of a declined link: return 'declined', no change, no audit row
  -- decline: status declined, ended_at now(), ended_by caller's member, audit 'link.declined'
  -- accept that completes the link: audit 'link.accepted'
public.unlink(p_link uuid) returns void
  -- 'an app pass cannot do this' / 'only a person can unlink notes'
  -- not an owner of either note, or no such link: 'link not found'
  -- status <> 'accepted': 'this link is not accepted'
  -- two owners: status declined, ended_at, ended_by, audit 'link.unlinked'
  -- one owner on both sides: delete the row, audit 'link.unlinked'
public.note_links(p_note uuid)
  returns table (id uuid, note_id uuid, title text, owner text, mine boolean)
  -- accepted links of p_note where the caller owns at least one side; other note described;
  -- order by created_at desc, id; limit 50; agent or app pass or no user: no rows
-- audit_log row: hive_id, member_id = acting member, note_id = the caller's note in the link
-- (for one owner: from_note), detail = jsonb_build_object('link', id, 'other_note', id)
```

```ts
// web/src/vault/types.ts
export type NoteLink = {
  id: string;
  note_id: string;
  title: string;
  owner: string;
  mine: boolean;
};
// VaultData.open's note variant becomes { note; body; cut; links: NoteLink[] }
// VaultActions gains: unlink(linkId: string): Promise<Result>;
// web/src/app/vault/write.ts
export async function unlinkIn(db: Db, linkId: unknown): Promise<Result>; // rpc("unlink", { p_link })
// web/src/app/vault/actions.ts
export async function unlink(linkId: string): Promise<Result>;
```

---

### Task 1: Migration and database tests

**Files:**

- Modify: `supabase/migrations/20261124074246_link_behaviours.sql`
- Modify: `tests/sharing-rules.test.mjs` (new tests near the existing link tests; fix any
  existing test that relied on the old behaviour, saying which in the report)
- Check: `scripts/demo.mjs`, `scripts/local-db.mjs`, `tests/*.mjs` for inserts into `links`
  that the new rule refuses

**Interfaces:** Produces the SQL contract above. Consumes nothing.

- [ ] Read `respond_to_link` in `20261123150712_connected_apps.sql` (the current version),
      `links_before_insert` in `20261120000002_sharing_rules.sql` and the link tests at
      `tests/sharing-rules.test.mjs:150-260` and `:2013-2210`.
- [ ] Write failing tests, one behaviour each:
  - reverse proposal after a decline is refused with `this link was declined`
  - reverse proposal while one is proposed or accepted is refused with
    `these notes already have a link`
  - an agent's reverse proposal after a decline is refused the same way
  - the pair index refuses a reversed row even with the trigger disabled (insert as the table
    owner with `session_replication_role = replica`, or the helper the file already has)
  - declining an accepted link raises; the link stays accepted and both still read
  - declining twice returns `declined` and writes one audit row
  - decline stamps `ended_at`, `ended_by`; audit `link.declined` with the detail shape
  - the completing accept writes audit `link.accepted`; the first accept of two does not
  - `unlink`: by either owner; the other person can no longer read the unlinked note
    (`select` returns no row) and it leaves `map_graph` links; audit `link.unlinked`
  - `unlink` refused for: an agent, an app pass, a member who owns neither note
    (`link not found`), a proposed link and a declined link (`this link is not accepted`)
  - after `unlink` the pair cannot be proposed again, either direction
  - a same-owner link is unlinked by deleting the row and can be inserted again
  - `note_links`: returns the other note's title and owner for each side's owner, `mine`
    false; for a same-owner link `mine` true; nothing for proposed or declined links; nothing
    for a third member, an agent or an app pass; capped at 50
  - anon and public cannot execute `unlink` or `note_links`
- [ ] Run `node --test tests/sharing-rules.test.mjs`; see them fail for the right reason.
- [ ] Write the migration per the contract, with a header comment in the style of the other
      migrations (what it adds, what it leaves alone).
- [ ] Run `pnpm test`; all database tests pass. Run `node scripts/demo.mjs` if `pnpm test`
      does not cover it.
- [ ] Report: tests added, any existing test changed and why.

### Task 2: Vault list and Unlink

**Files:**

- Modify: `web/src/vault/types.ts`, `web/src/vault/Preview.tsx`, `web/src/vault/sentences.ts`
  (or the file the vault keeps its strings in), `web/src/vault/fixture.ts`,
  `web/src/vault/vault.module.css` (only if an existing class does not fit),
  `web/src/vault/Vault.tsx` (pass the action through)
- Modify: `web/src/app/vault/load-vault.ts`, `write.ts`, `actions.ts`, `page.tsx`, and the dev
  page under `web/src/app/dev/vault/`
- Test: `web/src/app/vault/load-vault.test.ts`, `write.test.ts`,
  `web/src/vault/sentences.test.ts`, `web/e2e/vault.spec.ts`

**Interfaces:** Consumes `note_links` and `unlink` (SQL contract). Produces the TS contract.

- [ ] Before any UI: load the `frontend-design` skill, read `docs/ui-concept.md` (vault
      section) and how `Preview.tsx` renders the Delete confirmation. Reuse that pattern.
- [ ] Failing unit tests:
  - `load-vault`: `note_links` is called once with the open note's id, in the same batch as
    the note (no call when no note is open); rows map to `NoteLink`; a failed `note_links`
    read gives `links: []` and still returns the note; malformed rows are dropped
  - `write`: `unlinkIn` rejects a non-uuid without a query, rejects without a user, calls
    `rpc("unlink", { p_link })` in lower case, `{ok:false}` on an error, `{ok:true}` otherwise;
    the error message is not returned to the caller
  - `sentences`: the two confirmation sentences, with the owner's name
- [ ] Implement load, write, action, types, fixture (one linked note with a colleague, one
      same-owner link).
- [ ] `Preview`: "Linked with" list under the sharing control, only when not empty. Each row:
      title as a link to `?note=<note_id>`, owner, **Unlink**. Unlink opens the in-place
      confirmation (**Unlink** / **Keep**); while the action runs the buttons are disabled; on
      `{ok:false}` show the vault's existing failure line; on success `router.refresh()`.
      Keyboard: the confirmation moves focus to **Keep**; Escape keeps.
- [ ] Browser tests on the dev page: the list shows; Unlink then Keep leaves it; Unlink then
      Unlink removes the row; a note with no links shows no heading; the confirmation names
      the owner. Run `pnpm --filter @hive-mind/web test` and the vault e2e spec.
- [ ] Report what was built and any class added.

### Task 3: MCP description, inbox wording, docs

**Files:**

- Modify: `mcp/src/tools.ts` (description of `hive_propose_link` only; add: "A pair a person
  declined or unlinked cannot be proposed again.")
- Modify: `web/src/inbox/text.ts` and `text.test.ts` (Decline confirmation gains "It cannot be
  proposed again.")
- Modify: `docs/security.md` (links: one per pair, decline final, Unlink, the three audit
  actions, people only), `docs/ui-concept.md` (vault: Linked with and Unlink; inbox wording),
  `docs/prd.md` if it describes declining, `README.md`/`docs/README.md` only if they describe
  the handshake

**Interfaces:** Consumes the spec wording. Produces nothing other tasks read.

- [ ] Failing test for the inbox sentence, then the change.
- [ ] Docs in plain language, matching what the spec says shipped. Run `pnpm lint`.

---

## Execution DAG

- Dependencies: Task 1, Task 2 and Task 3 depend only on the contracts in this plan. No task
  depends on another task's files.
- **Batch 1 (parallel):** Task 1, Task 2, Task 3. File sets do not overlap, so they share the
  one worktree.
- **Batch 2 (orchestrator):** review each task against the spec, run a security review of the
  migration, run the four gates plus the browser tests, commit, `scripts/finish-task.sh`.
- **Batch 3 (orchestrator):** check the hosted project for pairs with rows in both directions,
  apply the migration with `supabase db query --linked -f`, record the version, deploy the
  site, smoke test.
- Critical path: Task 2 (the longest single task), then review and gates.

## Performance and data budget

- Vault index, map, inbox first paint: no new query.
- Open a note: `note_links`, in parallel with the note read, at most 50 rows, by
  `unique (from_note, to_note)` and `links_to_idx`.
- Unlink: one rpc, then the existing refresh. No client cache to invalidate.
- Link insert: one indexed existence check in the trigger; the pair index adds one index write.
