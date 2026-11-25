# Notes Keep Their Real Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An imported note carries the date it was written, and the Timeline places notes by that date on a scale that fits them.

**Architecture:** The browser derives two dates per imported note and the import stores them in `created_at` / `updated_at`. A migration lets only a person set those columns and adds `created_at` to the map's payload. The Timeline reads the created date and picks a day, week, month, quarter or year scale in the browser.

**Tech Stack:** Postgres (migration, PGlite tests under node:test), Next.js 16 server actions, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-note-dates-design.md`. Its "Behaviour" section is the requirement; read it first.

## Global Constraints

- Schema changes only through a migration minted with `scripts/new-migration.sh note_dates`. Never edit a shipped migration. Replace a function by copying its **latest** definition (search all migrations for the last `create or replace function public.<name>`) and changing only what this plan says.
- Security-definer functions keep `set search_path = ''` and their existing guards and grants.
- Field names, exact: an import note may carry `written_at` and `modified_at` (ISO texts); a map item carries `created_at` beside `updated_at`.
- Usable date range: 1990-01-01T00:00:00Z up to now, inclusive. A date with no time of day is 12:00 UTC.
- All calendar arithmetic in the map is UTC, as the existing code is.
- No new server round trip in the map. No user-facing literal in a component (the `no-literals` tests).
- UI: load the `frontend-design` skill and read `docs/ui-concept.md` first. Another session reworks the map's look: change column logic and labels only; no new colours, no layout change beyond what a label needs.
- Never log a note's path, title or text.
- Subagents do not run `git`. The orchestrator commits, staging by path. Run `pnpm lint` (Prettier) before reporting.

## File Structure

| File                                                                                     | Responsibility                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `supabase/migrations/<stamp>_note_dates.sql` (create)                                    | date rules in `notes_before_write`; `map_graph` |
| `tests/sharing-rules.test.mjs` (modify)                                                  | database tests                                  |
| `docs/hosted-db-bringup.md`, `docs/security.md` (modify)                                 | current state; who may set dates                |
| `web/src/import/dates.ts` (create) + test                                                | derive the two dates                            |
| `web/src/import/plan.ts`, `web/src/vault/Import.tsx` (modify)                            | the dates travel with a note                    |
| `web/src/app/vault/import.ts` (modify) + test                                            | check, store, date-only update                  |
| `web/src/app/dev/vault/DevVault.tsx` (modify), `web/e2e/vault.spec.ts`                   | stand-in and browser test                       |
| `web/src/map/timescale.ts` (create) + test                                               | scale, column, label                            |
| `web/src/map/{types,graph,layouts,scene,arrange,Peek,DetailRail,fixture}.ts(x)` (modify) | use created date and the scale                  |
| `web/src/app/dev/map/page.tsx` (modify), `web/e2e/map.spec.ts`                           | sample data with old notes; browser tests       |

## Execution DAG

- Task 1 (database), Task 2 (import), Task 3 (map): no dependency on each other; they share only the field names fixed above and touch disjoint files.
- Task 4 (review, gates, merge, apply the migration to the hosted project, deploy) depends on 1, 2, 3.

Batches: **A** = Tasks 1, 2, 3 at the same time. **B** = Task 4. Critical path: Task 3 → Task 4.

---

### Task 1: The database

**Files:** create `supabase/migrations/<stamp>_note_dates.sql` (run `scripts/new-migration.sh note_dates`); modify `tests/sharing-rules.test.mjs`, `docs/hosted-db-bringup.md` (the "current state" list of migrations and one line on what this one does), `docs/security.md` (a short section 15, "A note's dates").

**Produces:** `notes.created_at` / `notes.updated_at` obey the rules below; `map_graph` items have `'created_at'`.

`notes_before_write`, added to the latest definition, nothing else changed. With `agent` the existing `jwt_agent_id()` value and `app` = `public.jwt_oauth_client() is not null` (check the exact helper name in `20261123150712_connected_apps.sql`), and `person` = `agent is null and not app and (select auth.uid()) is not null`:

- INSERT, not a person: `new.created_at := now(); new.updated_at := now();`
- INSERT, a person: `new.created_at := least(coalesce(new.created_at, now()), now()); new.updated_at := least(greatest(coalesce(new.updated_at, now()), new.created_at), now());`
- UPDATE, not a person: `new.created_at := old.created_at;` and, when the content did not change, `new.updated_at := old.updated_at;`
- UPDATE, a person: `new.created_at := least(new.created_at, now());` and, when the content did not change, `new.updated_at := least(greatest(new.updated_at, new.created_at), now());`
- UPDATE with a content change: `updated_at := now()` as today, then raise it to `created_at` if needed (it cannot be, since `created_at <= now()`).
- A caller with no JWT at all (the test harness's owner connection, a script with the service key) is "not a person" by the definition above. Check what `scripts/import-vault.mjs` and the existing tests rely on: if they insert notes with explicit dates as the service role and tests break, treat the service role (`auth.role() = 'service_role'` or no JWT) as allowed to set dates, and say so in the migration's header comment.

`map_graph`: in the latest definition add `created_at` to the `kept` rows (a note's `n.created_at`; a file's `f.created_at`) and `'created_at', k.created_at` to the item object. Picking, ordering and everything else unchanged.

The header comment of the migration says, as the others do, what it changes and what it leaves alone.

- [ ] **Step 1: failing tests** in `tests/sharing-rules.test.mjs`, following its helpers for acting as a person, an agent and an app pass:
  - a person inserts a note with `created_at` and `updated_at` in 2024: both are kept;
  - a person inserts with `created_at` tomorrow: stored as now (within a few seconds);
  - a person inserts with `updated_at` before `created_at`: `updated_at` equals `created_at`;
  - an agent inserts with dates in 2024: both are now; an app pass likewise (if an app pass can insert notes at all; otherwise assert what applies);
  - a person changes only `created_at` and `updated_at` of their note: stored, `version` unchanged, `written_by_agent` unchanged;
  - an agent sends an update with another `created_at` and unchanged content: `created_at` and `updated_at` keep their old values;
  - a person changes the body and sends an old `updated_at`: `updated_at` is now, `version` + 1;
  - `map_graph` gives a note its `created_at` (the 2024 value) and a file its `created_at`; a locked item still carries it (it is no more revealing than `updated_at`, which a locked item already carries).
- [ ] **Step 2:** `node --test tests/sharing-rules.test.mjs` fails on the new tests only.
- [ ] **Step 3:** write the migration.
- [ ] **Step 4:** `pnpm test` (root: database tests and web tests) passes; `pnpm lint` passes.
- [ ] **Step 5:** docs. Report; the orchestrator commits `feat(db): a note's dates are set by a person only; the map carries created_at`.

---

### Task 2: The import carries dates

**Files:** create `web/src/import/dates.ts`, `web/src/import/dates.test.ts`; modify `web/src/import/plan.ts` (+ `plan.test.ts`), `web/src/vault/Import.tsx`, `web/src/app/vault/import.ts` (+ `import.test.ts`), `web/src/app/dev/vault/DevVault.tsx`, `web/e2e/vault.spec.ts`, `docs/security.md` section 13 (one bullet under Limits).

**Produces:**

```ts
// web/src/import/dates.ts — pure, runs in a browser, never throws
export const EARLIEST = Date.UTC(1990, 0, 1);
/** Epoch ms of a date text in one of the spec's formats, or null. Date-only is 12:00 UTC. */
export function parseDate(v: unknown): number | null;
/** The first usable date in a path: file name first, then folders from the deepest up. */
export function dateInPath(path: string, now: number): number | null;
/** The two dates of an imported note as ISO texts, or null where none is usable. */
export function noteDates(
  frontmatter: unknown,
  path: string,
  lastModified: number | undefined,
  now: number,
): { written_at: string | null; modified_at: string | null };
/** A date a batch may carry: a text of at most 40 characters that parses to EARLIEST..now. */
export function cleanDate(v: unknown, now: number): string | null;

// web/src/import/plan.ts
export type ImportNote = {
  path: string;
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  written_at?: string;
  modified_at?: string;
};
// noteBytes counts the two when present.
```

Rules: the spec's "The two dates of a note". Details:

- Field lookup ignores case and compares the six names in the spec's order (not the object's order). A value may be a string, a finite number (milliseconds; a number below 10^11 is seconds) or a `Date`. A list takes its first element.
- `parseDate` accepts only the spec's formats with a real calendar date (`2025-02-30` is null); an ISO text with an offset or `Z` is honoured; a date-time without an offset is taken as UTC.
- `dateInPath`: `YYYY[-_.]MM[-_.]DD` or `YYYYMMDD`, not preceded or followed by a digit; skip a match that is not a real date or is out of range and try the next.
- `modified_at` is the file time when usable; when both exist and it is before `written_at`, it becomes `written_at`. `written_at` falls back to the file time.
- `Import.tsx`: after `parseNote`, add `...dates` (only the non-null ones) using `file.lastModified` and one `Date.now()` taken when the import starts.
- `import.ts` `cleanBatch`: the two keys are optional; a present one that is not a string is malformed (the whole batch is refused, as for other fields); a string that `cleanDate` rejects is dropped silently (the note is still imported). Rebuild the note from known keys as now.
- `importBatchIn`:
  - a new note: add `created_at: written_at` and `updated_at: modified_at ?? written_at` when present;
  - select `created_at, updated_at` with the existing notes; "same" now also requires that each sent date equals the stored one (compare epoch milliseconds);
  - content the same and a date differs: one update of `{ created_at, updated_at }` only (only the keys that were sent), outcome "updated";
  - content differs: the existing update, plus `created_at` when sent. Do not send `updated_at` (the database stamps now).
  - Because a content update stamps now, the next import of the same file would see `updated_at` differ and correct it to the file's time; that is intended.

- [ ] **Step 1: failing unit tests.** `dates.test.ts`: every format; invalid calendar dates; each field name and their order (`created` beats `date` whatever the object's order); case-insensitive names; `[[2025-03-14]]` and quoted values; number in ms and in seconds; a `Date`; a list; future and pre-1990 skipped with fallback to the next source; file name before folder, deepest folder first; `20250314` yes, `120250314` no; no source gives nulls; `modified_at` raised to `written_at`; hostile inputs (a getter that throws, 10^6-character strings) do not throw and return quickly. `plan.test.ts`: `noteBytes` counts the dates. `import.test.ts`: a batch with a number as `written_at` is refused; an unparseable or future text is dropped and the note imported; a new note is inserted with both columns; unchanged content with a different stored `created_at` gives one update holding only the two date keys and outcome "updated"; identical dates give "unchanged" and no write; changed content sends `created_at` and not `updated_at`; notes without dates behave exactly as before.
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the dev stand-in remembers the dates per path so a second import of the same folder with other dates answers "updated"; add one browser test for a re-import that only corrects dates if the stand-in can show it (Playwright can set a file's `lastModified` through `setInputFiles` buffers only as "now": drive the dates through a `date:` field in the file's text instead).
- [ ] **Step 5:** `pnpm --filter @hive-mind/web test`, the vault browser tests (port 3100 may be held by another worktree: copy `web/playwright.config.ts` to a temporary config on another port, run with `-c`, delete the copy), `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 6:** report; the orchestrator commits `feat(import): notes are imported with the date they were written`.

---

### Task 3: The Timeline uses the created date and fits its scale

**Files:** create `web/src/map/timescale.ts`, `web/src/map/timescale.test.ts`; modify `web/src/map/types.ts`, `graph.ts`, `layouts.ts`, `scene.ts`, `arrange.ts`, `Peek.tsx`, `DetailRail.tsx`, `fixture.ts`, their tests, `web/src/app/dev/map/page.tsx`, `web/e2e/map.spec.ts`, `docs/ui-concept.md` (the Timeline row of the views table and one paragraph on the scale).

**Produces:**

```ts
// web/src/map/timescale.ts — pure, UTC
export type Unit = "day" | "week" | "month" | "quarter" | "year";
export const COLUMNS = 14;
export type Scale = { unit: Unit; now: number };
/** The smallest unit in which `oldest` falls within COLUMNS columns counting the current one;
 * "day" when there is nothing or `oldest` is not a finite positive time; "year" beyond that. */
export function pickScale(oldest: number, now: number): Scale;
/** 0..COLUMNS-1; COLUMNS-1 is the current unit; older than the first column gives 0; a time
 * after now gives COLUMNS-1. */
export function columnOf(scale: Scale, t: number): number;
/** The label of a column, per the spec. */
export function columnLabel(scale: Scale, column: number): string;
```

- `types.ts`: a payload node gains `created_at?: string | null`; a model node gains `createdAt: number` (epoch ms; the parsed `created_at`, else `updatedAt`; 0 for root and hubs).
- `graph.ts`: fill `createdAt`. `DAYS` stays exported and equal to `COLUMNS`. `dayIndex` stays for callers that mean days (keep its tests). `activity`'s per-day agent counts become per-column counts on a scale passed in (or returned with it): count notes with `byAgent` by `columnOf(scale, createdAt)`; its "today" numbers stay on `updatedAt`.
- `layouts.ts` (the Timeline layout only): compute the scale once from the smallest positive `createdAt` among the notes and files it lays out, place each by `columnOf(scale, createdAt)`, a hub by its topic's newest `createdAt`. `byFreshness` and the other layouts are untouched.
- `scene.ts`: column labels come from `columnLabel`. With the day unit the labels must be exactly what they are today (the existing tests prove it).
- However the scale reaches both the layout and the labels, it must be the same scale: derive it in one place and pass it, never twice from different sets.
- `arrange.ts` `time`: use `created_at ?? updated_at`.
- `Peek.tsx` and `DetailRail.tsx`: show "Written" (created) and keep "Changed" (updated); when the two fall on the same day show both anyway. Sentences in the file that already holds these components' text.
- Fixture and `/dev/map`: a flag `?old=1` gives sample notes created over the last three years (deterministic), so the scale shows quarters; without it the sample stays within 14 days.

- [ ] **Step 1: failing unit tests.** `timescale.test.ts`: `pickScale` for an oldest of today, 13 days, 14 days (week), 13 weeks back, 14 weeks (month), 13 months, 14 months (quarter), 13 quarters, 14 quarters (year), 30 years (year), 0, NaN, a future time; edges at UTC midnight, Monday, the first of a month, 1 January, a leap day; `columnOf` for now (13), one unit back (12), the first column, older (0), future (13); week columns across a year boundary; `columnLabel` for each unit: "Today", "This week", "This month", the year on January and on column 0, "Q1 2026", "2026". Model tests: `createdAt` from `created_at`, fallback to `updatedAt` when absent, null or unparseable. Layout tests: an old note sits in the column of its created date, not of its change; a hive of recent notes gives the same positions as before this change (snapshot the existing expectations). `arrange` groups by created date.
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4: browser tests** in `web/e2e/map.spec.ts`, following the file's way of reading the canvas scene (the tests there assert labels through whatever accessible or test hook the Timeline already exposes; use the same hook, add none unless there is none): `/dev/map?old=1` on Timeline shows quarter or year labels and no "Today"; the default sample shows "Today"; the peek of a note shows Written and Changed. Run them on a temporary port if 3100 is held; the frame-rate tests in that file are load-sensitive: run them alone and do not report them as failures of this change if they pass alone.
- [ ] **Step 5:** `pnpm --filter @hive-mind/web test`, the map browser tests, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 6:** report; the orchestrator commits `feat(map): the Timeline places notes by created date on a scale that fits`.

---

### Task 4: Review, gates, release (orchestrator)

- [ ] Whole-feature review, with a security read of the migration (who can set dates, guards and grants unchanged, `map_graph` reveals nothing new) and of `import.ts`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; the vault and map browser tests.
- [ ] `scripts/finish-task.sh`.
- [ ] Apply the migration to the hosted project in one transaction that also records it in `supabase_migrations.schema_migrations`; confirm with a read. Then deploy the site.
- [ ] Hand over: how to test (import the DRA folder again into "DRA Vault").

## Self-review

Spec coverage: dates and sources (Task 2), who may set dates and the payload (Task 1), Timeline, grouping, details, fallback (Task 3), re-import fix (Task 2), budget (Task 3: one pass, no request). Names are the same across tasks: `written_at`, `modified_at`, `created_at`, `createdAt`, `pickScale`, `columnOf`, `columnLabel`, `COLUMNS`. No placeholders.
