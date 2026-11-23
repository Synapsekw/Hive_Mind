---
type: index
status: active
last-updated: 2026-11-22
tags: [project/hive-mind, adr, index]
---

# Decision and gotcha index

One line each. Two separate sequences: `decision-NN` and `gotcha-NN`. Before minting a new one,
take the **next free number** (decision **13**, gotcha **07**) and add a row here. Never rename
an existing file.

## Product and sharing model

- **D01** [[2026-11-16-decision-01-private-by-default-with-a-consent-handshake]] — private until shared; links need both owners
- **D02** [[2026-11-16-decision-02-sharing-rules-live-in-the-database]] — RLS is the boundary; agents never change sharing
- **D04** [[2026-11-16-decision-04-notes-stay-separate-with-a-synthesis-layer]] — notes for truth, synthesis for speed
- **D05** [[2026-11-16-decision-05-trust-tiers-and-quarantine]] — self-hosted agents are quarantined

## Architecture and build approach

- **D03** [[2026-11-16-decision-03-desktop-apps-first-over-mcp]] — MCP connector first; hosted chat only via vendor programmes
- **D06** [[2026-11-20-decision-06-local-first-on-the-supabase-stack]] — local Supabase, migrations as files
- **D08** [[2026-11-20-decision-08-every-row-belongs-to-a-hive]] — tenancy from day one
- **D09** [[2026-11-20-decision-09-embeddings-and-storage-deferred]] — no embeddings or storage in the first slice (storage arrived 2026-11-22)
- **D12** [[2026-11-22-decision-12-agents-save-files-only-from-the-working-folder]] — the save tool reads only the working folder, never hidden files

## UI

- **D07** [[2026-11-20-decision-07-brain-dashboard-is-the-map]] — one dot per note, six views; other layouts rejected
- **D13** [[2026-11-22-decision-13-keystone-glass-look-with-themes]] — Keystone glass look, 17 themes, light mode, theme-driven dot colours

## Workflow

- **D10** [[2026-11-21-decision-10-task-worktrees-nested-in-the-project]] — worktrees under `.claude/worktrees/`
- **D11** [[2026-11-21-decision-11-plans-must-state-execution-dag]] — every plan states its DAG

## Gotchas

- **G01** [[2026-11-20-gotcha-01-tests-stub-supabase-auth]] — green tests prove the SQL, not real Supabase
- **G02** [[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]] — resolved: the MCP server runs on the hosted project (`pnpm test:live`)
- **G03** [[2026-11-16-gotcha-03-brand-name-is-unresolved]] — "Hive Mind" and "Cortex" are both crowded
- **G04** [[2026-11-22-gotcha-04-supabase-mcp-stamps-its-own-migration-version]] — re-stamp MCP-applied migrations to the repo version
- **G05** [[2026-11-22-gotcha-05-finish-task-cannot-remove-the-worktree-the-session-sits-in]] — resolved: the finish no longer fails at cleanup; an empty folder may remain
- **G06** [[2026-11-22-gotcha-06-agent-sign-in-rests-on-the-legacy-jwt-secret]] — closed: agents sign in through the `agent-session` function; revoke the legacy JWT secret only once every machine runs a build from after that change
