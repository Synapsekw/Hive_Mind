# Delete a note — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person deletes one of their own notes in the vault, for good, after a deliberate
second click; the audit log records it.

**Architecture:** The existing `notes_delete` policy stays the boundary. One migration adds a
before-delete trigger that writes `note.deleted` to the audit log. A server action deletes by
id through the person's session; the preview pane gets a two-step Delete.

**Tech stack:** Postgres (PGlite in tests), Next.js App Router (`web/`), CSS Modules on the
theme tokens, node:test, Vitest, Playwright.

Spec: [`docs/superpowers/specs/2026-11-23-delete-note-design.md`](../specs/2026-11-23-delete-note-design.md).

## Global constraints

- The migration is minted with `scripts/new-migration.sh note_delete_audit`. No shipped
  migration is edited; the `notes_delete` policy is not touched; nothing in `mcp/` changes.
- Only the note's owner, signed in as a person, deletes. No permission logic in `web/`.
- The audit row holds the note's id and two counts, never its path, title or body. Server logs
  hold an error's code and message only.
- The trigger must not break any delete that works today (a workspace, a member, a hive, a
  service delete).
- Look: tokens only, the inbox's Decline as the model for the confirm, fits 1100 × 560, works at
  390 wide.
- Tests first, seen failing. Stage by path; conventional commits with a lower-case subject and
  the `Co-Authored-By` line. Subagents in a parallel batch do not commit.

## Contract shared between tasks

`web/src/vault/types.ts`: `VaultActions` gains `deleteNote(noteId: string): Promise<Result>`.

Sentences (`web/src/vault/sentences.ts`):

- `DELETE_QUESTION` = "Delete this note? It is gone for good, with its history and its links.
  Files attached to it stay in the gallery."
- `DELETED` = "Note deleted."
- `DELETE_FAILED` = "That didn't work. Try again."

Database: `delete from public.notes where id = $1` as the person; audit action `note.deleted`,
`detail = { "links": int, "files": int }`.

---

### Task 1: Migration and database tests

**Files:** create `supabase/migrations/<stamp>_note_delete_audit.sql`; modify
`tests/sharing-rules.test.mjs` (append `// ------- deleting a note`).

- [ ] **Tests first:**
  1. a person deletes their own note: the note, its versions, its links (one accepted, one
     proposed, in both directions) and its topic tags are gone; a file attached to it remains
     with `note_id` null;
  2. one `audit_log` row: action `note.deleted`, the note's id, the person's member id, detail
     exactly `{ links: 2, files: 1 }`; no value in the row contains the note's path, title or
     body;
  3. refused, nothing changed and no audit row: the owner's agent, another member of the hive
     (also when the note is shared with them), another hive's owner, anon;
  4. the audit row is readable by the hive's owner only;
  5. a delete with no person (`db.query` as the database owner) removes the note and writes no
     audit row;
  6. deleting a workspace as its person removes its notes and writes one row per note;
     deleting a member and deleting a whole hive (as the database owner) still succeed.
- [ ] See them fail; mint and write the migration:

```sql
create function public.notes_deleted_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or not exists (select 1 from public.hives h where h.id = old.hive_id) then
    return old;
  end if;
  insert into public.audit_log (hive_id, member_id, agent_id, action, note_id, detail)
  values (
    old.hive_id,
    (select m.id from public.members m
      where m.hive_id = old.hive_id and m.user_id = v_uid),
    public.jwt_agent_id(),
    'note.deleted',
    old.id,
    jsonb_build_object(
      'links', (select count(*) from public.links l
                 where l.from_note = old.id or l.to_note = old.id),
      'files', (select count(*) from public.files f where f.note_id = old.id)));
  return old;
end
$$;

create trigger notes_deleted_audit before delete on public.notes
  for each row execute function public.notes_deleted_audit();

revoke all on function public.notes_deleted_audit() from public, anon, authenticated;
```

Where this does not fit the shipped schema, follow the schema and keep the contract. If the
before trigger makes any existing delete fail (test 6), fix the trigger, not the test.

- [ ] All database tests pass; `pnpm test` green.

### Task 2: Server action

**Files:** modify `web/src/app/vault/write.ts`, `write.test.ts`, `actions.ts`, `page.tsx`.

- [ ] **Tests first** for `deleteNoteIn(db, id)`: a non-uuid or non-string → not ok, no query;
      no session → not ok, no query; the query is `from("notes").delete().eq("id", id)
.select("id")`; one row → ok; zero rows, an error, or a malformed answer → not ok; an error
      logs code and message only.
- [ ] Implement in the style of `releaseIn`; add `deleteNote` to `actions.ts`; pass it from
      `page.tsx`.

### Task 3: Screen, dev page, browser tests

**Files:** modify `web/src/vault/types.ts`, `sentences.ts` (+test), `Preview.tsx`, `Vault.tsx`,
`vault.module.css`, `web/src/app/dev/vault/DevVault.tsx`, `page.tsx`, `web/e2e/vault.spec.ts`.

- [ ] **Browser tests first:**
  1. your own open note has Delete; a colleague's note has none;
  2. Delete shows `DELETE_QUESTION` with Delete and Keep; Keep puts everything back, focus on
     Delete;
  3. a double-click on Delete does not delete (at 390, 700 and 1600 wide); a second click after
     600 ms does: `deleteNote(id)` is called once, the tab closes, the row leaves the list,
     `DELETED` is announced, focus is in the note list;
  4. `?fail=1`: `DELETE_FAILED`, the note stays, the confirm is closed;
  5. keyboard: Tab reaches Delete after the sharing control; Escape answers Keep;
  6. the page does not scroll at 1100 × 560 with the question showing.
- [ ] See them fail; implement. `router.refresh()` after success and after failure. The dev page
      removes the note from its own sample data and records the call on `window.__vaultCalls`.
- [ ] Screenshots (question showing; dark and light; 1100 × 560 and 390) into the scratchpad;
      look and fix.

### Task 4: Hosted database, docs, gates, review

- [ ] Whole-branch review with the spec's review focus; one fix wave.
- [ ] Apply the migration to the hosted project through the Supabase MCP, re-stamp its version
      ([[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]), check the trigger
      exists.
- [ ] Docs: `README.md`, `docs/security.md` (audit actions; what a delete removes),
      `docs/ui-concept.md` (vault), `docs/hosted-db-bringup.md` (the migration).
- [ ] Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, all browser tests.
- [ ] `scripts/finish-task.sh`; walkthrough; `/wrapup`.

---

## Execution DAG

- **Edges:** Tasks 1, 2 and 3 depend only on the contract above. Task 4 → Tasks 1, 2, 3.
- **Batch A (parallel, three agents):** Task 1 (`supabase/`, `tests/`) ∥ Task 2
  (`web/src/app/vault/`) ∥ Task 3 (`web/src/vault/`, `web/src/app/dev/vault/`,
  `web/e2e/vault.spec.ts`). No shared file. The tree typechecks only when 2 and 3 are both in,
  so they are committed together.
- **Batch B:** Task 4.
- **Critical path:** Task 3 → Task 4.
- One worktree; agents in Batch A do not commit.

## Performance and data-fetching budget

No change to first paint. Delete: one write, one refresh. The trigger's two counts read by
indexed columns (`links.from_note`, `links.to_note`, `files.note_id`); Task 1 checks those
indexes exist and adds none unless one is missing.

## Out of scope

Trash and undo, folder or bulk delete, deleting attached files, any MCP tool.
