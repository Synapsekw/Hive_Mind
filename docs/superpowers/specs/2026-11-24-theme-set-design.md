# Eight hand-tuned themes: design

Date: 2026-11-24. Status: approved from a clickable mock ("i like the themes and their
backgrounds", then "ok" to the design).

## 1. What changes

The 18 generated themes are replaced by 8 themes tuned by hand. Three things change with them:

1. **Colours.** Each theme sets its own page colour, card colour, text, accent, and a colour ramp
   that runs from an old note to a fresh one.
2. **Backgrounds.** The wash gradient, the coloured blooms over it and the frosted glass go. The
   page is one flat colour; the map card and the side panel are solid, with one faint tint behind
   the centre of the map.
3. **Glow.** A fresh note keeps its glow, drawn as a soft halo under a crisp dot instead of a
   blur of the dot itself.

Not in this round, and not to be touched: the layout, the sections of any page, the filter bar and
where it sits, the rails and their folding, the three views and their geometry, the server and the
database. Moving the filters was raised and is parked.

## 2. The themes

Honey is the default. Seven are dark and Paper is light. There is no light version of the other
seven and no dark version of Paper.

| Id            | Label       | Scheme | Page      | Card      | Line      | Text      | Muted     | Accent    | Glow      | Hub       | Ramp: old, middle, fresh      |
| ------------- | ----------- | ------ | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | ----------------------------- |
| `honey`       | Honey       | dark   | `#060606` | `#0c0c0d` | `#222224` | `#f3efe8` | `#8d8a84` | `#f5b544` | `#ffb640` | `#f5b544` | `#3a2c14` `#b9791f` `#ffd98a` |
| `abyss`       | Abyss       | dark   | `#02060b` | `#050b13` | `#132231` | `#e3f1f6` | `#7592a3` | `#3fe0d0` | `#35e6d8` | `#8ff5ea` | `#0f2c44` `#1f7fa6` `#a5fff3` |
| `ember`       | Ember       | dark   | `#090505` | `#0f0808` | `#2a1917` | `#f6ece8` | `#a08a84` | `#ff6a3d` | `#ff5a2a` | `#ff9a5c` | `#4a1612` `#e2452a` `#ffe9a8` |
| `aurora`      | Aurora      | dark   | `#040807` | `#070f0d` | `#17272a` | `#e8f4ef` | `#7f9a92` | `#5ef2a8` | `#56f0a6` | `#b79cf7` | `#3b2a6e` `#3f8fc4` `#8dffc4` |
| `moonstone`   | Moonstone   | dark   | `#07080a` | `#0d0f12` | `#23262c` | `#eef0f4` | `#8b909b` | `#dfe6f5` | `#cfe0ff` | `#ffffff` | `#30343d` `#8a93a6` `#ffffff` |
| `ultraviolet` | Ultraviolet | dark   | `#07040e` | `#0c0815` | `#251b3a` | `#f1ebfb` | `#9486ad` | `#c77dff` | `#d05cff` | `#ff9ae0` | `#2d1b55` `#9b4de0` `#ffa8e6` |
| `blueprint`   | Blueprint   | dark   | `#061021` | `#0a1830` | `#1d3359` | `#e6efff` | `#7f97c0` | `#7fb4ff` | `#8fc0ff` | `#ffd166` | `#1f3d6e` `#6ea0e8` `#ffffff` |
| `paper`       | Paper       | light  | `#e9e5dc` | `#f8f6f1` | `#d9d3c6` | `#1d1a16` | `#7a7469` | `#c2590c` | `#f5a524` | `#c2590c` | `#d3ccbe` `#7b7265` `#1d1a16` |

Each theme also sets:

- **Tint:** its glow colour at 5% to 10% opacity, as a radial gradient centred on the map card and
  gone by 58% of the radius. The value per theme is the one in the mock
  (`.superpowers/brainstorm/61224-1795527844/content/theme-set-v1.html`, object `T`).
- **Active fill and text:** the background and text of the active navigation row and the chosen
  segment of a segmented control, also from the mock.
- **Grid:** Blueprint only. Lines of `rgba(127,180,255,.07)`, 1 px, every 28 px, on the map card.

These values are the starting point. A value that fails a contrast limit in section 6 is changed
by hand in `themes.json` until it passes; nothing adjusts colours automatically any more.

## 3. Theme data and tokens

### 3.1 `themes.json`

`web/src/theme/themes.json` (and its copy `docs/ui/themes.json`) holds the eight records. A record
is flat: `id`, `label`, `scheme` (`dark` or `light`), `bg`, `card`, `tint`, `line`, `text`,
`muted`, `accent`, `glow`, `hub`, `ramp` (three colours), `activeBg`, `activeFg`, and optionally
`grid`. There are no `dark` and `light` halves and no `brand2`, `brandMid`, `wash`, `bloom`,
`mark` or `rings` fields.

### 3.2 Look

A look is the theme alone: `Look = { theme: string }`. `Mode`, `Reach` and `DotMode` and their
lists are removed. The cookie `hive-look` holds the theme id. `parseLook` reads the first
dot-separated part, so an old value such as `keystone.light.vivid.classic` is read as `keystone`,
which is not a theme any more and falls back to Honey. No migration.

The root element carries `data-theme`. It keeps `data-mode`, now set from the theme's scheme, so
existing `[data-mode="light"]` selectors and `color-scheme` keep working. `data-reach` and
`data-dots` are removed, and so is the `data-scope="chrome"` scope: Paper's rail and side panel
use the same dark-on-light text as its card. `data-scope="reset"` is removed with it, since there
is nothing left to reset.

### 3.3 Tokens

Token names that components already use keep their names, so component CSS and layout are not
rewritten. Their values now come straight from the theme record:

| Token                           | New value                                                           |
| ------------------------------- | ------------------------------------------------------------------- |
| `--bg`                          | the page colour                                                     |
| `--wash`                        | the page colour (a flat colour where the gradient was)              |
| `--bloom`, `--glow`             | `none`                                                              |
| `--glass`                       | the card colour, opaque                                             |
| `--glass2`, `--panel-solid`     | the card colour, opaque                                             |
| `--surface`                     | the card colour (popovers)                                          |
| `--fg`, `--muted`               | text, muted                                                         |
| `--fg2`, `--quiet`              | fixed per scheme as today                                           |
| `--line`, `--line-hi`           | the line colour; the same colour moved 12% towards the text         |
| `--fill`, `--fill-on`, `--sel`  | text at 6%; the active fill; accent at 14%                          |
| `--brand`, `--brand-2`, `--acc` | the accent                                                          |
| `--grad`                        | the accent (one colour; the name stays so its users are not edited) |
| `--on-brand`                    | near-black or white, whichever reaches 4.5:1 on the accent          |
| `--edge`, `--edge-card`         | the line colour                                                     |
| `--lift`                        | `none` in dark themes; one soft shadow in Paper                     |
| `--mark`                        | the accent                                                          |
| `--hue-1` … `--hue-8`           | eight topic colours, generated per theme as today (section 5)       |

New tokens:

| Token                        | Value                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `--fresh-0` … `--fresh-7`    | the ramp at eight even steps, old to fresh, mixed in OKLCH |
| `--glow-colour`              | the theme's glow colour                                    |
| `--hub`                      | the theme's hub colour                                     |
| `--card-tint`                | the radial tint, and for Blueprint the grid in front of it |
| `--active-bg`, `--active-fg` | the active row and chosen segment                          |

`--rings-hub` and `--rings-glow` are removed.

### 3.4 Generated CSS

`themes.generated.css` shrinks to a `:root` block with Honey's tokens and one
`[data-theme="<id>"]` block per theme, each with its `color-scheme`. `adjustments.generated.txt`
and the code that writes it are deleted. `tokens.ts` loses the wash, bloom, reach, glass,
chrome-scope and adjustment code and becomes a mapping from a theme record to the tokens above
plus the topic-colour generator.

### 3.5 Component CSS

Only what the new look needs:

- every `backdrop-filter` and `-webkit-backdrop-filter` line is removed, with the
  `@supports` fallbacks that existed for them;
- the map card's background becomes `var(--card-tint), var(--glass)`;
- the active navigation row and the chosen segment use `--active-bg` and `--active-fg`;
- rules under `[data-scope="chrome"]`, `[data-scope="reset"]`, `[data-reach]` and `[data-dots]`
  are removed, and the `data-scope` attributes come off the components that set them.

No size, position, spacing or structure changes.

## 4. Appearance

The Appearance panel in the account popover becomes one list of the eight themes, each a button
with a swatch (the fresh end of its ramp over its card colour) and its label; the current one is
marked. The Mode, Reach and Dot colours controls are removed. Choosing a theme sets `data-theme`
and `data-mode` on the root and writes the cookie: zero round-trips, as today.

## 5. The map

### 5.1 Rings

- **Dot colour.** A note or file is filled with `--fresh-N`, where N is its freshness level
  (0 to 7, from `freshness.ts`, unchanged). Today's rule (brand colour at an opacity per level)
  goes. Dimming by a filter or a selection still multiplies opacity.
- **Outline.** The thin outline around a readable dot is kept, in the dot's own ramp colour.
- **Halo.** A dot at level 6 or 7 gets a halo: a radial gradient in `--glow-colour`, full at the
  centre, 35% at 0.4 of the radius, gone at the edge, 6.5 dot radii wide. Peak opacity 0.3 at
  level 6 and 0.5 at level 7; at level 7 it breathes between 0.42 and 0.58 on the 4-second cycle
  the glow uses today, and is still under reduced motion. Halos are drawn first, all dots after,
  so a halo never covers a neighbour's dot. Dark themes add the halo to what is under it
  (`lighter`); Paper paints it normally at 0.42 peak.
- **Sprite.** The halo is drawn once per theme and device pixel ratio to an offscreen canvas and
  stamped with `drawImage`. `shadowBlur` is no longer used for fresh dots.
- **Hubs.** Every theme draws hubs in `--hub`, with a halo at 0.3. Hubs no longer take group
  colours in Rings, in any theme.
- **Index.** White in dark themes, the text colour in Paper, with a halo at 0.4.
- **The 400 limit.** `GLOW_MAX` is removed if the 5,000-item frame checks in
  `e2e/map-perf.spec.ts` still pass under 34 ms with halos on for every fresh dot. If they do
  not, the limit stays and the spec's known gap stays with it.

### 5.2 Timeline and Orbit

Unchanged in drawing. Their eight topic colours are generated as today, from the hue midway
between the theme's accent and glow colour, with today's lightness and chroma per scheme.
Moonstone's accent has almost no chroma, so it gets the eight near-greys by the existing rule. The
"Classic" fixed eight are removed with the Dot colours switch.

The filter bar's group swatches in Rings take `--hub`; in Timeline and Orbit they keep the topic
colours.

## 6. Contrast and tests

`contrast.test.ts` keeps its limits and runs over the eight themes instead of 102 combinations:

- text and muted text at least 4.5:1 on the page colour and on the card;
- quiet labels, the accent, the focus ring, `--hub` and the eight topic colours at least 3:1 on
  the card;
- `--fresh-5`, `--fresh-6` and `--fresh-7` at least 3:1 on the card;
- text on the accent (`--on-brand`) at least 4.5:1;
- `--active-fg` on `--active-bg` at least 4.5:1.

`--fresh-0` to `--fresh-4` are below 3:1 by design: an old note is meant to be faint. This is the
gap accepted today, now stated per ramp step.

A failing pair fails the test; the fix is a hand edit to `themes.json`.

Other tests:

- `look.test.ts`: parse, format, fallback from an old four-part cookie.
- `tokens.test.ts`: every theme yields every token; the ramp's ends equal the record's first and
  last colours; topic colours are eight and distinct.
- `generated.test.ts`: the committed CSS equals what the generator writes.
- `usage.test.ts` and `no-literals.test.ts`: still no colour literals in components; the removed
  tokens and attributes are no longer referenced anywhere.
- `renderer.test.ts`: a dot's fill is its ramp colour; halos are stamped for levels 6 and 7 only
  and before the dots; no `shadowBlur` on fresh dots; hubs use the hub colour.
- Browser tests: `appearance.spec.ts` rewritten for the one list; `e2e/look.ts` and the specs
  that set a theme, mode or reach updated to set a theme; `map-perf.spec.ts` unchanged and
  decisive for 5.1.
- `dense.test.ts` and `lint.test.ts` adapted or removed according to what they still cover.

## 7. Documents

- `docs/ui-concept.md` section 2 ("Visual language", "Themes, mode and reach", dot colours) is
  rewritten for flat surfaces and the eight themes; section 3's Rings paragraph for the ramp, the
  halo and the hubs; section 6's contrast line for the new matrix.
- A new decision note in `vault/decisions/` records that the hand-tuned set replaces the
  Keystone glass look and marks
  `2026-11-22-decision-13-keystone-glass-look-with-themes` as superseded.

## 8. Performance and data

- First paint: unchanged. The theme is drawn by the server from the cookie, so there is no flash.
- Choosing a theme: 0 round-trips; CSS variables on the root, a cookie write, one redraw of the
  canvas after the palette is read again.
- No server data changes. No new query.
- The map stays one canvas. Removing `backdrop-filter` and `shadowBlur` removes work per frame;
  the frame limit of 34 ms at 5,000 items stays the test.

## 9. Independent units

1. **Theme data, look and tokens:** `themes.json`, `look.ts`, `tokens.ts`, `css.ts`, the generated
   CSS and their unit tests. Produces the token names in 3.3.
2. **Renderer:** ramp fill, halo sprite, hubs, index, the 400 limit. Consumes `--fresh-N`,
   `--glow-colour`, `--hub`.
3. **Appearance and the root attributes:** the panel, `LookProvider`, the root layout, the cookie.
   Consumes the new `Look`.
4. **Component CSS:** section 3.5. Consumes `--card-tint`, `--active-bg`, `--active-fg`.
5. **Browser tests and documents:** after 1 to 4.

Unit 1 comes first, since 2, 3 and 4 depend on its names. Units 2, 3 and 4 touch different files
and can run at the same time. Unit 5 is last.

## 10. Known gaps accepted

- Seven themes have no light version and Paper no dark one.
- Old notes (ramp steps 0 to 4) are below 3:1 against the card.
- A person who had chosen one of the 18 old themes lands on Honey.
- The topic colours in Timeline and Orbit stay generated, not hand-tuned.
