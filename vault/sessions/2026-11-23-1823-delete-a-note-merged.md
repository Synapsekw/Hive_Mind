---
type: session
date: 2026-11-23-1823
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-1618-agent-sign-in-without-the-legacy-secret]]"
---

# Agent sign-in promoted; deleting a note merged

## What changed

- **Agent sign-in tried on the Mac and promoted.** With `SUPABASE_JWT_SECRET` removed from
  `.env` and Claude Code restarted, the agent read the hive and wrote
  `test/sign-in-check.md` through the `agent-session` function. PR #5 (`develop` to `main`,
  `c5454e1`) merged after CI passed.
- **Deleting a note merged** into `develop` (`a4f4b13`). In the vault, an open note of your own
  has a quiet **Delete** after the sharing control; a second click, at least half a second
  after the question, removes it for good with its history, links and topic tags. Files
  attached to it stay in the gallery, readable by their owner only. Spec and plan:
  `2026-11-23-delete-note-*`.
- **Migration `20261123123845_note_delete_audit`**: a before-delete trigger writes
  `note.deleted` (the note's id and two counts, never its text) to the audit log. Applied to
  the hosted project through the Supabase MCP and re-stamped. The `notes_delete` policy is
  unchanged: the owner as a person only, never an agent.
- **From the review** (no blocking defect): after deleting a note opened from the map or the
  gallery you stay in its workspace; a burst of clicks on the confirm no longer gets through;
  "Note deleted." and a failure are visible lines; a note opened while a delete runs stays
  open; deletes in progress are tested through `/dev/vault?slow=1`.

## Why

The first hand test of agent sign-in left a test note nobody could remove: agents create
notes, and no screen let a person delete one. Danijel chose a permanent delete with a confirm
over a trash.

## How to test (for the user)

On `develop`, hosted project, `pnpm dev:web` (restart it to pick up the new code).

1. Open **Vault** and the note `test/sign-in-check.md`. Under its title, after the sharing
   button, there is **Delete**.
2. Click **Delete**: it asks "Delete this note? It is gone for good, with its history and its
   links. Files attached to it stay in the gallery." Click **Keep**: nothing happens.
3. Click **Delete**, wait a moment, click **Delete** again: the note closes, leaves the list,
   and a line says "Note deleted."
4. Double-click **Delete** quickly on another note of yours: it only asks, it does not delete.
5. Open a note that is not yours (`Shared with me`, or the test colleague's Acme note): there
   is no Delete.
6. `/dev/vault` shows the same on sample data; `?fail=1` refuses, `?slow=1` makes it slow.

## Open threads

- No undo; a colleague whose note was linked to a deleted one gets no notice; an agent that
  writes the same path again recreates the note under a new id.
- On a workspace delete the audit counts are per note and count files that are then removed,
  not detached.
- The fix-wave agent hung for over an hour on a screenshot step and was stopped; its edits were
  complete and all tests pass, but the visible "Note deleted." line was not looked at in a
  screenshot.
- The legacy JWT secret is still valid; the Windows machine still runs the old MCP build.
- Still open: the two link behaviours, the test colleague's Acme note (the owner cannot delete
  it: it is not his), `task/keystone-glass`.

## Next session entry point

After Danijel has deleted the test note by hand, promote `develop` to `main`. Then the remote
MCP connector, held to "a colleague is connected in two minutes with nothing installed", and
hosting with server-emailed invitations.
