---
type: spec
status: approved
date: 2026-11-24
tags: [project/hive-mind, ui, brand]
---

# Logo: a linked hive, and the HIVE MIND wordmark

The placeholder logo is a filled hexagon cut with `clip-path` and the word "Hive". This replaces it
with a real mark and wordmark, chosen in the visual companion from four concepts and four type
treatments.

## The mark

Two halves of a hexagon with a gap between them, bridged by one link with a node at each end: two
people's halves of the hive, linked only after both accept. Drawn as inline SVG on a 48 × 48
view box with round caps and joins (stroke 3.4):

- left half `M20 7.6 L8.4 14.3 L8.4 33.7 L20 40.4` in `--mark` (the theme's accent);
- right half `M28 7.6 L39.6 14.3 L39.6 33.7 L28 40.4` in `--fresh-4` (the middle of the ramp);
- link `M17 24 L31 24` in `--fresh-7`, with a node (r 4) at 17,24 in `--mark` and at 31,24 in
  `--fresh-7`.

Every colour is a theme variable, so all eight themes recolour it with no extra work, and the
colour-literal lint stays clean.

## The wordmark

"HIVE MIND" in capitals: **HIVE** Inter 700 in `--text`, **MIND** Inter 300 in `--muted`, letter
spacing 0.08em. The self-hosted Inter is a variable font; its declared weight range widens from
`400 600` to `300 700` so these weights are real, not synthesised.

## Where it appears

| Place                          | What shows                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Left rail, signed in           | The mark (18 px), then the hive's name as the hive switcher, unchanged                        |
| Left rail, signed out          | The mark, then "Hive Mind" (`BRAND`)                                                          |
| Rail folded                    | The mark alone, as now                                                                        |
| Login, join, password, consent | Mark (32 px) + wordmark, inside the page's `h1`; the heading's accessible name is "Hive Mind" |
| Browser tab                    | Title "Hive Mind"; favicon `web/src/app/icon.svg` in Honey colours (Next's file convention)   |

The rail's hover turn (60°) goes: two halves rotated read as broken. On hover the link brightens
instead (opacity 0.75 to 1). Reduced motion keeps no transition, as before.

The favicon is a file Next serves as-is, so it carries literal colours; it is an `.svg`, which the
colour-literal lint does not scan.

## Units

- `web/src/brand/Mark.tsx` — the mark. Props: `size` (px). `aria-hidden`, `focusable="false"`.
- `web/src/brand/Logo.tsx` — mark + wordmark. Renders a span whose accessible text is
  "Hive Mind" (the visible letters are capitals by CSS, so a screen reader hears words).
- `web/src/brand/brand.module.css` — wordmark type and the link hover hook.
- Call sites: `shell/Shell.tsx`, `app/login/page.tsx`, `join/Join.tsx`, `join/Password.tsx`,
  `app/oauth/consent/Frame.tsx`; `shell/hiveText.ts` (`BRAND`), `app/layout.tsx` (title, font).
- Old `.mark` rules in `login.module.css` and `shell.module.css` are removed; `--grad` and `--mark`
  stay (used elsewhere / by the mark).

Independent units: the favicon has no dependency on the components. The call-site swaps depend
only on `Mark` and `Logo` and touch separate files.

## Performance and data

Static markup; no data, no server round-trip, no client state. The SVG is a few hundred bytes
inline.

## Tests

- Vitest (`brand/logo.test.tsx`, via `react-dom/server`): the logo's text is "Hive Mind"; the mark
  is `aria-hidden`; mark colours are only `var(--…)`.
- `brand/no-literals.test.ts`: no colour literals under `src/brand`.
- Playwright: login heading is "Hive Mind"; the rail still shows the mark and the switcher;
  consent and join headings updated where they assert "Hive".
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
