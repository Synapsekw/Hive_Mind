---
type: adr
date: 2026-11-16
status: accepted
tags: [decision]
related:
  - "[[2026-11-16-decision-01-private-by-default-with-a-consent-handshake]]"
  - "[[2026-11-16-decision-05-trust-tiers-and-quarantine]]"
---

# Decision 02 — Sharing rules live in the database; agents never change sharing

## Context

Most reads and writes come from AI agents, which can be buggy or prompt-injected. Permission checks in server code are one mistake away from a leak.

## Decision

Row-level security in Postgres decides every read and write. The MCP server holds no permission logic: it signs in as the member behind the token and lets the database decide. An agent identity carries `agent_id`, `workspace_id` and `trust_tier` claims, and the database refuses any attempt by such an identity to set visibility, accept a link or delete a note. Agents may propose; people decide.

## Rationale

A hijacked agent can then only write inside its own workspace, and that is versioned. The rule holds for every future client (web app, other MCP servers) without re-implementing it.

## Consequences

- Positive: one place to audit; tested in `tests/sharing-rules.test.mjs`.
- Negative: every access change is a migration plus a test.
- Open follow-ups: storage policies must follow the same rule when files land.
