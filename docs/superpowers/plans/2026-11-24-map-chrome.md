# The map's controls in one bar: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the map's controls in one top bar with one filter list, hide the side panel until it is asked for, and move Labels and Legend beside the zoom control.

**Architecture:** A rearrangement of existing React components in `web/src/map/`; no canvas, renderer, data or server change. Existing behaviour (filter rules, previews, chip fitting, popover closing, fold cookie) is moved, not rewritten. Spec: `docs/superpowers/specs/2026-11-24-map-chrome-design.md`.

**Tech stack:** Next.js (app router), React, CSS Modules, Vitest, Playwright.

## Global constraints

- Work only in this worktree (`.claude/worktrees/map-chrome`, branch `task/map-chrome`). Never touch the main checkout or `.claude/worktrees/note-dates`.
- Commit identity `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage by path; never `git add -A`, `git add .` or `git commit -a`.
- No new colour, token or theme name in component CSS; `src/map/no-literals.test.ts` and `src/theme/usage.test.ts` must keep passing.
- Not to be touched: `renderer.ts`, `scene.ts`, `layouts.ts`, `arrange.ts`, `select.ts`, the canvas drawing in `MapCanvas.tsx`, `Peek.tsx`, `DotList.tsx`, the left rail, the themes, every other page, anything under `supabase/` or `mcp/`.
- A filter still means: any within a list, all across lists. Choosing a filter clears the selection. Pointing at or focusing a row previews it.
- Every interaction is client state: 0 new requests.
- Every control is a real `button` or `input` with an accessible name; popovers carry `data-popover=""`; anything drawn over the stage carries `data-map-overlay=""`.
- Exact strings: `Group by`, `Filter`, `Search notes and files`, `Clear all`, `Close details`, `Labels`, `Legend`, `N items` / `1 item`, `M of N shown`, `N most recent items`.
- Browser tests run with `cd web && npx playwright test e2e/<file> --project=chromium` (the config starts its own server on port 3100). Frame checks only with `npx playwright test e2e/map-perf.spec.ts --project=perf --no-deps` and the same for `e2e/hub-map-perf.spec.ts`, each named on its own.
- Stop only processes you started. A dev server on port 3000 belongs to the user.
- Gates before every commit of a task: `pnpm --filter @hive-mind/web typecheck`, `pnpm lint`, `pnpm --filter @hive-mind/web test`, and the browser spec files the task touched.

## File map

| File                                  | Change                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `web/src/shell/fold.ts`               | Panel default becomes shut (Task 1)                                                 |
| `web/src/map/todayName.ts` (new)      | Pure: the Today button's accessible name (Task 1)                                   |
| `web/src/map/TodayButton.tsx` (new)   | The Today button (Task 1)                                                           |
| `web/src/map/DetailRail.tsx`          | Strip removed; fold button becomes "Close details" (Task 1)                         |
| `web/src/map/Legend.tsx` (new)        | The legend list, moved out of `FilterBar.tsx` (Task 2)                              |
| `web/src/map/ZoomControl.tsx`         | Gains Labels and Legend (Task 2)                                                    |
| `web/src/map/MapCanvas.tsx`           | Passes the two new props through to `ZoomControl`; no drawing change (Task 2)       |
| `web/src/map/GroupMenu.tsx` (new)     | The Group by button and menu (Task 3)                                               |
| `web/src/map/countText.ts` (new)      | Pure: the count's text (Task 4)                                                     |
| `web/src/map/FilterBar.tsx`           | Becomes search + Filter + one popover + chips, rendered inside the top bar (Task 4) |
| `web/src/map/Controls.tsx`            | `TopBar` lays out the new bar (Tasks 1 to 4)                                        |
| `web/src/map/Map.tsx`                 | Wiring (Tasks 1 to 4)                                                               |
| `web/src/map/map.module.css`          | Bar, popover columns, corner; old rules deleted (Tasks 1 to 4)                      |
| `web/e2e/map.spec.ts`, `fold.spec.ts` | Rewritten where they name what is gone (each task)                                  |
| `docs/ui-concept.md`                  | Section 3 (Task 5)                                                                  |

## Execution DAG

- Task 1 (panel) → Task 2 (corner) → Task 3 (Group by) → Task 4 (filter and count) → Task 5 (docs and final checks).
- **Parallel batches: none.** Every task edits `Controls.tsx`, `Map.tsx`, `map.module.css` and `e2e/map.spec.ts`; running two at once would only produce merge conflicts in those four files. The pure units (`todayName`, `countText`) are a few minutes each and ride with the task that uses them.
- **Critical path:** all five tasks, in order. Task 4 is the long one.

---

### Task 1: The side panel is hidden until asked for

**Files:**

- Modify: `web/src/shell/fold.ts`, `web/src/shell/fold.test.ts`
- Create: `web/src/map/todayName.ts`, `web/src/map/todayName.test.ts`, `web/src/map/TodayButton.tsx`
- Modify: `web/src/map/DetailRail.tsx`, `web/src/map/Controls.tsx`, `web/src/map/Map.tsx`, `web/src/map/map.module.css`
- Test: `web/e2e/fold.spec.ts`, `web/e2e/map.spec.ts`

**Interfaces:**

- Produces: `DEFAULT_FOLD = { rail: "open", panel: "shut" }`; `parseFold` returns panel `"open"` only for the exact word `open`.
- Produces: `todayName(today: number, needs: number): string`.
- Produces: `<TodayButton today={number} needs={number} open={boolean} controls={string} onToggle={() => void} />`, rendered as the last child of `TopBar`. `TopBar` gains the prop `today: React.ReactNode` (a slot), so later tasks do not change its signature for this.
- Produces: the panel element has `id="hv-details"`.

- [ ] **Step 1: Failing unit tests.** In `fold.test.ts` change the expectations: `DEFAULT_FOLD` equals `{ rail: "open", panel: "shut" }`; `parseFold(undefined)`, `""`, `"nope"` give `{ rail: "open", panel: "shut" }`; `parseFold("shut")` gives `{ rail: "shut", panel: "shut" }`; `"shut.open"` gives panel open; `"shut.nope"` gives panel shut; `formatFold(DEFAULT_FOLD)` is `"open.shut"`. Create `todayName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { todayName } from "./todayName";

describe("todayName", () => {
  it("names the count", () => {
    expect(todayName(82, 0)).toBe("Today, 82 notes written or changed");
  });
  it("uses the singular for one", () => {
    expect(todayName(1, 0)).toBe("Today, 1 note written or changed");
  });
  it("adds what needs the person", () => {
    expect(todayName(82, 5)).toBe(
      "Today, 82 notes written or changed, 5 need you",
    );
    expect(todayName(0, 1)).toBe(
      "Today, 0 notes written or changed, 1 needs you",
    );
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @hive-mind/web test -- fold todayName`. Expected: the changed fold cases and all of `todayName` fail.

- [ ] **Step 3: Implement the pure parts.** In `fold.ts`: `DEFAULT_FOLD = { rail: "open", panel: "shut" }`; in `parseFold` the rail keeps `side(parts[0])` and the panel becomes `parts[1] === "open" ? "open" : "shut"`. Update the file's head comment ("Anything but the exact words reads as the default: rail open, panel shut"). `todayName.ts`:

```ts
/** The Today button's accessible name: today's writes, and what waits for the person. */
export function todayName(today: number, needs: number): string {
  const base = `Today, ${today} ${today === 1 ? "note" : "notes"} written or changed`;
  if (needs <= 0) return base;
  return `${base}, ${needs} ${needs === 1 ? "needs" : "need"} you`;
}
```

- [ ] **Step 4:** Run the two unit files again. Expected: pass.

- [ ] **Step 5: `TodayButton.tsx`.** A `button type="button"` with `aria-label={todayName(today, needs)}`, `aria-expanded={open}`, `aria-controls={controls}`, `aria-pressed` not used. Visible content: a muted word "Today", the number, and when `needs > 0` an `aria-hidden` dot in the accent colour. Class `s.today` in `map.module.css`, styled like the existing `.toggle` (8 px radius, 1 px line, hairline brightens on hover). Hidden under 700 px (same media query the fold uses).

- [ ] **Step 6: `DetailRail.tsx`.** Remove the strip element and the `strip`, `stripNum`, `stripBadge` rules. The fold button keeps its ref and place and becomes: `aria-label="Close details"`, `title="Close details ( ] )"`, an × glyph (reuse the SVG stroke style already there), no `aria-expanded`. Give the panel's root element `id="hv-details"`. When the panel shuts while focus is inside it, move focus to the Today button (`document.querySelector<HTMLElement>("[data-today]")?.focus()`; put `data-today=""` on the button) instead of to the fold button. Keep the existing effect that ends a By person preview on shut.

- [ ] **Step 7: CSS.** Under the fold media query, `html[data-panel="shut"] .details` becomes `display: none` and the root grid drops the panel's column (find the `data-panel="shut"` rules near line 977 and the `.root` grid). Remove the 52 px strip width and the rules that only served it.

- [ ] **Step 8: Wire.** `Controls.tsx`: `TopBar` takes `today: React.ReactNode` and renders it last, inside a right-aligned group. `Map.tsx`: pass `<TodayButton today={act.today} needs={inbox} open={fold.panel === "open"} controls="hv-details" onToggle={togglePanel} />` (`useFold()` already gives `fold` and `togglePanel`). The `]` key handler and `pick`'s `openPanel()` stay as they are.

- [ ] **Step 9: Browser tests.** In `fold.spec.ts`: the panel tests now start from no cookie with `data-panel="shut"` and the panel not visible; replace the strip test with: Today opens it, "Close details" shuts it, `]` toggles it, a cookie `open.open` starts open, selecting a dot opens it, shutting it keeps the selected dot selected (the dot's button keeps `aria-pressed="true"`), shutting with focus inside moves focus to the Today button. Remove the 52 px width assertion for the panel (the rail's 60 px one stays). In `map.spec.ts`: tests that read the side panel ("the side panel shows today…", the selected-dot tests) work because selecting opens it; the Today test must press Today first. Tests that pinned widths with "both sides open" must set the cookie `open.open` through the file's existing cookie helper.

- [ ] **Step 10:** Run the gates and `npx playwright test e2e/fold.spec.ts e2e/map.spec.ts --project=chromium`. Expected: all pass.

- [ ] **Step 11: Commit.** `git add` the files above by path; message `feat(map): the side panel is hidden until asked for, with a Today button`.

---

### Task 2: Labels and Legend beside the zoom control

**Files:**

- Create: `web/src/map/Legend.tsx`
- Modify: `web/src/map/ZoomControl.tsx`, `web/src/map/MapCanvas.tsx`, `web/src/map/FilterBar.tsx`, `web/src/map/Controls.tsx`, `web/src/map/Map.tsx`, `web/src/map/map.module.css`
- Test: `web/e2e/map.spec.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `<Legend rings={boolean} hubs={"Topic hub" | "Group hub"} />` rendering the existing `<ul className={s.legendList}>` and its `Mark`s (move `Mark` with it and export it; `FilterBar.tsx` imports it back for its rows).
- Produces: `ZoomControl` props gain `names: boolean`, `onNames: () => void`, `legend: React.ReactNode`. `MapCanvas` gains the same three props and passes them through. `TopBar` loses `names` and `onNames`.

- [ ] **Step 1: Failing browser tests.** In `map.spec.ts` rewrite "the Legend lists the shapes, and brightness only in Rings" to open it with `page.getByRole("button", { name: "Legend" })` inside `page.getByRole("group", { name: "Zoom" })`, and add: the Labels button is inside the Zoom group, has `aria-pressed="true"` at first, and pressing it sets `aria-pressed="false"`; Escape closes the legend and returns focus to its button; a press outside closes it; the legend popover's bottom edge is above the Zoom group's top edge (it opens upward). Run them: expected fail (no such buttons in the group).

- [ ] **Step 2: `Legend.tsx`.** Move the legend list and `Mark` out of `FilterBar.tsx` unchanged.

- [ ] **Step 3: `ZoomControl.tsx`.** After Fit add an `aria-hidden` divider, then a button "Aa" (`aria-label="Labels"`, `aria-pressed={names}`, `onClick={onNames}`), then a button "?" (`aria-label="Legend"`, `aria-expanded`, `aria-controls`) that toggles a popover (`role="group"`, `aria-label="Legend"`, `data-popover=""`) positioned `bottom: calc(100% + 8px); right: 0`. Closing rules as in `FilterBar.tsx` lines 143 to 172 (press outside, Escape captured first, focus back to the button); copy that effect, scoped to this one popover.

- [ ] **Step 4:** Remove the Legend slot and its popover from `FilterBar.tsx` (and `"legend"` from its `Which` type) and the Labels button from `TopBar`. Thread `names`, `onNames`, `legend` from `Map.tsx` through `MapCanvas` to `ZoomControl`; `legend` is `<Legend rings={view === "rings"} hubs={view === "rings" ? "Group hub" : "Topic hub"} />`.

- [ ] **Step 5:** Run the gates and `npx playwright test e2e/map.spec.ts --project=chromium`. Fix any other test that pressed the old Labels or Legend buttons. Expected: pass.

- [ ] **Step 6: Commit.** Message `feat(map): Labels and Legend sit beside the zoom control`.

---

### Task 3: Group by is a menu

**Files:**

- Create: `web/src/map/GroupMenu.tsx`
- Modify: `web/src/map/Controls.tsx`, `web/src/map/map.module.css`
- Test: `web/e2e/map.spec.ts`

**Interfaces:**

- Consumes: `ARRANGES: [Arrange, string][]` and `type Arrange` from `./arrange` (unchanged).
- Produces: `<GroupMenu arrange={Arrange} onArrange={(a: Arrange) => void} />`. `TopBar` keeps its `arrange` and `onArrange` props; `Map.tsx` does not change in this task.

- [ ] **Step 1: Failing browser tests.** Rewrite the six tests that use the "Arrange by" group (lines 640 to 820 of `map.spec.ts`: visible in Rings only, Time regroups with no request, Links clears a pinned group, selection kept, the pill test, the 1280 px bar test) to the new control: a button named `Group by Folder` (accessible name is the visible text "Group by" plus the current choice); pressing it shows three `menuitemradio` rows Folder, Links, Time with `aria-checked` on the current one; choosing Time closes the menu, the button reads `Group by Time`, focus is on the button, the dots have moved and no request was sent; the button is absent in Timeline and Orbit and present again in Rings; Escape and a press outside close the menu with focus back on the button; arrow keys move between rows. Drop the "pill under the pressed button" test for this control (it has no pill); keep the view switch's pill assertions. Run: expected fail.

- [ ] **Step 2: `GroupMenu.tsx`.** A wrapper `div` (position relative) holding the button (`aria-haspopup="menu"`, `aria-expanded`) with a muted "Group by" and the current name plus a chevron, and when open a `div role="menu" aria-label="Group by" data-popover=""` under it with three `button role="menuitemradio" aria-checked` rows; the checked row shows a tick. Opening moves focus to the checked row. ArrowUp, ArrowDown, Home and End move focus; Enter or Space or a click chooses and closes; Escape (captured, so the map's Escape does not also clear the selection), a press outside, and focus leaving close it. Choosing the current entry just closes.

- [ ] **Step 3:** In `TopBar` replace the `view === "rings"` block (label, group, pill) with `{view === "rings" && <GroupMenu arrange={arrange} onArrange={onArrange} />}` and delete `arrangeGroup`, `arrangePill`, and the `.arrange` and `.arrangeLabel` rules.

- [ ] **Step 4:** Run the gates and `npx playwright test e2e/map.spec.ts --project=chromium`. Expected: pass.

- [ ] **Step 5: Commit.** Message `feat(map): Group by is a menu in the top bar`.

---

### Task 4: Search, one filter list, chips and one count in the bar

**Files:**

- Create: `web/src/map/countText.ts`, `web/src/map/countText.test.ts`
- Modify: `web/src/map/FilterBar.tsx`, `web/src/map/Controls.tsx`, `web/src/map/Map.tsx`, `web/src/map/map.module.css`
- Test: `web/e2e/map.spec.ts`, `web/e2e/fold.spec.ts` (where it reads the old bar)

**Interfaces:**

- Consumes: `today` slot of `TopBar` (Task 1), `GroupMenu` (Task 3), `Mark` from `Legend.tsx` (Task 2), `chipFit` (unchanged).
- Produces: `countText(c: { shown: number; total: number; active: boolean; truncated: boolean }): string`.
- Produces: `FilterBar` keeps its current props and gains `onQ(q: string): void` and `truncated: boolean`; it loses nothing. It now renders, in order, three siblings for the bar: the search field with the Filter button and its popover, the chips row, and the count with Clear all. `TopBar` takes it as a slot: `filter: React.ReactNode`, placed between Group by and `today`. `TopBar` loses `stats`, `q` and `onQ`.

- [ ] **Step 1: Failing unit test.** `countText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countText } from "./countText";

const base = { shown: 301, total: 301, active: false, truncated: false };

describe("countText", () => {
  it("counts the items when nothing is filtered", () => {
    expect(countText(base)).toBe("301 items");
    expect(countText({ ...base, shown: 1, total: 1 })).toBe("1 item");
  });
  it("says how many of them show when filtered", () => {
    expect(countText({ ...base, shown: 96, active: true })).toBe(
      "96 of 301 shown",
    );
    expect(countText({ ...base, shown: 0, active: true })).toBe(
      "0 of 301 shown",
    );
  });
  it("says so when the map was cut to its newest items", () => {
    expect(
      countText({ shown: 5000, total: 5000, active: false, truncated: true }),
    ).toBe("5,000 most recent items");
    expect(
      countText({ shown: 96, total: 5000, active: true, truncated: true }),
    ).toBe("96 of 5,000 shown");
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @hive-mind/web test -- countText`. Expected: fail, module not found.

- [ ] **Step 3: `countText.ts`.**

```ts
const n = (v: number) => v.toLocaleString("en-US");

/** The one count in the map's bar. */
export function countText(c: {
  shown: number;
  total: number;
  active: boolean;
  truncated: boolean;
}): string {
  if (c.active) return `${n(c.shown)} of ${n(c.total)} shown`;
  if (c.truncated) return `${n(c.total)} most recent items`;
  return `${n(c.total)} ${c.total === 1 ? "item" : "items"}`;
}
```

Run the test again. Expected: pass.

- [ ] **Step 4: Failing browser tests.** Rewrite the filter tests of `map.spec.ts` (lines 921 to 1290) against the new shape, keeping every behaviour they assert:
  - one button `Filter` opens one popover (`role="group"`, name "Filter") holding three groups named by `aria-label`: the heading ("Folders", "Clusters", "Months", "Topics"), "Kind", "People"; rows are `role="checkbox"` as before;
  - "only one list is open at a time" becomes: opening Filter while the Group by menu is open closes the menu, and the reverse;
  - the popover's top edge is below the search field's bottom edge, and its right edge does not pass the card's right edge;
  - with choices made the Filter button's accessible name is `Filter, 2 chosen`;
  - chips, their remove buttons, "+N", Clear all, the search chip: same assertions, now located inside the top bar (`page.getByRole("main", { name: "Hive map" })` then the bar);
  - the count: `301 items` at rest (use the fixture's real number, read from the page once), `M of N shown` after a choice, and again `N items` after Clear all; no text matching `/links?$/` in the bar;
  - previews on hover and focus, Escape, press outside, tab out, "choosing a filter clears the selection", "a group the next view does not have is dropped": unchanged in meaning;
  - replace the two width tests with: at 1600 px with the panel open two folders give two chips and no "+N"; at 1280 px with the panel open eight choices give a "+N" chip and no element of the bar overlaps another (compare bounding boxes of view switch, Group by, search, chips row, count, Today); at 1000 px the bar is two rows (search's top is below the view switch's bottom) and nothing overlaps;
  - nothing with the old bar's class is on the stage: `[data-map-stage] [data-filter-bar]` has count 0 (put `data-filter-bar=""` on the new search wrapper so the old selector, if any test used it, is updated deliberately).

  Run: expected fail.

- [ ] **Step 5: Rework `FilterBar.tsx`.** Keep, moved but not rewritten: the `lists` computation and counts, `toggled`, the preview calls on pointer and focus, the outside-press and Escape effect, `onBlur`, `onListKey`, the chips array, the hidden measuring copy, the `chipFit` effect, the pending-focus effect. Change:
  - `Which` is gone; `open` is a boolean and there is one button ref (`Filter`).
  - The component returns a fragment of three elements, all inside one wrapper with `ref={root}` and `display: contents` is **not** used (the outside-press test needs a real box): make the wrapper the flex child that grows (`.filterGroup`), containing (1) `.searchBox` with the search icon, the `input#hv-search` (`type="search"`, placeholder `Search notes and files`, `value={q}`, `onChange` calls `onQ`), the Filter button and the popover; (2) the chips row; (3) the count `span role="status"` with `countText(...)` and Clear all.
  - The popover (`role="group"`, `aria-label="Filter"`, `data-popover=""`, class `.filterPop`) is positioned `top: calc(100% + 8px); right: 0` relative to `.searchBox`, with three columns (`.filterCols`, a grid of `minmax(180px, 1.4fr) minmax(120px, 1fr) minmax(120px, 1fr)`), each a `div role="group" aria-label={label}` with its head ("All" shortcut kept) and its rows; each column `overflow-y: auto` with the popover capped at `60%` of the stage height (read the stage's height once on open and set `max-height` inline; fall back to `60vh`). When the wrapper is narrower than 520 px the grid becomes one column and the popover scrolls as a whole. Arrow keys move within a column; Tab moves on to the next column.
  - `roomAtCap` in the chip-fit effect becomes: the wrapper's width less the search box's, the count's and Clear all's widths and the gaps. Observe the wrapper, the count and the search box with the `ResizeObserver`. Delete the `--filter-gutter` and `offsetParent` logic.
  - Search keeps a minimum width of 220 px and a preferred width of 320 px.
- [ ] **Step 6: `TopBar` and `Map.tsx`.** `TopBar` becomes: view switch, Group by, `{filter}`, `{today}`; `flex-wrap: wrap` with a row gap; the filter group has `flex: 1 1 520px` and `order` such that under about 1100 px of card width it wraps to the second row while Today stays on the first (give Today `margin-left: auto` and the filter group `order: 3; flex-basis: 100%` inside a container query or the existing width media query; use whichever the file already uses for the bar). In `Map.tsx` delete the `stats` string, move the `<FilterBar … />` element from the stage into `TopBar`'s `filter` prop with the added `onQ={filter(setQ)}` and `truncated={model.truncated}`, and compute `active` inside `FilterBar` as now. When the model has one node or none, `FilterBar` still renders the search field and the count, and hides Filter and the chips (it used to return null).
- [ ] **Step 7: CSS.** Delete `.stats`, `.tools`, `.search` (old), `.filterBar`, `.filterSlot`, `.filterRule`, `.filterButton` rules that only the bottom bar used, the `--filter-gutter` variable and the print and narrow rules that name them. Add `.filterGroup`, `.searchBox`, `.filterCols`. Reuse existing tokens only.
- [ ] **Step 8:** Run the gates and `npx playwright test e2e/map.spec.ts e2e/fold.spec.ts --project=chromium`. Expected: pass. Then the two frame checks, each on its own command. Expected: pass, 95th percentile under 34 ms.
- [ ] **Step 9: Commit.** Message `feat(map): search, one filter list, chips and one count in the top bar`.

---

### Task 5: The design document and the last checks

**Files:**

- Modify: `docs/ui-concept.md`

**Interfaces:**

- Consumes: the finished behaviour of Tasks 1 to 4.

- [ ] **Step 1:** In `docs/ui-concept.md` section 3 rewrite: the "Arrange by" bullet (now "Group by", a menu in the top bar; same three choices and effects); the "Filter bar" bullet (search with Filter inside it in the top bar, one list with three columns opening downward, chips, one count with its three texts, Clear all; Legend and Labels are beside the zoom control); the "Layout" paragraph (the side panel is hidden until Today, a selected dot or `]` asks for it); the "Folding" paragraph (the panel no longer folds to a strip; default shut; cookie values unchanged; "Close details"). Section 6's list needs no change.
- [ ] **Step 2:** Run every gate from the repository root: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `cd web && npx playwright test --project=chromium`, then the two frame checks. Expected: all pass. Report exact counts.
- [ ] **Step 3:** Take screenshots of `/dev/map` at 1500 × 900 and 1000 × 720 in Honey and Paper with the filter open and two chips chosen, and of Timeline, into the scratch directory given by the controller; list the paths in the report.
- [ ] **Step 4: Commit.** Message `docs(ui): the map's controls in one bar`.
