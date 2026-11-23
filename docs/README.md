---
type: moc
status: active
tags: [project/hive-mind, docs]
---

# Hive Mind — Documentation

Start here. This is the map of Hive Mind's documentation for contributors (human and AI). It does
not duplicate content — it points to the canonical home of each topic.

## The two-layer model

- **`docs/`** (this tree) — the **front door**: product requirements, the master design spec, the
  supporting specs, and per-phase plans. Browsable on GitHub with standard Markdown links.
- **`vault/`** — a tracked **Obsidian dev-memory vault**: the north-star ("where are we"), maps,
  the decision log (ADRs), and session notes. Uses Obsidian `[[wikilinks]]`.

> **Rule of thumb:** _stable product & design intent_ lives in `docs/`; _live state, navigation,
> decisions, and working notes_ live in `vault/`. The [north-star](../vault/00-north-star.md) is
> the single "open this first" entry point for current status.

## Product & requirements

- **[Product Requirements (PRD)](prd.md)** — problem, roles, requirements, non-goals, phasing.
- [User stories](user-stories.md) — per role, with acceptance criteria and priority.
- [Investor pitch](investor-pitch.md) — positioning, named competitors, market sizing.
- [`vault/product.md`](../vault/product.md) — product context: users, purpose, design principles.

## Design & architecture

- **[Master design spec](superpowers/specs/2026-11-16-hive-mind-design.md)** — the engineering
  source of truth: stack, architecture, data model, sharing rules, MCP server, data flows,
  onboarding, phased build plan, guardrails.
- [Security & trust](security.md) — threat model, identity and tokens, data handling, the remote
  connector.
- [Agent integration](agent-integration.md) — supported agents (the local server, and the remote
  connector at `https://<site>/mcp`), tool surface, guardrail layers, the instruction template,
  the housekeeper.
- [UI concept](ui-concept.md) — principles, tokens, the map's six views, other pages. Prototypes
  in [`ui/`](ui/).

## Roadmap & current state

- [Master spec §10 — Phased build plan](superpowers/specs/2026-11-16-hive-mind-design.md#10-phased-build-plan).
- [`vault/moc/platform-roadmap.md`](../vault/moc/platform-roadmap.md) — phase table with status.
- [`vault/00-north-star.md`](../vault/00-north-star.md) — **where we are right now**.

## Per-phase specs & plans

- [`superpowers/specs/`](superpowers/specs/) — design specs (master + per-phase).
- [`superpowers/plans/`](superpowers/plans/) — implementation plans. Current:
  [Phase 1 — Local end to end](superpowers/plans/2026-11-21-local-end-to-end.md).
- Remote connector, sign-in window and hosting (built):
  [spec](superpowers/specs/2026-11-23-remote-connector-design.md),
  [plan](superpowers/plans/2026-11-23-remote-connector.md). An app connects at
  `https://<site>/mcp` through a Hive Mind sign-in window and gets six tools; `hive_save_file`
  stays in the local server.

## How we build here

- [`AGENTS.md`](../AGENTS.md) — the working agreement (branch lifecycle, skills, tests mandatory).
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — full contributor workflow.
- [`README.md`](../README.md) — what exists and how to run it.

## Operations & decisions

- [`vault/moc/operations.md`](../vault/moc/operations.md) — Supabase, MCP, migrations.
- [Bringing up a hosted database](hosted-db-bringup.md) — migrations, first hive, first agent
  token, hosting on Netlify, connecting Claude and ChatGPT.
- [`vault/decisions/`](../vault/decisions/) — decisions and gotchas.
- [`vault/sessions/`](../vault/sessions/) — working-session notes.
