# Vault import — short design

T4 of [Phase 1 — Local end to end](../plans/2026-11-21-local-end-to-end.md).

## Intent

Get the owner's existing notes into the hive, so agents answer from real knowledge and the map
(phase 2) has real notes to show. The source is an Obsidian vault of 955 markdown notes; the first
run brings in a small cross-section, the rest follows with the same command.

## Goals, non-goals, anti-goals

- **Goals:** one hive note per markdown file at the same relative path; frontmatter kept; safe to
  re-run (changed files become new versions, nothing is duplicated); a subset can be chosen at run
  time; the originals are never modified.
- **Non-goals:** PDFs, Office files and images (file storage is T5); turning wiki links into hive
  links (the later link job); keeping the folder and the hive in sync both ways.
- **Anti-goals:** an import that shares anything; an import that deletes hive notes because a file
  went missing; a bypass of row-level security to make a bulk load faster.

## Approaches

1. **A script that signs in as the person and writes through the REST API — picked.** The notes are
   the person's, so they are imported as the person: `written_by_agent` stays empty and the
   database's own rules decide every write. It needs no new server code.
2. **A new MCP tool that the agent calls per file.** An agent may only write in its own workspace,
   so the originals could not be kept in a separate one, and 955 tool calls is the wrong shape.
3. **A direct SQL load with the service role.** Fast, but it skips row-level security and the
   versioning trigger's identity checks, which is the one thing this project never does.

## Decisions made with Danijel

- **A separate workspace, `DRA`.** The agent's token is bound to `Main`, so it can read and search
  the imported notes but not change them. New knowledge goes into `Main`. A note cannot move
  between workspaces afterwards, so this is permanent per note.
- **First batch:** `Decisions`, `MOCs` and `Home.md` (25 notes).

## Design

- `scripts/import-vault.mjs <folder> <workspace> [--include p]... [--exclude p]... [--dry-run]`.
- **Parsing:** strip a BOM, normalise Windows line endings, read YAML frontmatter into the note's
  `frontmatter`. The title is the frontmatter `title`, else the file name. Unreadable frontmatter
  is not fatal: the whole file becomes the body and the run reports a warning.
- **Selection:** every `.md` under the folder except dot-folders; `--include` and `--exclude` take
  folder or file paths, case-insensitive. Files over 1 MB are skipped and reported.
- **Folders:** each directory that directly holds an imported note gets a `folders` row, and the
  note points at it, so folder-level sharing works later. No sharing is set.
- **Idempotence:** a note is matched by path within the workspace and updated only when its title,
  body or frontmatter differ. A hive note whose file has gone is reported and kept.
- **Failure isolation:** notes are created in batches of 50; if the database refuses a batch, its
  notes are retried one by one so a single bad note is reported and the rest go in.
- **Identity:** the script exchanges the agent token for the owner's ids (`agent_login`) and signs
  a 30-minute person identity with the JWT secret. It shares the legacy-secret dependency of
  [gotcha 06](../../../vault/decisions/2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret.md).
- **Structure:** the importer talks to the database only through a seven-method store. The tests
  use a PGlite store under row-level security; the script uses a REST store.

## Left to the builder

Mapping a note's `related` frontmatter and wiki links onto hive links belongs to the link job.

## Plan, execution DAG and budget

One chain: tests → importer → dry run on the real folder → real run → re-run to prove idempotence
→ docs. No parallel batches. No UI. A run reads the workspace's notes once in pages of 200 over the
`(workspace_id, path)` unique index, then writes in batches of 50; nothing is unbounded.
