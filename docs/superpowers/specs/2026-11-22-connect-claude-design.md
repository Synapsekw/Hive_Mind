# Connecting the owner's Claude — short design

T3 of [Phase 1 — Local end to end](../plans/2026-11-21-local-end-to-end.md).

## Intent

Get a real agent using the hive in real work, so the instruction template is tested by use rather
than by reading it. The owner's Claude Code is the agent; the hosted dev project is the hive.

## Goals, non-goals, anti-goals

- **Goals:** the `hive` server available to Claude Code on the owner's machine; one folder whose
  sessions read and write the hive; an instruction template that only promises what is built.
- **Non-goals:** Claude Desktop or the web apps (they need the remote connector, phase 3), file
  storage (T5), importing existing notes (T4).
- **Anti-goals:** secrets copied into a client config file; every session on the machine writing
  to the hive whether or not the work should be remembered.

## Approaches

1. **Server for the whole user account, instructions in one folder — picked by Danijel.** The
   server is registered at user scope so any session can reach it, but only `E:\Dev\hive-work`
   carries the instructions to use it. More folders can opt in later with the same file.
2. **This repo only (`.mcp.json` entry).** Contained, but the only notes would be about building
   Hive Mind.
3. **Everywhere (user-level instructions).** Most coverage, most noise, and no way to have a
   session that is not recorded.

## Design

- **Launch without copying secrets.** The server is started as
  `node --env-file=<repo>/.env <repo>/mcp/dist/index.js`, so the URL, keys and token stay in the
  one git-ignored `.env`. Registered with `claude mcp add --scope user hive -- …`.
- **A dedicated folder.** `E:\Dev\hive-work\CLAUDE.md` holds the instructions. It is outside the
  repo and not tracked; the template it was written from is
  [agent-integration.md §5](../../agent-integration.md#5-instruction-template).
- **Template fixes found while writing it:** the old template told the agent to save files and
  write a session note with tools that are only designed; it did not say that `hive_write` replaces
  the whole note, where to put notes, or what to do when a tool fails. The new one is limited to
  the six built tools.
- **Verification:** `claude mcp list` shows `hive` connected; a headless read-only session in
  `hive-work` called `hive_overview` and reported workspace `Main`, tier `vendor`.

## What is left to the owner

The real working session: open Claude Code in `E:\Dev\hive-work`, do real work, and note where the
instructions fall short. Those notes feed the next revision of the template.

## Plan, execution DAG and budget

One chain: register the server → write the folder's instructions → verify → update the docs. No
parallel batches. No UI; a session's start costs one `hive_overview` (bounded to 20 notes) plus
whatever searches the topic needs.
