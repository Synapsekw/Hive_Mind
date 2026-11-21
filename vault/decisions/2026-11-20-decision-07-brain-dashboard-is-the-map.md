---
type: adr
date: 2026-11-20
status: accepted
tags: [decision]
related: []
---

# Decision 07 — The map is the brain dashboard

## Context

Five map designs were tried. Rejected: an entity-level "neural map", three per-note cluster layouts, and a plain force graph.

## Decision

The map is one dot per note or file with six views of the same graph (rings, circle, topics, links, timeline, orbit), slim rails, and a right rail that swaps between today's activity and the selected item. Reference: `docs/ui/map.dc.html` and `docs/ui-concept.md`. The structure follows the dashboard in the MAPS guide (github.com/pavrus117/ai-os-maps-guide), built with Hive's own look.

## Rationale

It shows every note, not just topics, and "show, don't store" keeps the page a pure view of the database. Danijel chose it and asked that the other options be ignored.

## Consequences

- Positive: one design to build against.
- Negative: six layouts of ~hundreds of dots must stay one fetch and zero further round-trips.
- Open follow-ups: the fly-to animation; a camera for large hives.
