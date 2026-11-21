---
type: session
date: 2026-11-16-1300
branch: none
trigger: backfill
status: complete
tags: [session]
related:
  - "[[2026-11-16-decision-01-private-by-default-with-a-consent-handshake]]"
  - "[[2026-11-16-decision-03-desktop-apps-first-over-mcp]]"
  - "[[2026-11-16-gotcha-03-brand-name-is-unresolved]]"
---

# Concept, research and the planning docs

Backfilled on 2026-11-21 from the planning conversation. No repo existed yet.

## What changed

- **The concept was settled in a voice brainstorm:** each member's agent writes its own memory;
  members choose what to share; notes on the same client or topic are linked with weighted
  strength; links need both owners' approval; a synthesis page per entity sits on top.
- **Six planning docs written**, now in `docs/`: [[prd]] and the architecture that became
  [[2026-11-16-hive-mind-design]], [[user-stories]], [[security]], [[agent-integration]],
  [[ui-concept]], [[investor-pitch]].
- **Subscription sign-in researched.** Consumer Claude and ChatGPT subscriptions cannot power a
  third-party chat UI except through the vendors' approved sign-in programmes
  ([[2026-11-16-decision-03-desktop-apps-first-over-mcp]]).
- **Competitors found and named** in the pitch: Basic Memory Teams, Mnemoverse, TeamShared,
  Supermemory, Mem0, Zep, Cognee, Letta.
- **Added along the way:** project-per-member isolation with a workspace-bound token, trust tiers
  for self-hosted agents, the housekeeper agent, the super admin role.
- **Naming:** "Hive Mind" and "Cortex" both found crowded
  ([[2026-11-16-gotcha-03-brand-name-is-unresolved]]).

## Why

To turn a one-person agent memory vault into a product a team can trust: the decisions on consent
and on where permissions live had to be made before any code.

## How to test (for the user)

No user-facing behavior to test — this session produced documents only.

## Open threads

- Brand name: shortlist three and check domains and trademarks.
- Market sizing in the pitch is a founder estimate; verify against official SME statistics.
- Applications to the two vendor sign-in programmes.

## Next session entry point

Design the UI and decide local-first vs hosted — see [[2026-11-20-2130-map-design-and-first-backend-slice]].
