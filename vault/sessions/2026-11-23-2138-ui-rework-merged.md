---
type: session
date: 2026-11-23-2138
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-23-decision-14-the-map-is-drawn-on-one-canvas]]"
  - "[[2026-11-22-decision-13-keystone-glass-look-with-themes]]"
---

# UI rework merged: a living map, the Hive view and the Hive theme

## What changed

- Brainstormed with live prototypes (on the fixture and on the real 1,605-note DRA vault); spec `docs/superpowers/specs/2026-11-23-ui-rework-design.md`, plan `docs/superpowers/plans/2026-11-23-ui-rework.md`; built by subagents in five batches; merged to `develop` as `39a85bd` (not yet on `main`).
- Map: one canvas with a hidden list of real buttons ([[2026-11-23-decision-14-the-map-is-drawn-on-one-canvas]]); zoom, pan, pinch, labels that appear as you zoom without overlapping; hover peek, firing links, staggered view glides, Orbit drag; legend dock; side panel with count-up, 14-day line and "Needs you".
- New **Hive** view (the opening view; Circle removed): a honeycomb with a territory per topic, honey fill by recency over two weeks, capped cells for unshared items, geometric agent marks (live, today, idle) and an "At the hive" panel.
- New **Hive** theme (honey and amber, colour only) is the default; 18 themes; its light seeds were darkened for contrast; `--mark` token.
- Rail: sliding active bar, collapsible agents card, account popover (Appearance, Settings, Sign out); name, role and hive load in the root layout. Vault, gallery, inbox and settings got shared hover and motion tokens.
- Gates: typecheck, lint, 149 node and 970 web unit tests, build, and all 173 browser tests (including a 5,000-item performance check).

## Why

The app looked static: no hover, no motion, graphs not zoomable, a messy legend and rail. Measuring the prototype on the real DRA vault showed DOM dots could not stay smooth at real size, which drove the switch to a canvas.

## How to test (for the user)

1. Pull `develop`, `pnpm install`, `pnpm dev:web` (needs `web/.env.local`).
2. Open `http://localhost:3000/dev/map`: it opens on the Hive view in the amber theme.
3. Hover a dot: it glows, light runs along its links, a peek card shows title, topic and author.
4. Scroll to zoom toward the cursor, drag to pan; labels appear without overlapping; Fit (bottom right) or `0` returns to 100%.
5. Click a dot: the camera frames it and the side panel shows it; "‹ Today" goes back.
6. Switch Rings, Topics, Links, Timeline: dots sweep in a wave; in Orbit, drag to spin.
7. In Hive, "At the hive" (top right) names live agents; a live agent's hexagon glows and moves a few cells.
8. Dock (bottom left): hover a topic to preview, click to pin, click again to unpin.
9. Rail: open the agents card and the account popover (Appearance, Settings, Sign out); Escape closes it.
10. `http://localhost:3000/dev/map?items=5000` stays smooth when zooming and switching views.
11. Turn on "Reduce motion" in the OS and reload: nothing moves on its own.

## Open threads

- Promote `develop` to `main` (PR) and redeploy the Netlify site.
- The rail's active bar does not slide between pages (each page renders its own rail); make the rail persistent.
- Removed dots vanish without a fade-out; the renderer and `MapCanvas.tsx` are large with no unit tests; the account read runs twice per request (wrap `ownHive` in `cache()`).
- "Other" holds 389 DRA notes because the map names only the 7 largest topics.

## Next session entry point

Open the promotion PR `develop → main`, check the map on the live site, then pick up server-emailed invitations as planned in §3.
