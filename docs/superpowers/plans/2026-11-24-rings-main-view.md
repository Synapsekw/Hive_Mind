# Rings as the Main Map View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map has three views (Rings, Timeline, Orbit); Rings opens first, is drawn in one colour with brightness by freshness, and can be arranged by Folder, Links or Time.

**Architecture:** Two new pure modules (`freshness.ts`, `arrange.ts`). The arrangement decides the model's `topics`, so hubs, sectors, the dock and the group filter follow it unchanged. The Hive, Topics and Links views and their code are deleted. The Rings layout is rewritten to sort by freshness and scale itself into the 1000 x 760 box. The renderer batches dots by freshness level instead of by topic.

**Tech Stack:** Next.js 16, React 19, TypeScript, canvas 2D, vitest, Playwright. No server change.

**Spec:** `docs/superpowers/specs/2026-11-24-rings-main-view-design.md`

## Global Constraints

- The left rail (`web/src/shell/*`) and the detail panel (`web/src/map/DetailRail.tsx`) are not edited.
- Timeline and Orbit keep their current look: they always use the Folder model capped at 8 groups.
- No migration, no change under `supabase/` or `mcp/`. No new network call.
- `View` is exactly `"rings" | "timeline" | "orbit"`. `Arrange` is exactly `"folder" | "links" | "time"`.
- Rings draws at most 12 groups (11 plus a fold group).
- Freshness opacities, in order of level 0 to 7: `0.11, 0.15, 0.23, 0.33, 0.45, 0.6, 0.76, 0.94`.
- Freshness level: age of 2 days or less is 7; otherwise `floor(7.4 * e^(-days / 26))` clamped to 0..6.
- Rings numbers: hub radius 120, first item arc 165, arcs 15 apart, 13.5 along the arc, sector gap 0.05 rad, agent ring 30 beyond the last arc and at least 300, everything scaled so the agent ring is at most 350, dots never below 2.5 px.
- Link clusters: hubs are items with more than 25 links; 12 passes; clusters under 3 items go to "Small clusters".
- Every interaction is 0 server round-trips. The 5,000-item browser check: 95th-percentile frame under 34 ms.
- Text shown to people is sentence case, plain words, no em dashes.
- Implementers do not commit. The controller commits each task by path with a lower-case conventional subject.
- Gates before a task is done: `pnpm typecheck`, `pnpm lint`, the task's own unit tests. Final gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and `pnpm --filter web exec playwright test`.

## Performance and data-fetching budget

- First paint: the one existing `map_graph` call. Nothing added.
- View switch, arrangement switch, filter, search, zoom: client state only, 0 round-trips, no write.
- Hot-path read unchanged: bounded at 5,000 items over indexed columns.
- Model per arrangement: linear in items and links (12 passes for Links), built on first use and kept in a per-payload cache.

## File map

| File                                                                 | Change                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `web/src/map/freshness.ts`, `freshness.test.ts`                      | New. Age to level and opacity.                                       |
| `web/src/map/arrange.ts`, `arrange.test.ts`                          | New. Payload to ordered groups.                                      |
| `web/src/map/types.ts`                                               | `View` narrowed; `Arrange` exported from `arrange.ts`.               |
| `web/src/map/graph.ts`, `graph.test.ts`                              | `buildModel(payload, grouping?)`; `markState` is not kept.           |
| `web/src/map/layouts.ts`, `layouts.test.ts`                          | Rings rewritten; `topics` and `force` deleted.                       |
| `web/src/map/scene.ts`, `scene.test.ts`                              | Comb fields removed; `fresh`, `dotScale`, `groupLabels`, new guides. |
| `web/src/map/renderer.ts`                                            | Hive branches removed; dots batched by freshness; group labels.      |
| `web/src/map/MapCanvas.tsx`, `DotList.tsx`, `nodeShape.ts`           | Hive props and marks removed; dot scale.                             |
| `web/src/map/Map.tsx`, `Controls.tsx`, `Dock.tsx`, `map.module.css`  | Three views, "Arrange by", dock heading.                             |
| `web/src/map/hive.ts`, `hive.test.ts`, `useMarks.ts`, `Presence.tsx` | Deleted.                                                             |
| `web/src/theme/*contrast*` test                                      | Outline contrast check.                                              |
| `web/e2e/map.spec.ts`, `map-perf.spec.ts`, `rail.spec.ts`            | Updated.                                                             |
| `docs/ui-concept.md`, `AGENTS.md`                                    | Three views.                                                         |

## Execution DAG

Dependencies:

- Task 1 (freshness): none.
- Task 2 (arrange): none.
- Task 3 (remove three views): none.
- Task 4 (Rings geometry and freshness drawing): Tasks 1 and 3.
- Task 5 (arrangement wiring): Tasks 2 and 3.
- Task 6 (browser tests, performance, docs): Tasks 4 and 5.

Parallel batches:

1. **Batch A:** Tasks 1, 2 and 3 together. Tasks 1 and 2 create new files only; Task 3 edits existing files and touches neither new file.
2. **Batch B:** Tasks 4 and 5 together. Task 4 owns `layouts.ts`, `scene.ts`, `renderer.ts`, `nodeShape.ts`, `MapCanvas.tsx`, `DotList.tsx` and their tests. Task 5 owns `graph.ts`, `Map.tsx`, `Controls.tsx`, `Dock.tsx`, `map.module.css` and their tests. The one shared seam is the call to `buildScene` in `Map.tsx`: Task 4 defines the new signature below and Task 5 calls it as written.
3. **Batch C:** Task 6.

Critical path: Task 3, then Task 4 (or 5), then Task 6. Three steps.

---

### Task 1: Freshness levels

**Files:**

- Create: `web/src/map/freshness.ts`
- Test: `web/src/map/freshness.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export const FRESH_ALPHA: readonly number[]; // length 8
  export const FRESH_LEVELS = 8;
  /** 0 (oldest) to 7 (changed in the last two days). A time of 0 or in the future of `now` counts as level 0 and 7. */
  export function freshLevel(updatedAt: number, now: number): number;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { FRESH_ALPHA, FRESH_LEVELS, freshLevel } from "./freshness";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);

describe("freshLevel", () => {
  it("is 7 for anything changed in the last two days", () => {
    expect(freshLevel(NOW, NOW)).toBe(7);
    expect(freshLevel(NOW - 2 * DAY, NOW)).toBe(7);
  });
  it("is 7 for a time in the future", () => {
    expect(freshLevel(NOW + DAY, NOW)).toBe(7);
  });
  it("drops just past two days and never returns 7 again", () => {
    expect(freshLevel(NOW - 2 * DAY - 1, NOW)).toBe(6);
    expect(freshLevel(NOW - 3 * DAY, NOW)).toBe(6);
  });
  it("follows floor(7.4 * e^(-days/26)) clamped to 0..6", () => {
    expect(freshLevel(NOW - 10 * DAY, NOW)).toBe(5);
    expect(freshLevel(NOW - 26 * DAY, NOW)).toBe(2);
    expect(freshLevel(NOW - 60 * DAY, NOW)).toBe(0);
    expect(freshLevel(NOW - 400 * DAY, NOW)).toBe(0);
  });
  it("is 0 for a missing time", () => {
    expect(freshLevel(0, NOW)).toBe(0);
    expect(freshLevel(Number.NaN, NOW)).toBe(0);
  });
  it("has eight rising opacities", () => {
    expect(FRESH_LEVELS).toBe(8);
    expect([...FRESH_ALPHA]).toEqual([
      0.11, 0.15, 0.23, 0.33, 0.45, 0.6, 0.76, 0.94,
    ]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter web exec vitest run src/map/freshness.test.ts`
Expected: fails, `./freshness` not found.

- [ ] **Step 3: Implement**

```ts
// How fresh an item is, as a level the renderer turns into opacity and glow. Pure.
const DAY_MS = 86_400_000;

export const FRESH_LEVELS = 8;
export const FRESH_ALPHA: readonly number[] = [
  0.11, 0.15, 0.23, 0.33, 0.45, 0.6, 0.76, 0.94,
];

export function freshLevel(updatedAt: number, now: number): number {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 0;
  const days = (now - updatedAt) / DAY_MS;
  if (days <= 2) return 7;
  return Math.max(0, Math.min(6, Math.floor(7.4 * Math.exp(-days / 26))));
}
```

- [ ] **Step 4: Run the test, see it pass.** Same command. Then `pnpm typecheck && pnpm lint`.

---

### Task 2: Arrangements

**Files:**

- Create: `web/src/map/arrange.ts`
- Test: `web/src/map/arrange.test.ts`

**Interfaces:**

- Consumes: `MapPayload` from `./types`.
- Produces:
  ```ts
  export type Arrange = "folder" | "links" | "time";
  export const ARRANGES: [Arrange, string][]; // [["folder","Folder"],["links","Links"],["time","Time"]]
  /** The dock's heading for the groups of an arrangement. */
  export const GROUP_HEADING: Record<Arrange, string>; // Folders, Clusters, Months
  export type Grouping = {
    names: string[]; // group names in drawing order
    of: number[]; // group index per payload node, same order as payload.nodes
  };
  export function grouping(
    payload: Pick<MapPayload, "nodes" | "links">,
    arrange: Arrange,
    now: number,
    max?: number, // default 12
  ): Grouping;
  ```

Rules (from the spec, sections 3 and 3.1):

- **Folder:** group = `node.topic`. Order: count descending, then name ascending by code unit (`a < b`), the same comparison `buildModel` uses today.
- **Time:** an item changed 14 days ago or less (by `now`) is in "Last 2 weeks"; otherwise its group is its UTC month as "November 2026" (English month names, built from a fixed array, not `toLocaleDateString`). A missing time (`updated_at` unparsable) goes to the oldest month group present, or to "Earlier" if there is none. Order: "Last 2 weeks" first, then months newest first.
- **Links:** as spec 3.1. Degree counts each payload link once per end, ignoring links whose end is not in `nodes` and self links. Fixed group names: "Hub notes", "Small clusters", "Unlinked". A cluster's name is the title of its readable member (`locked === false` and `title !== null`) with the highest degree, ties to the smallest node index, cut to 28 characters; with no readable member, "Cluster N" where N counts unnamed clusters from 1 in size order. Two clusters with the same name: the later one gets " (2)", " (3)". Order: count descending, then name.
- **Cap:** when there are more than `max` groups, the first `max - 1` keep their place and the rest fold into one last group: "Earlier" for Time; for Folder "Other" (or "Other topics" when a kept group is named "Other"); for Links "Other" (or "Other clusters").
- Empty `nodes` returns `{ names: [], of: [] }`.

- [ ] **Step 1: Write the failing tests** in `arrange.test.ts`. Build payload nodes with a small helper:

```ts
import { describe, expect, it } from "vitest";
import { GROUP_HEADING, grouping } from "./arrange";
import type { MapNode } from "./types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);
const node = (id: string, over: Partial<MapNode> = {}): MapNode => ({
  id,
  kind: "note",
  topic: "General",
  member_id: "m1",
  updated_at: new Date(NOW).toISOString(),
  locked: false,
  title: id,
  path: `${id}.md`,
  workspace_id: "w1",
  by_agent: false,
  agent_id: null,
  note_id: null,
  ...over,
});
const link = (from: string, to: string) => ({ from, to, tier: 1, score: 1 });
const sizes = (g: { names: string[]; of: number[] }) =>
  g.names.map((_, i) => g.of.filter((x) => x === i).length);
```

Cases to write, each with exact expected `names` and `sizes`:

1. Folder: topics A (3 items), B (2), C (2) give `["A","B","C"]`, sizes `[3,2,2]`.
2. Folder cap: 14 topics `t01`..`t14` with 14, 13, ... 1 items and `max` default give 12 names, the last "Other", its size `2 + 1 = 3`; with a real topic named "Other" among the first 11, the fold group is "Other topics".
3. Folder with `max = 8` gives 8 names, the last "Other".
4. Time: items at `NOW`, `NOW - 14 * DAY`, `NOW - 15 * DAY`, `NOW - 50 * DAY` give `["Last 2 weeks","November 2026","October 2026"]` with sizes `[2,1,1]`.
5. Time order is newest first even when an older month has more items.
6. Time cap: 14 distinct months give 12 names ending in "Earlier".
7. Links: two triangles `a-b-c` and `d-e-f`, a pair `g-h`, a lone `i`. Names are `["a","d","Small clusters","Unlinked"]` (triangle names by highest degree, ties to smallest index), sizes `[3,3,2,1]`.
8. Links hub: one node linked to 26 others which have no other links. The hub is in "Hub notes" (size 1) and the 26 are in "Unlinked".
9. Links with a locked cluster: a triangle whose three nodes are all `locked: true, title: null` is named "Cluster 1".
10. Links ignores a link to an id not in `nodes` and a self link.
11. Determinism: calling `grouping` twice on the same input returns deep-equal results; shuffling `payload.links` does not change `sizes`.
12. `GROUP_HEADING` equals `{ folder: "Folders", links: "Clusters", time: "Months" }`.
13. Empty input returns `{ names: [], of: [] }` for all three arrangements.

- [ ] **Step 2: Run and see them fail.** `pnpm --filter web exec vitest run src/map/arrange.test.ts`

- [ ] **Step 3: Implement `arrange.ts`.** Structure:

```ts
// The groups the Rings view is drawn in, for one arrangement. Pure and deterministic.
import type { MapPayload } from "./types";

export type Arrange = "folder" | "links" | "time";
export const ARRANGES: [Arrange, string][] = [
  ["folder", "Folder"],
  ["links", "Links"],
  ["time", "Time"],
];
export const GROUP_HEADING: Record<Arrange, string> = {
  folder: "Folders",
  links: "Clusters",
  time: "Months",
};
export type Grouping = { names: string[]; of: number[] };

const DAY_MS = 86_400_000;
const HUB_DEGREE = 25;
const PASSES = 12;
const MIN_CLUSTER = 3;
const NAME_MAX = 28;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Input = Pick<MapPayload, "nodes" | "links">;

/** Raw group key per node plus the order the keys are drawn in, before the cap. */
type Raw = { key: string[]; order: string[] };

function bySize(key: string[]): string[] {
  const n = new Map<string, number>();
  for (const k of key) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    .map(([k]) => k);
}

function folder(p: Input): Raw {
  /* key = node.topic; order = bySize(key) */
}
function time(p: Input, now: number): Raw {
  /* as the rules above; order by newest */
}
function links(p: Input): Raw {
  /* degree, hubs, 12 passes, names; order = bySize(key) */
}

function cap(raw: Raw, max: number, fold: string, foldAlt: string): Grouping {
  /* fold the tail */
}

export function grouping(
  p: Input,
  arrange: Arrange,
  now: number,
  max = 12,
): Grouping {
  if (p.nodes.length === 0) return { names: [], of: [] };
  if (arrange === "time") return cap(time(p, now), max, "Earlier", "Earlier");
  if (arrange === "links") return cap(links(p), max, "Other", "Other clusters");
  return cap(folder(p), max, "Other", "Other topics");
}
```

Fill the four helpers to make the tests pass. In `links`, index nodes by id with a `Map`, build adjacency as arrays of node indices sorted ascending (so link order does not matter), and run the passes in index order.

- [ ] **Step 4: Run the tests, see them pass,** then `pnpm typecheck && pnpm lint`.

---

### Task 3: Remove the Hive, Topics and Links views

A deletion. After it the app builds and runs with three views; Rings still looks as it does today.

**Files:**

- Modify: `web/src/map/types.ts`, `layouts.ts`, `layouts.test.ts`, `scene.ts`, `scene.test.ts`, `renderer.ts`, `MapCanvas.tsx`, `DotList.tsx`, `Map.tsx`, `Controls.tsx`, `nodeShape.ts`, `graph.ts` and any test importing the removed names
- Delete: `web/src/map/hive.ts`, `hive.test.ts`, `useMarks.ts`, `Presence.tsx`
- Do not touch: `web/e2e/*` (Task 6), `freshness.ts`, `arrange.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `export type View = "rings" | "timeline" | "orbit";`
  - `export const VIEWS: [View, string][] = [["rings","Rings"],["timeline","Timeline"],["orbit","Orbit"]];` in `Controls.tsx`
  - `layout(view: "rings" | "timeline", model, now)`; `orbit(model)` unchanged
  - `buildScene(model, view, pos, act, now)` (the `comb` argument is gone); `Scene` loses `combCells`, `combSize`, `entrance`
  - `dotDiameter(n: ModelNode): number` (the `hive` and `smallComb` arguments are gone)
  - `MapCanvas` loses the props `marks`, `moved`, `flare`
  - `HiveMap` opens with `useState<View>("rings")`

- [ ] **Step 1:** Change `View` in `types.ts`. Run `pnpm typecheck` and use the errors as the work list.
- [ ] **Step 2:** In `layouts.ts` delete `topics`, `force`, `forceIterations`, `ITERATIONS`, `FULL_NODES`; narrow `layout`'s first parameter and its `switch`. Orbit in `Map.tsx` used the `topics` layout as its flat fallback (`flatView`): use `"rings"` instead.
- [ ] **Step 3:** Delete `hive.ts`, `hive.test.ts`, `useMarks.ts`, `Presence.tsx`. In `Map.tsx` remove `comb`, `markStates`, `agentMarks`, `markPos`, `moved`, `agentNames`, the `listPos` override (use `listBase`), the `Presence` element and their imports. Keep `lastUsed` (the rail's agent rows use it).
- [ ] **Step 4:** In `scene.ts` remove the comb fields and the `comb` parameter; the core swarm condition becomes `!isTime`. In `renderer.ts` remove `F.hive`, `F.small`, the comb cache and drawing, the entrance, the Hive branch of `drawAgent` and `drawRoot`, flares, the `"links"` alpha special case (use the non-links value) and the `hex` helper if unused. In `MapCanvas.tsx` remove mark gliding, `markTarget`, `markAnim`, `markShown`, the Hive hit-size branch, and set `PULSE_VIEWS` to `new Set<View>(["rings"])`.
- [ ] **Step 5:** Update unit tests: delete cases for removed things, keep and adjust the rest (`layouts.test.ts`, `scene.test.ts`, any `Map`-level test). Do not weaken a test of kept behaviour.
- [ ] **Step 6:** `pnpm typecheck && pnpm lint && pnpm --filter web exec vitest run` all pass. `grep -rn "hive\b" web/src/map --include='*.ts' --include='*.tsx' -i` shows no reference to the comb, marks or the Hive view (the words "hive" for the product and "Hive index" for the root stay).

---

### Task 4: Rings geometry and freshness drawing

**Files:**

- Modify: `web/src/map/layouts.ts`, `layouts.test.ts`, `scene.ts`, `scene.test.ts`, `renderer.ts`, `nodeShape.ts`, `MapCanvas.tsx`, `DotList.tsx`
- Modify: the theme contrast test under `web/src/theme/` (find it with `grep -rln "contrast" web/src/theme`)

**Interfaces:**

- Consumes: `freshLevel`, `FRESH_ALPHA`, `FRESH_LEVELS` (Task 1); the narrowed `View`, `Scene` and `dotDiameter` (Task 3).
- Produces:
  ```ts
  // layouts.ts
  export type RingsLayout = {
    pos: [number, number][];
    scale: number; // 1, or less when the rings were shrunk into the box
    hubR: number; // radius of the hub ring, after scaling
    firstR: number; // radius of the first item arc, after scaling
    agentR: number; // radius of the agent ring, after scaling
    labels: {
      text: string;
      x: number;
      y: number;
      align: "left" | "right" | "centre";
    }[];
  };
  export function ringsLayout(model: MapModel): RingsLayout;
  // layout("rings", ...) returns ringsLayout(model).pos, so existing callers keep working.

  // scene.ts
  export function buildScene(
    model: MapModel,
    view: View,
    pos: [number, number][],
    act: Activity,
    now: number,
    rings?: RingsLayout | null, // given in Rings
  ): Scene;
  // Scene gains:
  //   fresh: Uint8Array        level per model node (0 for root, hubs, agents)
  //   dotScale: number         1 outside Rings
  //   groupLabels: RingsLayout["labels"]   [] outside Rings
  // Scene.guides.rings becomes [hubR, firstR, agentR] in Rings, [] elsewhere.

  // nodeShape.ts / renderer.ts
  export function dotDiameter(n: ModelNode, scale?: number): number; // never below 2.5 for notes and files
  export const OUTLINE_ALPHA: number; // renderer.ts, the constant the contrast test checks
  ```

Geometry rules are in the spec, section 4, and the numbers are in Global Constraints. Group label text is `"<name> · <count>"`, the name cut to 44 characters with "…". A label's anchor is on the sector's mid angle at the last arc's radius plus 34 (scaled); `align` is `"left"` when `cos(mid) > 0.25`, `"right"` when below `-0.25`, else `"centre"`.

- [ ] **Step 1: Failing layout tests** in `layouts.test.ts` (build models with the fixture in `fixture.ts`, which takes an `items` option):
  1. In every sector the notes' radii never decrease as `updatedAt` gets older (freshest innermost).
  2. Every file's radius is greater than every note's radius in the same sector.
  3. With 60 items `scale` is 1 and `agentR` is at least 300.
  4. With 5,000 items `scale` is below 1, `agentR` is 350 within 0.01, and every position is inside the box `0..1000` by `0..760`.
  5. No two items are closer than `13.5 * scale - 0.01` (check within each arc and between neighbouring arcs of a sector).
  6. One label per group, text ends with `· <count>`, and `align` matches the side of the circle.
  7. `layout("rings", model, now)` equals `ringsLayout(model).pos`.
- [ ] **Step 2:** Run, see them fail. `pnpm --filter web exec vitest run src/map/layouts.test.ts`
- [ ] **Step 3:** Rewrite `rings` as `ringsLayout`. Keep `parts` and `spread` for the sector widths, but start the first sector at twelve o'clock (`-TAU/4 + GAP/2`) and drop the 0.28 rad label gap. Sort each sector's notes then files by `updatedAt` descending, ties by `id`. Lay out unscaled, compute the agent ring, then multiply every radius by `scale = min(1, 350 / agentR)`; spacing shrinks by the same factor because radii do. `timeline` and `orbit` are not changed.
- [ ] **Step 4:** Run, see them pass.
- [ ] **Step 5: Failing scene tests:** `fresh[i]` equals `freshLevel(node.updatedAt, now)` for notes and files and 0 for the rest; in Rings `guides.rings` is `[hubR, firstR, agentR]`, `dotScale` is the layout's scale and `groupLabels` are the layout's labels; in Timeline `dotScale` is 1, `groupLabels` is `[]`, `guideLabels` are as before. The "Notes", "Files", "Agents" ring labels are gone; Rings has one guide label, "Agents", on the agent ring at the upper left.
- [ ] **Step 6:** Implement in `scene.ts`; run, pass.
- [ ] **Step 7: Renderer.**
  - `dotDiameter(n, scale = 1)`: `size(n) * scale`, and for notes and files not below 2.5.
  - `drawDots`: batch notes and files by `kind | freshness level | dim alpha` instead of by topic. Colour is `pal.brand`. Opacity is `FRESH_ALPHA[level] * alphaOf(F, i)`; drop the `theirs` 0.72 factor. Hubs stay batched per topic in `hueOf` colour, drawn after the dots.
  - Outline: after filling a batch of readable dots, stroke the same path in `pal.brand` at `OUTLINE_ALPHA * alphaOf` with a 1 px line, only when the dot's diameter on screen is at least 4 px. Locked dots stay hollow: card colour fill, `pal.brand` stroke at full `alphaOf`.
  - Glow: level 6 batches get `shadowBlur` 8, level 7 batches 14; while not `still`, level 7's blur is `14 + 4 * sin(TAU * time / 4000)` and sets `F.ambient = true`. Draw the glow only when the scene has at most 400 dots at levels 6 and 7 together; above that, skip the blur (performance).
  - Add `sceneNow`-independent caching: the dot cache key gains nothing new, because `fresh` belongs to the scene.
  - Group labels: draw `scene.groupLabels` in the label pass with the canvas `textAlign` from `align`, in `pal.fg`, taking part in the existing overlap skipping, hidden when `labelsOn` is false and when dimmed by a group filter that excludes them.
  - Guides: the three circles from `scene.guides.rings`.
  - The hidden list (`DotList.tsx`) and the hit test in `MapCanvas.tsx` use `dotDiameter(n, scene.dotScale)`; the hit radius is never below 6 px.
- [ ] **Step 8: Contrast.** Export `OUTLINE_ALPHA` from `renderer.ts`. In the theme contrast test add a case: for every theme, mode and reach, `brand` composited at `OUTLINE_ALPHA` over the map card colour has contrast of at least 3 against that card colour. Set `OUTLINE_ALPHA` to the smallest of `0.5, 0.6, 0.7, 0.8, 0.9, 1` that passes everywhere. If 1 fails for some theme, stop and report which themes fail and by how much; do not change theme seeds.
- [ ] **Step 9:** `pnpm typecheck && pnpm lint && pnpm --filter web exec vitest run` pass. Open `http://localhost:3000/dev/map` and `?items=5000` with `pnpm dev:web`, and check by eye: freshest dots innermost and glowing, files outside notes, group names outside the circle, nothing clipped at 100%.

---

### Task 5: Arrangement wiring

**Files:**

- Modify: `web/src/map/graph.ts`, `graph.test.ts`, `Map.tsx`, `Controls.tsx`, `Dock.tsx`, `map.module.css`

**Interfaces:**

- Consumes: `grouping`, `Grouping`, `Arrange`, `ARRANGES`, `GROUP_HEADING` (Task 2); the narrowed `View` and `VIEWS` (Task 3); `ringsLayout`, `buildScene(..., rings)` (Task 4, signature above).
- Produces:
  - `buildModel(payload: MapPayload, groups?: Grouping): MapModel`. Without `groups` it uses `grouping(payload, "folder", 0, 8)`, which reproduces today's topics exactly (seven largest plus "Other", "Other topics" when needed). `topics[i]` is `{ name: groups.names[i], hue: i % 8, count }`.
  - `TopBar` gains `arrange: Arrange`, `onArrange: (a: Arrange) => void`, and shows the "Arrange by" group only when `view === "rings"`.
  - `Dock` gains `heading: string` used for the group list's visible heading and its `aria-label`.

- [ ] **Step 1: Failing model tests** in `graph.test.ts`:
  1. `buildModel(payload)` gives the same `topics` as before this change for the existing fixtures (keep the existing assertions green).
  2. `buildModel(payload, grouping(payload, "time", now))` has one hub per time group, in order, and every item's `topic` is its time group's index.
  3. With 12 groups, hues are `0,1,...,7,0,1,2,3`.
- [ ] **Step 2:** Run, fail. Implement: replace the ranking and folding block in `buildModel` with the `Grouping`; keep everything after it. Run, pass.
- [ ] **Step 3: Map state.** In `Map.tsx`:
  - `const [arrange, setArrange] = useState<Arrange>("folder");`
  - `const groups = useMemo(() => view === "rings" ? grouping(p, arrange, now) : grouping(p, "folder", 0, 8), [sig, view, arrange, dayNow])` where `p` is the parsed payload and `dayNow` is `now` floored to the UTC day (so the Time groups do not rebuild every minute). Keep a per-payload cache `Map<string, MapModel>` keyed by `"rings:" + arrange` and `"other"`, so going back to an arrangement does not rebuild.
  - `model = buildModel(p, groups)`.
  - In Rings compute `ringsLayout(model)` once per model (in the existing layout cache), use its `pos`, and pass it to `buildScene` as the last argument; pass `null` in the other views.
  - `changeArrange`: set the arrangement, clear `topicName`, clear hot, and call `cameraRef.current?.fitView()`. The selection stays (it is kept by key). The canvas already glides across a model change by key, so no canvas change is needed; check it does.
  - The dock gets `heading={view === "rings" ? GROUP_HEADING[arrange] : "Topics"}`.
- [ ] **Step 4: Controls.** In `Controls.tsx` add the group after the view switch, same markup and sliding pill as the view switch:

```tsx
{
  view === "rings" && (
    <div
      ref={arrangeGroup}
      role="group"
      aria-label="Arrange by"
      className={s.switch}
    >
      <span aria-hidden="true" className={pill.pill} style={arrangePill} />
      {ARRANGES.map(([a, name]) => (
        <button
          key={a}
          type="button"
          className={s.tab}
          aria-pressed={arrange === a}
          onClick={() => onArrange(a)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
```

with a visible "Arrange by" caption before it styled like the existing section labels (JetBrains Mono, 11 px, upper case). If the bar no longer fits at 1280 px wide with the detail panel open, let the bar wrap onto a second row; nothing may overflow or overlap.

- [ ] **Step 5: Dock.** Use `heading` for the visible text and the `aria-label` of the group list. The kind filter's "Topics" entry (hubs) becomes "Groups".
- [ ] **Step 6:** `pnpm typecheck && pnpm lint && pnpm --filter web exec vitest run` pass. By eye on `/dev/map`: each arrangement regroups with a glide; the dock heading and entries follow; selecting a dot then switching arrangement keeps it selected; Timeline and Orbit look as before.

---

### Task 6: Browser tests, performance check and docs

**Files:**

- Modify: `web/e2e/map.spec.ts`, `web/e2e/map-perf.spec.ts`, `web/e2e/rail.spec.ts`, `docs/ui-concept.md`, `AGENTS.md`
- Possibly modify: `web/src/map/fixture.ts` (only to give fixture items a spread of ages and a few links, if the tests need it)

**Interfaces:**

- Consumes: everything above. Canvas test hooks that exist today: `data-view`, `data-animating`, `data-ambient`, `data-hot` on the canvas; `button[data-map-dot]` with `data-lit`, `data-x`, `data-y` in the hidden list `ul[aria-label="Items on the map"]`.

- [ ] **Step 1: `map.spec.ts`.**
  - `VIEWS` is `["Rings", "Timeline", "Orbit"]`; "the map opens on the hive" becomes "the map opens on rings" and expects `data-view="rings"`.
  - Delete "the hive names who is at the hive". Add: no element with the accessible name "At the hive" exists.
  - "the six views switch..." becomes "the three views switch in the browser without a request".
  - Tests that clicked "Topics" or "Links" as a view use "Timeline" instead.
  - "a topic dot takes the theme's first topic colour" becomes two tests: a hub takes the theme's first group colour; a note dot is drawn in the brand colour (sample the canvas pixel at a fresh dot's `data-x`, `data-y`, as the existing test does).
  - Dock tests address the group list by its new name ("Folders").
  - New: "Arrange by" is visible in Rings and absent in Timeline and Orbit.
  - New: choosing Time changes the dock's heading to "Months", its first entry to "Last 2 weeks", and moves at least one dot (`data-x` changes once `data-animating` is gone); no request is sent (same technique as the views test).
  - New: with a group filter pinned, choosing Links clears the filter (every dot `data-lit="true"`).
  - New: select a dot by keyboard, choose Time, and the same title is still shown in the detail panel.
  - New: the freshest note in the first sector is nearer the centre than the oldest (compare distances of `data-x`, `data-y` from the stage centre).
- [ ] **Step 2: `map-perf.spec.ts`.** The existing 5,000-item zoom check runs on Rings (it opens there now). Add a second test: on `?items=5000`, click Time and measure frames until `data-animating` clears; the 95th percentile is under 34 ms.
- [ ] **Step 3: `rail.spec.ts`.** Remove the comment and scoping that existed only because of "At the hive", if the plain query is now unambiguous.
- [ ] **Step 4: Docs.** `docs/ui-concept.md` section 3: three views, Rings first, the arrangements, brightness means freshness, hubs keep group hues; remove the Hive, Topics and Links descriptions and the "At the hive" panel; update the motion row in section 2 and the performance section's view count. `AGENTS.md` rule 5: "the map has three views of one graph". Do not edit ADR files.
- [ ] **Step 5:** Run everything: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `pnpm --filter web exec playwright test`. All pass. Make sure no dev server of ours holds the Playwright port first.

---

## Self-review

- Spec 2 (views): Task 3. Spec 3 and 3.1 (arrangements): Tasks 2 and 5. Spec 4 (geometry): Task 4. Spec 5 (colour, outline contrast): Tasks 1 and 4. Spec 6 (kept behaviour): guarded by the existing browser tests kept in Task 6. Spec 7 (budget): Tasks 5 and 6. Spec 8 (accessibility): Tasks 5 and 6. Spec 10 (tests, docs): every task, Task 6.
- Names used across tasks: `freshLevel`, `FRESH_ALPHA`, `FRESH_LEVELS`, `grouping`, `Grouping`, `Arrange`, `ARRANGES`, `GROUP_HEADING`, `ringsLayout`, `RingsLayout`, `buildScene(..., rings)`, `dotDiameter(n, scale)`, `OUTLINE_ALPHA`, `buildModel(payload, groups)`.
