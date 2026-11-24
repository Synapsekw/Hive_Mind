---
type: design
status: active
last-updated: 2026-11-24
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

| Token      | Choice                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background | The theme's wash: a 168° three-stop gradient, with soft radial glows of the theme's two accents on top (three at the edges, two pooled behind the map card). The map's stage adds one faint glow of its own                                        |
| Map card   | Frosted glass: the card colour at 56% (dark) or 78% (light) opacity, `backdrop-filter: blur(30px) saturate(1.5)`, 20 px radius, a 1 px light edge                                                                                                  |
| Side panel | A second, lighter glass slab: white at 4.5% (dark) or 13% (light), same blur, 1 px hairline                                                                                                                                                        |
| Left rail  | No panel; it sits on the wash                                                                                                                                                                                                                      |
| Text       | From the theme: `text`, `textMuted`. On the light-mode wash all text is white (muted is white at 90%)                                                                                                                                              |
| Accent     | The theme's `brand`. Fills that mark "active" or "primary" use the gradient `brand → brandMid → brand2`                                                                                                                                            |
| Type       | Inter 400 / 500 / 600; JetBrains Mono for counts and section labels (11 px, uppercase, 0.12em tracking); tabular numbers                                                                                                                           |
| Controls   | 8 px radius (7 px inside the 10 px view-switch track). Hairlines brighten on hover, never thicken: white 10% to 26% in dark; in light, black 10% to 24% on the card and white 24% to 55% on the rail and side panel                                |
| Nav rows   | 24 px icon slot, then the label. Active row: a faint brand tint plus a 3 px gradient bar on the rail's outer edge                                                                                                                                  |
| Depth      | No drop shadows on controls. The card carries one soft shadow (`--lift`); otherwise the glass edge and blur do the separating                                                                                                                      |
| Motion     | Dots glide between views and between arrangements in a staggered wave; hubs and the freshest dots breathe; the orbit turns; links fire a pulse. Shared tokens `--dur-fast`, `--dur`, `--dur-slow`, `.rise`; easing `cubic-bezier(0.16, 1, 0.3, 1)` |

### Themes, mode and reach

Appearance is four independent choices (theme, mode, reach and dot colours), kept per browser, changed in an Appearance panel inside the account popover at
the bottom of the left rail.

- **Theme (18):** Hive (default; honey and amber, colour only, no texture), Keystone, Graphite, Aurora, Sunset, Nebula, Lagoon, Tropic, Orchid,
  Peach, Glacier, Dusk, Berry, Candy, Citrus, Prism, Mocha, Neon. Keystone and Graphite have one
  accent; the rest have two. The seed values for every theme in both modes are in
  [`ui/themes.json`](ui/themes.json); the 17 other than Hive were copied from Monolith's `develop` on
  2026-11-18. Hive's light seeds are darkened so white text on the wash keeps its contrast. A `--mark`
  token carries the colour of the hexagon mark beside the Hive name at the top of the left rail.
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
and topics sit closer in hue than in Classic. These colours mark groups: the hubs in Rings, and every
dot in Timeline and Orbit. Dots in Rings are drawn in the theme's brand colour instead (see
section 3).

Contrast is checked by a test for every theme, mode and reach (section 6). Where a derived
colour falls short, its lightness is adjusted, never a seed; every adjustment is listed in
`web/src/theme/adjustments.generated.txt`.

## 3. The map (home)

One dot per note or file, drawn on a single canvas. A visually hidden list of real buttons carries
keyboard and screen-reader access. The same dots are shown in three views, and Rings opens first:

| View     | What it shows                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------- |
| Rings    | Opening view. The index at the centre, a hub per group, the group's items on arcs outward from it |
| Timeline | Agent writes per day on top; every note under the day it last changed                             |
| Orbit    | The same dots on a slowly rotating sphere, agents on an outer ring                                |

- **Rings:** the groups sit in sectors around the circle, and each item is placed by how recently
  it changed: the freshest notes on the arc nearest the hub, older ones further out, files after
  one empty arc, agents on a ring beyond them. The whole picture shrinks to fit the card. All dots
  are drawn in the theme's brand colour, and brightness means freshness: an item changed in the
  last two days is bright and breathes, an old one is faint. A readable dot has a thin outline; the
  contrast of the faintest dots against the card is a known gap, accepted for now. Only the hubs
  keep their group colours.
- **Quiet at rest:** Rings draws no ring labels and does not label hubs. At rest it draws only the
  spokes from the index to the hubs, and group names are drawn on the canvas on one circle outside
  the rings, as "name · count". A dot's own links show when it is hot (hovered),
  focused or selected.
- **Arrange by:** a switch that appears only in Rings, with Folder, Links and Time. Folder groups
  by topic (the largest first, up to twelve groups, the rest folded into "Other"). Links groups
  items that link to each other into clusters, named after their best-linked note, with "Hub
  notes", "Small clusters" and "Unlinked" for the rest. Time groups by month, with "Last 2 weeks"
  first when anything changed in that time. Changing it moves the dots in one glide, keeps the
  selected item selected, and clears a pinned group filter, since the groups are new. It is client
  state only and sends no request.
- **Timeline and Orbit** keep the per-topic colours (at most eight topics, the rest folded into
  "Other"), and the dock calls the list "Topics".
- **Zoom and pan:** wheel or pinch toward the cursor, drag to pan, double-click to zoom in, a
  zoom control (+, −, Fit), and keys. Orbit turns by dragging. Labels are chosen once motion
  settles; zoom-driven labels are capped at 60 and never overlap (rule labels are not capped).
- **Hover peek:** a small card with the title, group and owner; links fire a pulse along their
  length. The index dot's card says "Groups" with a count.
- **Legend dock:** the group list, Kinds and People. In Rings the group list is headed "Folders",
  "Clusters" or "Months" to follow the arrangement, and the kind entry for hubs reads "Groups". In
  Timeline and Orbit the heading and the hubs' kind entry read "Topics". Hover previews the isolation; click pins it.
- **Shapes:** circle = note, diamond = file, ringed circle = hub, hollow = a colleague's item that
  is not shared with you, hexagon = the hive index. In Rings the agents are dots on the outer
  ring. Nothing on the map shows whether an agent is live, wrote today or is idle; the agents card
  in the left rail shows who is connected.
- **Core:** a swarm at the centre showing the last 24 hours of writes.
- **Isolate, don't hide:** picking a group, a kind or a person dims everything else.
- **Click a dot:** it lights up with its connections; the right rail shows what it is, who wrote
  it and what it connects to. An unshared note shows only "Private note" and its topic.
- **Search:** matching dots stay lit and get labels when there are few enough.

Layout: a left rail on the wash (mark and the hive's name, five destinations with icons, agents
summary, account button), the map on the glass card with the view switch as one segmented control,
and a glass side panel. It shows Today until something is selected (a count-up of today's writes,
a 14-day sparkline of agent writes, By person, and Needs you), then Selected. The housekeeper's last
run sits below. The rail's active bar marks the current page (each page renders its own rail, so the bar does
not slide between pages), the agents card collapses, and an account popover holds Appearance,
Settings and Sign out; the member's name, role and hive load in the root layout.

**The hive switcher.** The hive's name beside the mark at the top of the rail is a button. It
opens a popover, in the way the account button does, with:

- the person's hives, each with their role there and a tick on the current one. Choosing
  another switches to it and reloads the page the person is on;
- **New hive**, which opens a small form in the same popover with two fields, "Hive name" and
  "Your name in this hive" (filled in with the person's current display name), then **Create**
  and **Cancel**. After Create the new hive opens on the map. A refusal shows one line under
  the form: the name rules (1 to 60 characters each), "You already own 5 hives.", or the usual
  failure line.

A person in one hive still gets the button and New hive. Escape closes the popover and returns
focus to the button. The list is drawn from what the page already loaded, so opening it costs
no round-trip. It reuses the rail's tokens and the account popover's classes; the account
popover keeps showing the current hive and role. There is no rename, delete or leave yet.

**No hive yet.** A signed-in person who is in no hive sees the home page's empty state with the
same New hive form, so a first hive can be started without an invitation.

Known follow-ups: make the rail persistent across pages so the bar slides.

Rejected and not to be reopened: the entity-level "neural map", the per-topic cluster options and
the plain force graph ([[2026-11-20-decision-07-brain-dashboard-is-the-map]]).

## 4. Other pages

- **Inbox** — overlap suggestions, share proposals from agents, contradiction flags, quarantine
  releases. Each item: what, who, why, two actions. Built so far: proposed links waiting for
  your own answer (accept or decline) and your held notes (release or open in the vault), with
  the number waiting on the rail. Decline asks first: "Decline this link? It cannot be proposed
  again." A declined pair of notes stays declined.
- **Entities** — synthesis at the top with every fact citing its source on hover; contradictions
  pinned; linked notes and files below.
- **Vault** — folder tree, note list, note preview. Visibility shown inline and changed in place;
  quarantine is a folder with a release action. The preview of your own note has a quiet
  **Delete** after the sharing control. The first click asks "Delete this note? It is gone for
  good, with its history and its links. Files attached to it stay in the gallery." with
  **Delete** and **Keep**; the second Delete counts only half a second after the question
  appears, as with the inbox's Decline. Afterwards the note's tab closes and a status line says
  "Note deleted." A colleague's note has no Delete. A note with accepted links shows **Linked
  with** under the sharing control: for each link the other note's title (which opens it in the
  vault), its owner, and **Unlink**. A note with no accepted links shows no such heading.
  Unlink asks in place, as Delete does: "Unlink these notes? You and (owner) will no longer
  read each other's note through this link. The two notes cannot be linked again." with
  **Unlink** and **Keep**. For two notes of your own it asks "Unlink these two notes of
  yours?", and those two can be linked again later. Afterwards the page refreshes; if the open
  note was a colleague's that you could read only through that link, it is gone and the vault
  shows its "not found" state.
- **Gallery** — previews of generated documents; mine, shared with me, whole hive; a full-screen
  viewer for PDF, PPTX, XLSX and images. Built so far: a card grid with image thumbnails, the
  viewer for images and PDFs, download for every file and delete for your own; PPTX and XLSX
  download only.
- **Chat** — conversations on the left, the thread in the centre panel with source chips under
  each answer, agent activity and artifacts on the right. The line under the composer always says
  which workspace is written to and whose subscription is paying.
- **Settings** — workspaces and tokens, connected agents and setup instructions, sharing defaults,
  members and roles, audit log. Built so far: your own agents (connect, token shown once,
  revoke) and the member list. Under Members the owner has an **Invite a member** form (email
  and display name). Nobody is added at once: the server emails the address an invitation, and
  the person joins on the `/join` page by pressing **Join**. Every invited address is listed
  under **Invitations** with name, email, invited and expiry dates, **Send again** and
  **Revoke**. A notice says the invitation was sent, or that it was saved but the email could
  not be sent. A member who is not the owner sees neither the form nor the invitations.

## 5. Overlays and states

| Overlay or state         | Behaviour                                                   |
| ------------------------ | ----------------------------------------------------------- |
| Command palette          | Searches notes, entities, files and actions                 |
| Share dialog             | Private, group or named members; shows what will change     |
| Handshake                | Names the entity only; share or decline; a decline is final |
| Contradiction resolver   | Two facts side by side with owners and dates                |
| Token dialog             | Name, workspace, trust tier, expiry; token shown once       |
| First run                | Empty map with the onboarding steps and a connect action    |
| No hive yet              | The home page's empty state with the New hive form          |
| Hive switcher            | Popover from the hive's name: hives, role, tick, New hive   |
| Token revoked or expired | Inbox item with a regenerate action                         |
| Write rejected           | Inbox item with the attempted path and the reason           |
| Synthesis failed         | Entity page shows the last good version with a retry        |
| Offline                  | Map freezes with a reconnect notice                         |

## 6. Accessibility

- Colour meaning is doubled by shape or text.
- Real buttons and labels everywhere; visible keyboard focus.
- Reduced-motion setting stops everything that moves on its own: the view and arrangement glide and
  waves, hub breathing, the orbit turn, firing pulses, the count-up and ambient frames.
  Nothing moves under it; the map is drawn still.
- Contrast, in every theme, mode and reach (102 combinations), asserted by
  `web/src/theme/contrast.test.ts`: text at least 4.5:1; quiet labels, the eight dot colours and
  the focus ring at least 3:1. The same holds on the solid fallback backgrounds.
- Focus ring: 2 px of the accent with a 2 px offset on every interactive element.
- Glass has a fallback: where `backdrop-filter` is unsupported the card uses the solid page
  colour, the side panel its solid equivalent and popovers the solid surface colour.

## 7. Performance budget for the map

The map is **one canvas**, not a DOM node per dot (DOM dots ran at 20 to 30 fps on a real
1,605-note vault). Static layers are cached and redrawn crisp once the camera settles; frames are
drawn on demand; ambient motion (hub breathing, orbit turn) is throttled to about
12 fps and pauses when the map is off-screen or the tab hidden. A browser check (`e2e/map-perf.spec.ts`)
keeps the 95th-percentile frame of a one-second wheel zoom on 5,000 items under 34 ms, and the same
limit holds for the glide after choosing another arrangement and after switching Rings to
Timeline; neither glide may have a frame of a second or more. In development, `/dev/map?items=N`
builds a map of N items to test this.

Three views of one graph, and three arrangements of Rings, must be **one load and zero further
round-trips**: fetch the nodes and links once, compute every layout and grouping in the browser,
and switch views and arrangements in client state only. The
fetch must be bounded: select only the columns the map draws, over indexed columns, never note
bodies.

Changing theme, mode, reach or dot colours is also **zero round-trips**: it changes CSS variables
on the root and nothing else. The choice is remembered per person; where it is stored is not
decided yet.
