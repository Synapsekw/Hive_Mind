---
type: adr
date: 2026-11-24
status: accepted
tags: [decision, product, cost]
related:
  - "[[platform-roadmap]]"
---

# The hive owner pays for hive maintenance

## Context

Some work keeps a hive useful without belonging to any one member: finding links between notes,
keeping the entity registry, rebuilding synthesis pages, noticing overlap. From Phase 4 on, much
of it needs a language model or embeddings, so it costs API tokens. Each member already brings
their own agent (Claude, ChatGPT) for their own writing, paid from their own subscription.

## Decision

Danijel, 2026-11-24: hive maintenance is paid by the hive's owner. The owner sponsors the API
tokens that maintenance uses; a member who joins a hive benefits from it and never has to supply
an API key of their own for it. A person supplies keys only when they run a hive of their own.

## Rationale

A member's key would make the hive's quality depend on who happens to have one, and would put a
cost on being invited. The owner is the one who decided to have the hive and who answers for it.

## Consequences

- Positive: joining a hive costs a member nothing beyond their own agent.
- Negative: the owner carries a cost that grows with the hive, so maintenance needs a budget the
  owner can see and cap.
- Open follow-ups: Phase 4 must run maintenance on the server with a key held per hive (a server
  secret, never in a browser, a prompt or a log), never through a member's agent or key. Where
  the key is stored, how spending is shown and capped, and what a self-hosted hive configures are
  to be designed with Phase 4.
- Not affected: turning wiki links into links (2026-11-24) uses no model and no tokens.

## Related

- `docs/superpowers/specs/2026-11-24-wiki-links-design.md`
