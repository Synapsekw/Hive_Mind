---
type: session
date: 2026-11-24-1928
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-24-decision-16-eight-hand-tuned-themes-replace-keystone-glass]]"
  - "[[2026-11-24-1609-rings-hive-theme-rails-filters]]"
  - "[[2026-11-24-1829-hub-hover-perf]]"
---

# Eight hand-tuned themes replace the generated set

## What changed

- Brainstormed the look with Danijel on clickable mocks. He liked the glow, disliked the themes, chose eight hand-made ones (Honey, Abyss, Ember, Aurora, Moonstone, Ultraviolet, Blueprint, Paper) and asked that the layout and sections stay as they are. Spec `docs/superpowers/specs/2026-11-24-theme-set-design.md`, plan `docs/superpowers/plans/2026-11-24-theme-set.md`.
- **Theme engine** (merge `51475bb`): `themes.json` holds one flat record per theme; `tokens.ts` maps a record straight to tokens; the adjustment engine, the 102-combination contrast model, Mode, Reach and Dot colours are gone. Appearance is eight swatches. The cookie `hive-look` holds a theme id; an old value falls back to Honey.
- **Surfaces are flat:** no wash, bloom, frosted glass or scope attributes; the map card has one faint tint (a grid in Blueprint). No layout declaration changed, checked by two reviews.
- **Rings:** a note's colour comes from the theme's freshness ramp (eight steps), a fresh note has a halo stamped under a crisp dot, and hubs take the theme's hub colour. Halos are skipped above 400 fresh notes; hubs keep theirs.
- Integrated with `task/hub-hover-perf`, which merged meanwhile and changed the same renderer: the hot dot's neighbour batches now follow the ramp and halo rules (`4adeb69`).
- Gates on the merged state: 1,833 web unit tests, typecheck, lint, build; the affected browser specs and all frame checks pass (16.8 ms p95 at 5,000 items; hub hover 16.8 ms).

## Why

The 18 themes were one recipe in 18 hues on a muddy wash, and the glow blurred the dots. Seeing hand-made looks on a mock of his own map settled it; the decision is recorded in [[2026-11-24-decision-16-eight-hand-tuned-themes-replace-keystone-glass]].

## How to test (for the user)

1. Pull `develop`, `pnpm dev:web`, open `http://localhost:3000/dev/map`: Honey, true black, old notes dim umber, fresh ones gold with a soft halo that breathes, honey hubs.
2. Account button (bottom left), Appearance: eight swatches and nothing else. Click each: the page changes at once, no reload.
3. Ember: old notes are dull red, fresh ones near white. Aurora: violet to mint, violet hubs. Blueprint: a fine grid on the map card, yellow hubs. Paper: the light one, dark dots on a honey highlight, dark text on the rail.
4. Reload: the theme stays. Hover a hub: it and its neighbours keep their halos.
5. Timeline and Orbit: unchanged apart from the theme's topic colours. Click Rings, Timeline, Orbit: the highlight still slides.
6. Vault, Gallery, Inbox, Settings in Honey and in Paper: nothing has moved; cards and popovers are solid; text is readable; a selected note row is tinted.
7. `/dev/map?items=5000`: still smooth; with that many fresh notes there are no note halos, by design.

## Open threads

- Not deployed and not promoted; the live site still shows the old themes.
- Parked: moving the filters and the scattered map controls, which Danijel raised first and then set aside ("don't touch the current layout").
- Seven themes have no light version and Paper no dark one. Old notes (ramp steps 0 to 4) are below 3:1 against the card on purpose.
- A frame check run against a dev server through a throwaway Playwright config reported 17 ms where the repo's `perf` project reported 50 ms. Only `npx playwright test e2e/map-perf.spec.ts --project=perf --no-deps` counts; `hub-map-perf.spec.ts` must be named on its own.
- The halo loop exists twice in `renderer.ts` (`drawDots` and `drawNear`); a shared helper is a small follow-up. Neighbour batches are not sorted by freshness.
- A subagent told to stop its own leftover servers also stopped Danijel's dev server on port 3000; briefs now say "stop only the pids you started".
- Implementer commits carry "Co-Authored-By: Claude Sonnet 5.5", the model that wrote them.

## Next session entry point

Have Danijel try the eight themes on the real hive, then deploy `develop`. If he wants the map controls and filters rearranged, start a new brainstorm from the critique at the top of this session.
