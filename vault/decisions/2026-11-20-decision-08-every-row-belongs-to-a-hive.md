---
type: adr
date: 2026-11-20
status: accepted
tags: [decision]
related: []
---

# Decision 08 — Every row belongs to a hive from day one

## Context

The first user is one team, but the product is meant for many.

## Decision

`hive_id` is on every content table and every policy is hive-scoped, although only one hive exists today.

## Rationale

Adding tenancy later means rewriting every policy and backfilling every row. It costs one column now.

## Consequences

- Positive: the super admin and multi-hive work in phase 6 need no schema rewrite.
- Negative: slightly more to pass on each insert (triggers fill it in from the workspace).
