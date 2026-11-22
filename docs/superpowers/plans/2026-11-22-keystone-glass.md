---
type: plan
status: draft
last-updated: 2026-11-22
tags: [project/hive-mind, plan, ui]
---

# Keystone glass restyle — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web/` looks like the Keystone glass prototype in 17 themes, two modes and three reach
levels, and a person can change the look with no server round-trip.

**Architecture:** a pure TypeScript theme engine turns the seed values into final colours and
renders one committed stylesheet keyed by four attributes on `<html>`; the same engine feeds a
contrast test. The root layout reads a cookie and renders the attributes; an Appearance panel in
the shared rail changes them in the browser. The map, vault and sign-in styles are rewritten onto
the new tokens.

**Tech stack:** Next.js 16 App Router, React 19, CSS Modules, Vitest (file snapshots), Playwright,
`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`.

**Spec:** [`../specs/2026-11-22-keystone-glass-design.md`](../specs/2026-11-22-keystone-glass-design.md).
Read it first, with `docs/ui/map.dc.html` (the reference; formulas at lines 353–381) and
`docs/ui-concept.md` §2. This plan does not repeat their values.

## Global constraints

- A restyle only: no change to routes, data loading, behaviour, the database or `mcp/`. Decision 07
  stands (one dot per note, six views).
- Theme, mode, reach and dot colours are the attributes `data-theme`, `data-mode`, `data-reach`,
  `data-dots` on `<html>`; changing one makes **0 requests** and does not re-run the map's layout.
- No component names a theme. No colour literal (`#hex`, `rgb(`, `hsl(`, `oklch(`) outside
  `web/src/theme/` and `web/src/app/globals.css`.
- Seeds in `themes.json` are never edited; a failing contrast pair is fixed by a lightness
  adjustment of the derived foreground, listed in the committed report.
- Contrast: 4.5:1 text; 3:1 quiet labels, dots, focus rings; every theme × mode × reach.
- Sizes and treatments from the prototype: card radius 20 px, `blur(30px) saturate(1.5)`, controls
  8 px radius (7 px inside the 10 px view-switch track), rail 208 px, side panel 280 px, section
  labels JetBrains Mono 11 px uppercase 0.12em, easing `cubic-bezier(0.16, 1, 0.3, 1)`. No pills,
  no shadows on controls, no component library, no Tailwind, no icon library.
- Every screen still fits one window from 1100 × 560 up; the existing fit tests stay green.
- Cookie `hive-look` = `<theme>.<mode>.<reach>.<dots>`, `Path=/`, one year, `SameSite=Lax`; each
  part is checked against the allowed values and anything else falls back to
  `keystone.dark.tinted.theme`.
- `pnpm build` passes with no environment and no network font fetch. `web/` reads no secrets.
- Load `frontend-design` before Tasks 2–5. `docs/ui/chat.dc.html` is not touched.
- Stage by path; conventional commits ending with the `Co-Authored-By` line. Subagents in a
  parallel batch do not commit; the orchestrator commits each task's paths.

## Contracts shared between tasks

```ts
// web/src/theme/look.ts
export type Mode = "dark" | "light";
export type Reach = "subtle" | "tinted" | "vivid";
export type DotMode = "theme" | "classic";
export type Look = { theme: string; mode: Mode; reach: Reach; dots: DotMode };
export const THEMES: readonly { id: string; label: string }[]; // 17, in themes.json order
export const MODES: readonly Mode[];
export const REACHES: readonly Reach[];
export const DOT_MODES: readonly DotMode[];
export const DEFAULT_LOOK: Look; // keystone, dark, tinted, theme
export const LOOK_COOKIE = "hive-look";
export function parseLook(value: string | undefined): Look; // never throws
export function formatLook(look: Look): string;

// web/src/theme/colour.ts
export type RGB = { r: number; g: number; b: number }; // 0..1, sRGB
export type RGBA = RGB & { a: number };
export function fromHex(hex: string): RGB;
export function toHex(c: RGB): string; // lowercase #rrggbb
export function mix(a: RGB, b: RGB, shareOfB: number): RGB; // as CSS color-mix in srgb
export function over(top: RGBA, under: RGB): RGB; // alpha compositing
export function toOklch(c: RGB): { l: number; c: number; h: number };
export function fromOklch(l: number, c: number, h: number): RGB; // chroma reduced into sRGB
export function contrast(a: RGB, b: RGB): number; // WCAG ratio
export function css(c: RGB | RGBA): string; // "#rrggbb" or "rgba(r, g, b, a)"

// web/src/theme/tokens.ts
export type Tokens = Record<string, string>; // CSS custom property name -> value
export function baseTokens(theme: string, mode: Mode): Tokens; // independent of reach
export function reachTokens(theme: string, mode: Mode, reach: Reach): Tokens;
export function chromeTokens(theme: string, mode: Mode): Tokens; // light-mode chrome scope; {} in dark
export function dotTokens(theme: string, mode: Mode, dots: DotMode): Tokens; // --hue-1..8
export type Surface =
  "card" | "rail" | "panel" | "popover" | "cardSolid" | "panelSolid";
export function backgrounds(
  theme: string,
  mode: Mode,
  reach: Reach,
): Record<Surface, RGB[]>;
export type Adjustment = {
  token: string;
  theme: string;
  mode: Mode;
  reach: Reach | "any";
  from: string;
  to: string;
};
export function adjustments(): Adjustment[];

// web/src/theme/css.ts
export function renderCss(): string; // the whole themes.generated.css
export function renderAdjustments(): string; // the whole adjustments.generated.txt

// web/src/theme/lint.ts
export function colourLiterals(
  dir: string,
): { file: string; line: number; text: string }[];

// web/src/shell/LookProvider.tsx ("use client")
export function LookProvider(p: {
  initial: Look;
  children: React.ReactNode;
}): JSX.Element;
export function useLook(): { look: Look; setLook(patch: Partial<Look>): void };

// web/src/shell/Shell.tsx — moved from web/src/map/Shell.tsx, same props
export function Shell(p: {
  current: "map" | "vault";
  agents?: AgentRow[];
}): JSX.Element;
// web/src/shell/Notice.tsx — moved from web/src/map/Notice.tsx, same props

// web/e2e/look.ts
export async function setLook(
  context: BrowserContext,
  look: string,
): Promise<void>; // sets the cookie
```

Token names are the prototype's: `--brand`, `--brand-2`, `--acc`, `--grad`, `--sel`, `--fg`,
`--fg2`, `--muted`, `--quiet`, `--line`, `--line-hi`, `--fill`, `--fill-on`, `--edge`,
`--edge-card`, `--bg`, `--surface`, `--glass`, `--glass2`, `--glow`, `--lift`, `--on-brand`,
`--wash`, `--bloom`, `--panel-solid`, `--hue-1` … `--hue-8`.

## Review focus

1. A tampered cookie (`<script>`, 10,000 characters, unknown ids, three parts, empty) gives the
   default look and none of it appears in the HTML (Tasks 1, 2).
2. Themes with one accent and themes with almost no chroma (Keystone, Graphite) still give eight
   different dot colours and no `NaN` (Task 1).
3. An OKLCH colour outside sRGB becomes a valid `#rrggbb` (Task 1).
4. In light mode a popover inside the rail or side panel has dark text on a light surface, not
   white on white (Tasks 2, 4).
5. Changing the look with a note selected, a filter typed or a sharing control open keeps that
   state and makes no request (Tasks 2, 3, 4).

---

### Task 1: Theme engine (no UI)

**Files:**

- Create: `web/src/theme/themes.json` (copy of `docs/ui/themes.json`), `look.ts`, `colour.ts`,
  `tokens.ts`, `css.ts`, `lint.ts`, tests `look.test.ts`, `colour.test.ts`, `tokens.test.ts`,
  `contrast.test.ts`, `generated.test.ts`; generated and committed:
  `web/src/theme/themes.generated.css`, `web/src/theme/adjustments.generated.txt`
- Modify: `.prettierignore` (the two generated files), `web/package.json` (script
  `"themes": "vitest run src/theme/generated.test.ts -u"`)

**Interfaces:** Produces everything under `web/src/theme/` in the contracts above.

Rules the signatures do not determine:

- Formulas: prototype lines 357–366 (tokens, reach table `rc`, bloom percentages, light tint 70%
  with white, fixed per-mode values, chrome values at lines 36–37) and 375–381 (dots). Spec §2 and
  "Settled details" restate them.
- `renderCss()` emits, in this order: a header comment saying the file is generated;
  `:root` with the default look's base, reach and dot tokens;
  `[data-theme="<id>"][data-mode="<mode>"]` blocks with `color-scheme` and base tokens;
  `[data-theme][data-mode][data-reach]` blocks; `[data-theme][data-mode][data-dots="theme"]` dot
  blocks; `[data-mode][data-dots="classic"]` blocks; `[data-mode="light"] [data-scope="chrome"]`
  per theme; `[data-scope="reset"]` per mode (restoring the card's text tokens). Deterministic:
  same input, same bytes.
- `backgrounds()`: each surface over each of the three wash stops, plain and with every
  overlapping bloom tint at full strength (spec "Settled details"); `cardSolid` and `panelSolid`
  are single opaque colours.
- Adjustment: when a foreground fails its minimum on any of its backgrounds, step its OKLCH
  lightness by 0.01 away from the backgrounds' average lightness until every background passes (at
  most 100 steps); record one `Adjustment`. Unreachable → `tokens` throws with the pair named.
- `colourLiterals(dir)` scans `.ts`, `.tsx`, `.css` files under `dir` (not `*.test.*`) for
  `#[0-9a-f]{3,8}\b`, `rgb(`, `rgba(`, `hsl(`, `oklch(` outside comments.

- [ ] **Step 1: Write the failing tests.**
  - `look.test.ts`: `parseLook(undefined)`, `""`, `"keystone.dark.tinted.theme"`,
    `"aurora.light.vivid.classic"`, `"nope.dark.tinted.theme"` (theme falls back, the rest kept),
    `"keystone.dark"`, `"<script>.dark.tinted.theme"`, a 10,000-character string;
    `formatLook(parseLook(x)) === x` for every valid combination; `THEMES` has 17 ids equal to
    `themes.json`'s.
  - `colour.test.ts`: `fromHex`/`toHex` round trip; `mix(#000000, #ffffff, 0.5)` → `#808080`;
    `over({white, a: 0.5}, black)` → `#808080`; `contrast(black, white)` = 21 (±0.01) and
    `contrast(x, x)` = 1; `toOklch`/`fromOklch` round trip within 1/255 for the 34 brand seeds;
    `fromOklch(0.82, 0.4, 150)` is inside 0..1 on every channel.
  - `tokens.test.ts`: `web/src/theme/themes.json` deep-equals `docs/ui/themes.json`; Keystone dark
    tinted: `--bg` = `mix(#0e0e10, #8ea2eb, 0.05)`, `--glass` is that colour at alpha 0.56,
    `--sel` is brand at alpha 0.14; Prism uses its `brandMid` in `--grad`, others the midpoint;
    Vivid has a non-empty `--glow` and the others `none`; `chromeTokens(_, "dark")` is `{}` and
    light sets `--fg` to `#ffffff`; `dotTokens` gives 8 distinct values for every theme, mode and
    dot mode, with no `NaN`; Classic equals the two lists in `ui-concept.md` §2 unless an
    `Adjustment` names that token.
  - `contrast.test.ts`: for every theme × mode × reach, the table of spec §3 — each pair's worst
    ratio over `backgrounds()` is at least its minimum, including the solid fallbacks and both dot
    modes; a failure message names theme, mode, reach, token, background and ratio.
  - `generated.test.ts`: `expect(renderCss()).toMatchFileSnapshot("./themes.generated.css")`; the
    same for `renderAdjustments()` and `./adjustments.generated.txt`; gzip of `renderCss()` is
    under 15,000 bytes; two calls return identical strings.
- [ ] **Step 2:** `pnpm --filter @hive-mind/web exec vitest run src/theme`. Expected: fail.
- [ ] **Step 3:** Implement `look.ts`, `colour.ts`, `tokens.ts`, `css.ts`, `lint.ts`.
- [ ] **Step 4:** `pnpm --filter @hive-mind/web themes` to write the two generated files, then the
      command of step 2 and `pnpm --filter @hive-mind/web typecheck`. Expected: pass. Read
      `adjustments.generated.txt` and put its count and the largest lightness change in the report.
- [ ] **Step 5:** Commit `feat(web): theme engine, generated stylesheet and contrast test`.

### Task 2: Root wiring, fonts and the shared shell

**Files:**

- Create: `web/src/shell/Shell.tsx`, `Notice.tsx`, `Appearance.tsx`, `LookProvider.tsx`,
  `shell.module.css`, `notice.module.css`, `web/src/shell/no-literals.test.ts`,
  `web/e2e/look.ts`, `web/e2e/appearance.spec.ts`
- Modify: `web/src/app/layout.tsx`, `web/src/app/globals.css`, `web/package.json` + lockfile (add
  the two font packages, remove `geist`), `web/src/map/Map.tsx`, `web/src/vault/Vault.tsx`,
  `web/src/app/page.tsx`, `web/src/app/vault/page.tsx` and any other importer of the moved files,
  `web/src/map/map.module.css` (delete the rail and notice rules that moved)
- Delete: `web/src/map/Shell.tsx`, `web/src/map/Notice.tsx`

**Interfaces:**

- Consumes: Task 1 (`parseLook`, `formatLook`, `THEMES`, …, `themes.generated.css`).
- Produces: `LookProvider`, `useLook`, the moved `Shell` and `Notice`, `setLook` for browser
  tests, and in `globals.css`: the import of the generated stylesheet, the page background
  (`--bloom`, `--wash`), type, focus ring, the `@supports not (backdrop-filter)` rules for the
  shared classes, `print` and `forced-colors` rules, and **temporary aliases** so the unrestyled
  screens stay usable: `--panel: var(--surface); --text: var(--fg); --text-2: var(--muted);
--text-quiet: var(--quiet); --accent: var(--acc); --fill-1: var(--fill); --fill-2:
var(--fill-on)`. Task 6 deletes them.

Behaviour:

- `layout.tsx` is async: reads `hive-look` with `cookies()`, `parseLook`, renders the four
  attributes on `<html>`, wraps children in `LookProvider`, loads the two fonts with
  `next/font/local` from the packages' variable `woff2` files (weights 400–600 Inter, 400–500
  JetBrains Mono) exposing `--font-sans` and `--font-mono`.
- `setLook(patch)`: merges, sets the four `dataset` values on `document.documentElement`, writes
  `document.cookie` (`formatLook`, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`). No fetch, no
  `router.refresh()`.
- `Shell`: rail directly on the wash with `data-scope="chrome"`; mark and name; nav rows "Map" and
  "Vault" as links with a 24 px icon slot (the prototype's inline drawings), `aria-current`, the
  tint and 3 px gradient bar on the active row; agents list; `Appearance`; sign out.
- `Appearance` (spec §5): closed by default; button with swatch, "Appearance" and the theme's
  label, `aria-expanded`; the popover has `data-scope="reset"` and four radio groups in the spec's
  order with the labels "Dot colours" and "How far the colour reaches"; arrow keys move within a
  group; Escape closes and returns focus to the button.

- [ ] **Step 1: Write the failing tests.**
  - `web/e2e/appearance.spec.ts` on `/dev/map`: with no cookie `<html>` has
    `data-theme="keystone"`, `data-mode="dark"`, `data-reach="tinted"`, `data-dots="theme"`; with
    the cookie `aurora.light.vivid.classic` set before navigation the first HTML response already
    carries those four values; a cookie of `<script>alert(1)</script>` gives the defaults and the
    response body does not contain `alert(1)`; opening the panel and choosing "Aurora" changes
    `data-theme` and the computed `--brand` of `html`, sets the cookie, and **no request is made**
    (listen from before the click); the same for Light, Classic and Vivid; after a reload the
    choice is still applied; Escape closes the panel and focus is on its button; in light mode the
    popover's computed `color` is not white; with a dot selected, changing theme keeps the detail
    panel's title; the computed `font-family` of `body` starts with the Inter family and no request
    goes to `fonts.googleapis.com` or `fonts.gstatic.com`.
  - `web/src/shell/no-literals.test.ts`: `colourLiterals("src/shell")` is empty.
  - Existing `map.spec.ts` and `vault.spec.ts` stay green (run them after the move).
- [ ] **Step 2:** `pnpm --filter @hive-mind/web test:e2e`. Expected: the new spec fails.
- [ ] **Step 3:** Load `frontend-design`; implement.
- [ ] **Step 4:** Both browser suites, web unit tests, `pnpm typecheck`, `pnpm lint`, `pnpm build`
      with no environment. Expected: pass.
- [ ] **Step 5:** Screenshot `/dev/map` at 1600×1000 in the default look and in
      `aurora.light.vivid.classic` with the panel open; look at them (the map itself is still
      old-look through the aliases; the rail and background must be right).
- [ ] **Step 6:** Commit `feat(web): look cookie, fonts and the shared rail with an appearance panel`.

### Task 3: Map restyle

**Files:**

- Modify: `web/src/map/map.module.css`, `Map.tsx`, `Dots.tsx`, `Edges.tsx`, `Controls.tsx`,
  `DetailRail.tsx`, `Orbit.tsx`, `web/e2e/map.spec.ts`
- Create: `web/src/map/no-literals.test.ts`

**Interfaces:** Consumes the tokens and `data-scope`; produces nothing new.

- The card: `background: var(--glow), var(--glass)`, blur, `--edge-card`, `--lift`, radius 20,
  the stage's faint brand glow; the detail aside is `--glass2` with `data-scope="chrome"`.
- Dots, hubs, selected ring, labels, ring labels and edges per the spec's "Settled details"
  (edge and dot colours) and the prototype lines 414–433; `SOFT` and the five literals in
  `Edges.tsx` become tokens.
- View switch, labels button, search, chips, detail panel, buttons: prototype sizes and hover
  rules; no `border-radius: 999px` left except true circles (`50%`).
- Fit rule and media query unchanged in meaning.

- [ ] **Step 1: Write the failing tests:** `no-literals.test.ts` (`colourLiterals("src/map")`
      empty); in `map.spec.ts`: run the four fit tests in the default look and again in
      `aurora.light.vivid.classic` (via `setLook`); the card's computed `backdrop-filter` contains
      `blur(30px)`; no element under `main` has computed `border-radius` of `999px`; a topic dot's
      computed background equals the computed `--hue-1` of `html`, and differs between
      `data-dots="theme"` and `"classic"` for the Aurora theme.
- [ ] **Step 2:** Run unit and browser tests. Expected: the new ones fail.
- [ ] **Step 3:** Load `frontend-design`; restyle.
- [ ] **Step 4:** Unit, both browser suites, typecheck, lint. Expected: pass.
- [ ] **Step 5:** Screenshot `/dev/map` at 1600×1000 and 1366×768 in keystone dark, keystone
      light, graphite dark, aurora light vivid, neon dark vivid classic, in the Map view and one
      other view with a dot selected; compare with `docs/ui/map.dc.html` opened in a browser; fix
      what is off.
- [ ] **Step 6:** Commit `feat(web): the map in Keystone glass`.

### Task 4: Vault restyle

**Files:**

- Modify: `web/src/vault/vault.module.css`, `Vault.tsx`, `Tabs.tsx`, `Folders.tsx`, `NoteList.tsx`,
  `Preview.tsx`, `ShareControl.tsx`, `MarkTag.tsx`, `Markdown.tsx` (classes only),
  `web/e2e/vault.spec.ts`
- Create: `web/src/vault/no-literals.test.ts`

**Interfaces:** Consumes the tokens and `data-scope`.

- One glass card holding tabs, folder column, list and preview; hairlines between columns; the
  sharing control and the release box are reset popovers (`data-scope="reset"`, `--glass` + blur,
  1 px `--line`, radius 14); marks use `--fg2` / `--muted` with their glyph and text; the primary
  "Save" uses `--grad` with `--on-brand`; the sticky list header's background works on glass (no
  opaque `--panel`).
- The rule that un-sticks the list header while a control is open keeps working.

- [ ] **Step 1: Write the failing tests:** `no-literals.test.ts` (`colourLiterals("src/vault")`
      empty); in `vault.spec.ts`: the fit tests and the two "control stays reachable" tests run in
      the default look and in `aurora.light.vivid.classic`; no element under `main` has computed
      `border-radius` of `999px`; with the sharing control open in light mode its computed `color`
      is not white and its background is not transparent.
- [ ] **Step 2:** Run. Expected: the new ones fail.
- [ ] **Step 3:** Load `frontend-design`; restyle.
- [ ] **Step 4:** Unit, both browser suites, typecheck, lint. Expected: pass.
- [ ] **Step 5:** Screenshot `/dev/vault` at 1600×1000 and 1366×768 in the five looks of Task 3:
      a note open, the control open on a note and on a folder, the shared tab, the held list; fix
      what is off.
- [ ] **Step 6:** Commit `feat(web): the vault in Keystone glass`.

### Task 5: Sign-in and notices

**Files:**

- Modify: `web/src/app/login/login.module.css`, `login-form.tsx`, `page.tsx`,
  `web/src/shell/notice.module.css`, `web/src/shell/Notice.tsx`
- Create: `web/src/app/login/no-literals.test.ts`, `web/e2e/login.spec.ts`

**Interfaces:** Consumes the tokens.

- A single glass card (max 360 px, radius 20) centred on the wash; input and buttons 8 px radius
  with hairlines; the primary button `--grad` with `--on-brand`; the mark uses `--grad`.
- The notice keeps its copy and its "Try again" link.

- [ ] **Step 1: Write the failing tests:** `no-literals.test.ts` (`colourLiterals("src/app")`
      returns only entries in `globals.css`); `login.spec.ts`: `/login` renders in the default
      look and in `aurora.light.vivid.classic`, fits 1366×768 without scrolling, the email input
      and the submit button have a computed `border-radius` of `8px`, and Tab reaches the input
      then the button with a visible outline.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Load `frontend-design`; restyle.
- [ ] **Step 4:** Unit, browser suites, typecheck, lint. Expected: pass.
- [ ] **Step 5:** Screenshot `/login` in keystone dark and aurora light; look at them.
- [ ] **Step 6:** Commit `feat(web): sign-in and notices in Keystone glass`.

### Task 6: Remove the old tokens, fallback check, docs

**Files:**

- Modify: `web/src/app/globals.css` (delete the temporary aliases and any old token),
  `docs/ui-concept.md` (§2 corrections listed in the spec, §6 thresholds), `README.md` (one
  paragraph: themes, where the choice is kept, how to regenerate the stylesheet),
  `docs/superpowers/specs/2026-11-16-hive-mind-design.md` (the UI section's look, if it names the
  navy look)
- Create: `web/src/theme/usage.test.ts`

- [ ] **Step 1: Write the failing test** `usage.test.ts`: no file under `web/src` references
      `--panel`, `--text`, `--text-2`, `--text-quiet`, `--accent`, `--fill-1`, `--fill-2`,
      `--soft`, `--raised` or `GeistSans`; every `var(--name)` used under `web/src` (outside
      `theme/`) is defined in `themes.generated.css`, `globals.css` or the same file;
      `globals.css` contains an `@supports not` block for `backdrop-filter` that sets the card to
      `var(--bg)` and the panel to `var(--panel-solid)`.
- [ ] **Step 2:** Run. Expected: fail on the aliases.
- [ ] **Step 3:** Delete the aliases, fix what the test finds, update the docs.
- [ ] **Step 4:** Fallback by hand: in a browser test page, inject a style that sets
      `backdrop-filter: none !important` and the fallback backgrounds, screenshot `/dev/map` and
      `/dev/vault` in keystone dark and aurora light, and confirm text is readable.
- [ ] **Step 5:** A sweep: screenshot `/dev/map` in all 17 themes × 2 modes at Tinted (34 images)
      into the scratch folder, look at every one, and list any that look wrong in the report.
- [ ] **Step 6:** The four gates and all browser suites. Expected: pass.
- [ ] **Step 7:** Commit `chore(web): drop the old tokens and bring the docs in line with the new look`.

---

## Execution DAG

| Task                      | Depends on | Touches                                                            |
| ------------------------- | ---------- | ------------------------------------------------------------------ |
| 1 Theme engine            | —          | `web/src/theme/`, `.prettierignore`, `web/package.json` (script)   |
| 2 Root wiring and shell   | 1          | `web/src/app/layout.tsx`, `globals.css`, `web/src/shell/`, imports |
| 3 Map                     | 2          | `web/src/map/`, `web/e2e/map.spec.ts`                              |
| 4 Vault                   | 2          | `web/src/vault/`, `web/e2e/vault.spec.ts`                          |
| 5 Sign-in and notices     | 2          | `web/src/app/login/`, `web/src/shell/notice*`, `e2e/login.spec.ts` |
| 6 Old tokens, docs, sweep | 3, 4, 5    | `globals.css`, `docs/`, `web/src/theme/usage.test.ts`              |

- **External dependency, met:** the vault merged into `develop` on 2026-11-22 (`193c31f`); this
  branch was cut after it.
- **Batch 1:** Task 1. **Batch 2:** Task 2. **Batch 3, in parallel:** Tasks 3, 4 and 5 (separate
  folders; subagents do not commit; only one may run the browser suite at a time, so each runs its
  own spec file while building and the orchestrator runs the full suites after the batch).
  **Batch 4:** Task 6.
- **Critical path:** 1 → 2 → 3 → 6.

## Performance and data-fetching budget

- **First paint:** no new server read; the layout reads a cookie already on the request. One
  stylesheet with every theme, at most 15 KB gzipped (asserted in Task 1). Two self-hosted variable
  font files, preloaded by `next/font/local`. Every page is rendered per request.
- **Interactions:** opening the Appearance panel and changing theme, mode, reach or dot colours
  make 0 requests (asserted in Task 2) and change only attributes on `<html>`; React state for the
  map and vault is untouched. All earlier budgets (map and vault) are unchanged.
- **Server data:** none read or written by this slice.
- **Rendering cost:** two blurred layers plus one popover; if dots gliding over the card are not
  smooth in the browser, the stage is promoted to its own layer (Task 3).

## Out of scope

The chat screen; storing the look per account; following the system's dark or light setting;
Inbox and Gallery entries in the rail; any behaviour or data change.
