---
type: session
date: 2026-11-24-2023
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: [[2026-11-16-gotcha-03-brand-name-is-unresolved]]
---

# A real logo: the linked hive and HIVE MIND

## What changed

- New mark, picked in the visual companion from four "hive + network" concepts: two halves of a
  hexagon joined by one link (two people's sides, linked only after both accept). Inline SVG in
  `web/src/brand/Mark.tsx`, coloured only by theme variables (`--mark`, `--fresh-4`, `--fresh-7`),
  so all eight themes recolour it.
- Wordmark `web/src/brand/Logo.tsx`: **HIVE** Inter 700, **MIND** Inter 300 muted, 0.08em
  tracking; reads as "Hive Mind". Inter's declared weight range widened to 300–700.
- Login, join, password and consent cards show mark + wordmark in the `h1`; the rail shows the
  mark beside the hive switcher (signed out: "Hive Mind"). The 60° hover turn is replaced by the
  link brightening. Tab title "Hive Mind"; favicon `web/src/app/icon.svg` (Honey colours).
- Spec `docs/superpowers/specs/2026-11-24-logo-design.md`, plan
  `docs/superpowers/plans/2026-11-24-logo.md`. Merged as `2fa8710` (`3fa2d8d`).
- Folded and removed the stray `_draft-2026-11-24-1533.md` (it was the themes session, already
  written up in [[2026-11-24-1928-eight-hand-tuned-themes]]).

## Why

The placeholder hexagon didn't look good. Danijel asked for a proper mark and for the wordmark
to read HIVE MIND, which goes against gotcha 03 ("the product UI says Hive" because of HIVEMIND
trademarks). The name is still a working name; the wordmark sits in one component, so it's cheap
to change.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev:web`, open `http://localhost:3000/login`. Expected: the mark
   (two orange half-hexagons joined by a light link) followed by **HIVE** in bold and **MIND**
   lighter and muted; the browser tab shows the new icon and the title "Hive Mind".
2. Sign in. Expected: the top of the left rail shows the new mark, then your hive's name as
   before; hovering that row makes the link in the middle of the mark brighter.
3. Account menu > Appearance: switch to Abyss, then Paper. Expected: the mark recolours with each
   theme (teal in Abyss; burnt orange, grey and near-black in Paper).
4. Fold the rail with `[`. Expected: only the mark shows, centred.
5. Or on the live site after a redeploy from `develop`.

## Open threads

- Brand name: gotcha 03 is still open; the UI now says Hive Mind. Run the trademark and domain
  check before anything public.
- No Apple touch icon or PNG fallback for the favicon (SVG only).
- In the first full run of the browser tests, 3 login and join tests timed out while many tests
  ran at once; all 30 passed when run again.

## Next session entry point

Have Danijel look at the logo across the themes; if he wants it tuned (size on the cards, stroke
weight), it's all in `web/src/brand/`.
