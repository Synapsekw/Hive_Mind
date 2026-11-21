---
type: adr
date: 2026-11-16
status: accepted
tags: [decision]
related:
  - "[[2026-11-16-decision-02-sharing-rules-live-in-the-database]]"
---

# Decision 05 — Trust tiers; self-hosted agents are quarantined

## Context

Any MCP agent can connect, including open-source agents on someone's laptop with no vendor safety layer.

## Decision

A token has a trust tier set by the member at creation: `vendor` or `self_hosted`. A self-hosted agent reads shared notes and what it wrote itself, and everything it writes is quarantined until the member releases it.

## Rationale

Connectivity is not the risk; trust is. Quarantine keeps unreviewed content away from everyone else's agents.

## Consequences

- Positive: open to any agent without lowering the floor.
- Negative: an extra step for members using their own agents.
- Open follow-ups: should vendor agents also start quarantined for a new member's first week?
