---
type: adr
date: 2026-11-23
status: accepted
tags: [decision, ui, performance]
related:
  - "[[2026-11-22-decision-13-keystone-glass-look-with-themes]]"
  - "[[2026-11-23-2138-ui-rework-merged]]"
---

# The map is drawn on one canvas

## Context

The map drew every note, file, link and honeycomb cell as its own DOM element (buttons, SVG
paths). On the real DRA vault (1,605 notes, 6,782 links, 1,951 Hive cells) that ran at 20 to 30
frames a second, and wheel-zoom frames spiked past 100 ms: every zoom step restyled thousands of
elements, and the always-on hub, index and glow animations kept the whole stage repainting even
when idle. The map payload is capped at 5,000 items, so it would only get worse.

## Decision

The map is drawn on one `<canvas>`. Geometry that changes only with the model is batched once per
model; static layers (comb, guides, resting links) are cached as a bitmap and redrawn crisp after
the camera settles; frames are drawn on demand; ambient motion (breathing, the index turning, a
live agent's glow) runs throttled at about 12 fps and pauses off-screen or when the tab is hidden;
only real motion (camera, glides, pulses, Orbit) runs at full rate; nothing moves on its own under
reduced motion. Keyboard and screen-reader access stays through a visually hidden list of real
buttons, one per dot, whose focus draws a ring on the canvas. Panels (peek, dock, zoom control,
"At the hive", side panel) stay ordinary DOM.

## Rationale

A canvas benchmark of the same DRA scene held 60 fps idle, hovering, zooming and panning, with a
full redraw well under a millisecond. Keeping DOM dots and tuning them (counter-scaling, fewer
animations) could not remove the per-element restyle on zoom. A pan/zoom library or WebGL was
not needed for the 5,000-item cap and would add a dependency.

## Consequences

- Positive: smooth at real size; an e2e check holds the 95th-percentile frame of a 1-second wheel
  zoom on 5,000 items under 34 ms; an idle map draws about 10 frames a second instead of 60.
- Negative: tests can no longer read dots' CSS; they read the hidden buttons' `data-lit`,
  `data-x`/`data-y` and canvas attributes (`data-view`, `data-hot`, `data-preview`,
  `data-animating`, `data-ambient`), and one test samples canvas pixels. The renderer
  (`web/src/map/renderer.ts`) and `MapCanvas.tsx` are large and have no unit tests of their own.
- Open follow-ups: split the renderer and add unit tests; dots removed on a refresh vanish without
  a fade-out; the cached layer can reach about 64 MB at device-pixel-ratio 2 (watch iOS canvas
  limits).

## Related

- Spec: `docs/superpowers/specs/2026-11-23-ui-rework-design.md` §1.01
