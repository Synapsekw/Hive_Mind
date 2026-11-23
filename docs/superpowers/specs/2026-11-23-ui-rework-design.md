---
type: spec
status: draft
last-updated: 2026-11-23
tags: [project/hive-mind, ui, design]
---

# UI rework: a living map and calmer chrome

## Why

The web app reads as static. The map's dots do not react to the pointer, nothing moves except
the core and the orbit, the graphs cannot be zoomed, the legend is two loose rows of chips, and
the foot of the left rail (agents on two lines each, Appearance, Sign out) is cramped. Other
pages have hover states, but they are faint and inconsistent.

## Decisions taken in brainstorming

| Question       | Answer                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Scope          | Everything in one round: map interaction, chrome, and the look of all pages |
| How far        | Keep Keystone glass, its 17 themes and its tokens; add depth, light, motion |
| Dot hover      | Peek card plus neighbours lit and links firing                              |
| Zoom           | Map-style: wheel/pinch toward the cursor, drag to pan, semantic labels      |
| Legend         | A floating glass dock with three groups: Topics, Kind, People               |
| Rail foot      | A collapsible agents card and one account button with a menu                |
| Ambient motion | "Alive but calm"                                                            |
| Build approach | DOM dots kept, a hand-rolled camera; no new dependency                      |
| New view       | A **Hive** view (a honeycomb) replaces Circle and is the map's opening view |
| New theme      | A **Hive** theme (honey, wax, amber light) is added and becomes the default |

The approved reference is the interactive prototype built in the brainstorm on the real fixture
hive (`.superpowers/brainstorm/*/content/map-prototype-hive.html`, not committed). Where this spec
and the prototype differ, this spec wins.

ADR 13 (Keystone glass) stands. This spec only extends its "Motion" and "Controls" rows; the
"Hairlines brighten on hover, never thicken" rule still holds.

## 1. The map

### 1.0 The Hive view (new, replaces Circle, opens by default)

The views become **Hive**, Rings, Topics, Links, Timeline and Orbit, in that order, and the map
opens on Hive. Circle is removed (its layout function and tests go with it). `docs/ui-concept.md`
section 3 is updated to match.

- **One honeycomb.** A pointy-top hex grid of radius 12 cells (469 cells) centred in the
  1000 × 760 box, with a cell radius of 15.5 units. The hive index sits on the centre cell.
- **A territory per topic.** Each topic's hub sits on a seed cell on a ring 6.3 cells out, at
  evenly spaced angles in topic order. Territories grow round-robin: on each turn every topic
  with room left takes the free neighbouring cell nearest its seed (ties lean toward the centre),
  until it has one cell for its hub plus one per note or file. Within a territory, items are
  placed nearest the hub first, most recently changed first. The layout is deterministic for a
  model, so it is computed once and cached like the other flat views. Cells nobody claims stay
  as empty frames at the edge.
- **Honey fill shows recency.** A cell's fill is its topic colour at an opacity of
  `max(0.06, 0.5 × e^(-hours since change / 60))`. A hub cell has a fixed 0.32 fill and a brighter
  edge. The index cell is a faint fill of the text colour.
- **Capped cells.** An item that is not shared with you is a capped cell: the card colour with a
  dashed edge in its topic colour. This doubles the existing "hollow = not shared" meaning.
- **Dots on cells.** The dot buttons stay (keyboard, labels, hover and selection unchanged) and
  sit on their cell centres, drawn smaller (notes and files 6 px, hubs 11 px).
- **Links hidden at rest.** Links are not drawn until a dot is hot or selected; then its links
  draw and fire as in every view. Ambient link pulses are off in Hive (the agent marks replace
  them).
- **Agent marks show who is at the hive.** In Hive the agent dots are drawn as a small geometric
  mark, not an illustration: a 12 px hexagon outline in the brand colour with a centre point.
  Nothing pictorial (no insects, wings or faces). The marks sit on or just under the comb, never
  far from it. Their state comes from `agentStatus` and `last_used_at`, which the map already
  loads:
  - **Live** (status "connected"): a solid centre and a soft brand-coloured glow that swells and
    fades on a 2.6 s cycle. The mark sits on the edge of its member's most recently changed cell.
    About every 3.4 s it moves 0.8 s to another cell of its member, changed in the last few days
    and at most three cells away. That cell's honey flares and fades back.
  - **Today** (used in the last 24 hours, not connected): a still outline with a small
    text-coloured centre, on its member's latest cell.
  - **Idle** (older or never used): an empty outline at 40% opacity, in a row inside a small
    entrance arch drawn under the comb.
  - Moves and the glow never run while a dot is hot, while the tab is hidden or under reduced
    motion. The marks then stay still, but keep their state styling.
- **"At the hive" panel.** In Hive a small glass panel at the top right of the stage lists the
  live and today agents (the mark, the name, then "live" in the brand colour or "2h ago"), and
  one line "_n_ idle at the entrance". Hovering a row makes that agent's mark hot. It is a list
  with real text, so a screen reader hears who is live.
- **Filters and hover** dim the cells with their dots: cells outside the filter or the hot
  neighbourhood drop to a near-empty frame.
- **Grid size.** The radius above (12 cells, 469 cells, cell radius 15.5) is the minimum. When the
  hive has more items, the radius is the smallest one whose cell count holds every item plus 15%
  headroom, and the cell radius shrinks so the comb still fits the box. All cells are drawn as
  polygons in one SVG group, so at the 5,000-item cap that is about 5,800 polygons drawn once per
  model; only their classes change on hover and filter.

### 1.1 Camera (flat views)

- One transform layer (`world`) wraps the SVG backdrop, the guide labels and the dots, and
  carries `translate(tx, ty) scale(k)`. The 1000 × 760 coordinate box is unchanged; the world is
  sized to fit the stage.
- Zoom range `k` 0.6 to 8. The wheel zooms toward the cursor (`exp(-deltaY × 0.0025)`, or
  `× 0.01` for a trackpad pinch, which arrives as `ctrlKey`). Two-finger touch pinch does the same.
- Dragging the stage pans. A pointer that moves 4 px or more is a drag, and a drag never counts
  as a click on a dot. A click on the empty stage clears the selection.
- Double-click zooms ×2 toward the point. Keys when focus is not in a text field: `+`/`=` and `-`
  zoom about the centre, `0` fits, arrow keys pan by 60 px, `Escape` clears the selection and
  fits, and `/` focuses the search.
- A zoom control in the bottom-right corner of the stage: `−`, the zoom as a percentage, `+` and
  `Fit`. Each is a real button with a label.
- Dots and labels keep their screen size at every zoom (each counter-scales by `1 / k` through a
  CSS variable `--k`), so zooming spreads the map out instead of making blobs. Lines use
  `vector-effect: non-scaling-stroke`. The world layer must not carry `will-change: transform`
  (it rasterises once and blurs when zoomed).
- The core swarm fades out above `k` 1.8.
- Switching views glides the camera back to Fit.
- Clicking a dot, picking a connection in the side panel or picking a single search result glides
  the camera (650 ms on `--ease`) to frame the dot and its neighbours, at a zoom from 1 to 3.

### 1.2 Semantic zoom (labels)

Today's label rules stay (the selection, hubs when Labels is on, the selection's neighbours when
there are 14 or fewer, search with 14 or fewer hits, agents in Timeline). In addition, when Labels
is on and the view is not Orbit:

- at `k` ≥ 1.8, lit dots with three or more links that are inside the visible stage get a label;
- at `k` ≥ 3, every lit dot inside the visible stage does;
- at most 60 zoom-driven labels show at once (the ones nearest the centre of the stage win).

Labels are worked out again after a pan or zoom settles (debounced 60 ms), not on every frame.

### 1.3 Hover and keyboard focus

- After 80 ms on a dot (or when it gets keyboard focus) the dot becomes **hot**: its shape grows
  ×1.7 with a glow in its colour, the dots it links to stay at full strength with a softer glow,
  its links are drawn in its colour, and every other dot drops to 32%. This "soft" dim is
  deliberately lighter than the 10% "dim" of a filter or a selection, so the two read differently.
- **Firing:** when a dot becomes hot or is selected, one pulse of light travels outward along
  each of its links (an SVG path with `pathLength=100`, a 7-unit dash animated along it in 1.1 s,
  removed when done).
- **Peek card:** a small glass card next to the pointer (it flips to stay on screen) showing the
  kind (with its colour), the title, then Topic, By, Changed (relative) and Links. A locked item
  shows only "Private note" or "Private file", its topic and "Not shared with you", the same rule
  as the side panel. The card is `aria-hidden`: the same facts are on the dot's label and in the
  side panel, and a screen reader hears the dot's existing `aria-label`.
- Leaving the dot restores everything within 150 ms.

### 1.4 Orbit

- The orbit keeps turning on its own. Dragging turns it around the vertical axis. It resumes
  turning 3 s after the drag ends, and pauses while a dot is hovered (as today).
- The wheel zooms the sphere's radius, ×0.6 to ×2.4.
- Dots on the far side fade and blur slightly for depth.
- The orbit moves from a pure CSS animation to a `requestAnimationFrame` loop that projects the
  existing 3D positions, because a CSS animation cannot be dragged. The loop runs only while
  Orbit is the view and the tab is visible.

### 1.5 View changes and arrival

- Dots glide between views as today (0.9 s), now staggered by their distance from the centre
  (up to 450 ms), so a change sweeps outward in a wave.
- When the map first opens, dots bloom out from the core to their places with the same stagger.
- The view switch gets a sliding highlight that moves under the chosen view (0.45 s).
- Dots that are new in a refreshed payload bloom in. Dots that are gone fade out.

### 1.6 Ambient motion ("alive but calm")

- Topic hubs breathe: their glow swells and fades on a 5 s cycle, each hub out of phase.
- The hive index turns once every 30 s.
- About every 700 ms one random link carries a faint pulse in the brand colour. This is skipped
  while the tab is hidden, while a dot is hot, and in Orbit and Timeline.
- A connected agent's status dot pulses softly.

### 1.7 Ring and axis labels

The ring names become small uppercase mono tags placed on the guide rings themselves (the gaps
between bands), at the upper-left, instead of across the bands at the top. They keep a constant
size at every zoom. "Topics" is dropped, because the hubs carry their own labels.

### 1.8 Legend dock

- One glass dock floating at the bottom-left of the stage, leaving room for the zoom control,
  with three groups separated by hairlines: **Topics** (a swatch, the name and the count for each
  topic; it scrolls sideways, and its right edge fades out when it overflows), **Kind** (icon-only
  shape buttons for note, file, topic, agent and not shared with you, each with a tooltip and an
  `aria-label`) and **People** (an initials avatar per member, "(you)" in the tooltip).
- **Hover or focus previews:** the dots outside the entry soft-dim (32%) while the pointer is on
  it. **Click pins** it as today's filter (10% dim, `aria-pressed`). Clicking it again unpins it.
- The filtering logic itself (`lit`) is unchanged.

### 1.9 Side panel

- **Nothing selected ("Today"):** an eyebrow "Today", the count of notes written or changed today
  counting up on load, a 14-day sparkline of agent writes (drawn in on load, from
  `activity().days` summed per day), "By person" bars that grow in, and **Needs you**: one row
  with the inbox count linking to `/inbox` (hidden when the count is zero). Hovering a person's
  row soft-previews their dots.
- **Something selected:** "‹ Today" to go back, then the title, the kind, topic and author line,
  and the connections list. Hovering a connection makes it hot on the map; clicking it selects it
  and glides the camera to it. The panel content fades and rises in on each change.

## 1A. The Hive theme (new default)

A new theme, **Hive**, is added to `web/src/theme/themes.json` as the first entry and becomes
`default` (Keystone stays, as one of 18). It goes through the existing pipeline: seeds only,
everything else derived, `pnpm themes` regenerates the CSS, and the contrast test covers it in
both modes and every reach. Where a derived colour falls short, its lightness is adjusted and
listed in `adjustments.generated.txt`, as for every theme.

| Seed      | Dark                            | Light (the "bold frame")        |
| --------- | ------------------------------- | ------------------------------- |
| brand     | `#f5b544` (honey)               | `#c77a12`                       |
| brand2    | `#ef8a3c` (orange)              | `#d0601c`                       |
| brandMid  | null                            | null                            |
| content   | `#1a1208`                       | `#ffffff`                       |
| text      | `#fbf3e4`                       | `#24190c`                       |
| textMuted | `#cfbb9c`                       | `#5e4a30`                       |
| surface   | `#1d160c`                       | `#fffaf0`                       |
| wash      | `#3b2811`, `#1d140a`, `#090604` | `#d98a1e`, `#c46a17`, `#8a4310` |

- **Dot colours** come from the existing "Follow theme" generator (eight hues fanned 160° around
  the honey-to-orange midpoint), not hand-picked. That lands on warm rose, coral, apricot, amber,
  pollen, lime and mint, as in the prototype. "Classic" still gives the fixed eight.
- **No texture.** The theme is colour only: no honeycomb pattern on the page, the rail or the
  panels. The honeycomb lives only in the map's Hive view.
- **The mark** (the hexagon at the top of the rail) is filled with the brand gradient in Hive.
  In other themes it stays the text colour. This is driven by a token (`--mark`), never by the
  theme's name.
- **People's existing choice wins.** Someone who already picked a theme keeps it; only a browser
  with no stored choice starts on Hive. `docs/ui-concept.md` section 2 is updated (18 themes, Hive
  is the default), and ADR 13 gets a short addendum recording the new default.

## 2. The left rail (every page)

- **Destinations:** each row's fill slides in from the left on hover, and the icon nudges 2 px
  and scales ×1.08. The 3 px gradient bar of the current row becomes one element that slides
  between rows when the current page changes.
- **Mark:** turns 60° on hover.
- **Agents card** (only where agents are given, today the map): a compact glass card with a stack
  of status dots and "_n_ of _m_ agents connected". It is a disclosure button
  (`aria-expanded`); open, it lists one line per agent: the status dot, the name (ellipsis, full
  name in `title`) and the last use in short form (`now`, `2h`, `3d`, `never`). It is closed by
  default.
- **Account button** at the very bottom: an initials avatar, the member's display name and
  "_hive_ · _role_". It opens a menu upwards (`aria-haspopup="menu"`, Escape and an outside click
  close it, focus returns to the button) holding **Appearance** (opens today's Appearance panel
  unchanged, inside the menu), **Settings** and **Sign out** (the existing form post). The
  separate Appearance row and Sign out row leave the rail.
- The account button needs the member's own display name, role and hive name (see section 5).

## 3. Shared motion and hover language (all pages)

A small set of shared tokens and utility classes in `globals.css`, used by every page, so pages
stop inventing their own:

- `--ease` stays. Added: `--dur-fast` 0.18 s, `--dur` 0.3 s, `--dur-slow` 0.6 s.
- **Rise:** panels and cards enter with a 10 px rise and fade (0.7 s), staggered 80 ms between
  the rail, the main card and the side panel on first load. This runs once per page load, not on
  every client navigation.
- **Hover lift for cards and list rows:** the hairline brightens (`--line` to `--line-hi`), the
  fill goes to `--fill`, and clickable cards lift 1 px. Never a thicker border, never a drop
  shadow on controls (ADR 13).
- **Primary buttons:** a slight brighten and a 1 px lift on hover.
- **Segmented switches** (the map's views, the vault's workspace tabs, the gallery's scope)
  share one sliding-highlight component.
- **Popovers and menus:** fade and scale from 0.98, with the origin on the side they open from.

Page by page, applying only the language above and no new layouts:

- **Vault:** the workspace tabs get the sliding highlight; folder and note rows get the hover
  fill; the preview fades in when the note changes; the search field widens on focus as on the
  map.
- **Gallery:** cards lift and brighten on hover, and the thumbnail scales ×1.03 inside its
  frame; the viewer opens with a fade and scale.
- **Inbox:** item cards lift on hover; an answered item collapses smoothly (height and fade)
  instead of vanishing.
- **Settings:** section cards and rows get the shared hover; the token dialog opens like the
  other popovers.

## 4. Accessibility

- `prefers-reduced-motion: reduce` turns off the glide, the stagger, firing pulses, ambient
  pulses, breathing, the turning index, the orbit's turning, count-ups, rises and camera glides
  (camera moves still happen, instantly). Hover highlighting and zoom still work.
- Everything hover reveals is also reachable by keyboard focus (dots, dock entries, panel rows).
- The zoom control, dock entries, agents card and account menu are real buttons with names; the
  menu follows the menu-button pattern; the dock's kind and people buttons have `aria-label`s.
- Contrast: the new eyebrows, counts and dock labels use `--quiet` or brighter, which the contrast
  test already holds at 3:1 or more in every theme. The soft dim (32%) is decoration, never the
  only signal. The existing contrast test runs unchanged.

## 5. Performance and data-fetching budget

- **First paint:** unchanged map payload (one bounded query, as today) plus the inbox count, as
  today. Added: one `members` row for the caller (display name and role, by `user_id` within the
  hive, an indexed unique pair) and the hive name. This runs inside each page's existing
  `Promise.all`, so it adds no serial round-trip.
- **Every interaction in this spec** (hover, peek, zoom, pan, fit, view switch, dock preview and
  pin, agents card, account menu, panel changes) is **client state only: 0 server round-trips.**
  None of it changes server data. The account menu's Sign out is the existing form post.
- **Rendering bounds:** the payload stays capped at 5,000 items. Pan and zoom change one
  transform, not each dot. Labels are recomputed only once a pan or zoom settles, capped at 60.
  Firing creates at most one path per link of the hot dot. The ambient pulse keeps at most three
  paths alive. Hub breathing animates only hubs (at most 8 topics plus "Other"). The orbit's
  `requestAnimationFrame` loop exists only while Orbit is open and the tab is visible.
- No new runtime dependency.

## 6. Independent units (for the plan's DAG)

These have no shared state with one another and can be built in parallel once the shared tokens
(unit A) are in:

- **A. Shared motion tokens and utilities** (`globals.css`, the sliding-highlight switch
  component). Everything else consumes it.
- **B. Map camera and semantic zoom** (a `useCamera` hook, the zoom control, label rules).
- **C. Hover, peek and firing** (hot state, the peek card, pulses). It consumes B's transform for
  placement.
- **D. Map motion** (staggered glide, arrival bloom, ambient pulses, hub breathing, the
  draggable orbit).
- **E. Legend dock** (it replaces `Chips`).
- **F. Side panel Today and Selected** (`DetailRail`).
- **G. Rail: sliding bar, agents card, account menu**, plus the loader for the member's name and
  role on every page.
- **H. Vault, Gallery, Inbox and Settings polish.**
- **I. Hive view**: the `hive` layout in `layouts.ts` (pure, alongside the others), the comb
  backdrop, the agent marks and the "At the hive" panel. It replaces Circle in the view list. The
  layout is independent of everything else; the comb and marks consume D's motion conventions.
- **J. Hive theme**: seeds in `themes.json`, the `--mark` token in the
  generator, the regenerated CSS and adjustments, the new default, and the Appearance tests
  updated for it. It has no dependency on any other unit.

## 7. Testing

- **Unit (vitest), Hive layout:** deterministic for a model; every note, file and hub gets its
  own cell (no two items share one); every item sits inside its own topic's territory and each
  territory is contiguous; the index is on the centre cell; the grid grows to hold 5,000 items
  and stays inside the 1000 × 760 box; recency maps to the honey opacity formula; each agent's
  mark state (live, today, idle) follows from its status and last use; a live mark's next cell
  is its own member's and at most three cells away.
- **Unit (vitest), Hive theme:** the existing contrast, token, lint and generated-CSS tests pass
  with Hive included (now 18 themes, 108 combinations); `--mark` is the text colour for every
  theme but Hive; a stored choice is kept and an empty one resolves to Hive.
- **Unit (vitest):** the camera maths (zoom toward a point keeps that point fixed; clamping;
  fit; framing a set of points), the semantic-label selection (thresholds, viewport culling, the
  cap of 60), the sparkline series from `activity().days`, the short agent "last used" form, the
  stagger delay function, and the account loader's query shape.
- **Browser (Playwright, `web/e2e`):** hovering a dot shows the peek card and lights its
  neighbours; the wheel changes the zoom percentage and Fit restores 100%; a drag pans without
  selecting; clicking a dot selects it and the panel shows it; a dock hover previews and a click
  pins (`aria-pressed`); the agents card expands; the account menu opens, Escape closes it, and
  Sign out is inside it; with reduced motion emulated, nothing animates (no running
  `getAnimations()` on the stage). The existing 154 browser tests are updated where markup moves
  (chips to dock, Appearance and Sign out into the menu) and must all pass.
- The four gates (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) pass.

## Out of scope

- New pages (Entities, Chat) and any layout change to the vault, gallery, inbox or settings
  beyond section 3.
- Canvas or WebGL rendering; minimap; saving the camera position across visits.
- Light-mode-specific redesign: every new surface uses the existing tokens, so light mode follows,
  but it gets no separate art direction in this round.
