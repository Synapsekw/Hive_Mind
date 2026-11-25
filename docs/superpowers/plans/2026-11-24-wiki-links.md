# Wiki Links Become Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `[[wiki links]]` between a person's own notes in one workspace into accepted links, at the end of a folder import and from a button in the vault.

**Architecture:** A pure module finds and resolves references. One server step (a server action) reads 40 notes after a cursor, resolves their references against the workspace's index of paths, and inserts the missing pairs as the signed-in person; the database's existing rules accept them. The browser loops over the steps from the import panel and from a new panel. No migration.

**Tech Stack:** Next.js 16 server actions, Supabase JS client (person's session), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-wiki-links-design.md`. Read it first; its "Behaviour" section is the requirement.

## Global Constraints

- No database migration, no change under `supabase/` or `mcp/`.
- The server action signs in as the person (`createServerSupabase`), never a service key. No permission logic in app code: validate argument shapes, read the hive and member from the workspace's row, and let the database decide.
- Never log or return a note's text, title or path. Log an error's code and message only (`failed()` in `import.ts`); reads whose request names ids or paths log the code only.
- Link values: `tier: 2`, `score: 0.8`.
- Limits, exact: 40 notes a step; index pages of 1,000, at most 20 pages; link pages of 1,000, at most 20; insert chunks of 200; 2,000 distinct targets a note; cursor at most 500 characters; give up after 3 refused steps in a row.
- Every user-facing sentence lives in `web/src/vault/connectText.ts`; components hold no literals (`no-literals.test.ts` enforces it).
- UI: load the `frontend-design` skill and read `docs/ui-concept.md` before touching a component. Another session is reworking the look: reuse the classes the import panel already uses in `vault.module.css`; add no new colours and at most layout-only rules.
- Subagents do not run `git`. The orchestrator commits, staging by path.
- Formatting is Prettier; run `pnpm lint` before reporting.

## File Structure

| File                                                      | Responsibility                                               |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `web/src/import/types.ts` (modify)                        | `ConnectResult`, `ImportActions.connect`                     |
| `web/src/import/wikilinks.ts` (create) + test             | find targets, index paths, resolve a target                  |
| `web/src/app/vault/connect.ts` (create) + test            | one server step                                              |
| `web/src/app/vault/import.ts` (modify)                    | export the shared "is this workspace the person's own" check |
| `web/src/app/vault/actions.ts`, `page.tsx` (modify)       | the endpoint and its wiring                                  |
| `web/src/vault/connectRun.ts` (create) + test             | the browser loop                                             |
| `web/src/vault/connectText.ts` (create) + test            | sentences                                                    |
| `web/src/vault/Connect.tsx` (create)                      | the button's panel                                           |
| `web/src/vault/Import.tsx`, `Vault.tsx` (modify)          | connecting stage; the button                                 |
| `web/src/app/dev/vault/DevVault.tsx`, `page.tsx` (modify) | stand-in and flags                                           |
| `web/e2e/vault.spec.ts` (modify)                          | browser tests                                                |
| `docs/security.md` (modify)                               | section 14                                                   |

## Execution DAG

- Task 0 (orchestrator, inline): shared types and stubs. No dependency.
- Task 1 (pure module) depends on Task 0.
- Task 3 (browser side) depends on Task 0.
- Task 2 (server step) depends on Tasks 0 and 1.
- Task 4 (docs, whole-feature review, gates) depends on Tasks 1 to 3.

Batches: **A** = Task 0. **B** = Tasks 1 and 3 at the same time (no shared file). **C** = Task 2. **D** = Task 4. Critical path: 0 → 1 → 2 → 4.

---

### Task 0: Shared types and stubs

**Files:** modify `web/src/import/types.ts`, `web/src/app/vault/actions.ts`, `web/src/app/vault/page.tsx`, `web/src/app/dev/vault/DevVault.tsx`; create `web/src/app/vault/connect.ts`.

**Produces:**

```ts
// web/src/import/types.ts
/** One step of connecting a workspace's wiki links. `next` is the cursor for the step after,
 * null when the workspace is done. `total` is the workspace's notes; `scanned` this step's. */
export type ConnectResult =
  | {
      ok: true;
      next: string | null;
      total: number;
      scanned: number;
      linked: number;
      already: number;
      missing: number;
      failed: number;
    }
  | { ok: false };

export type ImportActions = {
  createWorkspace(name: string): Promise<WorkspaceMade>;
  importBatch(workspaceId: string, notes: ImportNote[]): Promise<BatchResult>;
  connect(workspaceId: string, after: string | null): Promise<ConnectResult>;
};
```

```ts
// web/src/app/vault/connect.ts (stub; Task 2 replaces the body)
export async function connectBatchIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<ConnectResult>;
// web/src/app/vault/actions.ts
export async function connectWikiLinks(
  workspaceId: string,
  after: string | null,
): Promise<ConnectResult>; // withSession({ ok: false }, db => connectBatchIn(db, workspaceId, after))
```

- [ ] Add the types; add the stub returning `{ ok: false }`; add the action; pass `connect: connectWikiLinks` in `page.tsx`; add `connect: async () => ({ ok: false })` to the dev stand-in.
- [ ] `pnpm typecheck` passes. Commit `feat(vault): types and endpoint stub for connecting wiki links`.

---

### Task 1: Find and resolve references (pure)

**Files:** create `web/src/import/wikilinks.ts`, `web/src/import/wikilinks.test.ts`.

**Interfaces — Produces:**

```ts
export const MAX_TARGETS = 2000;
/** Distinct targets in first-seen order, at most MAX_TARGETS. Never throws, whatever it is given. */
export function wikiTargets(body: string, frontmatter: unknown): string[];
export type Indexed = { id: string; path: string };
export type Index = { readonly size: number /* opaque otherwise */ };
export function buildIndex(notes: readonly Indexed[]): Index;
/** The id of the note `target` means for a note at `fromPath`, or null. */
export function resolveTarget(
  index: Index,
  fromPath: string,
  target: string,
): string | null;
```

Rules are the spec's "What counts as a reference" and "Which note a target means", exactly. Implementation notes:

- Body: strip fenced blocks first (a line starting, after up to 3 spaces, with ``` or ~~~, to the next such line or the end), then inline code spans (`` `…` `` on one line), then scan with `/\[\[([^\[\]\n]+)\]\]/g`. Take the text before the first `|` or `#`; trim; drop if empty.
- An escaped pipe `\|` (Obsidian writes it inside tables) ends the target too: strip one trailing `\` before trimming.
- Extension rule: last path part contains a `.` and does not end in `.md` (any case) → skip. `Meeting 2026.11.24` has a dot and no known extension, so only skip when the text after the last dot is 1 to 5 letters or digits containing at least one letter and is not `md`.
- Frontmatter: walk strings in objects and arrays to depth 32; scan each string with the same expression, no code stripping. Anything that is not a plain object, array or string is ignored.
- Dedupe targets on the lower-cased, `.md`-stripped form; return the first spelling.
- Index: three maps keyed on lower-cased paths without `.md`: full path → note; base name → notes; and for suffix matching, test candidates of the base name with `path === t || path.endsWith("/" + t)`. Two notes whose paths differ only by case: the first by plain string order of the original path wins the full-path key.
- Relative targets: split on `/`, apply `.` and `..` against the linking note's folder parts; popping past the root → null.
- "Closest" comparator over candidates: same folder as `fromPath` first; fewer `/` in path; shorter path; `a.path < b.path`.

- [ ] **Step 1: write the failing tests.** At least these, each its own `it`:
  - forms: `[[A]]`, `[[A|b]]`, `[[A#h]]`, `[[A#^id]]`, `![[A]]`, `[[ A ]]`, `[[A\|b]]` in a table row all give `["A"]`;
  - `[[#h]]`, `[[]]`, `[[ | x]]`, a target with a newline, `[[pic.png]]`, `![[doc.pdf]]` give `[]`; `[[Meeting 2026.11.24]]` and `[[a/b.md]]` are kept;
  - fenced block with ``` and with ~~~, unclosed fence to the end, inline code: skipped; text after the block is still read;
  - frontmatter: `{ related: ["[[one]]", { deep: "see [[two|x]]" }] }` gives `one`, `two`; a string holding a fenced block is still read; numbers, null, a Date, depth 40 do not throw;
  - duplicates in different case and with `.md` collapse to the first spelling; 2,500 distinct targets give 2,000;
  - `wikiTargets(undefined as never, null)` gives `[]`;
  - resolve: bare name, case-insensitive, with `.md`; unknown gives null;
  - resolve ties: same folder beats shallower; shallower beats deeper; shorter beats longer; string order last;
  - resolve with folder: exact path from root beats a suffix match; suffix match at a segment boundary only (`b/Note` does not match `ab/Note.md`); leading `/`;
  - relative: `./x`, `../x`, `../../x` past the root gives null;
  - a note resolving to itself returns its own id (the caller drops it).
- [ ] **Step 2:** `pnpm --filter @hive-mind/web exec vitest run src/import/wikilinks.test.ts` fails (module missing).
- [ ] **Step 3:** implement.
- [ ] **Step 4:** the test passes; `pnpm typecheck && pnpm lint` pass.
- [ ] **Step 5:** report; the orchestrator commits `feat(import): find and resolve wiki links`.

---

### Task 2: The server step

**Files:** create body of `web/src/app/vault/connect.ts`, create `web/src/app/vault/connect.test.ts`; modify `web/src/app/vault/import.ts` (export the ownership check), `web/src/app/vault/import.test.ts` only if a moved helper needs it.

**Interfaces — Consumes:** `wikiTargets`, `buildIndex`, `resolveTarget` (Task 1); `ConnectResult` (Task 0); `isUuid` from `./validate`; `failed`, `rows`, `userId` from `import.ts` (export them).

**Produces:** `connectBatchIn(db, workspaceId, after)` as declared in Task 0, and from `import.ts`:

```ts
/** The workspace's hive and member when the workspace is the signed-in person's own, else null.
 * This is the check `importBatchIn` already makes, moved into one function it now calls. */
export async function ownWorkspace(
  db: Db,
  wsId: string,
  uid: string,
): Promise<{ hiveId: string; memberId: string } | null>;
```

Steps of `connectBatchIn`, in order; any read that fails or has an unexpected shape answers `{ ok: false }` and nothing is written:

1. `workspaceId` is a uuid; `after` is `null` or a string of 1 to 500 characters with no NUL. Otherwise `{ ok: false }` before any query.
2. `userId(db)`; `ownWorkspace(db, wsId, uid)`; null → `{ ok: false }`.
3. Index: `notes` `select("id, path")` `.eq("workspace_id", wsId).eq("member_id", memberId).order("path").range(from, from + 999)`, pages until a page is short; a 21st page → `{ ok: false }` (log `connect refused: workspace too large`). Keep rows whose `id` is a uuid and `path` a string.
4. Batch: `select("id, path, body, frontmatter")` same two filters, `.gt("path", after)` when `after` is set, `.order("path").limit(40)`. Zero rows → `{ ok: true, next: null, total, scanned: 0, linked: 0, already: 0, missing: 0, failed: 0 }`.
5. For each note: `wikiTargets(body, frontmatter)` (a non-string body counts as `""`), `resolveTarget`. Null → `missing += 1`. Own id → dropped. Otherwise a pair keyed `min(id)|max(id)`, kept once per step, remembering the direction first seen.
6. Existing links of the batch's notes: `links` `select("from_note, to_note")` `.or("from_note.in.(ids),to_note.in.(ids)")` `.order("id").range(...)`, pages of 1,000, at most 20 (a 21st → `{ ok: false }`). The ids are uuids already checked, so the filter text is safe to build. A wanted pair found in either direction → `already += 1`.
7. Insert the rest in chunks of 200: `{ hive_id, from_note, to_note, tier: 2, score: 0.8 }`. A chunk that fails is retried one row at a time: a row refused with a message containing `these notes already have a link` counts as `already`, any other refusal as `failed`.
8. Answer the counts; `next` is the last note's path when 40 rows came back, else null; `scanned` is the number of rows; `total` the index size.

The Supabase calls are not ordered the same on every page, so tests use a fake client that answers by table and records calls (see the fake in `import.test.ts`; extend the same pattern with `order`, `range`, `gt`, `limit`, `or`).

- [ ] **Step 1: failing tests**, each its own `it`:
  - hostile arguments: not a uuid, `after` a number, an object, `""`, 501 characters, a NUL: `{ ok: false }` and zero calls;
  - no session; workspace not found; workspace of another member: `{ ok: false }`, no insert;
  - an empty workspace and a cursor past the end: `next: null`, zeros;
  - a note linking to two notes: two rows inserted with `tier 2`, `score 0.8`, the workspace's `hive_id`, from the linking note;
  - A links B and B links A in one step: one row;
  - a pair that exists as (B, A) is `already`, not inserted;
  - a target with no note is `missing`; a self link is neither counted nor inserted;
  - the index is read in pages (1,000 then 300) and a target on the second page resolves;
  - existing links are read in pages;
  - 450 pairs go in three inserts (200, 200, 50);
  - a failed chunk falls back to single inserts; "already have a link" counts as `already`, another message as `failed`;
  - 40 rows back gives `next` = the 40th path; 39 gives `null`; the batch read uses `gt("path", after)`;
  - every read filters on `workspace_id` and `member_id`;
  - `console.error` is never called with a path, title or body (spy and assert on a failing read);
  - `importBatchIn`'s existing tests still pass after the `ownWorkspace` extraction.
- [ ] **Step 2:** run `pnpm --filter @hive-mind/web exec vitest run src/app/vault/connect.test.ts`; it fails.
- [ ] **Step 3:** implement; extract `ownWorkspace` without changing `importBatchIn`'s behaviour or log lines.
- [ ] **Step 4:** `pnpm --filter @hive-mind/web test`, `pnpm typecheck`, `pnpm lint` pass.
- [ ] **Step 5:** report; the orchestrator commits `feat(vault): the server step that connects wiki links`.

---

### Task 3: The browser side

**Files:** create `web/src/vault/connectRun.ts` (+ test), `web/src/vault/connectText.ts` (+ test), `web/src/vault/Connect.tsx`; modify `web/src/vault/Import.tsx`, `web/src/vault/importText.ts` only if a shared helper moves, `web/src/vault/Vault.tsx`, `web/src/vault/vault.module.css` (layout only, if needed), `web/src/app/dev/vault/DevVault.tsx`, `web/src/app/dev/vault/page.tsx`, `web/e2e/vault.spec.ts`.

**Interfaces — Consumes:** `ConnectResult`, `ImportActions.connect` (Task 0).

**Produces:**

```ts
// web/src/vault/connectRun.ts
export type ConnectTally = {
  linked: number;
  already: number;
  missing: number;
  failed: number;
};
export type ConnectEnd = "finished" | "stopped" | "halted";
export const GIVE_UP_AFTER = 3;
/** Runs steps from the start until the workspace is done, `stop()` says so, or three steps in a
 * row are refused or throw. A refused step is tried again from the same cursor. */
export async function runConnect(
  connect: ImportActions["connect"],
  workspaceId: string,
  on: { progress(done: number, total: number): void; stop(): boolean },
): Promise<{ tally: ConnectTally; end: ConnectEnd }>;
```

```ts
// web/src/vault/connectText.ts — exact copy
export const CONNECT = "Connect wiki links";
export const CONNECT_INTRO =
  "Turns the [[wiki links]] between your notes in this workspace into links. Only your own notes are linked. Links that are already there stay as they are.";
export const START = "Connect";
export const CONNECTING = "Connecting wiki links";
export const CONNECTED = "Wiki links connected";
export const CONNECT_STOPPED = "Connecting stopped";
export const CONNECT_HALTED =
  "Three steps in a row could not be saved, so connecting stopped. The links that were made stay. Connect again to finish the rest.";
export const AFTER_IMPORT_UNFINISHED =
  "Not every wiki link was connected. Open the workspace and press Connect wiki links to finish.";
export const connectProgress: (done: number, total: number) => string; // "120 of 480 notes read"
export function connectCounts(
  t: ConnectTally,
): { label: string; value: string }[];
// "Links made", "Already linked", "Pointing at no note", and "Could not be saved" only when failed > 0
```

Behaviour:

- **Import.tsx.** After the sending loop, when `end === "finished"` and `created + updated + unchanged > 0`: set a new stage `{ kind: "connecting", done, total, stopping }` (title `CONNECTING`, the same progress bar, sentence and Stop button the running stage uses; `aria-busy`, the unload warning and `onBusy(true)` stay on), run `runConnect`, then the done stage with `links: { tally, end } | null`. The done screen shows `connectCounts` under the note counts, and `AFTER_IMPORT_UNFINISHED` when the end is not `finished`. An import that was stopped or halted does not connect (`links: null`, nothing shown).
- **Connect.tsx.** Same shell as the import panel (`section` with `data-scope="reset"`, heading focused on each stage, Escape closes when idle, Close `aria-disabled` while running, unload warning). Stages: `ready` (intro + Start) → `running` (progress, Stop) → `done` (counts; `CONNECT_HALTED` as an alert when halted; a Close button). `router.refresh()` once at the end. Props: `{ workspace: { id; name }, connect, onClose, onBusy }`.
- **Vault.tsx.** Beside the "Import a folder" opener, when `importer` is given and the open tab is one of the person's own workspaces: a second `secondary` button `CONNECT`, `aria-expanded`, `aria-controls="vault-connect"`. Only one of the two panels is open at a time; either being busy disables both openers (`aria-disabled`). Closing returns focus to its opener.
- **Dev stand-in.** `connect` answers from memory: `total` = 90, 40 a step, each step `linked: 7, already: 2, missing: 1`; flags `?failconnect=2|all` (that step refused) and `slow` (waits like a batch). It records calls like the others.

- [ ] **Step 1: failing unit tests.** `connectRun.test.ts`: walks cursors `null → "a" → "b" → done` and sums tallies; progress called with cumulative `scanned` and `total`; stop after the first step ends `stopped`; a refused step is retried from the same cursor and counts toward the three; three in a row ends `halted`; a throw counts as refused; a success resets the streak; a step with `ok: true`, `scanned: 0` and a non-null `next` ends the run (no endless loop). `connectText.test.ts`: singular and plural, thousands separators, the fourth count only when `failed > 0`.
- [ ] **Step 2:** run them; they fail.
- [ ] **Step 3:** implement `connectRun.ts`, `connectText.ts`, then the components and the stand-in.
- [ ] **Step 4: browser tests** in `web/e2e/vault.spec.ts` (port 3100 may be held by another worktree: if so copy `web/playwright.config.ts` to a temporary file with another port, run with `-c`, delete the copy):
  - import a folder: after the last batch the panel says "Connecting wiki links", then the result shows "Links made" with the summed number;
  - a stopped import shows no link counts and made no `connect` call;
  - `?failconnect=all`: the import result shows the unfinished sentence;
  - the button is there on an own workspace and absent on "Shared with me";
  - the button's panel: Start, progress, counts; Escape and Close do nothing while running; focus returns to the opener after closing;
  - Stop ends with "Connecting stopped" and the counts so far;
  - `?failconnect=all`: the halted alert;
  - opening one panel closes the other; both openers are `aria-disabled` while either runs;
  - axe (as the file's other tests do it) finds nothing on the ready and the done stage.
- [ ] **Step 5:** `pnpm --filter @hive-mind/web test`, the vault browser tests, `pnpm typecheck`, `pnpm lint` pass.
- [ ] **Step 6:** report; the orchestrator commits `feat(vault): connect wiki links after an import and from a button`.

---

### Task 4: Docs, review, gates (orchestrator)

- [ ] `docs/security.md`: section 14 "Connecting wiki links": what the endpoint takes and checks, that the database decides, that only the person's own notes are read and linked, that nothing from a note is logged or returned, the limits.
- [ ] Whole-feature code review and a security review of `connect.ts` and the action (hostile arguments, filter building, what is logged, a colleague's note can never be a target).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, and the full browser suite.
- [ ] `scripts/finish-task.sh`; deploy the site; run it on the DRA workspace is the user's test; time `map_graph` on the hosted project and report.

## Self-review

Spec coverage: references (Task 1), resolution (Task 1), what is written and the counts (Task 2), where it runs (Task 3), limits (Tasks 1, 2), performance budget (Task 2's bounded reads; Task 4's timing), tests (each task). No placeholders. Names match across tasks: `connectBatchIn`, `connectWikiLinks`, `ImportActions.connect`, `ConnectResult`, `runConnect`, `ConnectTally`.
