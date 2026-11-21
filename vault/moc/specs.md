---
type: moc
status: active
tags: [moc/specs]
related: ["[[00-north-star]]"]
---

# Specs — Map of Content

> Index of design docs. The vault is the whole repo, so docs in `docs/` are linked as
> `[[wikilinks]]` and indexed by Dataview below. Frontmatter-or-die: every doc needs a `type:` to
> appear in the live query.

## Master spec

- [[2026-11-16-hive-mind-design]] — **Hive Mind — Master Design Spec** (`docs/superpowers/specs/`).
  Stack, architecture, data model, sharing rules, MCP server, data flows, onboarding, phased build
  plan, guardrails, manual responsibilities.

## Supporting docs

- [[prd]] — product requirements
- [[user-stories]] — per role, with acceptance criteria
- [[security]] — threat model and controls, with what is built vs designed
- [[agent-integration]] — tool surface, trust tiers, guardrail layers, instruction template
- [[ui-concept]] — tokens, the map's six views, other pages
- [[investor-pitch]] — positioning, competitors, market

## Plans

- [[2026-11-21-local-end-to-end]] — Phase 1 (current goal; `/goal` points here)

## Live: all specs/docs by recency

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs"
WHERE type
SORT file.mtime DESC
```

## Derived

- [[platform-roadmap]] — the build plan with live status
- [[architecture]] — the stack and data model as a code-structure map

## Related MOCs

- [[architecture]]
- [[operations]]
