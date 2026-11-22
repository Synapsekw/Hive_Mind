---
type: spec
status: draft
last-updated: 2026-11-22
tags: [project/hive-mind, spec, ui]
---

# Keystone glass restyle — design

A restyle of `web/` after
[decision 13](../../../vault/decisions/2026-11-22-decision-13-keystone-glass-look-with-themes.md).
The reference is [`docs/ui/map.dc.html`](../../ui/map.dc.html), the seed values are
[`docs/ui/themes.json`](../../ui/themes.json), and the visual language is
[`docs/ui-concept.md`](../../ui-concept.md) §2.

## Decisions for Danijel

Each is settled below as stated; change any of them in one line.

1. **The appearance choice is stored in a cookie** (chosen 2026-11-22). Per browser, not per
   account. A per-member copy in the database can be added later without changing this design.
2. **Approach A** (chosen 2026-11-22): theme values in one stylesheet, switched by attributes on
   the root element.
3. **Contrast thresholds:** 4.5:1 for all text, 3:1 for quiet labels, dots and focus rings.
   Hairlines are decoration and are not tested. _My call._
4. **A combination that fails is fixed by adjusting the derived colour, never the copied seed.**
   The adjustment moves lightness only, as little as needed. _My call._
5. **The Appearance panel sits at the bottom of the left rail and starts closed.** _My call; the
   prototype shows it open._
6. **Where the prototype and `ui-concept.md` §2 disagree, the prototype wins** and the doc is
   corrected (list in "Corrections to the concept doc"). _My call._
7. **Fonts are self-hosted** from npm packages; no request to Google at build or run time.
   _My call._
8. **A first visit is dark, whatever the system setting** (decision 13's default). _My call._
9. **Contrast wins over the exact look.** That includes the Classic dot colours: if one fails on a
   card it is adjusted like any other colour and the report says so, although decision 13 calls
   them fixed. _My call._
10. **The vault's sharing marks use the text tokens**, not colours of their own, so they are
    covered by the text rows of the contrast test. _My call._
11. **Only what Hive has is drawn:** the rail shows Map and Vault. The prototype's Inbox badge and
    Gallery link wait for their own slices. _My call._

## Intent

The first map and the vault were built in a navy look of their own. Decision 13 replaces it with
Keystone glass so Hive shares one design language with Monolith while staying recognisable: frosted
glass over a theme wash, and topic dots that take their colours from the theme. This slice changes
how `web/` looks and adds the control that lets a person choose a theme. Nothing about what the
screens do, or what they load, changes.

## Goals, non-goals, anti-goals

- **Goals**
  - Map, vault, sign-in and notice screens in Keystone glass, in all 17 themes, dark and light,
    at three reach levels, with "Follow theme" and "Classic" dot colours.
  - An Appearance panel to change the four choices, applied at once with no server round-trip,
    remembered across visits, and correct on first paint (no flash of another theme).
  - A test that every theme × mode × reach combination meets the contrast thresholds.
  - A solid look where `backdrop-filter` is unsupported.
- **Non-goals**
  - The chat screen (`docs/ui/chat.dc.html` stays in the old look, untouched).
  - Any change to behaviour, routes, data loading, the database or the MCP server.
  - Following Monolith's themes automatically; the seeds are a dated copy.
  - Storing the choice per account.
- **Anti-goals**
  - A component that names a theme, or a colour written outside the token files.
  - A theme switch that reloads the page, fetches a file or re-renders the map's layout.
  - The screens no longer fitting one window (the existing fit tests must stay green).
  - Reopening decision 07: one dot per note, six views.

## Approaches

- **A. Theme values in one stylesheet, switched by root attributes (chosen).** Every colour a
  screen needs is worked out ahead of time from the seeds and shipped as CSS variables under
  attribute selectors. Changing a choice sets an attribute and writes the cookie. Works without
  JavaScript after first paint, no flash, and the same code that produces the colours feeds the
  contrast test. Cost: one stylesheet carrying all themes; the root layout reads a cookie, so every
  page is server-rendered (all real pages already are).
- **B. Compute in the browser, as the prototype does.** Quick to port; shows the wrong theme until
  the script runs and cannot be contrast-tested without a browser.
- **C. One stylesheet per theme, fetched on demand.** Smallest first load; a theme change is a
  network request, which the brief forbids.

## Design

### 1. The four choices

| Choice | Attribute on `<html>` | Values                              | Default    |
| ------ | --------------------- | ----------------------------------- | ---------- |
| Theme  | `data-theme`          | the 17 ids in `themes.json`         | `keystone` |
| Mode   | `data-mode`           | `dark`, `light`                     | `dark`     |
| Reach  | `data-reach`          | `subtle`, `tinted`, `vivid`         | `tinted`   |
| Dots   | `data-dots`           | `theme` ("Follow theme"), `classic` | `theme`    |

**Cookie.** Name `hive-look`, value `<theme>.<mode>.<reach>.<dots>` (for example
`keystone.dark.tinted.theme`), `Path=/`, `Max-Age` one year, `SameSite=Lax`, readable by script
(the panel writes it), holds nothing personal. The root layout reads it on the server, checks each
part against the allowed values, falls back to the default for any part that is missing or
unknown, and renders the four attributes on `<html>`. The value is never written into the page
other than as those four checked attributes.

**Changing a choice** sets the attribute on `document.documentElement` and rewrites the cookie.
No request is made. The map does not re-run its layout: dot positions do not depend on colour.

### 2. Tokens

One source of truth in TypeScript (`web/src/theme/`), used by both the stylesheet and the tests:

- `themes.json` — a copy of `docs/ui/themes.json`; a test fails if the two differ.
- `colour.ts` — pure colour maths: hex and sRGB, mixing in sRGB as CSS `color-mix` does, alpha
  compositing, sRGB ↔ OKLCH, WCAG relative luminance and contrast ratio.
- `tokens.ts` — `tokens(theme, mode, reach)` returns every colour token as a final value, using the
  prototype's formulas (below). `dots(theme, mode)` returns the eight generated topic colours.
- A generator script writes `themes.generated.css` from those functions. The file is committed; a
  test regenerates it and fails if it differs, so there is no build step to forget.

**Selectors in the generated file.** `[data-theme][data-mode]` blocks carry everything that does
not depend on reach; `[data-theme][data-mode][data-reach]` blocks carry the card colours and the
Vivid glow; `[data-mode][data-dots="classic"]` carries the fixed eight. `:root` without attributes
resolves to the default combination, so a page always has a look.

**Token list** (names as the prototype uses them; values per the prototype, lines 357–366):

- From seeds: `--brand`, `--brand-2`, `--acc` (= brand), `--fg` (text), `--muted` (textMuted),
  `--grad` (`brand → mid → brand2`, where mid is `brandMid` or the sRGB midpoint), `--sel`
  (brand at 14%), `--wash` (168° gradient of the three stops at 0%, 46%, 100%), `--bloom` (the five
  radial glows; tints at dark 22/18/12 and 16/12, light 18/16/16 and 22/18, light tints mixed 70%
  with white).
- By reach: `--bg` = content mixed with brand at 0 / 5 / 8 % (dark) or 0 / 2.5 / 2.5 % (light);
  `--surface` = surface mixed with brand at 0 / 4 / 7 % (dark) or 0 / 4 / 5 % (light); `--glass` =
  `--bg` at 56% (dark) or 78% (light) opacity; `--glow` = two faint top-edge glows in Vivid, none
  otherwise.
- Fixed per mode: `--fg2`, `--quiet`, `--line`, `--line-hi`, `--fill`, `--fill-on`, `--edge`,
  `--edge-card`, `--glass2`, `--lift`, `--on-brand`, exactly as the prototype sets them.
- Dots: `--hue-1` … `--hue-8` (the existing names, so the dot and chip code keeps working).

**Light mode "bold frame".** The rail and the side panel sit on a saturated wash, so inside a
`chrome` scope the text tokens are white (`--fg`, `--fg2` white; `--muted` white 90%; `--quiet`
white 60%; lines white 24% / 55%; fills white 9% / 18%; `--sel` white 18%; `--grad` white;
`--on-brand` = brand; `--acc` white). A popover inside chrome (the Appearance panel, the vault's
sharing control when it opens in a chrome area) resets to the dark-on-light values.

**Dot colours, "Follow theme".** As the prototype (lines 375–381): take the OKLCH hues of `brand`
and `brand2`; the middle hue is the shortest-arc midpoint; topic _i_ uses step
`[0,4,1,5,2,6,3,7][i]` across a 160° fan centred on the middle hue; lightness alternates 0.82 /
0.72 (dark) or 0.60 / 0.50 (light); chroma 0.14 (dark) or 0.15 (light). When `brand` has chroma
below 0.03 (Graphite today) the eight are near-greys at chroma 0.012 with lightness rising in eight
steps (dark from 0.55 by 0.055; light from 0.30 by 0.06). Colours outside sRGB are brought in by
reducing chroma. **Classic** is the fixed eight of `ui-concept.md` §2, with its light-mode set.

### 3. Contrast

A unit test (no browser) runs over every theme × mode × reach — 102 combinations — and, for dots,
over both dot settings. Translucent layers are composited before measuring: the card is `--glass`
over the wash; the side panel is `--glass2` over the wash; each is measured against all three wash
stops and against the brightest point of the bloom on that stop, and the worst case counts.

| Pair                                                              | Minimum  |
| ----------------------------------------------------------------- | -------- |
| `--fg`, `--fg2`, `--muted` on the card                            | 4.5:1    |
| chrome `--fg`, `--muted` on the wash (rail) and on the side panel | 4.5:1    |
| `--on-brand` on each stop of `--grad`                             | 4.5:1    |
| text on the Appearance popover and other reset popovers           | 4.5:1    |
| `--quiet` on its background (card and chrome)                     | 3:1      |
| each of the eight dots on the card, both dot settings             | 3:1      |
| the focus ring (`--acc`) against the card and against the wash    | 3:1      |
| the same pairs with the solid fallback backgrounds (§4)           | as above |

**When a pair fails,** `tokens()` adjusts the derived colour for that combination: it moves the
foreground's OKLCH lightness toward white or black in small steps until the pair passes, leaving hue
and chroma alone, and never touches a seed or the background. The generator prints a report of
every adjustment (which token, which combination, from and to); the report is committed beside the
stylesheet so a reviewer can see what moved. If a pair cannot pass by lightness alone the test
fails and names it; that case comes back to Danijel rather than being waived.

### 4. Without `backdrop-filter`

Inside `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`:
the card's background is the opaque `--bg`; the side panel's is `--panel-solid` (its glass
composited over the middle wash stop, computed by `tokens()`); popovers use `--surface`. Edges,
radius and shadow are unchanged. The contrast test covers these values.

### 5. Layout and components

Sizes follow the prototype: rail 208 px with no background; one card (20 px radius, 1 px light
edge, margin 8 px 4 px, `blur(30px) saturate(1.5)`); side panel 280 px as a second glass slab with
a hairline; controls 8 px radius (7 px inside the 10 px view-switch track); hairlines brighten on
hover and never thicken; nav rows with a 24 px icon slot, the active row with a faint tint and a
3 px gradient bar on the rail's outer edge; section labels in JetBrains Mono 11 px uppercase with
0.12em tracking; easing `cubic-bezier(0.16, 1, 0.3, 1)`. No pills, no shadows on controls.

- **Shell.** The rail's markup and styles move out of the map into `web/src/shell/` (it serves the
  map and the vault). It keeps the mark, "Map" and "Vault" links, the agents list and sign out,
  and gains the Appearance panel above sign out.
- **Appearance panel.** A button showing a swatch, "Appearance" and the theme's name, with
  `aria-expanded`; closed by default. Open, in this order: Dark / Light; the 17 theme swatches
  (each a radio with the theme's name as its accessible name, a ring on the selected one);
  "Dot colours": Follow theme / Classic; "How far the colour reaches": Subtle / Tinted / Vivid.
  Each group is a radio group operable by arrow keys. Escape closes it and returns focus.
- **Map.** The stage keeps its 1000 × 760 proportion and the fit rule. Dots, hubs, the selected
  ring, labels and edges take the prototype's treatment; the five colours hard-coded in the edge
  drawing and the one in the dot drawing become tokens. The view switch, search, chips and the
  detail panel are restyled; their behaviour and markup roles do not change.
- **Vault.** The tabs, folder column, note list and preview sit on the one glass card; the
  sharing control and its sentence are a reset popover; marks keep their text and shape.
- **Sign-in and notices.** A single glass card centred on the wash; the primary button uses
  `--grad` with `--on-brand` text (in light mode on the wash: white with brand-coloured text).
- **Fonts.** Inter (400, 500, 600) and JetBrains Mono (400, 500) from self-hosted variable-font
  packages, `font-display: swap`, with tabular numbers as today. The `geist` package is removed.

### 6. Accessibility

Focus ring 2 px `--acc` with 2 px offset on every interactive element, visible in both modes and
in chrome. Marks and states keep text, never colour alone. `prefers-reduced-motion` stops the
breathing, orbit and pulse as today. `color-scheme` follows the mode so native controls match.
The first visit's mode is dark regardless of the system setting (decision 13's default); the panel
is the way to change it.

### 7. Corrections to the concept doc

`docs/ui-concept.md` §2 is brought in line with the prototype: hairline strengths differ in light
mode (black 10% / 24% on the card, white 24% / 55% in chrome); reach also tints `--surface`; the
low-chroma case is near-grey rather than pure grey and is triggered by chroma, not by name; the
card carries one soft shadow (`--lift`); Inter is loaded at 400 / 500 / 600 only; the stage has one
extra faint glow. §6 gains the contrast thresholds of this spec.

## Constraints

- AGENTS.md #3 and #5: `frontend-design` loaded before building; in-page changes make no
  round-trip. No component library, no Tailwind.
- `pnpm build` passes with no environment set and without network access to a font service.
- `web/` reads no secrets; the cookie carries no personal data and is not trusted.
- The existing unit and browser tests keep passing; a test changes only where it asserted the old
  look.

## Performance budget

- **First paint:** no new server read besides the cookie already on the request. One extra
  stylesheet with all themes (budget: 15 KB gzipped) and two font files, preloaded. Every page
  becomes server-rendered because the layout reads a cookie; `/dev/map` was the only static page.
- **Changing theme, mode, reach or dot colours:** 0 requests; an attribute change and a style
  recalculation. The map's layout code does not run.
- **Blur:** two blurred layers (card, side panel) plus a popover when open. What they blur is the
  static wash, so moving dots do not force the blur to be redrawn behind them; if the browser
  tests' frame checks or manual testing show otherwise, the stage is given its own layer.

## Independent units (for the plan)

1. Theme engine: colour maths, tokens, dot generation, generator and its stylesheet, contrast test.
   Pure, no UI.
2. Root wiring: cookie parsing, attributes on `<html>`, fonts, global tokens, the shell moved to
   `web/src/shell/` with the Appearance panel.
3. Map restyle. 4. Vault restyle. 5. Sign-in and notices, plus the doc corrections.

Unit 2 needs unit 1; units 3, 4 and 5 need unit 2 and touch separate files, so they can run at the
same time.

## Settled details (from the builder check)

- **Scopes.** The light-mode chrome and reset rules live in the generated global stylesheet as
  `[data-mode="light"] [data-scope="chrome"]` and `[data-scope="reset"]`; components set
  `data-scope`. CSS Modules only read tokens through `var()`.
- **`color-scheme`** is set per `[data-mode]` block.
- **Compositing for the contrast test.** Blur is ignored. A background is the layer's colour over
  each of the three wash stops, once plain and once with every bloom tint that can overlap it
  applied at its full strength (the gradient's 0% stop); the worst result counts.
- **One token, two backgrounds.** Chrome text must pass on the rail and on the side panel: the
  adjustment loops until both pass, and if they pull in opposite directions the test fails and
  names the pair.
- **Edge and dot colours.** Guides use `--line`, edges `--edge`, highlighted edges `--fg`, ticks
  `--quiet`, the swarm `--brand`; index, agent and kind dots use `--fg2`; hub borders and the
  selected ring's gap use `--bg`.
- **Layout.** The root layout becomes async and reads the cookie; `<html>` gets
  `suppressHydrationWarning` only if a warning actually appears.
- **Fonts** are wired through `next/font/local` from the packages' files, for preload and
  `font-display: swap`.
- **Stylesheet size** is asserted in the generator test (15 KB gzipped).
- **Browser tests pick a look** by setting the `hive-look` cookie on the browser context through a
  small helper.
- **Print** drops the wash and glass and uses the solid `--bg`. **`forced-colors: active`** removes
  gradients and glass and uses system colours.
- **Sign-in with no cookie** shows the default look.
- **Nav icons** are the prototype's inline drawings for Map and Vault.
- **Static pages.** After this change every page is rendered per request; the build output will
  show no static page except `/_not-found` if Next keeps it static.

## Left to the builder

Exact spacing where the prototype is silent (the vault has no prototype: apply the map's grammar);
icon drawings for the nav rows (simple inline shapes, no icon library); the adjustment step size in
§3; how the sharing control is positioned as a popover.
