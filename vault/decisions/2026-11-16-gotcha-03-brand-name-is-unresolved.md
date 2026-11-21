---
type: adr
date: 2026-11-16
status: open
tags: [gotcha]
related: []
---

# Gotcha 03 — The brand name is unresolved

## Context

"Hive Mind" has several registered HIVEMIND trademarks, including one held by a large autonomy and drone company. "Cortex" is more crowded still: every major domain is taken and a desktop agent product uses the name.

## Decision

"Hive Mind" is the working name and concept word only. The product UI says "Hive". Shortlist three names and run proper domain and trademark checks before anything public.

## Rationale

Researched 2026-11-16; names floated: Myelin, Dendrite, a compound of Cortex.

## Consequences

- Keep the name out of identifiers that are hard to change later (package names are `hive-mind` and `@hive-mind/mcp` for now).
