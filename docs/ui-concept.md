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
  you. The only decorative light is a faint tint of the theme's glow colour behind the centre of the map.
- **The data carries the colour.** Navigation and panels are neutral and flat; hue is spent on the
  dots and on the one accent.
- **Humans decide, the system suggests.** Every suggestion arrives as a quiet item in "Needs you",
  never a modal that blocks work.
- **Familiar where it must be.** Chat keeps the three-column shape of Claude and ChatGPT.
- **Show, don't store.** The map is drawn from the database every time; the page holds no state of
  its own.

## 2. Visual language

The look is flat: the layout grammar of our Monolith app (a rail and a side panel sitting directly
on the page colour, content on one inset card) with solid surfaces and a colour ramp that shows
how fresh a note is, which is Hive's own
([[2026-11-24-decision-16-eight-hand-tuned-themes-replace-keystone-glass]]). There is no wash,
no bloom and no frosted glass. It replaces the Keystone glass look
([[2026-11-22-decision-13-keystone-glass-look-with-themes]]), which replaced the navy look the
first map was built with.

| Token      | Choice                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background | One flat colour, the theme's page colour, behind the rail and the side panel                                                                                                                                                                       |
| Map card   | A solid card colour, 20 px radius, a 1 px line. Behind the centre of the map sits one faint radial tint of the theme's glow colour (5% to 10%), gone by 58% of the radius. Blueprint also draws a fine grid on the card                            |
| Side panel | The same solid card colour, with a 1 px line                                                                                                                                                                                                       |
| Left rail  | No panel; it sits on the page colour                                                                                                                                                                                                               |
| Text       | From the theme: `text`, `textMuted`. Every theme, Paper included, uses its own text colour on the rail, the side panel and the card alike                                                                                                          |
| Accent     | The theme's one accent. Fills that mark "active" or "primary" use it as a single colour; the chosen segment and the active nav row use the theme's own active fill and text                                                                        |
| Type       | Inter 400 / 500 / 600; JetBrains Mono for counts and section labels (11 px, uppercase, 0.12em tracking); tabular numbers                                                                                                                           |
| Controls   | 8 px radius (7 px inside the 10 px view-switch track). Hairlines brighten on hover, never thicken: the line colour moves 25% towards the text colour                                                                                               |
| Nav rows   | 24 px icon slot, then the label. Active row: the theme's active fill plus a 3 px bar of the accent on the rail's outer edge                                                                                                                        |
| Depth      | No drop shadows on controls and no blur. In the dark themes nothing is lifted; in Paper the card carries one soft shadow (`--lift`)                                                                                                                |
| Motion     | Dots glide between views and between arrangements in a staggered wave; hubs and the freshest dots breathe; the orbit turns; links fire a pulse. Shared tokens `--dur-fast`, `--dur`, `--dur-slow`, `.rise`; easing `cubic-bezier(0.16, 1, 0.3, 1)` |

### Themes

Appearance is one choice, the theme, kept per browser and changed in an Appearance panel inside the
account popover at the bottom of the left rail. The panel is a single list of eight swatches; each
swatch is the theme's card colour split on the diagonal with the freshest colour of its ramp.

There are eight themes, each tuned by hand. Honey is the default.

- **Honey:** near-black with honey and amber; the colour of the hive.
- **Abyss:** deep blue-black with a cool teal.
- **Ember:** warm black with orange and red, and a hot yellow at the fresh end.
- **Aurora:** green-black with a mint accent and violet hubs.
- **Moonstone:** neutral black and silver, nearly without hue.
- **Ultraviolet:** purple-black with violet and pink.
- **Blueprint:** navy with a fine grid on the card and yellow hubs.
- **Paper:** warm off-white with dark text and a burnt-orange accent.

A theme is dark or light by itself; Paper is the light one. There is no light version of the other
seven and no dark version of Paper. Everything about a theme is a record in
[`ui/themes.json`](ui/themes.json) (the live copy is `web/src/theme/themes.json`): page, card,
line, text, muted, accent, glow, hub, the active fill and text, the tint, and the ramp. The
component CSS never names a theme.

**The ramp.** Each theme sets three colours, old, middle and fresh; eight steps are mixed between
them (`--fresh-0` to `--fresh-7`, old to fresh). In Rings a note takes its colour from this ramp
by how recently it changed (section 3). Notes at the fresh end also get a soft halo in the
theme's glow colour, drawn under a crisp dot.

**Topic colours.** The eight topic colours are generated: take the hue midway between the theme's
accent and its glow colour (in OKLCH), fan eight hues across 160° around it, and alternate two
lightness levels (0.82 / 0.72 in dark, 0.60 / 0.50 in light) at chroma 0.14 (0.15 in light), with
neighbouring topics placed far apart in the fan. A theme whose accent has almost no chroma
(OKLCH chroma below 0.03; today that is Moonstone) gets eight near-greys instead, spaced evenly
in lightness. The rule is triggered by the chroma, never by the theme's name. A topic has no fixed
colour across themes. These colours mark groups in Timeline and Orbit. In Rings the dots take
their colour from the ramp and the hubs take the theme's hub colour (see section 3).

**Contrast.** Every theme is checked by a test (section 6). A colour that fails is changed by hand
in `themes.json`; nothing adjusts colours automatically.

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
  one empty arc, agents on a ring beyond them. The whole picture shrinks to fit the card. Every
  dot takes a colour from the theme's ramp by how recently it changed: an old note sits at the dim
  end, a note changed in the last two days at the bright end, with a soft halo under it that
  breathes. Hubs take the theme's hub colour. A readable dot has a thin outline; the contrast of
  the faintest dots against the card is a known gap, accepted for now.
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
  "Other"), and the filter bar calls the list "Topics".
- **Zoom and pan:** wheel or pinch toward the cursor, drag to pan, double-click to zoom in, a
  zoom control (+, −, Fit), and keys. Orbit turns by dragging. Labels are chosen once motion
  settles; zoom-driven labels are capped at 60 and never overlap (rule labels are not capped).
- **Hover peek:** a small card with the title, group and owner; links fire a pulse along their
  length. The index dot's card says "Groups" with a count.
- **Filter bar:** a solid bar at the bottom left of the map, in place of the old legend dock. It
  holds three list buttons (the groups, Kind and People), a chip for each choice and for the
  search text, a count, Clear all and a Legend. In Rings the group list is named "Folders",
  "Clusters" or "Months" to follow the arrangement, and the kind row for hubs reads "Groups"; in
  Timeline and Orbit both read "Topics". A list button opens a list of checkboxes above the bar,
  one list at a time. Pointing at or focusing a row previews it on the map without choosing it;
  Escape, a press outside or tabbing out closes the list. Choosing as many rows as you like
  works by one rule: any within a list, all across lists, so two folders show both, and adding a
  person narrows that to the person's items in those folders. Each choice shows as a chip with a
  remove button, and the count reads "All N shown" or "M of N shown". The Legend lists the shapes,
  and in Rings only, that brighter means changed more recently. Choosing a filter clears the
  selection, and choosing another arrangement clears the group choice. A "By person" row in the
  side panel is a button that adds the same person to the filter.
- **Shapes:** circle = note, diamond = file, ringed circle = hub, hollow = a colleague's item that
  is not shared with you, hexagon = the hive index. In Rings the agents are dots on the outer
  ring. Nothing on the map shows whether an agent is live, wrote today or is idle; the agents card
  in the left rail shows who is connected.
- **Core:** a swarm at the centre showing the last 24 hours of writes.
- **Isolate, don't hide:** choosing a group, a kind or a person dims everything else.
- **Click a dot:** it lights up with its connections; the right rail shows what it is, who wrote
  it and what it connects to. An unshared note shows only "Private note" and its topic.
- **Search:** matching dots stay lit and get labels when there are few enough.

Layout: a left rail on the page colour (mark and the hive's name, five destinations with icons, agents
summary, account button), the map on the card with the view switch as one segmented control,
and a solid side panel. It shows Today until something is selected (a count-up of today's writes,
a 14-day sparkline of agent writes, By person, and Needs you), then Selected. The housekeeper's last
run sits below.

**Folding.** The left rail folds to a 60 px strip of icons, on every page that has a rail, and the
map's side panel folds to a 52 px strip that shows today's count and, when anything waits, the
number that needs you. Each has a fold button (named "Fold navigation" or "Unfold navigation",
"Fold details" or "Unfold details") and a key: `[` for the rail and `]` for the panel (the panel
only on the map). The keys are ignored while typing, inside a popover or dialog, with a modifier
held, and on key repeat. The state is kept in one cookie, `hive-fold`, as `<rail>.<panel>` with
each part `open` or `shut`, and the server draws it on the page, so a reload does not flash.
Below 700 px the layout stacks and nothing folds. Folding keeps the map's view, so a zoomed-in
map stays zoomed in. Selecting a dot while the panel is folded opens it. The rail's active bar marks the current page (each page renders its own rail, so the bar does
not slide between pages), the agents card collapses, and an account popover holds Appearance,
Settings and Sign out; the member's name, role and hive load in the root layout.

**The hive switcher.** The hive's name beside the mark at the top of the rail is a button. It
opens a popover, in the way the account button does, with:

- the person's hives, each with their role there and a tick on the current one. Choosing
  another switches to it and reloads the page the person is on. A hive that is marked for
  deletion reads "being deleted" beside its name;
- **New hive**, which opens a small form in the same popover with two fields, "Hive name" and
  "Your name in this hive" (filled in with the person's current display name), then **Create**
  and **Cancel**. After Create the new hive opens on the map. A refusal shows one line under
  the form: the name rules (1 to 60 characters each), "You already own 5 hives.", or the usual
  failure line.

A person in one hive still gets the button and New hive. Escape closes the popover and returns
focus to the button. The list is drawn from what the page already loaded, so opening it costs
no round-trip. It reuses the rail's tokens and the account popover's classes; the account
popover keeps showing the current hive and role. There is no rename or leave yet; deleting a
hive is in Settings (section 4).

**No hive yet.** A signed-in person who is in no hive sees the home page's empty state with the
same New hive form, so a first hive can be started without an invitation.

**A hive that is being deleted.** Every screen of a hive marked for deletion shows one banner
above the page: "This hive will be deleted on (date). Nothing new can be saved." The date is in
the person's locale. An owner also gets **Cancel deletion** in the banner; it asks once in
place, then the page reloads and the banner is gone. Other members see the banner without the
button. The banner is placed once, in the root layout, and its date comes with what every page
already loads, so it costs no round-trip. It is a status line (`role="status"`), not a modal:
reading goes on as before. A write that is tried anyway fails with the screen's usual failure
line, and the banner says why. Cancelling works until the scheduled erase has started on the
hive; after that the database refuses it. It uses no new colour or token. When the hive is erased, a
person who had it chosen lands in their oldest remaining hive, or on the no-hive page.

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
  **Import a folder** in the vault's header opens a panel in place, not a new page, for a
  folder of markdown notes. It goes through five steps:
  1. **Pick.** The browser's folder picker; the files are read in the browser.
  2. **Summary**, before anything is saved: notes found, other files skipped, notes skipped
     for being over 1 MB. Frontmatter that cannot be read is kept as text and reported in the result. More than
     2,000 notes stops here: the panel says so and asks for a subfolder.
  3. **Destination.** "New workspace", with a name field filled in with the folder's name, or
     one of the person's workspaces in this hive. A refusal shows one line: the name rule (1
     to 60 characters), a name already in use, or 20 workspaces already.
  4. **Progress**, as "120 of 480 notes", with **Stop**. Stop ends after the batch in flight;
     what was saved stays.
  5. **Result.** Five counts (created, updated, unchanged, skipped, failed) with the paths of
     anything skipped or failed. The vault refreshes once, and the new workspace's tab can be
     opened from the panel.

  Every imported note arrives private; the panel has no sharing choice. Images, PDFs and other
  files are not imported. Controls are labelled, progress is announced politely, focus moves
  to the result's heading, and Escape closes the panel when no import is running. The panel
  is client state until Import is pressed, then one request per batch, one after another. It
  uses no new colour or token.

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
  Owners also have a **Delete this hive** section. It shows how many members, notes and files
  the hive holds and a field for the hive's name; **Delete hive** is enabled only when the
  typed name matches exactly. Nothing is erased at once: the hive is marked, the page reloads,
  and for 7 days everyone can read and nobody can save. While the hive is marked, the section
  shows the date it will be erased and **Cancel deletion** in place of the form. A member who
  is not an owner does not see the section. In a hive that is being deleted **Revoke** on an
  agent still works, so a leaked token can be cut off; everything else in Settings that saves
  is refused. Revoke on an agent that is already revoked shows the usual failure line there (a
  known gap).

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
| Hive being deleted       | Banner on every screen with the date; an owner can cancel   |
| Import a folder          | Panel in the vault: pick, summary, destination, progress    |
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
- Contrast, in every theme (8), asserted by `web/src/theme/contrast.test.ts`: text at least 4.5:1;
  quiet labels, the eight dot colours and the focus ring at least 3:1; the three freshest ramp
  steps at least 3:1 (older steps are fainter on purpose).
- Focus ring: 2 px of the accent with a 2 px offset on every interactive element.

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

Changing the theme is also **zero round-trips**: it changes CSS variables
on the root and nothing else. The choice is remembered per person; where it is stored is not
decided yet.
