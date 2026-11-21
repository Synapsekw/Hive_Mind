---
type: index
status: active
last-updated: 2026-11-21
tags: [project/hive-mind, adr, index]
---

# Decision and gotcha index

One line each. Two separate sequences: `decision-NN` and `gotcha-NN`. Before minting a new one,
take the **next free number** (decision **12**, gotcha **04**) and add a row here. Never rename
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
- **D09** [[2026-11-20-decision-09-embeddings-and-storage-deferred]] — no embeddings or storage in the first slice

## UI

- **D07** [[2026-11-20-decision-07-brain-dashboard-is-the-map]] — one dot per note, six views; other layouts rejected

## Workflow

- **D10** [[2026-11-21-decision-10-task-worktrees-nested-in-the-project]] — worktrees under `.claude/worktrees/`
- **D11** [[2026-11-21-decision-11-plans-must-state-execution-dag]] — every plan states its DAG

## Gotchas

- **G01** [[2026-11-20-gotcha-01-tests-stub-supabase-auth]] — green tests prove the SQL, not real Supabase
- **G02** [[2026-11-20-gotcha-02-mcp-server-untested-end-to-end]] — the MCP sign-in has never run on a live stack
- **G03** [[2026-11-16-gotcha-03-brand-name-is-unresolved]] — "Hive Mind" and "Cortex" are both crowded
