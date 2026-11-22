# File storage — short design

T5 of [Phase 1 — Local end to end](../plans/2026-11-21-local-end-to-end.md).

## Intent

Agents produce deliverables (proposals, spreadsheets, decks), not only notes. Those files need a
home in the hive that is private by default and shared exactly like the note they belong to, so
that the web app can later serve them to the right people.

## Goals, non-goals, anti-goals

- **Goals:** one private bucket; storage rules decided in the database; a `hive_save_file` tool;
  rule tests that run without Docker; proof against the real Storage API.
- **Non-goals:** reading or downloading files through an agent; bulk-importing the files of an
  existing vault; holding a self-hosted agent's file for review; signed URLs for the web app.
- **Anti-goals:** a file readable by someone who cannot read its note; an agent that can delete or
  overwrite a file; an agent that can be talked into uploading any file on the machine.

## Approaches

1. **Storage policies that defer to the `files` table — picked.** A stored object is readable when
   the caller can see a `files` row for its path, and that row is already governed by "shared like
   its note". One rule, in one place.
2. **Duplicate the sharing logic in the storage policies.** Two copies of the most security-critical
   rule in the system, bound to drift apart.
3. **Keep the bucket closed and serve every file through server code with the service role.** Moves
   the security boundary out of the database, which this project never does.

## Design

- **Migration `20261122063919_file_storage`:** bucket `files`, private, 50 MB per file. Paths are
  `<member_id>/<workspace_id>/outputs/<type>/<customer>/<name>`.
  - _Upload:_ the path must sit under one of the caller's own workspaces, and for an agent under
    the workspace its token is bound to.
  - _Read:_ the owner, or anyone who can see a `files` row for that path. The function doing the
    lookup is deliberately not `security definer`, so the caller's own row-level security applies.
  - _Delete:_ people only, their own files. _Overwrite:_ nobody; there is no update policy.
  - _The `files` table:_ a new trigger refuses a row whose path is not under its own member and
    workspace, or whose note belongs to someone else. Without it, a row naming another member's
    path would have made that member's file readable.
  - _Self-hosted agents_ cannot save files at all for now (default deny).
- **Tool `hive_save_file`** (`local_path`, `type`, `customer`, optional `name` and `note_path`):
  uploads, then records the `files` row. No permission logic: the database decides.
- **Local-disk guard:** the tool only reads files inside the server's working folder
  (`HIVE_FILES_ROOT`, default the folder the agent runs in), never hidden files, and never over
  50 MB. See
  [decision 12](../../../vault/decisions/2026-11-22-decision-12-agents-save-files-only-from-the-working-folder.md).
- **Tests:** `scripts/local-db.mjs` gains a stand-in for `storage.buckets` and `storage.objects`
  (row-level security on, only the columns the migration uses), so the rules are covered by five
  new cases in `tests/sharing-rules.test.mjs`. `pnpm test:live` saves, downloads and tries to
  delete and overwrite a real file through the Storage API, then cleans up as the owner.

## Deviation from the plan

The plan expected the storage tests on the local Docker stack. Docker is not installed, so the
rules are tested against the stand-in and the real behaviour against the hosted project. The
stand-in cannot catch a difference in how Supabase Storage itself applies policies; `test:live`
is what covers that, and it does not run in CI.

## Known gaps

- If the upload succeeds and the `files` row is refused, the object stays without a row. The owner
  can still see and delete it; the agent reports the failure.
- A file from a self-hosted agent has nowhere to wait for review; such agents are refused.
- The tool reads from the local disk, so it only works while the server runs on the member's
  machine. The hosted server (phase 3) needs a different upload path.

## Plan, execution DAG and budget

One chain: migration → stand-in and rule tests → tool → live test → apply to the hosted project →
docs. The tool and the rule tests both depend on the migration, and the live test on all three, so
there was no useful parallel batch. No UI. A save is one upload plus at most two small queries.
