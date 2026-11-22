---
type: session
date: 2026-11-22-1645
branch: task/ui-keystone-glass
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-22-decision-13-keystone-glass-look-with-themes]]"
  - "[[2026-11-20-decision-07-brain-dashboard-is-the-map]]"
---

# Keystone glass UI direction (design only)

## What changed

- `docs/ui/map.dc.html` replaced with the new map prototype: wash background, glass map card and side panel, icon nav rows, an Appearance panel (17 themes, dark and light, reach, dot colours).
- `docs/ui/themes.json` added: seed values for the 17 themes in both modes, copied from Monolith `develop` (2026-11-18).
- `docs/ui-concept.md` section 2 rewritten (visual language, themes, mode, reach, generated dot colours); layout paragraph, accessibility and performance notes updated. Section numbers are unchanged.
- [[2026-11-22-decision-13-keystone-glass-look-with-themes]] recorded; north-star notes that `web/` still has the old look.

## Why

Danijel wanted the UI closer to Monolith's current design, then distinct from it. He picked the Keystone option of three, then asked for Monolith's themes, glass, and dots that follow the theme. This was done in a design chat on the canvas while a separate session built the map in `web/`.

## How to test (for the user)

No user-facing behaviour to test: this is documentation and a reference prototype. To see the design, open the "Hive Mind UI Samples" canvas and use the Appearance panel at the bottom of the left rail.

## Open threads

- `web/` is not restyled. `web/src/app/globals.css` and `web/src/map/map.module.css` still carry the navy tokens and Geist.
- The prototype was never rendered and checked by the session that wrote it; only the dot-colour logic was run. Danijel looked at it on the canvas and approved.
- No contrast test for theme, mode and reach combinations; no fallback where `backdrop-filter` is unsupported; where the appearance choice is stored is undecided.
- `docs/ui/chat.dc.html` is still in the old look.
- The vivid top glow and the light-mode Classic dot colours are approximations, not Monolith values.
- The web-map spec and plan still describe the navy tokens; they are a record of what was built and were left as they are.
