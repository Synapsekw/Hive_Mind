---
type: adr
date: 2026-11-22
status: accepted
tags: [decision]
related:
  - "[[2026-11-20-decision-07-brain-dashboard-is-the-map]]"
---

# Decision 13 — The look is Keystone glass, with themes

## Context

The first map was built with a navy look of its own (`#06090F`, Geist, pills). Danijel asked for the UI to take cues from the Monolith app's current design, then for it not to look like a copy of Monolith. Three options were shown (Keystone, Quiet, Agent dock); he picked Keystone, asked for Monolith's themes, then for glass and for dots that change colour with the theme.

## Decision

Hive's look is "Keystone glass":

- Monolith's layout grammar: rail and side panel on a coloured wash, content on one inset card, monochrome chrome, hairlines that brighten, Inter and JetBrains Mono.
- Monolith's 17 themes, dark and light mode, and the three reach levels, with the same seed values (`docs/ui/themes.json`).
- Hive's own: the map card and side panel are frosted glass over the wash, and the eight topic colours are generated from the theme's two accents, with a "Classic" switch for the fixed eight.

Decision 07 stands: the map is still one dot per note with six views. Only the look changes. Reference: `docs/ui/map.dc.html` and `docs/ui-concept.md` section 2.

## Rationale

One design language across our products is cheaper to build and maintain; the glass and the theme-driven dots are what make Hive recognisable next to Monolith.

## Consequences

- Positive: themes cost nothing per component, because a theme only supplies seed values.
- Negative: the theme values are a copy. When Monolith changes its themes, Hive does not follow unless someone re-copies them.
- Negative: in "Follow theme" a topic has no fixed colour across themes, and topics are closer in hue than in Classic.
- Open follow-ups: a contrast test over every theme, mode and reach; a fallback where `backdrop-filter` is unsupported; where a person's appearance choice is stored; the chat screen (`docs/ui/chat.dc.html`) is still in the old look; the Quiet and Agent dock options were not chosen but the agent dock may return for chat.
