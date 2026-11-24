# Rings as the main map view: design

Date: 2026-11-24. Status: approved in brainstorming, awaiting plan approval.

## 1. What changes and what does not

The map gets three views instead of six: **Rings** (the opening view), **Timeline** and **Orbit**.
The Hive, Topics and Links views are removed. Rings is redrawn the way the prototype showed it on
the DRA vault (1,639 notes): one colour, brightness by freshness, the freshest notes on the inner
rings, and an "Arrange by" switch with three arrangements.

Not in this round, by the user's decision:

- The left rail and the right detail panel stay exactly as they are.
- Timeline and Orbit keep their current look and behaviour.
- No server change, no migration, no new data. Grouping notes by what their text is about (the
  prototype's "Topic" arrangement) needs an embedding per note and is a separate project.
- The other ideas from the brainstorm (reading a note in place, a work pane, search over note
  text, fewer pages, new typefaces, fewer themes) are parked.

## 2. Views

`View` becomes `"rings" | "timeline" | "orbit"`. The view switch shows Rings, Timeline, Orbit in
that order. The map opens on Rings.

Removed with the Hive view: the honeycomb layout (`hive.ts`), the moving agent marks
(`useMarks.ts`), the "At the hive" panel (`Presence.tsx`) and every Hive branch in the scene, the
renderer and the canvas. Removed with Topics and Links: the `topics` and force layouts. The left
rail's agents card still shows who is connected.

## 3. Arrangements (Rings only)

A second segmented control, "Arrange by", sits beside the view switch and is shown only in Rings.
It has three options. The choice is client state; it is not saved.

| Option           | A group is                                                                                 | Order around the circle     |
| ---------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| Folder (default) | the item's `topic` from the payload (its folder, cut to two segments), as today            | largest first, ties by name |
| Links            | a cluster of items that link to each other (see 3.1), plus "Small clusters" and "Unlinked" | largest first, ties by name |
| Time             | "Last 2 weeks", then one group per calendar month (UTC) of the item's last change          | newest first                |

At most 12 groups are drawn. With more, the first 11 keep their own sector and the rest fold into
one last group: "Other" for Folder and Links ("Other topics" or "Other clusters" if a real group
already has that name), "Earlier" for Time.

The arrangement decides the model's `topics`, so the hubs, the sectors, the legend dock's group
list and the group filter all follow it without further change. The dock's heading reads
"Folders", "Clusters" or "Months". Changing the arrangement clears the group filter, keeps the
selection (it is kept by key) and glides every dot to its new place with the same staggered wave
as a view switch. Timeline and Orbit always use the Folder model.

All three arrangements use only what `map_graph` already returns, including for items the member
cannot read (topic, time and links are already in the payload), so nothing new is revealed.

### 3.1 Link clusters

Deterministic, no randomness:

1. Degree of an item = its number of real links. Items with more than 25 links are hubs and are
   left out of clustering, so an index note does not pull everything into one cluster.
2. Label propagation on the remaining links: each item starts with its own index as label; for 12
   passes, in index order, an item takes the label most common among its neighbours, ties to the
   smallest label.
3. A cluster with fewer than 3 items goes to "Small clusters". An item with no links goes to
   "Unlinked". Hub items go to "Hub notes". An item linked only to hubs goes to "Unlinked".
4. A cluster is named after its readable member with the most links (ties to the smallest index),
   title cut to 28 characters. If no member is readable: "Cluster 1", "Cluster 2", in size order.

## 4. Rings geometry

Positions stay inside the 1000 x 760 box the camera fits, centre (500, 380).

- The index sits at the centre. One hub per group sits at radius 120, in the middle of its sector.
- Sectors start at twelve o'clock and go clockwise, with a 0.05 rad gap between them. A sector's
  width is in proportion to its item count, with the existing minimum widths.
- Inside a sector, items fill arcs outward from radius 165, 15 apart, 13.5 apart along the arc.
  Notes come first, sorted by last change, newest first, so the freshest sit on the inner rings.
  Files follow on the arcs after the last note arc, with one empty arc between. Ties by id.
- Agents sit evenly on one ring 30 beyond the outermost item arc (at least radius 300).
- If the agent ring would pass radius 350, every radius and both spacings are multiplied by one
  factor so it lands on 350, and the dots are drawn smaller by the same factor (not below 2.5
  screen pixels at 100% zoom). The layout returns that factor with the positions.
- Guides: faint circles at the hub radius, the first item arc and the agent ring. The "Notes",
  "Files" and "Agents" ring labels are dropped; the agent ring keeps "Agents".
- Group names are drawn outside the outermost arc of each sector, aligned away from the circle
  (left of centre: right-aligned; right of centre: left-aligned; near top and bottom: centred),
  as "<name> · <count>", cut to 44 characters. They take part in the existing no-overlap label
  pass and hide when "Labels" is off.

## 5. Colour and light

One rule: **brightness means freshness.** Notes and files are drawn in the theme's `brand` colour.

- Freshness level 0 to 7 from the age of the last change: 2 days or less is 7; otherwise
  `floor(7.4 * e^(-days / 26))`, kept within 0 to 6.
- Fill opacity by level: 0.11, 0.15, 0.23, 0.33, 0.45, 0.60, 0.76, 0.94.
- Levels 6 and 7 glow; level 7's glow breathes with the other ambient motion (about 12 frames a
  second, paused when off-screen, still under reduced motion).
- Every dot keeps a thin outline in `brand` so an old note is still a visible shape. The outline's
  opacity is one constant, chosen as the smallest value at which the outline has at least 3:1
  contrast against the map card in all 18 themes, both modes and all three reaches; the theme
  contrast test checks it.
- An item the member cannot read stays hollow (outline only). A file stays a diamond, a note a
  circle. Dots no longer dim for "not mine".
- Hubs and the legend dock's group swatches keep the theme's group hues (hue = group index modulo
  8), so the "dot colours" setting under Appearance still has an effect.
- Filtered-out dots dim to 10% and the soft dim to 32%, as today; the hot, focused and selected
  dot is drawn at full opacity.

## 6. Unchanged behaviour to keep

Zoom, pan, pinch, fit, keyboard keys, the hover peek, firing links on hover and selection, labels
that appear with zoom, the hidden list of real buttons (one per dot), the legend dock's filters
and preview, the search box, the detail panel, reduced motion, and the on-demand drawing with a
cached static layer.

## 7. Performance and data-fetching budget

- First paint: one `map_graph` call, as today. No new call.
- Switching view or arrangement, filtering, searching, zooming: 0 server round-trips. Nothing in
  this change writes server data.
- The hot-path read is unchanged (bounded at 5,000 items over indexed columns).
- Building a model for an arrangement is linear in items and links (12 passes for Links). Each
  arrangement's model and layout is computed on first use and kept until the payload changes.
- The 5,000-item browser check must hold on Rings: 95th-percentile frame under 34 ms during a
  one-second wheel zoom, and under 34 ms during an arrangement switch.

## 8. Accessibility

- "Arrange by" is a labelled group of toggle buttons like the view switch, reachable by keyboard.
- The hidden list's buttons keep their names; the group in a name follows the arrangement.
- Freshness is also in the peek card and the detail panel as a date, so it is not carried by
  brightness alone.

## 9. Independent units

1. `freshness.ts`: age to level and opacity. Pure.
2. `arrange.ts`: payload to ordered groups for Folder, Links and Time. Pure.
3. Removing the Hive, Topics and Links views. A deletion across types, layouts, scene, renderer,
   canvas, map screen and tests.
4. Rings geometry and freshness drawing (layout, scene, renderer).
5. Arrangement wiring (model, map state, controls, dock heading).
6. Browser tests, performance check, docs.

Units 1 and 2 share nothing. Units 4 and 5 touch different files and both need unit 3 first.

## 10. Testing

- Unit: freshness levels at the boundaries; each arrangement's groups, order, cap and names; link
  clusters on a small fixed graph, including a hub and an unreadable cluster; Rings geometry
  (freshest innermost, files after notes, everything inside the box, the scale factor at 5,000
  items, no two items closer than the spacing); the outline contrast across themes.
- Browser: the map opens on Rings; the view switch has exactly three views; each arrangement
  regroups the dots and the dock; the group filter clears and the selection survives an
  arrangement switch; no "At the hive" panel; the 5,000-item performance checks.
- Docs: `docs/ui-concept.md` section 3 and `AGENTS.md` rule 5 ("six views") say three views.
