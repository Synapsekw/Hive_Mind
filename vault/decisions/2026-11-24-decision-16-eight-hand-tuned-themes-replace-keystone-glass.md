---
type: adr
date: 2026-11-24
status: accepted
tags: [decision, ui, design]
related:
  - "[[2026-11-22-decision-13-keystone-glass-look-with-themes]]"
---

# Decision 16: eight hand-tuned themes replace the Keystone glass look

## Decision

The 18 themes generated from seeds, with their dark and light modes, three reaches and two dot
colour sets, are replaced by 8 themes tuned by hand: Honey (default), Abyss, Ember, Aurora,
Moonstone, Ultraviolet, Blueprint and Paper. Surfaces are flat; the wash gradient, the blooms and
the frosted glass are gone. A theme sets a three-colour freshness ramp, and a fresh note glows
with a halo drawn under a crisp dot.

## Why

Danijel found the generated themes not nice: one recipe in 18 hues, a muddy wash, and a glow that
blurred the dots. Shown eight hand-made looks on a mock of the map, he chose them and asked for
the layout to stay as it is.

## Consequences

- No light version of a dark theme and no dark version of Paper.
- A colour that fails contrast is changed by hand in `themes.json`; the adjustment engine and its
  generated list are deleted.
- Anyone who had chosen an old theme lands on Honey.
- Supersedes [[2026-11-22-decision-13-keystone-glass-look-with-themes]].
