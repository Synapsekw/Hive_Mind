---
type: session
date: 2026-11-23-1139
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-22-2050-keystone-glass-merged]]"
  - "[[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]]"
---

# File gallery and inbox merged; the Mac has its own agent

## What changed

- **File gallery** merged into `develop` (`931fe4a`): `/gallery`, a card grid of the files the
  member may read, a full-window viewer for images and PDFs, download for every file, delete for
  the member's own. No schema change. Spec and plan: `2026-11-22-file-gallery-*`.
- **The Mac has an agent.** A second agent was created for Danijel; its token is in the Mac's
  `.env` (a first token was pasted into the chat, revoked, and replaced). The `hive` MCP server is
  registered in Claude Code at user scope and `/Users/danijeljovanovic/Dev/hive-work` holds the
  instruction file. `pnpm test:live` passes 12 of 12 on the Mac; the two-member suite is skipped
  for lack of a second member's token.
- **Inbox** merged into `develop` (`8d93d80`): `/inbox` lists the link proposals waiting for the
  member's own answer (Accept, Decline) and the member's held notes (Release, Open in vault); the
  rail shows the number waiting on every screen. Migration `20261123071625_inbox` adds two
  partial indexes and the people-only functions `inbox` and `inbox_count`, with 12 database
  tests. Spec and plan: `2026-11-23-inbox-*`.
- **Review of the inbox branch** found that a double click on Decline could decline in one
  gesture on narrow windows; fixed (a confirming press within half a second of the question is
  ignored), with browser tests at three widths. A flaky gallery browser test was fixed too.

## Why

The gallery and the inbox were the last two screens of Phase 2. The inbox is the first place a
person can accept a link, which the database has supported since Phase 0.

## How to test (for the user)

Gallery, on `develop` with `pnpm dev:web`: open **Gallery**; with no files it says "No files
yet". To see files, open Claude Code in `~/Dev/hive-work`, ask it to save a PNG, a PDF and a
spreadsheet to the hive, and reload.

Inbox:

1. Without the database: open `http://localhost:3000/dev/inbox`. Three links and two held notes
   on sample data. Accept removes a row; Decline asks first; Release removes a held note. Try
   `?empty=1` and `?many=1`.
2. On the hosted project, first apply the migration (see Open threads). Then `/inbox` shows
   "Nothing needs you." until an agent proposes a link to a colleague's note or a self-hosted
   agent writes a note.
3. Before the migration is applied, `/inbox` says "Couldn't load the inbox." and the rail shows
   no count; the map, the vault and the gallery work as before.

## Open threads

- **The hosted database does not have `20261123071625_inbox` yet.** Apply the file unchanged
  (Supabase CLI `db push`, or the Supabase MCP followed by the re-stamp of gotcha 04), then
  update "Current state" in `docs/hosted-db-bringup.md`.
- **Two database behaviours older than this work, now reachable from a screen** (in the inbox
  spec's known gaps): a declined link can be proposed again in the reverse direction; and
  `respond_to_link(…, false)` declines a link whatever its status, so declining from a stale tab
  undoes an accepted link. Each needs a product decision, then a migration with a test.
- Accepting or declining a link is still not written to the audit log.
- The gallery has not been tried on real files (the hive has none).
- The merged branch `task/keystone-glass` still exists locally and on GitHub.
- `pnpm test:live` with two members has not run on the Mac (needs `HIVE_AGENT_TOKEN_2`), so the
  new live check of `inbox` has not run anywhere.

## Next session entry point

Apply the inbox migration to the hosted project and try `/inbox` and `/gallery` on real data;
then promote `develop` to `main` (Phase 2 is feature-complete) and decide on the two link
behaviours above before Phase 3.
