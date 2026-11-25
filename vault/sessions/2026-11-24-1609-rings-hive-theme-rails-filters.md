---
type: session
date: 2026-11-24-1609
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-2138-ui-rework-merged]]"
  - "[[2026-11-23-decision-14-the-map-is-drawn-on-one-canvas]]"
---

# Rings as the main view, a near-black Hive theme, folding rails and a filter bar

## What changed

- Brainstormed the map's look again on the real DRA vault (1,639 notes) with clickable prototypes: Rings, Hive, Constellation, Atlas, Mosaic and a semantic map. Danijel chose **Rings**. Research into other tools is summarised in the conversation, not in the repo.
- **Rings is the main view** (merge `3181beb`): three views (Rings, Timeline, Orbit); Hive, Topics and Links views and the honeycomb code are gone. Rings draws one colour, brighter when fresher, freshest notes innermost, group names outside the circle, only the index-to-hub spokes at rest, scaled to fit 5,000 items. "Arrange by" Folder, Links or Time. Spec `docs/superpowers/specs/2026-11-24-rings-main-view-design.md`.
- **Hive theme, dark mode only** (`d54464e`, `231f3fd`): near-black wash and card, background glows at 30%, honey hubs and a stronger glow in Rings (seed fields `rings` and `bloom`; tokens `--rings-hub`, `--rings-glow`). The other 17 themes are unchanged.
- **Filter bar and folding rails** (merge `0833845`): the legend dock became a filter bar (lists with several choices, chips, a count, Clear all, Legend); the left rail folds to icons on every page and the map's right panel to a strip (cookie `hive-fold`, keys `[` and `]`); a resize keeps the map's view. Spec `docs/superpowers/specs/2026-11-24-rails-and-filters-design.md`.
- Gates on the final code: 1,772 web unit tests, 328 browser tests, typecheck, lint, build.

## Why

The first rework made the map move but Danijel still found it unlike any chosen direction and the rails and legend messy. Seeing each look on his own vault settled the choice; the rest is polish on that choice.

## How to test (for the user)

1. Pull `develop`, `pnpm dev:web`, open `http://localhost:3000/dev/map`: it opens on Rings, near-black, honey dots, fresh ones glowing near the centre.
2. "Arrange by" Time, Links, Folder: dots glide into new groups and the filter bar's first button is renamed.
3. Click Folders, tick two: both sectors light, two chips, "N of 301 shown". Hover a third row: it previews. Clear all.
4. Click a "By person" row on the right: a person chip appears.
5. Press `[`: the left rail folds to icons; reload, it stays. Press `]`: the right panel folds; click a dot, it opens.
6. Zoom in, fold either side: the zoom stays.
7. `/dev/map?inbox=2` with the panel folded: the strip shows 2. `/dev/map?items=5000`: still smooth.
8. Account menu, Appearance, Keystone: its hubs keep their colours and its background is as before.

## Open threads

- Not promoted to `main`; the live site was not redeployed by this session.
- Parked from the brainstorm: grouping by meaning (needs an embedding per note), reading a note in place, a work pane, search over note text, fewer pages.
- The 5,000-item frame checks sit at 33.4 ms against a 34 ms limit and fail when another session runs browser tests at the same time; they now run alone with two retries. `join.spec.ts:183` is flaky in full parallel runs and passes alone.
- Old notes' outline is below 3:1 contrast on the light glass card in some themes; the glow is off above 400 fresh notes; a group label can be cut at the stage edge when zoomed in.
- Fold keys are ignored with Shift held; folding the panel while pointing at a "connections" row can leave that dot hot; the filter bar is not laid out for phone width; Safari and Firefox behaviour is untested.
- Playwright's project setting makes the browser tests run at 1280 x 720, not the 1600 x 1000 the config's top level says.

## Next session entry point

Have Danijel try the map on the real hive, then promote `develop` to `main` and redeploy. If he wants more of the prototype's look, the next step is grouping by meaning.
