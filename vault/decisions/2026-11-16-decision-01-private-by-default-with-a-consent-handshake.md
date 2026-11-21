---
type: adr
date: 2026-11-16
status: accepted
tags: [decision]
related:
  - "[[2026-11-16-decision-02-sharing-rules-live-in-the-database]]"
---

# Decision 01 — Private by default, with a consent handshake

## Context

Colleagues will put personal and client work through the same agent. Competing products share everything a teammate writes the moment it is written.

## Decision

A note is private until its owner shares it, per note or per folder. When the platform finds two members working on the same thing it tells both, naming only the entity, and the notes open to each other only after **both** accept. A decline is silent.

## Rationale

Trust is the product. Nobody connects their real work to a shared memory that can leak it. The handshake also lets overlap be detected on private notes without exposing their content.

## Consequences

- Positive: the main differentiator against shared-store competitors.
- Negative: knowledge spreads more slowly than in an everything-shared pool.
- Open follow-ups: muting overlap detection per folder; a removed member's shared content stays by default and the owner can withdraw it.
