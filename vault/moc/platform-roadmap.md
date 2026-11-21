---
type: moc
status: active
tags: [moc/roadmap]
related: ["[[00-north-star]]"]
---

# Platform Roadmap — Map of Content

> The phased build plan (master spec §10). Phase status is mirrored in [[00-north-star]] §2 —
> bump it there when a phase closes. Commit + checkpoint after each phase: run the gates, write
> the session note, pause for review.

## Phases

| #   | Phase                  | Outcome                                                                               | Status      |
| --- | ---------------------- | ------------------------------------------------------------------------------------- | ----------- |
| 0   | Setup                  | Repo, schema, sharing rules, tests, MCP server skeleton, demo, workflows, vault       | Done        |
| 1   | Local end to end       | MCP server on a live stack, owner's Claude connected, vault import, file storage      | Next        |
| 2   | Web app and map        | Auth, brain-dashboard map on real data, vault browser with sharing controls, inbox    | Not started |
| 3   | Hosting and colleagues | Remote MCP transport, invitations, token UI, first colleague, agent sign-in revisited | Not started |
| 4   | Linking                | Entity registry + extraction, link discovery, notifications, handshake UI, embeddings | Not started |
| 5   | Synthesis and upkeep   | Synthesis pages, contradictions, housekeeper, weekly health report                    | Not started |
| 6   | Hosted chat and admin  | Vendor sign-in chat, SSO, super admin, multi-hive operations                          | Not started |

## Phase 0 — what shipped

- Schema: 14 tables, every row hive-scoped.
- Sharing rules: private by default, folder rules, named members, the two-sided link handshake,
  agent claims, quarantine for self-hosted agents. 10 tests.
- MCP server: `hive_overview`, `hive_search`, `hive_read`, `hive_write`, `hive_append`,
  `hive_propose_link`. Typechecked only.
- `pnpm demo`: the whole story in an in-process database.
- UI: the map (six views) and chat prototypes.

## Phase 1 — plan

[[2026-11-21-local-end-to-end]]: T1 database up → T2 MCP on a live stack (critical path) → T3
connect Claude, T6 second-member proof; T4 vault import and T5 file storage in parallel.

## Why this order

Linking needs a second person, and a second person needs hosting, so hosting (3) comes before
linking (4). The map (2) comes before both because it is how the owner sees whether the import
and the agent writes look right.

## Related MOCs

- [[architecture]]
- [[specs]]
