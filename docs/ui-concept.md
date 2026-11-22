---
type: design
status: active
last-updated: 2026-11-22
tags: [project/hive-mind, ui, design]
---

# Hive Mind — UI Concept

The interface should feel like looking into a living mind: quiet, spacious, almost nothing on
screen until you ask, and then precise. Modern and minimal.

The reference prototypes are in [`ui/`](ui/): `map.dc.html` and `chat.dc.html`. They are exports
from the design canvas and need its runtime to render; read them for structure, tokens and copy.
The live canvas is the "Hive Mind UI Samples" artifact.

## 1. Design principles

- **One idea per screen.** The map is a map; the chat is a chat. No dashboards of widgets.
- **Light is information.** Brightness means yours and recent; a hollow dot means not shared with
  you. The only decorative light is the theme's colour behind the glass.
- **The frame carries the colour, the data stays readable.** Navigation and panels are neutral or
  white-on-colour; hue is spent on the theme wash and on the dots.
- **Humans decide, the system suggests.** Every suggestion arrives as a quiet item in "Needs you",
  never a modal that blocks work.
- **Familiar where it must be.** Chat keeps the three-column shape of Claude and ChatGPT.
- **Show, don't store.** The map is drawn from the database every time; the page holds no state of
  its own.

## 2. Visual language

The look is "Keystone glass": the layout grammar of our Monolith app (a rail and a side panel
sitting directly on a coloured wash, content on one inset card) with frosted glass panels and
theme-driven dot colours, which are Hive's own
([[2026-11-22-decision-13-keystone-glass-look-with-themes]]). It replaces the navy look the first
map was built with.

| Token      | Choice                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background | The theme's wash: a 168° three-stop gradient, with soft radial glows of the theme's two accents on top (three at the edges, two pooled behind the map card). The map's stage adds one faint glow of its own         |
| Map card   | Frosted glass: the card colour at 56% (dark) or 78% (light) opacity, `backdrop-filter: blur(30px) saturate(1.5)`, 20 px radius, a 1 px light edge                                                                   |
| Side panel | A second, lighter glass slab: white at 4.5% (dark) or 13% (light), same blur, 1 px hairline                                                                                                                         |
| Left rail  | No panel; it sits on the wash                                                                                                                                                                                       |
| Text       | From the theme: `text`, `textMuted`. On the light-mode wash all text is white (muted is white at 90%)                                                                                                               |
| Accent     | The theme's `brand`. Fills that mark "active" or "primary" use the gradient `brand → brandMid → brand2`                                                                                                             |
| Type       | Inter 400 / 500 / 600; JetBrains Mono for counts and section labels (11 px, uppercase, 0.12em tracking); tabular numbers                                                                                            |
| Controls   | 8 px radius (7 px inside the 10 px view-switch track). Hairlines brighten on hover, never thicken: white 10% to 26% in dark; in light, black 10% to 24% on the card and white 24% to 55% on the rail and side panel |
| Nav rows   | 24 px icon slot, then the label. Active row: a faint brand tint plus a 3 px gradient bar on the rail's outer edge                                                                                                   |
| Depth      | No drop shadows on controls. The card carries one soft shadow (`--lift`); otherwise the glass edge and blur do the separating                                                                                       |
| Motion     | Dots glide between views; the core breathes; the orbit turns; a writing agent's dot pulses. Easing `cubic-bezier(0.16, 1, 0.3, 1)`                                                                                  |

### Themes, mode and reach

Appearance is three independent choices, per person, changed in an Appearance panel (bottom of the
left rail in the prototype; it can move to Settings).

- **Theme (17):** Keystone (default), Graphite, Aurora, Sunset, Nebula, Lagoon, Tropic, Orchid,
  Peach, Glacier, Dusk, Berry, Candy, Citrus, Prism, Mocha, Neon. Keystone and Graphite have one
  accent; the rest have two. The seed values for every theme in both modes are in
  [`ui/themes.json`](ui/themes.json), copied from Monolith's `develop` on 2026-11-18.
- **Mode:** dark (default) or light. Light is a "bold frame": the wash is a saturated gradient,
  everything painted on it is white, and the map sits on white glass. A primary button on the
  light wash is white with brand-coloured text.
- **Reach:** how much of `brand` is mixed into the card. Subtle 0%, Tinted 5% (default), Vivid 8%
  in dark; 0%, 2.5%, 2.5% in light. Reach tints the popover surface (`--surface`) too: 0%, 4%, 7%
  in dark; 0%, 4%, 5% in light. Vivid also adds two faint glows along the card's top edge.

A theme only supplies seeds. Everything else (gradient, glows, glass, selected tint, hairlines) is
derived from them, so a component never names a theme.

**Dot colours follow the theme.** The eight topic colours are generated: take the hue midway
between `brand` and `brand2` (in OKLCH), fan eight hues across 160° around it, and alternate two
lightness levels (0.82 / 0.72 in dark, 0.60 / 0.50 in light) at chroma 0.14 (0.15 in light), with
neighbouring topics placed far apart in the fan. A theme whose `brand` has almost no chroma
(OKLCH chroma below 0.03; today that is Graphite) gets eight near-greys instead, spaced evenly in
lightness. The rule is triggered by the chroma, never by the theme's name. A "Classic" switch
keeps the original fixed eight:
`#F5B556` `#62B8FF` `#FF8FB3` `#C4A2FF` `#5FE0B0` `#FF9D5C` `#5CD6E6` `#C3E36A`
(light mode starts from `#C98A1B` `#2F7FD1` `#D9567F` `#8B62D9` `#1FA57A` `#DB6A22` `#1C9BAA`
`#7F9E1F`; on the light card these are darkened per theme until they reach 3:1, so what is drawn
is darker than this list).
The trade-off is known and accepted: in "Follow theme" a topic has no fixed colour across themes,
and topics sit closer in hue than in Classic.

Contrast is checked by a test for every theme, mode and reach (section 6). Where a derived
colour falls short, its lightness is adjusted, never a seed; every adjustment is listed in
`web/src/theme/adjustments.generated.txt`.

## 3. The map (home)

One dot per note or file, coloured by topic. The same dots are shown in six views:

| View     | What it shows                                                                           |
| -------- | --------------------------------------------------------------------------------------- |
| Rings    | Concentric bands from the centre: synthesis, notes, files, agents; one sector per topic |
| Circle   | Everything on one ring, links across the middle                                         |
| Topics   | One cluster per topic                                                                   |
| Links    | Force layout: linked notes pull together                                                |
| Timeline | Agent writes per day on top; every note under the day it last changed                   |
| Orbit    | The same dots on a slowly rotating sphere, agents on an outer ring                      |

- **Shapes:** circle = note, diamond = file, ringed circle = synthesis page, hollow = a colleague's
  item that is not shared with you, hexagon = the hive index.
- **Core:** a swarm at the centre showing the last 24 hours of writes.
- **Isolate, don't hide:** picking a topic, a kind or a person dims everything else.
- **Click a dot:** it lights up with its connections; the right rail shows what it is, who wrote
  it and what it connects to. An unshared note shows only "Private note" and its topic.
- **Search:** matching dots stay lit and get labels when there are few enough.

Layout: a left rail on the wash (mark, hive switcher, five destinations with icons, agents
summary, Appearance), the map on the glass card with the view switch as one segmented control,
and a glass side panel that shows today's activity until something is selected. "Needs you" and
the housekeeper's last run sit below.

Rejected and not to be reopened: the entity-level "neural map", the per-topic cluster options and
the plain force graph ([[2026-11-20-decision-07-brain-dashboard-is-the-map]]).

## 4. Other pages

- **Inbox** — overlap suggestions, share proposals from agents, contradiction flags, quarantine
  releases. Each item: what, who, why, two actions.
- **Entities** — synthesis at the top with every fact citing its source on hover; contradictions
  pinned; linked notes and files below.
- **Vault** — folder tree, note list, note preview. Visibility shown inline and changed in place;
  quarantine is a folder with a release action.
- **Gallery** — previews of generated documents; mine, shared with me, whole hive; a full-screen
  viewer for PDF, PPTX, XLSX and images.
- **Chat** — conversations on the left, the thread in the centre panel with source chips under
  each answer, agent activity and artifacts on the right. The line under the composer always says
  which workspace is written to and whose subscription is paying.
- **Settings** — workspaces and tokens, connected agents and setup instructions, sharing defaults,
  members and roles, audit log.

## 5. Overlays and states

| Overlay or state         | Behaviour                                                |
| ------------------------ | -------------------------------------------------------- |
| Command palette          | Searches notes, entities, files and actions              |
| Share dialog             | Private, group or named members; shows what will change  |
| Handshake                | Names the entity only; share or decline                  |
| Contradiction resolver   | Two facts side by side with owners and dates             |
| Token dialog             | Name, workspace, trust tier, expiry; token shown once    |
| First run                | Empty map with the onboarding steps and a connect action |
| Token revoked or expired | Inbox item with a regenerate action                      |
| Write rejected           | Inbox item with the attempted path and the reason        |
| Synthesis failed         | Entity page shows the last good version with a retry     |
| Offline                  | Map freezes with a reconnect notice                      |

## 6. Accessibility

- Colour meaning is doubled by shape or text.
- Real buttons and labels everywhere; visible keyboard focus.
- Reduced-motion setting stops the glide, the breathing core and the orbit.
- Contrast, in every theme, mode and reach (102 combinations), asserted by
  `web/src/theme/contrast.test.ts`: text at least 4.5:1; quiet labels, the eight dot colours and
  the focus ring at least 3:1. The same holds on the solid fallback backgrounds.
- Focus ring: 2 px of the accent with a 2 px offset on every interactive element.
- Glass has a fallback: where `backdrop-filter` is unsupported the card uses the solid page
  colour, the side panel its solid equivalent and popovers the solid surface colour.

## 7. Performance budget for the map

Six views of one graph must be **one load and zero further round-trips**: fetch the nodes and
links once, compute every layout in the browser, and switch views in client state only. The
fetch must be bounded: select only the columns the map draws, over indexed columns, never note
bodies.

Changing theme, mode, reach or dot colours is also **zero round-trips**: it changes CSS variables
on the root and nothing else. The choice is remembered per person; where it is stored is not
decided yet.
