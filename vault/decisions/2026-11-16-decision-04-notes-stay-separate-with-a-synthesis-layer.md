---
type: adr
date: 2026-11-16
status: accepted
tags: [decision]
related: []
---

# Decision 04 — Notes stay separate; a synthesis layer sits on top

## Context

When two people share notes on the same client, should the notes merge into one page?

## Decision

Personal notes stay separate and linked. For each shared entity an agent-maintained synthesis page is built from the linked shared notes, with every fact citing its note and owner. Contradictions are flagged for a person, never silently merged.

## Rationale

Separate notes keep provenance, which matters when two colleagues remember a client's pricing differently. The synthesis is what makes the hive answer like one expert without anyone merging by hand.

## Consequences

- Positive: truth and trust in the notes, speed in the synthesis.
- Negative: a background job and a model call per rebuild.
- Open follow-ups: are synthesis pages editable by people or regenerated only?
