---
type: adr
date: 2026-11-21
status: accepted
tags: [decision]
related: []
---

# Decision 11 — Plans must state an execution DAG

## Context

Plans written as a flat list hide which tasks can run at the same time.

## Decision

Every plan for multi-task work has an Execution DAG section: dependencies, parallel batches and the critical path. `/whats-next` and `/develop` schedule from it.

## Rationale

Carried over from Monolith. Concurrency that is not written down is not used.

## Consequences

- Positive: parallel sessions by default.
- Negative: a little more planning per plan.
