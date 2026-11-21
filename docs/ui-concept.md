---
type: design
status: active
last-updated: 2026-11-21
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
  you. Nothing glows for decoration.
- **Humans decide, the system suggests.** Every suggestion arrives as a quiet item in "Needs you",
  never a modal that blocks work.
- **Familiar where it must be.** Chat keeps the three-column shape of Claude and ChatGPT.
- **Show, don't store.** The map is drawn from the database every time; the page holds no state of
  its own.

## 2. Visual language

| Token        | Choice                                                                          |
| ------------ | ------------------------------------------------------------------------------- |
| Base surface | `#06090F`; the working panel sits on it as a rounded `#0B101A` card (22 px)     |
| Text         | `#E6EBF5` primary, `#8A96AD` secondary, `#5F6B84` quiet                         |
| Accent       | `#CFF4FF` for the hive mark, primary actions and the selected state             |
| Topic hues   | `#F5B556` `#62B8FF` `#FF8FB3` `#C4A2FF` `#5FE0B0` `#FF9D5C` `#5CD6E6` `#C3E36A` |
| Type         | Geist, 400 / 500 / 600, sentence case, tabular numbers                          |
| Controls     | Pills (999 px radius), no borders; fills `#141B28` and `#1A2231`                |
| Depth        | No shadows, no rules between rails; separation by tone and space                |
| Motion       | Dots glide between views; the core breathes; the orbit turns. Nothing else.     |

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

Layout: a slim left rail (mark, five destinations, agents summary), the map on a rounded panel
with the view switch as one pill control, and a right rail that shows today's activity until
something is selected. "Needs you" and the housekeeper's last run sit below.

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
- Text contrast at least 4.5:1.

## 7. Performance budget for the map

Six views of one graph must be **one load and zero further round-trips**: fetch the nodes and
links once, compute every layout in the browser, and switch views in client state only. The
fetch must be bounded: select only the columns the map draws, over indexed columns, never note
bodies.
