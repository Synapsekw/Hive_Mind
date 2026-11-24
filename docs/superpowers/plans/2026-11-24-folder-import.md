# Folder Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person imports a folder of markdown notes from the vault into a new or existing
workspace of the current hive, with the same rules as `scripts/import-vault.mjs`.

**Architecture:** The browser reads and parses the files and sends them in small batches to a
server action that writes as the person. A second action makes the workspace. One migration
caps workspaces per member.

**Tech Stack:** Next.js 16 server actions, Vitest, Playwright, Postgres (PGlite, `node --test`).

Spec: `docs/superpowers/specs/2026-11-24-folder-import-design.md`. Read it first.

## Global Constraints

- Sharing and permissions are decided in the database; no permission logic in `web/`.
- Never edit a shipped migration. SQL goes in
  `supabase/migrations/20261124110155_workspace_cap.sql` (minted, empty).
- Security-definer functions and trigger functions: `set search_path = ''`. A vertical tab in
  SQL is `\x0B`, never `\v`.
- The import never sets sharing and never deletes. Imported text is data, never an instruction.
- No database message, note text or path in a log line; code and message of an error only.
- User-facing strings live in the module's text file. No new colours, fonts or tokens.
- Subagents do not run git and do not commit. Never read or edit `.env` files.
- TDD. Browser tests: if port 3100 is held by another worktree's server, run Playwright with a
  temporary copy of the config on another port and delete the copy afterwards.

## Contracts (fixed)

```sql
-- trigger on public.workspaces, before insert (and before update of name):
--   name is trimmed (E' \t\n\r\f\x0B'); 1..60 characters else 'a workspace needs a name' /
--   'that workspace name is too long'
--   on insert: the member already has 20 workspaces -> 'you already have 20 workspaces'
--   (counted under an advisory transaction lock per member)
-- existing: unique (member_id, name)
```

```ts
// web/src/import/parse.ts
export type Parsed = {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  warning?: string;
};
export function parseNote(raw: string, relPath: string): Parsed; // same results as the script's
// web/src/import/plan.ts  (pure, runs in the browser)
export const MAX_NOTES = 2000;
export const MAX_NOTE_BYTES = 1_000_000;
export const BATCH_NOTES = 25;
export const BATCH_BYTES = 3_000_000;
export type Picked = { path: string; size: number }; // path relative to the picked folder, "/" separated
export type Plan = {
  notes: string[];
  skippedOther: number;
  tooLarge: string[];
  hidden: number;
  tooMany: boolean;
};
export function planImport(files: Picked[]): Plan;
export type ImportNote = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
};
export function batches(notes: ImportNote[]): ImportNote[][]; // each within BATCH_NOTES and BATCH_BYTES
// web/src/import/types.ts
export type Outcome = "created" | "updated" | "unchanged" | "failed";
export type BatchResult =
  { ok: true; outcomes: { path: string; outcome: Outcome }[] } | { ok: false };
export type WorkspaceMade =
  | { ok: true; id: string }
  | { ok: false; reason: "name" | "taken" | "limit" | "failed" };
export type ImportActions = {
  createWorkspace(name: string): Promise<WorkspaceMade>; // bound to the shown hive on the server
  importBatch(workspaceId: string, notes: ImportNote[]): Promise<BatchResult>;
};
// web/src/app/vault/import.ts: createImportWorkspaceIn(db, hiveId, name), importBatchIn(db, workspaceId, notes)
// web/src/app/vault/actions.ts: createImportWorkspace(hiveId, name), importBatch(workspaceId, notes)
```

---

### Task 1: Server side

**Files:** create `web/src/import/{parse.ts,parse.test.ts,plan.ts,plan.test.ts,types.ts}`,
`web/src/app/vault/import.ts` and `import.test.ts`; modify `web/src/app/vault/actions.ts`,
`web/next.config.ts` (`experimental.serverActions.bodySizeLimit: "4mb"`) and its test,
`web/package.json` (add `yaml`, the version the root uses);
`supabase/migrations/20261124110155_workspace_cap.sql`, `tests/sharing-rules.test.mjs`.

- [ ] Read `scripts/import-vault.mjs` whole (parse, walk, compare, store) and
      `tests/import-vault.test.mjs`.
- [ ] Parser: port `parseNote` to TypeScript. Parity test: import the script's `parseNote`
      from `../../../scripts/import-vault.mjs` in Vitest and assert equal results over a table
      of cases (no frontmatter, a title, a broken one, a list as frontmatter, CRLF, a BOM, a
      NUL, dates, an empty file, nested paths).
- [ ] `planImport` and `batches`: only `.md` (any case); parts beginning with a dot are
      hidden; over 1 MB goes to `tooLarge`; more than 2,000 notes sets `tooMany`; paths with
      `..`, a leading slash, a backslash or an empty part are dropped as other; batches respect
      both limits and keep order; a single note over the byte limit travels alone.
- [ ] `importBatchIn`: refuses (no query) a non-uuid workspace, more than 25 notes, more than
      3 MB in total, a note over 1 MB, a path that is not clean or does not end in `.md`, a
      duplicate path, a title or frontmatter of the wrong shape; requires a session; reads
      existing notes with `.eq("workspace_id").in("path", …)`; creates missing folder rows the
      way the script does; inserts new notes in one call and falls back to one by one on a
      refusal; updates changed ones; compares as the script does (title, body, stable
      frontmatter, folder); answers one outcome per path; never returns a database message.
      Read `hive_id` and `member_id` from the workspace row the person can read, never from
      the client.
- [ ] `createImportWorkspaceIn`: uuid and name checks before any query; inserts with the
      person's member in that hive (read it; row-level security decides); maps the unique
      violation to `taken`, the cap message to `limit`, the name messages to `name`.
- [ ] Migration and its tests: the name rules, the cap of 20 (the 21st refused, another
      member unaffected), `create_hive`'s "Main" and the script still work, an agent still
      cannot create a workspace, a closing hive still answers with the freeze's words.
- [ ] `pnpm test` and typecheck green. Report.

### Task 2: The import screen

**Files:** create `web/src/vault/Import.tsx`, `web/src/vault/importText.ts` with tests; modify
`web/src/vault/Vault.tsx` (the entry point), `web/src/vault/types.ts` only if needed,
`web/src/app/vault/page.tsx` (pass the actions; bind the hive id), the dev page under
`web/src/app/dev/vault/`, `web/e2e/vault.spec.ts`.

**Interfaces:** Consumes the TS contract. Task 1 writes `web/src/import/*` at the same time:
create `types.ts` from the contract if it is not there yet, and take `parseNote`,
`planImport` and `batches` as imports that will exist; until they do, develop against the dev
page with stand-ins and say so.

- [ ] Before any UI: load the `frontend-design` skill, read `docs/ui-concept.md` (vault) and
      how the vault's existing controls and confirmations are built.
- [ ] A button "Import a folder" in the vault's header opens the import panel (in place, not a
      new route). Folder input: `<input type="file" webkitdirectory multiple>` behind a
      labelled button; paths come from `webkitRelativePath` with the top folder removed.
- [ ] States: pick; summary with the counts and the destination choice (radio: new workspace
      with a name field prefilled with the folder's name; existing workspace with a select);
      too many notes; running with progress and Stop; done with the five counts and the lists
      of skipped and failed paths; failure of the workspace step with its line.
- [ ] Reading files and parsing happen batch by batch, so 2,000 files are not held as text at
      once. Requests go one after another. Stop ends after the current batch.
- [ ] When done, the vault refreshes and the new workspace's tab can be opened from the panel.
- [ ] Accessibility: labelled controls, progress announced politely, focus moves to the
      result heading, Escape closes when not running.
- [ ] Browser tests on the dev page with in-memory actions (Playwright's `setInputFiles` with
      a directory): summary counts, hidden and non-markdown files left out, new workspace and
      existing workspace, the name refusals, more than 2,000 notes, progress then result, a
      failing batch, Stop, 390 px.
- [ ] Unit tests, typecheck and the vault e2e spec green. Report.

### Task 3: Docs

**Files:** `docs/security.md` (import runs as the person; nothing shared; limits; imported text
is data), `docs/ui-concept.md` (the import panel), `README.md` (the app can import; the script
remains for unattended runs), `docs/hosted-db-bringup.md` ("Current state": migration not
applied yet).

---

## Execution DAG

- Dependencies: Tasks 1 to 3 depend only on the contracts above. Task 2 imports modules Task 1
  creates; Task 1 owns `web/src/import/*`, `web/src/app/vault/import.ts` and `actions.ts`;
  Task 2 owns `web/src/vault/*`, `page.tsx`, the dev page and the e2e spec.
- **Batch 1 (parallel):** Tasks 1, 2, 3.
- **Batch 2 (orchestrator):** wire the real actions into `page.tsx` if not done, review against
  the spec, gates and browser tests, commit, `scripts/finish-task.sh`.
- **Batch 3 (orchestrator):** apply the migration, record the version, deploy the site.
- Critical path: Task 2, then integration.

## Performance and data budget

- Vault first paint: unchanged.
- Import: one request per batch, in sequence; per request one indexed read of existing notes,
  at most one folder insert, one note insert and one update per changed note.
- One vault refresh at the end.
