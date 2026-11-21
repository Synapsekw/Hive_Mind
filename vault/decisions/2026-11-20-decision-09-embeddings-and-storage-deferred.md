---
type: adr
date: 2026-11-20
status: accepted
tags: [decision]
related: []
---

# Decision 09 — Embeddings and file storage are deferred

## Context

The design has an embedding per note and deliverables in Storage.

## Decision

The first migrations ship neither. Search is keyword search over a generated `tsvector`. The embedding column arrives with the link-discovery job, Storage buckets with `hive_save_file`.

## Rationale

The embedding dimension locks the model choice, which has not been made. Storage policies cannot be tested in PGlite and need the local stack.

## Consequences

- Positive: nothing in the schema that is not exercised by a test.
- Negative: no semantic search and no files until phases 1 and 4.
