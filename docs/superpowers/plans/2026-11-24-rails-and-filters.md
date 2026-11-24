# Folding Rails and Filter Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map's legend dock becomes a filter bar with several choices at once, the left rail folds to icons on every page, and the map's right panel folds to a strip.

**Architecture:** The filter becomes three lists (any within a list, all across lists). A `FilterBar` component replaces `Dock`. The fold state lives in a cookie read on the server and in a small React context, and is applied as `data-rail` and `data-panel` on `<html>` so CSS does the folding with no flash on reload.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS modules, vitest, Playwright. No server or database change.

**Spec:** `docs/superpowers/specs/2026-11-24-rails-and-filters-design.md`
**Mock the user approved:** screenshots described in the spec; behaviour is in the spec.

## Global Constraints

- No change under `supabase/` or `mcp/`. No new network call. Folding and filtering are client state only.
- The canvas (`MapCanvas.tsx`, `renderer.ts`, `scene.ts`, `layouts.ts`) is not edited, except `Preview`/`previewTag` in `MapCanvas.tsx` if the type must follow the new filter.
- Filter rule: an empty list means all; any within a list; all across lists and the search.
- Cookie name `hive-fold`, value `<rail>.<panel>`, each part `open` or `shut`; anything else reads as `open`. Default `open.open`. One year, `SameSite=Lax`, path `/`.
- Folded left rail is 60 px wide; folded right panel is 52 px wide.
- Keys: `[` left rail on every page, `]` right panel on the map; ignored while typing, inside `[data-popover]`, `[role="dialog"]`, `[role="radiogroup"]`, or with a modifier.
- Reduced motion: no fold animation.
- Text shown to people is sentence case, plain words, no em dashes. Exact strings: "Fold navigation", "Unfold navigation", "Fold details", "Unfold details", "Clear all", "Legend", "All N shown", "M of N shown", "Remove <name>", "Agents", "<n> of <m> live", "Brighter means changed more recently", "Not shared with you".
- Colours come from theme tokens only (the repo's `no-literals` and `usage` tests enforce it). Every interactive control has a visible keyboard focus.
- Implementers do not commit. The controller commits each task by path with a lower-case conventional subject.
- Gates per task: `pnpm --filter web exec tsc --noEmit -p .`, `pnpm lint`, `pnpm --filter web exec vitest run`. Final: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and `pnpm --filter web exec playwright test`.

## Performance and data-fetching budget

- First paint: unchanged (one `map_graph` call). The fold cookie is read beside the look cookie in `app/layout.tsx`.
- Fold, filter, preview, clear: 0 round-trips, no server write.
- A filter change or a preview runs `lit()` once over the nodes; it never rebuilds the model, layout or scene.
- The 5,000-item browser checks must still pass.

## Execution DAG

- Task 1 (filter model): none.
- Task 2 (fold state and left rail): none.
- Task 3 (filter bar and map wiring): Task 1.
- Task 4 (right panel): Tasks 2 and 3.
- Task 5 (browser tests and docs): Tasks 3 and 4.

Batches: **A** Tasks 1 and 2 together (no shared files). **B** Task 3. **C** Task 4. **D** Task 5.
Critical path: 1, 3, 4, 5.

---

### Task 1: Filter model

**Files:** modify `web/src/map/types.ts`, `web/src/map/select.ts`, `web/src/map/select.test.ts`. Callers in `Map.tsx` are updated only as far as needed to compile (pass one-element or empty lists); Task 3 rewrites them.

**Interfaces — Produces:**

```ts
// types.ts
export type Filter = {
  topics: number[]; // group indices; empty = all
  kinds: NodeKind[]; // empty = all
  members: string[]; // member ids; empty = all
  q: string;
  sel: number | null;
  /** Whether the search also matches group names (default true). */
  groupNames?: boolean;
};
// select.ts
export function lit(model: MapModel, f: Filter): boolean[];
/** How many notes and files are lit. */
export function shown(
  model: MapModel,
  on: boolean[],
): { shown: number; total: number };
```

- [ ] **Step 1: failing tests** in `select.test.ts` (keep the existing cases, converted to lists):
  1. All lists empty, no search, no selection: everything is lit.
  2. `topics: [0, 2]` lights nodes of groups 0 and 2 only (plus the index).
  3. `topics: [0]` with `members: ["m2"]` lights only group 0 nodes owned by `m2`.
  4. `kinds: ["note", "file"]` lights notes and files and not hubs or agents.
  5. Search still narrows what the lists allow; `groupNames: false` still works.
  6. A selection still narrows to the selected node and its neighbours.
  7. `shown()` counts only notes and files, lit and total.
- [ ] **Step 2:** run, see them fail: `pnpm --filter web exec vitest run src/map/select.test.ts`.
- [ ] **Step 3:** implement. In `lit`, build `Set`s once outside the node loop.
- [ ] **Step 4:** make `Map.tsx` and `MapCanvas.tsx` compile with the new type, changing behaviour as little as possible (a single chosen value becomes a one-element list). Run the gates.

---

### Task 2: Fold state and the left rail

**Files:** create `web/src/shell/fold.ts`, `fold.test.ts`, `FoldProvider.tsx`; modify `web/src/app/layout.tsx`, `web/src/shell/Shell.tsx`, `AgentsCard.tsx`, `AccountMenu.tsx`, `HiveSwitcher.tsx`, `shell.module.css`, and the pages' own layout CSS only where the rail's width is assumed.

**Interfaces — Produces:**

```ts
// fold.ts (pure)
export const FOLD_COOKIE = "hive-fold";
export type Fold = { rail: "open" | "shut"; panel: "open" | "shut" };
export const DEFAULT_FOLD: Fold;
export function parseFold(value: string | undefined): Fold;
export function formatFold(f: Fold): string; // "open.shut"
// FoldProvider.tsx ("use client")
export function FoldProvider(props: {
  initial: Fold;
  children: React.ReactNode;
}): JSX.Element;
export function useFold(): {
  fold: Fold;
  toggleRail(): void;
  togglePanel(): void;
  openPanel(): void; // no-op when already open
  openRail(): void;
};
```

`FoldProvider` keeps the state, writes the cookie, mirrors it onto `document.documentElement` as `data-rail` and `data-panel`, and owns the `[` key (the `]` key is Task 4's, via `togglePanel`). `app/layout.tsx` reads the cookie, renders `<html data-rail=… data-panel=…>` and wraps the app in `FoldProvider`.

- [ ] **Step 1: failing tests** for `parseFold` and `formatFold`: undefined, empty, garbage, one part, `shut.open`, `open.shut`, `shut.shut`, a third part ignored; `formatFold(parseFold(x))` is stable.
- [ ] **Step 2:** implement `fold.ts`; tests pass.
- [ ] **Step 3:** `FoldProvider` and the layout change. Follow how the look cookie is read and written (`LookProvider.tsx`, `look.ts`).
- [ ] **Step 4:** the rail. Add the fold button (a real button, `aria-expanded`, named "Fold navigation" or "Unfold navigation"). Fold with CSS keyed on `html[data-rail="shut"]`: the rail becomes 60 px; labels are hidden visually but stay as accessible names; each destination gets a `title` with its name; the inbox count becomes a small badge on the icon; the current row keeps its tint and bar (the bar's measured offset must still be right after folding); the hive switcher shows the mark alone and pressing it calls `openRail()` then opens the switcher; the agents card shows its status dots alone and pressing it calls `openRail()` then opens the list; the account menu shows the avatar alone and still opens its popover, placed so it stays on screen.
- [ ] **Step 5:** the agents button unfolded reads "Agents" with "<n> of <m> live" beneath and never cuts its text; keep its accessible name and the existing tests' meaning (update test strings where the words changed).
- [ ] **Step 6:** every page that renders `Shell` (map, vault, gallery, inbox, settings and their `/dev/*` pages) lays out correctly folded and unfolded at 1600 and 1280 px wide; check each by eye with screenshots. Reduced motion: no width transition.
- [ ] **Step 7:** gates. Existing rail unit tests and `web/e2e/rail.spec.ts` must still pass or be updated only where a string from this task changed.

---

### Task 3: Filter bar and the map's wiring

**Files:** create `web/src/map/FilterBar.tsx`; delete `web/src/map/Dock.tsx`; modify `web/src/map/Map.tsx`, `map.module.css`, `MapCanvas.tsx` (only `Preview`/`previewTag` if needed).

**Interfaces — Consumes:** `Filter`, `lit`, `shown` (Task 1). **Produces:**

```tsx
export function FilterBar(props: {
  model: MapModel;
  heading: string; // Folders | Clusters | Months | Topics
  rings: boolean; // legend mentions brightness only in Rings
  topics: number[];
  onTopics(next: number[]): void;
  kinds: NodeKind[];
  onKinds(next: NodeKind[]): void;
  members: string[];
  onMembers(next: string[]): void;
  q: string;
  onClearSearch(): void;
  counts: { shown: number; total: number };
  onClearAll(): void;
  onPreview(p: Preview | null): void;
}): JSX.Element | null;
```

In `Map.tsx`: state becomes `topicNames: string[]`, `kinds: NodeKind[]`, `memberIds: string[]`; names and ids the model no longer has are dropped; changing the arrangement clears `topicNames`. A preview computes `lit()` with the previewed list replaced by the one row and the other lists and the search kept. `stats` in the top bar is unchanged.

- [ ] **Step 1:** build `FilterBar` to spec section 2.2: three list buttons with chosen counts, one list open at a time above the bar (`role="group"` with a label, rows `role="checkbox"`), preview on pointer and on focus, chips with "+N" overflow, the count in a polite live region, "Clear all", "Legend". Swatches reuse the dock's colour rule (`--rings-hub` fallback in Rings). Escape and outside press close and return focus. Mark the open list `data-popover` so the map's key handler leaves its keys alone.
- [ ] **Step 2:** wire it in `Map.tsx`, remove `Dock`, keep the `data-map-overlay` marker the canvas uses to ignore pointer events over overlays.
- [ ] **Step 3:** CSS in `map.module.css` from tokens only; the bar and the zoom control never overlap at 1280 px (the bar may shrink its chips first).
- [ ] **Step 4:** gates; by eye on `/dev/map` in Rings and Timeline, dark and light.

---

### Task 4: Right panel

**Files:** modify `web/src/map/DetailRail.tsx`, `map.module.css`, `Map.tsx`.

**Interfaces — Consumes:** `useFold` (Task 2); `memberIds`/`onMembers` state (Task 3).

- [ ] **Step 1:** a fold button at the top of the panel ("Fold details" / "Unfold details", `aria-expanded`), CSS keyed on `html[data-panel="shut"]` making it a 52 px strip with today's count and, when anything waits, the needs-you count; pressing the strip unfolds. The `]` key toggles it (in the map's existing key handler). Selecting a dot calls `openPanel()`.
- [ ] **Step 2:** "By person" rows become buttons with `aria-pressed`; pressing toggles that member in the People filter; pointing or focusing previews as today.
- [ ] **Step 3:** the map's layout holds at 1280 px with any combination of folds; the canvas refits when a fold changes the stage size (it already observes its size; check).
- [ ] **Step 4:** gates; by eye in all four fold combinations.

---

### Task 5: Browser tests and docs

**Files:** modify `web/e2e/map.spec.ts`, `web/e2e/rail.spec.ts`, `web/e2e/map-perf.spec.ts` only if a selector changed; `docs/ui-concept.md`.

- [ ] **Step 1:** replace the dock tests with filter bar tests covering every item in spec section 9.
- [ ] **Step 2:** fold tests on `/dev/map` and `/dev/vault`: by button, by key, a reload keeps it (check `html[data-rail]` in the server HTML, before hydration, with `page.request.get` and the cookie set), accessible names of folded controls, selecting a dot unfolds the panel, 1280 px with no overlap.
- [ ] **Step 3:** `docs/ui-concept.md`: the filter bar replaces the legend dock; folding; the keys.
- [ ] **Step 4:** the whole gate, and the whole browser suite. Leave no dev server running.
