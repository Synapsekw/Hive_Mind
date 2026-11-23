# File Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in member opens `/gallery`, sees the files they may read as a grid, views
images and PDFs full-screen, downloads any file and deletes their own.

**Architecture:** A server-rendered page loads a bounded file index through the member's own
session (row-level security decides) and signs thumbnail links on the server. A client component
holds the tab, filter and selection in state. Opening, downloading and deleting go through server
actions that sign short-lived links or remove the object and its row. No schema change.

**Tech stack:** Next.js App Router (`web/`), `@supabase/ssr` and `supabase-js` (database and
storage), CSS Modules reading the generated theme tokens, Vitest, Playwright.

Spec: [`docs/superpowers/specs/2026-11-22-file-gallery-design.md`](../specs/2026-11-22-file-gallery-design.md).

## Global constraints

- No migration, no change to `supabase/`, `mcp/` or the sharing rules. No permission logic in
  app code: the database decides which rows and objects are readable and deletable.
- No field carries `storage_path` to the browser (a signed link necessarily contains the path;
  corrected during the build). No service-role key; `web/` reads only the two
  `NEXT_PUBLIC_*` values.
- Signed links live **600 seconds**. The bucket is `files` and stays private.
- A file's declared `mime` is never trusted alone: `kind` needs the name's extension **and** the
  declared type to agree; SVG and HTML are `other`.
- Caps: **200** files per load, thumbnails only for images up to **2 MB** (2 × 1024 × 1024
  bytes), the PDF viewer only up to **25 MB**.
- Tokens only: no colour literal (`#hex`, `rgb(`, `hsl(`, `oklch(`) outside `web/src/theme/` and
  `web/src/app/globals.css`; no component names a theme. Every stylesheet that uses
  `backdrop-filter` carries the `@supports not` fallback (`web/src/theme/usage.test.ts` checks).
- Sizes from the look: card radius 20 px, `blur(30px) saturate(1.5)`, controls 8 px radius,
  section labels JetBrains Mono 11 px uppercase 0.12em, easing `var(--ease)`. No pills, no shadows
  on controls, no component library, no Tailwind, no icon library.
- The screen fits one window from 1100 × 560 up; the page never scrolls, the grid does.
- Dates are formatted in UTC from the file's own timestamp (reuse `web/src/vault/format.ts`).
- Server actions are public endpoints: check every argument before any query, return only
  `{ ok }` or the value, log only an error's code and message.
- Load `frontend-design` and read `docs/ui-concept.md` before Task 3. Follow the vault's patterns
  (`web/src/vault/`, `web/src/app/vault/`, `web/src/app/dev/vault/`, `web/e2e/vault.spec.ts`).
- Tests first, seen failing, in every task. Stage by path; conventional commits ending with the
  `Co-Authored-By` line. Subagents in the parallel batch do not commit; the orchestrator commits
  each task's paths.

## File structure

| File                                                 | Responsibility                                              |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `web/src/gallery/types.ts`                           | The contract: data, actions, cursor                         |
| `web/src/gallery/kind.ts`                            | `fileKind`, `kindLabel`, caps                               |
| `web/src/gallery/text.ts`                            | `sizeText`, `sharingText`, `metaLine`                       |
| `web/src/gallery/select.ts`                          | `visibleFiles`, `tabCounts`, `defaultTab`, `viewable`       |
| `web/src/gallery/fixture.ts`                         | Sample data for `/dev/gallery` and tests                    |
| `web/src/shell/Shell.tsx`                            | Adds the Gallery destination                                |
| `web/src/app/gallery/validate.ts`                    | `isUuid` re-export, `cleanCursor`                           |
| `web/src/app/gallery/load-gallery.ts`                | `loadGallery`, `loadPage`, `toFile`                         |
| `web/src/app/gallery/write.ts`                       | `openIn`, `downloadIn`, `deleteIn`                          |
| `web/src/app/gallery/actions.ts`                     | The four server actions                                     |
| `web/src/app/gallery/page.tsx`                       | The real page                                               |
| `web/src/gallery/Gallery.tsx`                        | Top bar, grid, state                                        |
| `web/src/gallery/FileCard.tsx`                       | One card                                                    |
| `web/src/gallery/Viewer.tsx`                         | Full-window viewer                                          |
| `web/src/gallery/Details.tsx`                        | Popover for files the viewer cannot show; shared action row |
| `web/src/gallery/gallery.module.css`                 | The screen's styles                                         |
| `web/src/app/dev/gallery/page.tsx`, `DevGallery.tsx` | The screen over the fixture, stand-in actions               |
| `web/e2e/gallery.spec.ts`                            | Browser tests                                               |

## Contracts shared between tasks

```ts
// web/src/gallery/types.ts
export type Kind = "image" | "pdf" | "slides" | "sheet" | "doc" | "other";
export type Sharing = "private" | "through-note" | "shared-with-me";
export type Tab = "mine" | "shared" | "all";
export type GalleryFile = {
  id: string;
  name: string;
  kind: Kind;
  size: number; // bytes; 0 when unknown
  created_at: string; // ISO
  owner: string; // display name
  mine: boolean;
  note: { id: string; title: string } | null; // only a note the caller may read
  sharing: Sharing;
  thumb: string | null; // signed link, images up to 2 MB only
};
export type Cursor = { created_at: string; id: string };
export type GalleryPage = { files: GalleryFile[]; next: Cursor | null };
export type GalleryData = GalleryPage; // first page
export type Result = { ok: true } | { ok: false };
export type GalleryActions = {
  openFile(id: string): Promise<{ url: string; kind: Kind } | null>;
  downloadFile(id: string): Promise<{ url: string } | null>;
  deleteFile(id: string): Promise<Result>;
  loadMore(cursor: Cursor): Promise<GalleryPage | null>;
};

// web/src/gallery/kind.ts
export const THUMB_MAX = 2 * 1024 * 1024;
export const PDF_VIEW_MAX = 25 * 1024 * 1024;
export function fileKind(name: string, mime: string | null): Kind;
export function kindLabel(kind: Kind, name: string): string; // "PDF", "PNG", "PPTX", "FILE"

// web/src/gallery/text.ts
export function sizeText(bytes: number): string; // "", "512 B", "340 KB", "1.2 MB"
export function sharingText(f: GalleryFile): string;
export function metaLine(f: GalleryFile, now: number): string; // "PDF · 1.2 MB · 3 Nov"

// web/src/gallery/select.ts
export function visibleFiles(
  files: GalleryFile[],
  tab: Tab,
  filter: string,
): GalleryFile[];
export function tabCounts(files: GalleryFile[]): Record<Tab, number>;
export function defaultTab(files: GalleryFile[]): Tab; // "mine" if any is mine, else "all"
export function viewable(f: GalleryFile): boolean; // image, or pdf up to PDF_VIEW_MAX

// web/src/gallery/fixture.ts
export function fixtureGallery(now: number): GalleryData; // 14 files, see Task 1
export function fixtureMore(now: number): GalleryPage; // 4 more, next: null

// web/src/app/gallery/load-gallery.ts
export type GalleryLoad =
  | { state: "ok"; data: GalleryData }
  | { state: "no-hive" }
  | { state: "error" };
export function loadGallery(db: Db): Promise<GalleryLoad>;
export function loadPage(db: Db, cursor: Cursor): Promise<GalleryPage | null>;

// web/src/gallery/Gallery.tsx ("use client")
export function Gallery(p: {
  data: GalleryData;
  now: number;
  actions: GalleryActions;
}): JSX.Element;

// web/src/shell/Shell.tsx
// `current` widens to "map" | "vault" | "gallery"; Notice's `current` widens the same way.
```

`Db` in `web/src/app/gallery/` is `Pick<SupabaseClient, "from" | "auth" | "storage">`.

Supabase storage calls used (supabase-js v2):

```ts
db.storage.from("files").createSignedUrls(paths, 600);
// → { data: { path: string | null; signedUrl: string; error: string | null }[] | null, error }
db.storage.from("files").createSignedUrl(path, 600, { download: name }); // download optional
// → { data: { signedUrl: string } | null, error }
db.storage.from("files").remove([path]);
// → { data: FileObject[] | null, error }
```

## Review focus

1. A row declared `application/pdf` or `image/png` whose content is HTML or SVG is never rendered
   as a page (Tasks 1, 3).
2. No field carries `storage_path`, and links to files the caller cannot read never reach the
   browser; an id the
   caller cannot read answers `null`, the same as an id that does not exist (Task 2).
3. `deleteFile` on a colleague's file shared with the caller is refused before any storage call
   (Task 2).
4. Tabs and filter make no request (Task 3).

---

### Task 1: Contract, pure helpers, fixture, rail entry

**Files:**

- Create: `web/src/gallery/types.ts`, `kind.ts`, `text.ts`, `select.ts`, `fixture.ts`,
  `kind.test.ts`, `text.test.ts`, `select.test.ts`, `fixture.test.ts`, `no-literals.test.ts`
- Modify: `web/src/shell/Shell.tsx`, `web/src/shell/Notice.tsx`, `web/e2e/appearance.spec.ts`
  (only if a rail assertion counts the links)

**Interfaces:** Consumes `longDate` / `shortDate` from `web/src/vault/format.ts` and
`colourLiterals` from `web/src/theme/lint.ts`. Produces everything in "Contracts" except the
loader and `Gallery`.

- [ ] **Step 1: Write the failing tests.**
  - `kind.test.ts`: `fileKind("a.png","image/png")` → `image`; jpg and jpeg with `image/jpeg`;
    gif, webp, avif; upper-case extension (`A.PNG`) → `image`; `("a.pdf","application/pdf")` →
    `pdf`; `("a.pptx", <any>)` → `slides`; xlsx and csv → `sheet`; docx, md, txt → `doc`;
    mismatches → `other`: `("a.png","text/html")`, `("a.html","image/png")`,
    `("a.pdf","text/html")`, `("a.png",null)`, `("a.svg","image/svg+xml")`, `("noext","image/png")`,
    `("a.pdf.html","application/pdf")`. `kindLabel("pdf","x.pdf")` → `"PDF"`;
    `kindLabel("image","x.jpeg")` → `"JPEG"`; `kindLabel("other","x")` → `"FILE"`;
    `kindLabel("other","x.zip")` → `"ZIP"`; a label is at most 5 characters, letters and digits
    only, else `"FILE"`.
  - `text.test.ts`: `sizeText(0)` → `""`; `512` → `"512 B"`; `1024` → `"1 KB"`; `348160` →
    `"340 KB"`; `1258291` → `"1.2 MB"`; negative or `NaN` → `""`. `sharingText` → `"Private"`,
    `"Shared through <title>"`, `"Shared with you by <owner>"`; a `through-note` file whose
    `note` is null → `"Shared through a note"`. `metaLine` joins the non-empty parts with `" · "`
    and uses `shortDate`.
  - `select.test.ts`: `mine` keeps `mine`; `shared` keeps `!mine`; `all` keeps all; the filter
    is a case-insensitive substring of `name`, trimmed, and an empty filter keeps all; order is
    untouched; `tabCounts` ignores the filter; `defaultTab`; `viewable` is true for an image of
    any size, a pdf of exactly `PDF_VIEW_MAX`, false for a pdf one byte over and for `slides`.
  - `fixture.test.ts`: 14 files, unique ids, sorted newest first; at least one of each `kind`;
    at least 3 not mine; at least one `through-note` and one `private`; one pdf larger than
    `PDF_VIEW_MAX`; every `thumb` starts with `data:image/png;base64,` and only images have one;
    `fixtureMore` returns 4 files older than all of the first page and `next: null`;
    `fixtureGallery(now).next` is not null.
  - `no-literals.test.ts`: `colourLiterals("src/gallery")` is empty (copy
    `web/src/vault/no-literals.test.ts`).
- [ ] **Step 2:** `pnpm --filter @hive-mind/web exec vitest run src/gallery`. Expected: fail
      (modules missing).
- [ ] **Step 3: Implement.** `fileKind`: take the text after the last `.` in the name,
      lower-cased; look it up in a table `{ png: ["image", "image/png"], jpg: ["image",
"image/jpeg"], jpeg: ["image", "image/jpeg"], gif: ["image", "image/gif"], webp: ["image",
"image/webp"], avif: ["image", "image/avif"], pdf: ["pdf", "application/pdf"] }` and
      require `mime` (lower-cased, parameters after `;` dropped) to equal the table's type;
      `pptx` → `slides`, `xlsx` / `csv` → `sheet`, `docx` / `md` / `txt` → `doc` regardless of
      `mime`; everything else `other`. Fixture: names like real deliverables (proposal PDFs,
      a pricing sheet, a kickoff deck, site photos), three owners (`Danijel` mine, `Ahmed`,
      `Sara`), dates relative to `now`; thumbnails are one 1 × 1 PNG data link per image.
- [ ] **Step 4: Rail.** Add to `DESTINATIONS` in `Shell.tsx`, after Vault:
      `{ key: "gallery", href: "/gallery", name: "Gallery", icon: <svg aria-hidden="true"
{...ICON}><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="m2.5 11 3.2-3.2
2.6 2.6 2-2 3.2 3.2" /><circle cx="10.6" cy="5.8" r="1" /></svg> }`; widen `current` in
      `Shell` and `Notice` to `"map" | "vault" | "gallery"`; in `Notice` the label and the
      "Try again" link become a lookup: map → "Hive map", `/`; vault → "Vault", `/vault`;
      gallery → "Gallery", `/gallery`. Update the file's opening comment.
- [ ] **Step 5:** `pnpm --filter @hive-mind/web exec vitest run` and
      `pnpm --filter @hive-mind/web typecheck`, then
      `pnpm --filter @hive-mind/web exec playwright test e2e/appearance.spec.ts e2e/map.spec.ts`.
      Expected: pass (fix a rail assertion only if it counted two links).
- [ ] **Step 6:** Commit `feat(web): the gallery's contract, helpers, fixture and rail entry`.

### Task 2: Loading and server actions

**Files:**

- Create: `web/src/app/gallery/validate.ts`, `load-gallery.ts`, `write.ts`, `actions.ts`,
  `validate.test.ts`, `load-gallery.test.ts`, `write.test.ts`

**Interfaces:** Consumes Task 1's types, `fileKind`, `THUMB_MAX`; `isUuid` from
`web/src/app/vault/validate.ts`; `createServerSupabase`. Produces `loadGallery`, `loadPage`,
`GalleryLoad`, and the actions `openFile`, `downloadFile`, `deleteFile`, `loadMore` with the
`GalleryActions` signatures.

Read `web/src/app/vault/load-vault.ts`, `load-vault.test.ts`, `write.ts`, `write.test.ts` and
`actions.ts` first and follow their shape, including the stub client the tests use.

- [ ] **Step 1: Write the failing tests.**
  - `validate.test.ts`: `cleanCursor` accepts `{ created_at: "2026-11-20T10:00:00.000Z", id:
<uuid> }` (any string `Date.parse` accepts and that is at most 40 characters and contains no
    `,`, `(`, `)` or `"`), returns a fresh object with exactly those two keys; rejects `null`,
    a string, a missing key, a non-uuid id, `created_at: "x"`, `created_at` with a comma.
  - `load-gallery.test.ts`, against a stub recording every call:
    - no hive → `{ state: "no-hive" }`; a failed hives, members, files or notes query →
      `{ state: "error" }`; no signed-in user or no member row for the user → `error`.
    - the files query selects exactly
      `id,member_id,workspace_id,note_id,storage_path,name,mime,size_bytes,created_at`, filters
      `hive_id`, orders `created_at` then `id` descending, and limits to 201.
    - 201 rows → 200 files and `next` equal to the 200th file's `(created_at, id)`; 200 rows →
      `next: null`.
    - `mine` is true when the row's `member_id` is the caller's member; `owner` is the member's
      display name, `""` for an unknown member.
    - the notes query asks only for the distinct non-null `note_id`s, selects
      `id,title,member_id,effective:note_visibility`, and is skipped when there are none.
    - sharing: mine + no note → `private`; mine + note with `effective` `private` → `private`;
      mine + note `group` or `members` → `through-note`; mine + a `note_id` the notes query did
      not return → `private` with `note: null`; not mine → `shared-with-me`, `note` set only when
      returned.
    - thumbnails: `createSignedUrls` is called once with the paths of files of `kind` `image`
      and `size_bytes` ≤ `THUMB_MAX`, and 600; not called when there are none; an entry with an
      `error` or a failed call gives `thumb: null` and the load still succeeds; links are matched
      to files by `path`, not by position.
    - no key named `storage_path`, `workspace_id` or `member_id` appears in the returned files
      (assert on `JSON.stringify`).
    - `loadPage(db, cursor)` adds the keyset filter
      `.or("created_at.lt.<c>,and(created_at.eq.<c>,id.lt.<id>)")` and returns `null` on any
      failure.
  - `write.test.ts`:
    - `openIn(db, "nope")` → `null` with no query made; an id with no row → `null`; a row →
      `{ url, kind }` from `createSignedUrl(path, 600)` with no download option; a signing error
      → `null`.
    - `downloadIn` → `createSignedUrl(path, 600, { download: name })`; `{ url }`.
    - `deleteIn`: bad id → `{ ok: false }`, no query; no row → `{ ok: false }`; a row whose
      `member_id` is not one of the caller's members → `{ ok: false }` and **`remove` is never
      called**; own row → `remove([path])` is called **before** the row delete; a `remove` error
      → `{ ok: false }` and the row delete is not called; row delete error → `{ ok: false }`;
      both fine → `{ ok: true }`. The row delete filters by `id` only (the database refuses
      anything else).
- [ ] **Step 2:** `pnpm --filter @hive-mind/web exec vitest run src/app/gallery`. Expected: fail.
- [ ] **Step 3: Implement.** `loadGallery`: wave 1 the first hive; wave 2 in parallel members
      (`id, display_name, user_id`), `db.auth.getUser()`, and the files page; wave 3 in parallel
      notes and thumbnails. Share one internal `page(db, hiveId, me, members, cursor?)` between
      `loadGallery` and `loadPage`; `loadPage` first re-reads the hive, the members and the user
      (it is a separate request). The caller's members for `deleteIn`: `members` rows of the
      first hive whose `user_id` is the signed-in user. `actions.ts` copies the vault's
      `withSession` and wraps `openIn`, `downloadIn`, `deleteIn`, and `loadPage` after
      `cleanCursor`.
- [ ] **Step 4:** Run the task's tests, `typecheck`, and
      `pnpm --filter @hive-mind/web exec vitest run src/secrets.test.ts`. Expected: pass.
- [ ] **Step 5:** Commit `feat(web): the gallery reads files and signs, downloads and deletes them`.

### Task 3: The screen, the development page, browser tests

**Files:**

- Create: `web/src/gallery/Gallery.tsx`, `FileCard.tsx`, `Viewer.tsx`, `Details.tsx`,
  `gallery.module.css`, `web/src/app/dev/gallery/page.tsx`, `DevGallery.tsx`,
  `web/e2e/gallery.spec.ts`

**Interfaces:** Consumes Task 1 (types, helpers, fixture, `Shell` with `current="gallery"`).
Produces `Gallery` with the contract's props, and `/dev/gallery`.

Load `frontend-design`; read `docs/ui-concept.md`, `web/src/vault/Vault.tsx`,
`vault.module.css`, `web/src/app/dev/vault/` and `web/e2e/vault.spec.ts`, and reuse their
grammar (root layout, card, tabs, filter box, popover with `data-scope="reset"`).

- [ ] **Step 1: Development page.** `/dev/gallery` (404 in production, fixed clock
      `Date.UTC(2026, 10, 22, 12)`) renders `DevGallery`, which passes stand-in actions that
      record each call on `window.__galleryCalls` and answer from the fixture: `openFile` → the
      file's `thumb` for an image, and for a pdf a `data:application/pdf;base64,` link of a
      minimal one-page PDF; `downloadFile` → a `data:text/plain,` link; `deleteFile` →
      `{ ok: true }`; `loadMore` → `fixtureMore(now)`. `?fail=1` makes `openFile` and
      `downloadFile` answer `null` and `deleteFile` `{ ok: false }`.
- [ ] **Step 2: Write the failing browser tests** (`gallery.spec.ts`, on `/dev/gallery`, with the
      `setLook` helper; run the layout tests in the default look and
      `aurora.light.vivid.classic`):
  - the rail shows Gallery with `aria-current="page"`; the heading region is labelled "Gallery".
  - the default tab is Mine; the counts match the fixture; choosing Shared with me and All and
    typing in the filter change the cards and make **no request** (count requests after load, as
    `vault.spec.ts` does); a filter with no match shows "No files match."
  - a card shows name, the meta line and the sharing line; a colleague's card shows the owner.
  - an image card opens a dialog named after the file with an `img`; Escape closes it and focus
    is back on the card; the right arrow shows the next viewable file.
  - a PDF card opens the dialog with an `iframe`; the oversized PDF opens the details popover
    instead, with Download and no `iframe`.
  - a deck card opens the details popover: Download is there, no dialog.
  - Download calls `downloadFile` with the file's id.
  - Delete is absent on a colleague's file; on an own file it asks ("Delete this file? This
    cannot be undone."), Cancel changes nothing, confirming calls `deleteFile`, removes the card
    and lowers the count; with `?fail=1` the card stays and "Couldn't delete the file." shows.
  - with `?fail=1`, opening an image shows "Couldn't open the file." and no dialog content.
  - "Open note in vault" has `href="/vault?note=<id>"` and is absent without a note.
  - Load more appends 4 cards and then disappears.
  - at 1366 × 768 and 1100 × 560 the page does not scroll and the grid does.
  - Tab reaches the tabs, the filter, each card and, in the dialog, close, Download and Delete,
    each with a visible outline; focus stays inside the open dialog.
- [ ] **Step 3:** Run the spec. Expected: fail.
- [ ] **Step 4: Build.**
  - `Gallery`: state `files` (from `data.files`), `next`, `tab` (`defaultTab`), `filter`,
    `open` (file id or null), `error`. The grid is a list (`<ul>`) of `FileCard` buttons;
    `visibleFiles` picks them. Deleting removes the file from `files` in place.
  - `FileCard`: a `<button>` with the thumbnail (`<img loading="lazy" alt="">`) or a type tile
    with `kindLabel`; name with `title`; `metaLine`; owner when not mine; `sharingText` with a
    mark (filled, half or hollow dot drawn in CSS, as the vault's marks) so it does not rest on
    colour.
  - `Viewer`: `role="dialog"`, `aria-modal="true"`, `aria-label` the file name; on open it calls
    `openFile(id)`. Image: `<img alt={name}>`. PDF: `fetch(url)`, require the response's
    `content-type` to start with `application/pdf`, make
    `URL.createObjectURL(new Blob([buf], { type: "application/pdf" }))`, show it in an
    `<iframe title={name}>`, and revoke the object URL on close or change; any other type or a
    failed fetch shows the message "This file can't be shown here." with Download. Focus moves
    to the close button, is trapped, and returns to the card on close; Escape closes; arrows
    move among `visibleFiles(...).filter(viewable)`.
  - `Details`: a popover anchored to the card (`data-scope="reset"`), with the file's lines and
    the shared action row (Download, Open note in vault, Delete). The same action row is used in
    the viewer's top bar. Delete is two-step in place: the first press shows the question with
    Delete and Cancel; no browser `confirm()`.
  - Download: call `downloadFile(id)`, then set `window.location.assign(url)`.
  - `gallery.module.css`: tokens only; the card grid
    `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))`; the viewer's backdrop is
    `var(--bg)` at reduced opacity through `color-mix(in srgb, var(--bg) 88%, transparent)`;
    include the `@supports not` fallback block for every glass surface.
- [ ] **Step 5:** Run the spec, the unit tests, `typecheck` and `lint`. Expected: pass.
- [ ] **Step 6:** Screenshot `/dev/gallery` (grid, viewer with an image, details popover) in
      keystone dark and aurora light at 1366 × 768; look at each and fix what looks wrong.
- [ ] **Step 7:** Commit `feat(web): the gallery screen with viewer, download and delete`.

### Task 4: The real page and the docs

**Files:**

- Create: `web/src/app/gallery/page.tsx`
- Modify: `README.md` (the web-app paragraph and the dev-pages line), `docs/ui-concept.md` §4
  (the Gallery line: what is built), `docs/security.md` (one paragraph: files are served through
  10-minute signed links made for the signed-in member; a mislabelled file is not rendered),
  `docs/superpowers/specs/2026-11-16-hive-mind-design.md` (the "Built so far" cell)

**Interfaces:** Consumes `loadGallery`, the four actions, `Gallery`, `Notice`.

- [ ] **Step 1:** Write `page.tsx` after `web/src/app/vault/page.tsx`:
      `export const dynamic = "force-dynamic"`; `no-hive` →
      `<Notice current="gallery">You're not in a hive yet. Ask its owner to invite you.</Notice>`;
      `error` → `<Notice current="gallery" tryAgain>Couldn't load the hive.</Notice>`; else
      `<Gallery data={result.data} now={Date.now()} actions={{ openFile, downloadFile,
deleteFile, loadMore }} />`.
- [ ] **Step 2:** `pnpm build`. Expected: `/gallery` and `/dev/gallery` listed as dynamic.
- [ ] **Step 3:** Update the four docs.
- [ ] **Step 4: Live check, by hand, signed in on the hosted project** (`pnpm dev:web`, needs
      `web/.env.local`): `/gallery` lists the files saved so far; one opens; one downloads. Do
      **not** delete a real file; delete is covered by the unit and browser tests. If the hive
      has no files or nobody is signed in on this machine, say so in the report instead of
      claiming the check.
- [ ] **Step 5:** The four gates and every browser suite. Expected: pass.
- [ ] **Step 6:** Commit `feat(web): the gallery page on real data`.

---

## Execution DAG

| Task                      | Depends on | Touches                                                                                |
| ------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| 1 Contract, helpers, rail | none       | `web/src/gallery/*.ts`, `web/src/shell/Shell.tsx`, `Notice.tsx`                        |
| 2 Loading and actions     | 1          | `web/src/app/gallery/` (no `page.tsx`)                                                 |
| 3 Screen, dev page, e2e   | 1          | `web/src/gallery/*.tsx`, `.css`, `web/src/app/dev/gallery/`, `web/e2e/gallery.spec.ts` |
| 4 Real page and docs      | 2, 3       | `web/src/app/gallery/page.tsx`, docs                                                   |

- **Batch 1:** Task 1. **Batch 2, in parallel:** Tasks 2 and 3 (no shared file; only Task 3 runs
  the browser suite; neither commits, the orchestrator commits each task's paths after review).
  **Batch 3:** Task 4.
- **Critical path:** 1 → 3 → 4.
- After Batch 3: a whole-branch review against "Review focus", one fix wave, then
  `scripts/finish-task.sh`.

## Performance and data-fetching budget

- **First paint:** three waves; four queries (the hive; its members; its files, filtered on the
  indexed `hive_id` and capped at 200; the attached notes by primary key) and one storage call
  signing every thumbnail at once. No file content is read on the server. Thumbnails are lazy and
  at most 2 MB each.
- **Tabs, filter, selecting a card, the details popover, moving in the viewer's list:** 0 server
  requests, client state only (asserted in Task 3).
- **Open / Download:** one server action; the browser then fetches the file from storage.
- **Delete:** one server action, the only write; the list changes in place, no re-read.
- **Load more:** one server action, capped at 200.
- **Unbounded reads:** none. Sorting a hive's files uses no index beyond `hive_id` (spec, "Known
  gaps").

## Out of scope

Upload; PPTX, XLSX and PDF thumbnails or previews beyond the browser's own PDF view; changing
sharing; an audit entry for deletes; any migration; the inbox.
