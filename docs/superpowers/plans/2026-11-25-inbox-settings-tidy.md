# Inbox and Settings, tidied — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build round 3 of the interface rework. The Inbox becomes a list with a detail pane. Settings becomes tabs in the top bar, with dialogs and ⋯ menus for rare and destructive actions.

**Architecture:**

- **Inbox.** It stays one client component tree in `web/src/inbox/`. `Inbox.tsx` keeps today's answer logic (`act`, the decline question, leaving rows, refresh) and adds a selection. Rendering moves into `InboxList.tsx` and `InboxDetail.tsx`. One new server action, `noteOpening`, reads one note's `body` by primary key and returns at most 280 characters.
- **Settings.** `Settings.tsx` keeps all of its state and handlers (the token's safety logic is untouched). It renders a tab bar, and each tab's markup moves into its own file, which receives props. `RowMenu.tsx` is the shared ⋯ menu. The dialogs reuse `web/src/vault/PanelDialog.tsx`.

**Tech Stack:** Next.js 16 App Router client components, React 19, CSS Modules, Vitest (units, colocated `*.test.ts`), Playwright (`web/e2e/inbox.spec.ts` and `web/e2e/settings.spec.ts`, on the pages `/dev/inbox` and `/dev/settings`, port 3100).

**Spec:** `docs/superpowers/specs/2026-11-25-inbox-settings-tidy-design.md`. Each task names the sections it builds; read those sections before starting.

## Global Constraints

**Scope**

- No migration and no database change. No change to `load-inbox.ts`, `load-settings.ts` or any existing server action's rules. The only new server code is `openingIn` and `noteOpening` (Task 1).
- The colleague's note shows only `memberName`, `topic` and `title | null`. Its body, path and id never reach the page (`inbox/types.ts` data rule). `noteOpening` is only called with `mine.id` or a held note's `id`.
- Settings tabs, topic search, kind chips, Inbox selection, ↑/↓ and the narrow fold are client state, with **0 server round trips**. The tab is written to the URL with `window.history.replaceState(null, "", url)`, never with `router.push` or `router.replace`.
- Who may do what is unchanged. A member has no Topics tab and no Hive tab, no Invite someone and no invitations. While the hive is being deleted (`closing`), there is no Find topics, no topic ⋯ and no workspace delete, as today.
- The token dialog's safety stays exactly as today: the page is inert from Create to Done, there is a `beforeunload` ask, Back is held, and the token lives in `Settings` state only. Every e2e test that checks this must still pass unchanged apart from opening the tab or dialog first.

**Copy and style**

- Status words stay today's: "Link accepted.", "Link declined.", "Note released.", "Agent connected.", "<name> revoked.", and so on.
- Every colour comes from a theme token (`var(--…)`). `src/inbox/no-literals.test.ts` and `src/settings/no-literals.test.ts` forbid colour literals.
- Sentences a person reads that this plan adds go in the text modules (`inbox/text.ts`, `settings/text.ts`, `settings/topicsText.ts`) as exported constants or functions.
- Controls follow `docs/ui-concept.md` §2: 8 px radius, 1 px hairlines that brighten on hover, no blur. Section labels are JetBrains Mono 11 px, uppercase, 0.12em. **At most one primary (yellow) button visible per Inbox detail and per Settings tab.**

**Tests**

- Existing browser tests are updated where words, order or the place of a control changed. A test is never deleted just to pass. A test whose premise is gone (for example "both sections show" on Settings) is rewritten to the new rule the spec states.
- Before each commit, run from `web/`:
  - `pnpm typecheck`
  - `npx prettier --check .`
  - `pnpm test`
  - the browser spec the task touched: `npx playwright test e2e/<file>.spec.ts --project=chromium`

  Port 3100 may already run a dev server from this worktree (the config reuses it). Never kill a server you did not start, and never kill anything on port 3000.

**Commits**

- Run commits inside the worktree `.claude/worktrees/round3-tidy`, branch `task/round3-tidy`.
- Stage by path only.
- Subjects are lower case after the type, for example `feat(inbox): …`.
- Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File                                                         | Responsibility                                                   | Task |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | ---- |
| `web/src/inbox/text.ts` + `text.test.ts`                     | `linkLine`, `openingOf`, the new sentences                       | 1    |
| `web/src/inbox/types.ts`                                     | `Opening`, `InboxActions.noteOpening`                            | 1    |
| `web/src/app/inbox/write.ts` + `write.test.ts`               | `openingIn(db, id)`                                              | 1    |
| `web/src/app/inbox/actions.ts`, `page.tsx`                   | `noteOpening`, passed to `Inbox`                                 | 1    |
| `web/src/inbox/fixture.ts`, `app/dev/inbox/*`                | Fixture bodies, the dev `noteOpening`                            | 1    |
| `web/src/inbox/useOpening.ts` (new)                          | The per-id cache of openings                                     | 2    |
| `web/src/inbox/InboxList.tsx` (new)                          | §2.2: the listbox of links and held notes                        | 2    |
| `web/src/inbox/InboxDetail.tsx` (new)                        | §2.3–2.5: the selected item, its answer, All done                | 2    |
| `web/src/inbox/Inbox.tsx`                                    | The bar, selection, answer logic, empty block, the fold (Task 3) | 2, 3 |
| `web/src/inbox/inbox.module.css`                             | Styles                                                           | 2, 3 |
| `web/e2e/inbox.spec.ts`                                      | Browser tests                                                    | 2, 3 |
| `web/src/settings/tabs.ts` + `tabs.test.ts` (new)            | `Tab`, `tabsFor`, `tabFromParam`, `TAB_NAMES`, `tabCount`        | 4    |
| `web/src/settings/RowMenu.tsx` (new)                         | The ⋯ menu shared by the tabs                                    | 4    |
| `web/src/settings/AgentsTab.tsx` (new)                       | §3.2                                                             | 4, 5 |
| `web/src/settings/WorkspacesTab.tsx` (new)                   | §3.3 (today's `Workspaces`, moved)                               | 4, 6 |
| `web/src/settings/Topics.tsx`                                | §3.4                                                             | 7    |
| `web/src/settings/PeopleTab.tsx` (new)                       | §3.5                                                             | 4, 8 |
| `web/src/settings/HiveTab.tsx` (new)                         | §3.6 (today's `DeleteHive`, moved)                               | 4, 8 |
| `web/src/settings/Settings.tsx`                              | The bar, tablist, state and handlers                             | 4–8  |
| `web/src/app/settings/page.tsx`, `app/dev/settings/page.tsx` | Read `?tab=` and pass `tab`                                      | 4    |
| `web/src/settings/settings.module.css`                       | Styles                                                           | 4–8  |
| `web/e2e/settings.spec.ts`                                   | Browser tests                                                    | 4–8  |
| `docs/ui-concept.md`                                         | Inbox and Settings sections                                      | 9    |

---

### Task 1: Inbox text helpers and the opening-lines action

Spec §2.2 (the sentence), §2.6.

**Files:**

- Modify: `web/src/inbox/text.ts`, `web/src/inbox/text.test.ts`, `web/src/inbox/types.ts`, `web/src/app/inbox/write.ts`, `web/src/app/inbox/write.test.ts`, `web/src/app/inbox/actions.ts`, `web/src/app/inbox/page.tsx`, `web/src/inbox/fixture.ts`, `web/src/app/dev/inbox/DevInbox.tsx`

**Interfaces:**

- Consumes: `LinkItem`, `InboxActions` (existing); `isUuid` from `web/src/app/vault/validate.ts`.
- Produces:
  - `linkLine(item: LinkItem): { mine: string; rest: string }`
  - `openingOf(body: string): string`
  - `OPENING_MAX = 280`
  - `type Opening = { ok: true; text: string } | { ok: false }` (in `inbox/types.ts`)
  - `InboxActions.noteOpening(id: string): Promise<Opening>`
  - `openingIn(db: Pick<SupabaseClient, "from">, id: unknown): Promise<Opening>`
  - the server action `noteOpening(id: string): Promise<Opening>`
  - `FIXTURE_BODIES: Record<string, string>` (in `inbox/fixture.ts`)
  - sentence constants in `inbox/text.ts`:

    ```ts
    export const ONLY_YOU = "Only you can answer these.";
    export const YOUR_NOTE = "Your note";
    export const theirLabel = (name: string) => `${name}'s note`;
    export const NOT_SHARED = "Not shared with you";
    export const SEE_LATER = "You will see it once you both accept.";
    export const ACCEPT_LINK = "Accept link";
    export const FINAL_NOTE =
      "A declined link is final for this pair of notes.";
    export const HELD_NOTE =
      "A held note is visible only to you until you release it.";
    export const heldFrom = (agent: string | null, date: string) =>
      `Held from ${agent ?? "an agent"} · ${date}`;
    export const theyAccepted = (name: string) => `${name} accepted`;
    export const OPEN_VAULT = "Open the vault";
    export const OPEN_IN_VAULT = "Open in vault";
    export const BACK = "Inbox";
    export const ALL_DONE = "All done.";
    export const EMPTY_TITLE = "Nothing needs you.";
    export const EMPTY_TEXT =
      "Link proposals between your notes and a colleague's, and notes your self-hosted agents hold for you, wait here.";
    export const moreWaiting = (n: number) =>
      `${n} more ${n === 1 ? "is" : "are"} waiting. Reload the page to see them.`;
    ```

- [ ] **Step 1: Write the failing unit tests.** Append to `web/src/inbox/text.test.ts`, adding `linkLine` and `openingOf` to its import from `./text`:

```ts
describe("linkLine", () => {
  const base = fixtureInbox().links;
  it("names their note's title when the person may read it", () => {
    const item = base.find((l) => l.theirs.title !== null)!;
    expect(linkLine(item)).toEqual({
      mine: "Northwind renewal, draft terms",
      rest: "with Sara's “Pricing 2026”",
    });
  });
  it("says the note can't be seen yet when the title is unknown", () => {
    expect(linkLine(base[0]!)).toEqual({
      mine: "Harbour Logistics proposal",
      rest: "with a note of Ahmed's you can't see yet",
    });
  });
  it("falls back to the path when the person's own note has no title", () => {
    const item = { ...base[0]!, mine: { ...base[0]!.mine, title: "" } };
    expect(linkLine(item).mine).toBe("clients/harbour-logistics/proposal.md");
  });
});

describe("openingOf", () => {
  it("drops front matter and headings and joins the first lines", () => {
    const body =
      "---\ntags: [a]\n---\n# Title\n\nFirst line.\nSecond line.\n\n## Part\nThird.";
    expect(openingOf(body)).toBe("First line. Second line. Third.");
  });
  it("cuts at 280 characters on a word boundary and adds an ellipsis", () => {
    const body = Array.from({ length: 80 }, () => "word").join(" "); // 399 characters
    const out = openingOf(body);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(281);
    expect(out.slice(0, -1).endsWith("word")).toBe(true);
  });
  it("keeps a short body whole", () => {
    expect(openingOf("Just this.")).toBe("Just this.");
  });
  it("answers an empty string for an empty or heading-only body", () => {
    expect(openingOf("")).toBe("");
    expect(openingOf("# Only a heading\n")).toBe("");
  });
  it("reads Windows line ends", () => {
    expect(openingOf("# T\r\nOne.\r\nTwo.")).toBe("One. Two.");
  });
});
```

If `fixtureInbox` is not already imported in the test file, add `import { fixtureInbox } from "./fixture";`.

- [ ] **Step 2: Run them and see them fail.** Run `cd web && npx vitest run src/inbox/text.test.ts`. Expected: FAIL, with `linkLine` and `openingOf` not exported.

- [ ] **Step 3: Implement them in `web/src/inbox/text.ts`.** Add the sentence constants from Interfaces too.

```ts
/** The row's sentence: the person's own note (emphasised by the screen), then the other one. */
export function linkLine(item: LinkItem): { mine: string; rest: string } {
  const { memberName, title } = item.theirs;
  return {
    mine: item.mine.title || item.mine.path,
    rest:
      title === null
        ? `with a note of ${memberName}'s you can't see yet`
        : `with ${memberName}'s “${title}”`,
  };
}

export const OPENING_MAX = 280;
const FRONT_MATTER = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const HEADING = /^#{1,6}(?:\s|$)/;

/** A note's first lines as plain text: no front matter, no headings, at most 280 characters. */
export function openingOf(body: string): string {
  const text = body.replace(/\r\n?/g, "\n").replace(FRONT_MATTER, "");
  const joined = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !HEADING.test(l))
    .join(" ")
    .replace(/\s+/g, " ");
  if (joined.length <= OPENING_MAX) return joined;
  const cut = joined.slice(0, OPENING_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
```

- [ ] **Step 4: Run them and see them pass.** Run `npx vitest run src/inbox/text.test.ts`. Expected: PASS.

- [ ] **Step 5: Add the type.** In `web/src/inbox/types.ts`:

```ts
/** A note's opening lines, read for the detail pane. Only ever asked for the person's own notes. */
export type Opening = { ok: true; text: string } | { ok: false };
```

Add `noteOpening(id: string): Promise<Opening>;` to `InboxActions`.

- [ ] **Step 6: Write the failing tests for `openingIn`.** Append to `web/src/app/inbox/write.test.ts`, importing `openingIn`:

```ts
function readStub(res: { data: unknown; error: Err | null }) {
  const limit = vi.fn(async () => res);
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { db: { from } as never, from, select, eq, limit };
}

const NOTE = "00000000-0000-4000-8000-00000000b001";

describe("openingIn", () => {
  it.each([
    ["a word", "x"],
    ["empty", ""],
    ["a number", 3],
    ["null", null],
    ["a filter", `${NOTE},id.neq.x`],
  ])("refuses an id that is %s with no query", async (_n, id) => {
    const t = readStub({ data: [], error: null });
    expect(await openingIn(t.db, id)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
  });
  it("reads one row's body by id and answers its opening", async () => {
    const t = readStub({ data: [{ body: "# T\nHello there." }], error: null });
    expect(await openingIn(t.db, NOTE)).toEqual({
      ok: true,
      text: "Hello there.",
    });
    expect(t.from).toHaveBeenCalledWith("notes");
    expect(t.select).toHaveBeenCalledWith("body");
    expect(t.eq).toHaveBeenCalledWith("id", NOTE);
    expect(t.limit).toHaveBeenCalledWith(1);
  });
  it("answers not ok when the row is not readable or the query fails", async () => {
    expect(
      await openingIn(readStub({ data: [], error: null }).db, NOTE),
    ).toEqual({ ok: false });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await openingIn(
        readStub({ data: null, error: { code: "42501", message: "denied" } })
          .db,
        NOTE,
      ),
    ).toEqual({ ok: false });
    expect(err).toHaveBeenCalledWith("note opening failed", "42501");
  });
});
```

- [ ] **Step 7: Run them and see them fail.** Run `npx vitest run src/app/inbox/write.test.ts`. Expected: FAIL, with `openingIn` not exported.

- [ ] **Step 8: Implement `openingIn` in `web/src/app/inbox/write.ts`.**

```ts
import type { Opening } from "../../inbox/types";
import { openingOf } from "../../inbox/text";

/**
 * A note's opening lines, for the inbox's detail pane: one primary-key read of `body`, cut to
 * 280 characters before it leaves the server. Row-level security decides whether the person may
 * read it; an unreadable row answers `{ ok: false }`. Only the error's code is logged.
 */
export async function openingIn(
  db: Pick<SupabaseClient, "from">,
  id: unknown,
): Promise<Opening> {
  if (!isUuid(id)) return { ok: false };
  const res = (await db
    .from("notes")
    .select("body")
    .eq("id", id)
    .limit(1)) as unknown as {
    data: { body?: unknown }[] | null;
    error: { code?: string } | null;
  };
  if (res.error) {
    console.error("note opening failed", res.error.code);
    return { ok: false };
  }
  const body = res.data?.[0]?.body;
  return typeof body === "string"
    ? { ok: true, text: openingOf(body) }
    : { ok: false };
}
```

- [ ] **Step 9: Run the tests and see them pass.** Run `npx vitest run src/app/inbox/write.test.ts`. Expected: PASS.

- [ ] **Step 10: Add the server action and wire the page.**

In `web/src/app/inbox/actions.ts`:

```ts
import type { Opening } from "../../inbox/types";
import { openingIn, respondIn } from "./write";

export async function noteOpening(id: string): Promise<Opening> {
  try {
    return await openingIn(await createServerSupabase(), id);
  } catch (e) {
    console.error("inbox action failed", e instanceof Error ? e.name : "");
    return { ok: false };
  }
}
```

In `web/src/app/inbox/page.tsx`, import `noteOpening` and pass `actions={{ respondToLink, releaseNote, noteOpening }}`.

- [ ] **Step 11: Add the fixture bodies and the dev action.**

In `web/src/inbox/fixture.ts`, export the bodies keyed by the person's own note ids (`b001`…`b005`):

```ts
/** The bodies of the person's own notes in the sample, for the dev page's opening lines. */
export const FIXTURE_BODIES: Record<string, string> = {
  "00000000-0000-4000-8000-00000000b001":
    "# Harbour Logistics proposal\n\nScope: two warehouses in Rotterdam, one cold store. Timeline twelve weeks from signature, with a pilot in week four.",
  "00000000-0000-4000-8000-00000000b002":
    "# Northwind renewal\n\nDraft terms for the 2027 renewal. Volume discount stays at 8%; payment terms move to 45 days.",
  "00000000-0000-4000-8000-00000000b003":
    "# Site visit\n\nWalked the north hall with the operations lead. Racking is older than the drawings say.",
  "00000000-0000-4000-8000-00000000b004":
    "# Lead review\n\nSeven new leads this month; three qualified. Follow up with the two logistics firms first.",
  "00000000-0000-4000-8000-00000000b005":
    "# Kickoff\n\nAttendees: client operations, our delivery lead. Agreed weekly check-ins on Tuesdays.",
};
```

In `web/src/app/dev/inbox/DevInbox.tsx`, import `FIXTURE_BODIES` from `../../../inbox/fixture` and `openingOf` from `../../../inbox/text`, then add the following to `actions`. Under `fail`, every action is refused, including this one.

```ts
noteOpening: (id) => {
  record("noteOpening", [id]);
  return new Promise((resolve) =>
    setTimeout(() => {
      const body = FIXTURE_BODIES[id];
      resolve(fail || body === undefined ? { ok: false } : { ok: true, text: openingOf(body) });
    }, WAIT),
  );
},
```

- [ ] **Step 12: Run the full gates.** From `web/`, run `pnpm typecheck && npx prettier --check . && pnpm test`. Expected: all PASS. The screen does not call `noteOpening` yet. That is Task 2.

- [ ] **Step 13: Commit.**

```bash
git add web/src/inbox/text.ts web/src/inbox/text.test.ts web/src/inbox/types.ts web/src/app/inbox/write.ts web/src/app/inbox/write.test.ts web/src/app/inbox/actions.ts web/src/app/inbox/page.tsx web/src/inbox/fixture.ts web/src/app/dev/inbox/DevInbox.tsx
git commit -m "feat(inbox): opening lines of a note, read by id and cut on the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Inbox as list and detail

Spec §2.1–2.6, §6 (Inbox list), §7 (Inbox browser tests).

**Files:**

- Create: `web/src/inbox/useOpening.ts`, `web/src/inbox/InboxList.tsx`, `web/src/inbox/InboxDetail.tsx`
- Modify: `web/src/inbox/Inbox.tsx`, `web/src/inbox/inbox.module.css`, `web/e2e/inbox.spec.ts`

**Interfaces:**

- Consumes: everything Task 1 produces; `shortDate` from `web/src/vault/format.ts`; the existing `acceptEffect`, `declineQuestion`, `proposer`, `tierReason`, `inboxCount` and `vaultHref`.
- Produces:
  - `useOpening(id: string | null, load: InboxActions["noteOpening"]): Opening | null`, where `null` means waiting or no id.
  - the `InboxList` and `InboxDetail` props given below. Task 3 relies on `Inbox.tsx` holding `selected` and on `InboxDetail` taking an optional `onBack`.

**Behaviour to build (spec §2):**

1. **`useOpening.ts`**:

```ts
"use client";
// The opening lines of the selected note, asked once per id for the page's life. `null` while
// waiting. A request still running when the selection moves on still fills the cache.
import { useEffect, useRef, useState } from "react";
import type { InboxActions, Opening } from "./types";

export function useOpening(
  id: string | null,
  load: InboxActions["noteOpening"],
): Opening | null {
  const cache = useRef(new Map<string, Opening>());
  const asked = useRef(new Set<string>());
  const loader = useRef(load);
  loader.current = load;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id || asked.current.has(id)) return;
    asked.current.add(id);
    let live = true;
    loader
      .current(id)
      .catch((): Opening => ({ ok: false }))
      .then((a) => {
        cache.current.set(id, a);
        if (live) bump((n) => n + 1);
      });
    return () => {
      live = false;
    };
  }, [id]);
  return id ? (cache.current.get(id) ?? null) : null;
}
```

Note: with `live = false`, an answer that lands after the selection moved is cached but does not re-render. When the person comes back, the cache answers.

2. **`Inbox.tsx`.** Keep `act`, `ask`, `keep`, `gone`, `leaving`, `busy`, `failed`, `asking`, `said`, the timers, the totals and `waiting` exactly as today. Change these parts:
   - **The selection.** Add `const [selected, setSelected] = useState<string | null>(null);`. The current item is `items.find(i => i.id === selected) ?? items[0] ?? null`, where `items = [...links.map(l => ({ kind: "link", item: l })), ...held.map(h => ({ kind: "held", item: h }))]`, with `links` and `held` filtered by `gone` as today.
   - **The next item after a successful answer.** In `act`, on success, before `setSaid(done)`, compute it from the current `links` and `held`:
     - the item after this one in the same group;
     - else the first remaining item in the same group, other than this one;
     - else the first item of the other group;
     - else `null`.

     Call `setSelected(next?.id ?? null)`. The focus target becomes the detail pane's heading (`detailHeading` ref, `tabIndex={-1}`), replacing today's "next row's first action".

   - **The failure path** keeps the item selected and shows `FAILED` in the detail pane (Task 2's `InboxDetail` `failed` prop).
   - **The bar:** `<h1>` "Inbox" with the count as today, and on the right `<p className={s.lede}>{ONLY_YOU}</p>` while anything waits.
   - **The body:**
     - `data.links.length + data.held.length === 0` and `inboxCount(data) === 0` (nothing loaded at all): the empty block, centred in the card: `EMPTY_TITLE`, `EMPTY_TEXT`, and `<Link href="/vault" className={s.secondary}>{OPEN_VAULT}</Link>`.
     - Otherwise a two-column grid (`.split`): `<InboxList …/>` on the left and `<InboxDetail …/>` on the right.
     - When every loaded row has been answered, the list is empty and the detail pane shows the "All done." state (below).
   - **The `aria-live` status line** stays.

3. **`InboxList.tsx`** props:

```ts
{
  links: LinkItem[]; held: HeldItem[];
  linksLeft: number; heldLeft: number;
  linksTotal: number; heldTotal: number; loadedLinks: number; loadedHeld: number;
  now: number;
  selectedId: string | null;
  leaving: ReadonlySet<string>;
  onSelect: (id: string, open: boolean) => void;   // open: Enter or click (Task 3 uses it)
}
```

- **Container:** `<div role="listbox" aria-label="Waiting for you" className={s.list}>`.
- **The links group** (only when there are links): `<div role="group" aria-labelledby="inbox-links">` with the label `<h2 className={s.label}><span id="inbox-links">Links to decide</span><span className={s.count}>{linksLeft}</span></h2>`, then one option per link.
- **The held group** (only when there are held notes): the same, with `inbox-held` and "Held notes".
- **Today's cap line** stays under each group: "Showing the newest 100 of N."
- **A link option:**

```tsx
<div
  role="option"
  id={`opt-${l.id}`}
  data-row={l.id}
  aria-selected={l.id === selectedId}
  tabIndex={l.id === selectedId ? 0 : -1}
  data-leaving={leaving.has(l.id) || undefined}
  className={s.option}
  onClick={() => onSelect(l.id, true)}
>
  <p className={s.what}>
    Link <em className={s.own}>{line.mine}</em> {line.rest}
  </p>
  <p className={s.meta}>
    <span>{proposer(l)}</span>
    <span>{tierReason(l.tier)}</span>
    <span>{shortDate(l.createdAt, now)}</span>
  </p>
  {l.theyAccepted && (
    <span className={s.tag}>{theyAccepted(l.theirs.memberName)}</span>
  )}
</div>
```

- **A held option:** the title (`h.title || h.path`) in `.what`, then `.meta` with `h.agentName ?? "An agent"` · `shortDate(h.updatedAt, now)` · `h.path`.
- **Keyboard** (on the listbox): ArrowDown and ArrowUp move to the next or previous option across both groups, Home and End to the first or last. Each calls `onSelect(id, false)` and focuses that option. Enter calls `onSelect(id, true)`.
- No buttons or links inside options.

4. **`InboxDetail.tsx`** props:

```ts
{
  current: { kind: "link"; item: LinkItem } | { kind: "held"; item: HeldItem } | null;
  opening: Opening | null;
  now: number;
  busy: boolean; failed: boolean; asking: boolean;
  waiting: number;                 // for the All done state
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAccept(): void; onAsk(): void; onKeep(): void; onDecline(): void; onRelease(): void;
  onBack?: () => void;             // Task 3
}
```

It renders `<section aria-labelledby="inbox-detail-title" className={s.detail}>`.

- **`current === null`:** `<h2 ref={headingRef} tabIndex={-1} id="inbox-detail-title">{ALL_DONE}</h2>`. Then `moreWaiting(waiting)` when `waiting > 0`, else the link Open the vault (`/vault`).
- **A link:**
  - The label line: `proposer` · `tierReason` · date.
  - The `<h2>` (heading ref) is the `linkLine` sentence.
  - `.pair`: two `.box` elements with `.swap` "⇄" between them (`aria-hidden`).
    - **Box one:** `YOUR_NOTE` label, the title, the path, and the opening text when `opening?.ok && opening.text`. While `opening === null`, a `.lines` placeholder of fixed height (`aria-hidden`). Then `<Link href={vaultHref(...)}>{OPEN_IN_VAULT}</Link>`.
    - **Box two:** `theirLabel(name)`. Then `title` and topic when known, else `NOT_SHARED` and `SEE_LATER`. Never anything else from `theirs`.
  - `acceptEffect(item)` once, as `.effect`.
  - **Actions group** `data-actions`:
    - When not `asking`: `ACCEPT_LINK` (`.primary`, `data-pick="accept"`) and Decline (`.secondary`, `data-pick="decline"`).
    - When `asking`: `declineQuestion()`, Decline (`.confirm`, `data-pick="decline"`) and Keep (`.secondary`, `data-pick="keep"`), exactly as today's row did. Escape inside the group calls `onKeep`.
    - `aria-disabled` while busy.
  - `FINAL_NOTE` as `.aside`.
  - `FAILED` as `.refused` when `failed`.
- **A held note:**
  - The `<h2>` is the title.
  - The path, `heldFrom(agentName, shortDate(updatedAt, now))`, and the opening text (same rules).
  - `HELD_NOTE`.
  - Release (`.primary`) and the link `OPEN_IN_VAULT` (`.secondary`).
  - `FAILED` when failed.

`Inbox.tsx` needs these focus targets: `{ pick: "keep" | "decline" }`, looked up inside the detail pane by `[data-pick=…]`, and `{ heading: true }` for the detail heading. Replace the per-row lookups with `detail.current?.querySelector(...)`.

5. **CSS** (`inbox.module.css`, tokens only):
   - `.split`: `display: grid; grid-template-columns: minmax(320px, 440px) 1fr; gap: 0;` filling the card height. Each column scrolls on its own (`overflow-y: auto; min-height: 0`), and the list has a 1 px `var(--line)` right border.
   - **`.option`:** padding 12px 16px, radius 8px, cursor pointer. Hover uses `var(--fill)`. `[aria-selected="true"]` uses the theme's selection surface (use the same token as the Vault's selected row; grep `aria-selected` in `vault.module.css`). The focus ring is `:focus-visible`.
   - `.own`: no italics (`font-style: normal`), the text colour, weight 600.
   - `.tag`: the existing mark style.
   - `.pair`: `display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px`.
   - `.box`: 1 px `var(--line)`, radius 8px, padding 14px.
   - `.lines`: `min-height: 3lh`.
   - Remove the styles for row-side actions that no longer exist. Keep `.primary`, `.secondary`, `.confirm`, `.refused`, `.ask`, `.label`, `.count`, `.meta`, `.empty`, `.srOnly` and `[data-leaving]`, and keep the collapse with its reduced-motion rule.

- [ ] **Step 1: Rewrite the browser tests first** (`web/e2e/inbox.spec.ts`), so they fail against today's screen. Keep the rail test unchanged. Rewrite the others to the new rules. Exact cases:
  - "list and detail: both groups with counts; the first link is selected; the detail shows both notes, the effect once and one primary button". Assertions:
    - `getByRole("listbox")` has 5 options.
    - The first option has `aria-selected="true"`.
    - The detail contains "Your note" and "Ahmed's note", `NOT_SHARED`, and the `acceptEffect` text exactly once in the page.
    - `page.locator('main [class*="primary"]:visible')` has count 1, and it is the button "Accept link". CSS Modules keep the class name inside the hashed name in development.
  - "the opening lines of your note appear; their note shows only its title". Wait for the text "Scope: two warehouses in Rotterdam". Then select the second option (ArrowDown) and expect "Pricing 2026" and "Draft terms for the 2027 renewal". Assert that `window.__inboxCalls` has `noteOpening` calls only with ids from `b001`–`b005`.
  - "↑/↓, Home and End move the selection; each opening is asked for once". With focus on the first option, press ArrowDown ×2 and then ArrowUp ×2. The selection visits `b001`, `b002`, `b003`, `b002`, `b001`. Expect `noteOpening` to have been called exactly once each for `b001`, `b002` and `b003`, three calls in all. Then End selects the last held note and Home the first link.
  - "Accept link answers, removes the row, selects the next and says Link accepted." The count drops by one, and the status says "Link accepted.".
  - "Decline asks first; Keep restores; the second Decline removes the row". Keep the double-click guard tests as today, pointed at the detail pane's buttons.
  - "a held note: Release says Note released.; Open in vault links to the note".
  - "answering the last item shows All done." Answer all five (accept ×3, release ×2), then expect "All done." and the link "Open the vault".
  - "a failed action keeps the item selected and says so" (`?fail=1`). The opening lines area is absent under fail.
  - "empty shows Nothing needs you. with Open the vault; above the cap says how many are shown" (`?empty=1`, `?many=1`).
  - "at 1100 x 560 the page does not scroll and each column scrolls on its own". Rewrite today's scroll test for both columns.
  - "keyboard: Tab reaches the listbox and then Accept link; Enter on Accept link focuses the next item's heading".

- [ ] **Step 2: Run them against today's screen and see them fail.** Run `cd web && npx playwright test e2e/inbox.spec.ts --project=chromium`. Expected: the new tests FAIL (no listbox).

- [ ] **Step 3: Implement `useOpening.ts`, `InboxList.tsx`, `InboxDetail.tsx`, the `Inbox.tsx` changes and the CSS,** as described above.

- [ ] **Step 4: Run the browser spec and the gates.** Run `npx playwright test e2e/inbox.spec.ts --project=chromium`, then `pnpm typecheck && npx prettier --check . && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Look at it.** Take screenshots of `/dev/inbox`, `/dev/inbox?empty=1` and `/dev/inbox?many=1` at 1500×900 and 1100×700 into the session scratchpad. Check that the explanation shows once, that there is one yellow button, and that the boxes sit side by side.

- [ ] **Step 6: Commit.**

```bash
git add web/src/inbox/useOpening.ts web/src/inbox/InboxList.tsx web/src/inbox/InboxDetail.tsx web/src/inbox/Inbox.tsx web/src/inbox/inbox.module.css web/e2e/inbox.spec.ts
git commit -m "feat(inbox): list and detail, one decision at a time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Inbox's narrow fold

Spec §2.7.

**Files:** Modify `web/src/inbox/Inbox.tsx`, `web/src/inbox/InboxDetail.tsx`, `web/src/inbox/inbox.module.css`, `web/e2e/inbox.spec.ts`.

**Interfaces:**

- Consumes: `useNarrow(ref, below = 1000)` from `web/src/vault/useNarrow.ts`; Task 2's `InboxList`, with `onSelect(id, open)`, and `InboxDetail`, with `onBack?`.
- Produces: nothing new for other tasks.

**Behaviour:**

- **The fold state.** `const card = useRef<HTMLElement>(null)` sits on `<main>`, with `const narrow = useNarrow(card)` and `const [showing, setShowing] = useState(false)`.
- **Narrow and not showing:** render only `InboxList` full width. `onSelect(id, true)` sets the selection and `setShowing(true)`. `onSelect(id, false)` only sets the selection.
- **Narrow and showing:** render only `InboxDetail` with `onBack={() => { setShowing(false); focus the row [data-row=selected] after render }}`.
- **`InboxDetail`.** When `onBack` is given, it draws at its top `<button type="button" className={s.back}>← {BACK}</button>`, labelled "Back to the inbox". Escape on the detail section (when not `asking`) calls `onBack`.
- After a successful answer in narrow mode, stay on the detail of the next item. With none left, the "All done." pane shows with its back button.
- Going wide again shows both columns, and `showing` no longer matters.

- [ ] **Step 1: Add the failing browser test.** "under 1,000 px the list shows alone; Enter opens the item full width; ← Inbox and Escape return to its row". Use the viewport 900×700:
  - Expect the listbox to be visible and no "Accept link".
  - Focus the first option and press Enter. Expect "Accept link" and the button "Back to the inbox", and the listbox hidden.
  - Press Escape. Expect the listbox, with focus on the first option.
  - Open the second option, then click Back. Expect focus on the second option.

- [ ] **Step 2: Run it and see it fail.** Run `npx playwright test e2e/inbox.spec.ts --project=chromium -g "1,000"`. Expected: FAIL.

- [ ] **Step 3: Implement it.** Add the `.back` style: quiet text button, 8 px radius, hairline on hover. Add `.split[data-narrow]`, which becomes `grid-template-columns: 1fr` without the list border.

- [ ] **Step 4: Run the whole inbox spec and the gates.** Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/src/inbox/Inbox.tsx web/src/inbox/InboxDetail.tsx web/src/inbox/inbox.module.css web/e2e/inbox.spec.ts
git commit -m "feat(inbox): narrow card folds the list and the detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Settings tabs, the URL, the ⋯ menu and the split into tab files

Spec §3.1, §3.7 (⋯ menus), §6 (tabs). This task moves markup without redesigning it, so every later Settings task edits only its own tab file, its styles and its tests.

**Files:**

- Create: `web/src/settings/tabs.ts`, `web/src/settings/tabs.test.ts`, `web/src/settings/RowMenu.tsx`, `web/src/settings/AgentsTab.tsx`, `web/src/settings/WorkspacesTab.tsx`, `web/src/settings/PeopleTab.tsx`, `web/src/settings/HiveTab.tsx`
- Modify: `web/src/settings/Settings.tsx`, `web/src/settings/settings.module.css`, `web/src/app/settings/page.tsx`, `web/src/app/dev/settings/page.tsx`, `web/src/app/dev/settings/DevSettings.tsx`, `web/e2e/settings.spec.ts`

**Interfaces:**

- Consumes: `useDismiss` from `web/src/map/useDismiss.ts`; `SettingsData`.
- Produces:

```ts
// tabs.ts
export type Tab = "agents" | "workspaces" | "topics" | "people" | "hive";
export const TAB_NAMES: Record<Tab, string> = {
  agents: "Agents",
  workspaces: "Workspaces",
  topics: "Topics",
  people: "People",
  hive: "Hive",
};
/** The tabs a person sees: a member has no Topics and no Hive. */
export function tabsFor(isOwner: boolean): Tab[] {
  return isOwner
    ? ["agents", "workspaces", "topics", "people", "hive"]
    : ["agents", "workspaces", "people"];
}
/** The tab a `?tab=` value opens; anything not shown to this person opens Agents. */
export function tabFromParam(
  v: string | null | undefined,
  isOwner: boolean,
): Tab {
  return (tabsFor(isOwner) as string[]).includes(v ?? "")
    ? (v as Tab)
    : "agents";
}
/** The number beside a tab's name; null for Hive. */
export function tabCount(
  tab: Tab,
  d: SettingsData,
  invitations: number,
): number | null {
  switch (tab) {
    case "agents":
      return d.agents.filter((a) => a.status === "active").length;
    case "workspaces":
      return d.workspaces.length;
    case "topics":
      return d.topics.length;
    case "people":
      return d.members.length + invitations;
    case "hive":
      return null;
  }
}
```

- `RowMenu`:

```ts
export type RowMenuItem = {
  key: string;
  text: string;
  danger?: boolean;
  onPick: () => void;
};
export function RowMenu(props: {
  label: string;
  items: RowMenuItem[];
  disabled?: boolean;
}): JSX.Element;
```

It renders the ⋯ button (`aria-label={label}`, `aria-expanded`, `aria-controls`, `data-menu`). Its popover is a `role="group"` of buttons with `data-item={key}`. It closes through `useDismiss`, and choosing an item closes it. Model it on `web/src/vault/NoteMenu.tsx`, and copy that file's `.noteMenu`, `.moreButton`, `.menuPop` and `.menuItem` styles into `settings.module.css` as `.rowMenu`, `.moreButton`, `.menuPop`, `.menuItem` (plus `.menuItem[data-danger]` in `var(--danger)` or the token the Hive section's red uses today).

- `Settings` gains the prop `tab?: Tab` (initial tab; default `"agents"`).
- The tab components take today's markup with the props below. Later tasks change their internals, never these names:
  - `AgentsTab({ agents, data, now, open, busy, failed, onShow, onCancel, onCreate, onAsk, onKeep, onRevoke, onSay, workspaceName })`
  - `WorkspacesTab` (today's `Workspaces`, same props)
  - `PeopleTab({ data, invitations, now, open, busy, failed, unsent, notice, onShow, onCancel, onInvite, onDismiss, onResend, onRevokeInvitation, onSay })`
  - `HiveTab` (today's `DeleteHive`, same props)
  - `ConnectForm` moves to `AgentsTab.tsx`; `InviteForm`, `InviteNotice` and `InvitationRow` move to `PeopleTab.tsx`.

- [ ] **Step 1: Write the failing unit test** `web/src/settings/tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fixtureSettings } from "./fixture";
import { tabCount, tabFromParam, tabsFor } from "./tabs";

describe("tabs", () => {
  it("an owner sees five tabs, a member three", () => {
    expect(tabsFor(true)).toEqual([
      "agents",
      "workspaces",
      "topics",
      "people",
      "hive",
    ]);
    expect(tabsFor(false)).toEqual(["agents", "workspaces", "people"]);
  });
  it.each(["agents", "workspaces", "topics", "people", "hive"])(
    "?tab=%s opens it for an owner",
    (t) => {
      expect(tabFromParam(t, true)).toBe(t);
    },
  );
  it.each([[null], [undefined], [""], ["nope"], ["AGENTS"]])(
    "%s opens Agents",
    (v) => {
      expect(tabFromParam(v as string | null, true)).toBe("agents");
    },
  );
  it("a member asking for topics or hive gets Agents", () => {
    expect(tabFromParam("topics", false)).toBe("agents");
    expect(tabFromParam("hive", false)).toBe("agents");
    expect(tabFromParam("people", false)).toBe("people");
  });
  it("counts active agents, workspaces, topics and people with invitations; none for Hive", () => {
    const d = fixtureSettings({});
    const active = d.agents.filter((a) => a.status === "active").length;
    expect(tabCount("agents", d, 0)).toBe(active);
    expect(tabCount("workspaces", d, 0)).toBe(d.workspaces.length);
    expect(tabCount("topics", d, 0)).toBe(d.topics.length);
    expect(tabCount("people", d, 2)).toBe(d.members.length + 2);
    expect(tabCount("hive", d, 0)).toBeNull();
  });
});
```

Check the signature of `fixtureSettings` in `web/src/settings/fixture.ts` and call it the way `fixture.test.ts` does.

- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run src/settings/tabs.test.ts`. Expected: FAIL, with the module missing.

- [ ] **Step 3: Implement `tabs.ts`** as in Interfaces. Run the test again. Expected: PASS.

- [ ] **Step 4: Move the markup.** Cut each section's JSX from `Settings.tsx` into its tab file with the props listed above, unchanged. `Workspaces` becomes `WorkspacesTab`, and `DeleteHive` becomes `HiveTab`. Move each sub-component with its section. `Settings.tsx` keeps the state, handlers, `TokenDialog`, the focus-target effect and the history and `beforeunload` effects.

- [ ] **Step 5: Build the bar and the tablist in `Settings.tsx`.**

```tsx
const [tab, setTab] = useState<Tab>(props.tab ?? "agents");
const shownTabs = tabsFor(data.isOwner);
function choose(t: Tab, focus = false) {
  setTab(t);
  const url = new URL(window.location.href);
  url.searchParams.set("tab", t);
  window.history.replaceState(null, "", url);
  if (focus) document.getElementById(`tab-${t}`)?.focus();
}
```

- **Header:** `<h1 ref={heading} tabIndex={-1} className={s.title}>{data.hiveName}<span className={s.titleSub}> · Settings</span></h1>`.
- **The tablist:** `<div role="tablist" aria-label="Settings sections" className={s.tabs}>`. For each `t`:

```tsx
<button
  role="tab"
  id={`tab-${t}`}
  aria-selected={t === tab}
  aria-controls={`panel-${t}`}
  tabIndex={t === tab ? 0 : -1}
  className={s.tab}
  onClick={() => choose(t)}
>
  {TAB_NAMES[t]}
  {count !== null && <span className={s.count}>{count}</span>}
</button>
```

    `onKeyDown` on the tablist: ArrowRight and ArrowLeft wrap through `shownTabs`, Home and End go to the first and last, and each calls `choose(next, true)`.

- **Panels:** render every tab's panel, each as `<section role="tabpanel" id={`panel-${t}`} aria-labelledby={`tab-${t}`} hidden={t !== tab}>`. They stay mounted, so a running Find topics or a typed form survives a tab switch.
- Move the old section `<h2>`s inside the panels as they are. Later tasks restyle them.
- **Members:** the Topics and Hive panels render only when `data.isOwner`, as today.
- [ ] **Step 6: Wire the pages to `?tab=`.**
  - In `web/src/app/settings/page.tsx`, give the page `searchParams: Promise<Record<string, string | string[] | undefined>>`. Read `tab` (first value) and pass `tab={tabFromParam(v, result.data.isOwner)}`.
  - Do the same in `web/src/app/dev/settings/page.tsx`, passing it through `DevSettings` to `Settings`.
- [ ] **Step 7: Build `RowMenu.tsx`** as in Interfaces, and its styles. Nothing uses it yet: Tasks 5–8 do, and their browser tests exercise it. In this task, typecheck and lint cover it.
- [ ] **Step 8: Update the browser tests.**
  - Add a helper at the top of `web/e2e/settings.spec.ts`:

```ts
async function openTab(
  page: Page,
  name: "Agents" | "Workspaces" | "Topics" | "People" | "Hive",
) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}
```

- Every existing test that reaches a section other than Agents first calls `openTab` (or loads `?tab=…`).
- Rewrite "the rail marks Settings; both sections show…" to "the rail marks Settings; the tabs show with counts; Agents is open; a revoked agent comes last…".
- Rename "a member who is not the owner sees the members…" to say "on the People tab".
- "the owner's last section says what deleting erases; a member has no such section" becomes "…on the Hive tab; a member has no Hive tab".
- "Topics: a member who is not the owner has no such section" becomes "…has no Topics tab".
- Add new tests:
  - "?tab=topics opens Topics; choosing a tab writes ?tab= without a request". Record `page.on("request")` for non-static requests after load, and expect none on tab clicks.
  - "arrow keys, Home and End move between tabs".
  - "?tab=hive for a member opens Agents".
- Keep the 1100×560 no-scroll tests, opening the tab each needs.
- [ ] **Step 9: Run the settings spec and all the gates.** Run `npx playwright test e2e/settings.spec.ts --project=chromium` and `pnpm typecheck && npx prettier --check . && pnpm test`. Expected: all PASS.
- [ ] **Step 10: Commit.**

```bash
git add web/src/settings/tabs.ts web/src/settings/tabs.test.ts web/src/settings/RowMenu.tsx web/src/settings/AgentsTab.tsx web/src/settings/WorkspacesTab.tsx web/src/settings/PeopleTab.tsx web/src/settings/HiveTab.tsx web/src/settings/Settings.tsx web/src/settings/settings.module.css web/src/app/settings/page.tsx web/src/app/dev/settings/page.tsx web/src/app/dev/settings/DevSettings.tsx web/e2e/settings.spec.ts
git commit -m "feat(settings): tabs in the top bar, kept in the address

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Agents tab

Spec §3.2, §3.7.

**Files:** Modify `web/src/settings/AgentsTab.tsx`, `web/src/settings/Settings.tsx` (only where `create` and `show` set focus targets), `web/src/settings/text.ts`, `web/src/settings/text.test.ts`, `web/src/settings/settings.module.css`, `web/e2e/settings.spec.ts`.

**Interfaces:**

- Consumes: `PanelDialog` from `web/src/vault/PanelDialog.tsx` (props `label`, `busy`, `onClose`, `children`). Its `.dim` and `.dialog` classes come from `vault.module.css` and need `position: relative` on the Settings card, which `.panel` already has. Also consumes `RowMenu` and Task 4's `AgentsTab` props.
- Produces:
  - `CONNECT_TITLE = "Connect an agent"`
  - `REVOKE_ITEM = "Revoke…"`
  - `foldedAgents(n: number): string`, which returns `` `${n} revoked or expired agent${n === 1 ? "" : "s"}` ``
  - `agentLine(a: Agent, workspace: string | null, now: number): string[]`, which returns the parts `[provider, tierText(a.trustTier), workspace?, lastUsed]`. `lastUsed` is `"Last used " + shortDate(...)`, or `"Never used"` when there is none.

**Behaviour:**

- **The heading row:** today's note on the left, and Connect an agent (`.primary`, `data-open="connect"`) on the right. The button always shows, and no longer hides while the form is open.
- **The connect form.** When `open?.kind === "connect"`, render today's `ConnectForm` inside `<PanelDialog label={CONNECT_TITLE} busy={busy} onClose={onCancel}>`. Add a heading `<h2>` "Connect an agent" at the form's top. Show the trust tiers as two selectable cards: radio inputs styled as cards, each with `tierText` and `tierHelp`, with the same values and the same field name as today. The buttons are Cancel and Create.
  - `Settings.show("connect")`'s focus target stays `{ form: "connect" }`. Its lookup `[data-form="connect"] input` works inside the dialog, because the dialog is inside `panel`.
  - On success the dialog closes and the token dialog opens, as today.
- **Active rows:**
  - The name, with the status mark.
  - One `.meta` line from `agentLine`.
  - At the right, `<RowMenu label={`Actions for ${agent.name}`} items={[{ key: "revoke", text: REVOKE_ITEM, danger: true, onPick: onAsk }]} />`.
  - When `asking`, the row shows today's question in place of the menu: "Revoke <name>?", Revoke (`data-pick="revoke"`), Keep (`data-pick="keep"`), and "It stops working within the hour.".
  - Today's `ask` and `keep` focus targets point at `data-pick` buttons. After Keep, focus goes to the row's ⋯ button: change `keep`'s target so the row lookup focuses `[data-menu]` when `pick` is `"revoke"` and no such button exists.
- **Revoked and expired agents** go under a `<details className={s.fold}><summary>{foldedAgents(n)}</summary><ul …>`, closed by default. Their rows have no menu.
- **No agents:** today's empty block, with the same Connect an agent button in the heading row.

- [ ] **Step 1: Write the failing unit tests** in `web/src/settings/text.test.ts`:

```ts
it("folds the revoked agents in one line", () => {
  expect(foldedAgents(1)).toBe("1 revoked or expired agent");
  expect(foldedAgents(3)).toBe("3 revoked or expired agents");
});
it("says an agent in one line", () => {
  const now = Date.UTC(2026, 10, 23, 12);
  const a = {
    id: "a",
    name: "C",
    provider: "Claude",
    trustTier: "vendor",
    workspaceId: "w",
    createdAt: "2026-11-20T00:00:00Z",
    lastUsedAt: null,
    status: "active",
  } as const;
  expect(agentLine(a, "Main", now)).toEqual([
    "Claude",
    "Vendor-hosted",
    "Main",
    "Never used",
  ]);
  expect(agentLine(a, null, now)).toEqual([
    "Claude",
    "Vendor-hosted",
    "Never used",
  ]);
});
```

- [ ] **Step 2: Run them and see them fail.** Then implement both in `text.ts`, importing `shortDate` from `../vault/format`. Run again. Expected: PASS.
- [ ] **Step 3: Update the browser tests** for agents:
  - "Connect an agent" tests open the dialog: expect `getByRole("dialog", { name: "Connect an agent" })`.
  - Escape closes it with focus on Connect an agent.
  - The token-dialog tests stay as they are after Create.
  - "Revoke asks first…" opens ⋯ (`getByRole("button", { name: "Actions for <name>" })`), then "Revoke…", then the question, then Keep, which returns focus to ⋯. The double-click and second-press checks stay.
  - "a revoked agent comes last" becomes: "revoked agents are folded under '1 revoked or expired agent' and have no menu".
  - Add: "the Agents tab shows one primary button".
- [ ] **Step 4: Implement it.** Run `npx playwright test e2e/settings.spec.ts --project=chromium` and the gates. Expected: PASS.
- [ ] **Step 5: Commit** `web/src/settings/AgentsTab.tsx web/src/settings/Settings.tsx web/src/settings/text.ts web/src/settings/text.test.ts web/src/settings/settings.module.css web/e2e/settings.spec.ts` with the subject `feat(settings): agents tab with a connect dialog and row menus`.

---

### Task 6: The Workspaces tab

Spec §3.3.

**Files:** Modify `web/src/settings/WorkspacesTab.tsx`, `web/src/settings/text.ts`, `web/src/settings/settings.module.css`, `web/e2e/settings.spec.ts`.

**Interfaces:**

- Consumes: `RowMenu`; today's `workspaceNotes`, `workspaceQuestion`, `workspaceFailure`, `workspaceDeleted`, `ONLY_WORKSPACE` and `WORKSPACES_NOTE`.
- Produces: `DELETE_WORKSPACE_ITEM = "Delete workspace…"` in `text.ts`.

**Behaviour:**

- **Each row:** the name, one `.meta` line with `workspaceNotes(w)`, and at the right:
  - when this is the only workspace, `ONLY_WORKSPACE` as a quiet line;
  - when `closing`, nothing;
  - otherwise `<RowMenu label={`Actions for ${w.name}`} items={[{ key: "delete", text: DELETE_WORKSPACE_ITEM, danger: true, onPick: () => ask(w.id) }]} />`.
- **Asking:** the row shows today's question, `workspaceQuestion(w)`, with Delete (`.confirm`), Keep and `WORKSPACE_ASIDE`. The refusal and success behaviour stays as today. Keep returns focus to the row's ⋯.
- **Remove** today's always-visible Delete button.

- [ ] **Step 1: Update the browser tests.**
  - "Workspaces: Delete asks first with the note count…" goes through ⋯ → "Delete workspace…".
  - "a failed workspace delete keeps the row and says so; a hive that is being deleted offers no Delete" asserts there is no ⋯ under `?closing=1`.
  - Add: "the only workspace shows its line and no menu". Use a fixture variant if one exists; otherwise skip this case with a note in the report. Do not add a fixture flag in this task.
- [ ] **Step 2: Run them and see them fail. Implement it. Run the spec and the gates.** Expected: PASS.
- [ ] **Step 3: Commit** `web/src/settings/WorkspacesTab.tsx web/src/settings/text.ts web/src/settings/settings.module.css web/e2e/settings.spec.ts` with the subject `feat(settings): workspaces tab with row menus`.

---

### Task 7: The Topics tab

Spec §3.4, §3.7.

**Files:** Modify `web/src/settings/Topics.tsx`, `web/src/settings/topicsText.ts`, `web/src/settings/topicsText.test.ts`, `web/src/settings/settings.module.css`, `web/e2e/settings.spec.ts`.

**Interfaces:**

- Consumes: `PanelDialog`, `RowMenu`, and `KINDS` with `t.KIND_NAMES` (already imported in `Topics.tsx`).
- Produces in `topicsText.ts`:
  - `SEARCH = "Find a topic"`
  - `ALL = "All"`
  - `FIND_LONG = "Find topics in my notes"`
  - `ticked(n: number, of: number) => \`${n} of ${of} ticked\``
  - `saveN(n: number) => \`Save ${n} topic${n === 1 ? "" : "s"}\``
  - `DELETE_TOPIC_ITEM = "Delete topic…"`
  - `NO_MATCH = "No topic matches."`
  - `filterTopics(topics: TopicRow[], kind: string | null, q: string): TopicRow[]`: case-insensitive substring on `name`, trimmed, with `kind` null meaning all.
  - `kindCounts(topics: TopicRow[]): Record<string, number>`

**Behaviour:**

- **The heading row:**
  - the label "Topics" with its count;
  - `t.NOTE`;
  - a `<input type="search" aria-label={SEARCH} placeholder={SEARCH}>`;
  - `FIND_LONG` (`.secondary`) when not `closing`. Keep the `opener` ref; it calls today's `find()`.
- **Today's finding status** (`t.FINDING`) and the message and problem lines stay under the heading row.
- **The candidates.** While `stage.kind === "picking"`, render today's candidate form unchanged inside `<PanelDialog label={t.FOUND} busy={stage.saving} onClose={cancel}>`, where `cancel` is today's Cancel handler.
  - The candidate lists scroll inside the dialog (`.dialog` already scrolls).
  - Show `ticked(stage.ticked.size, stage.found.length)` beside the heading.
  - The save button's text becomes `saveN(stage.ticked.size)`, with `aria-disabled` at 0.
  - Today's focus effects (the heading on open, Find on close) stay.
- **The chips.** `<div role="group" aria-label="Kinds">` holds the chip "All" and then each kind with topics. Each is a `<button aria-pressed>` showing `KIND_NAMES[kind]` and its count. The state is `const [kind, setKind] = useState<string | null>(null)`.
- **The list.** `filterTopics(shown, kind, q)` in a `<ul role="list" aria-label="Topics" className={s.topicGrid}>` (`grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`).
  - Each topic shows its name, its kind as a quiet mark when "All" is chosen, `t.topicNotes(topic.notes)`, and, when not `closing`, `<RowMenu label={`Actions for ${topic.name}`} items={[{ key: "delete", text: DELETE_TOPIC_ITEM, danger: true, onPick: () => setAsking(topic.id) }]} />`.
  - While asking, the cell shows today's question, Delete, Keep and `t.DELETE_ASIDE`.
  - The per-kind folds of saved topics go away; the chips replace them. The folds inside the candidate form stay.
- **Empty states:** with no topics, `t.EMPTY_TITLE` and `t.EMPTY_TEXT`. With a filter that matches nothing, `NO_MATCH`.

- [ ] **Step 1: Write the failing unit tests** in `topicsText.test.ts`, covering `filterTopics` (by kind, by text ignoring case and spaces, both, neither), `kindCounts`, `ticked` and `saveN` (0, 1, 2).
- [ ] **Step 2: Run them, implement, run again.** Expected: PASS.
- [ ] **Step 3: Update the browser tests.**
  - The Topics tests open the tab.
  - "Find" opens a dialog named `t.FOUND`, and Save reads "Save N topics".
  - "a long kind starts folded…" becomes "the candidates scroll inside the dialog and Save stays in view".
  - "Delete asks first" goes through ⋯.
  - Add: "search and chips filter the topics without a request". Record requests after load and expect none.
  - Under `?many=1`, the chips show counts.
- [ ] **Step 4: Implement it. Run the spec and the gates.** Expected: PASS.
- [ ] **Step 5: Commit** `web/src/settings/Topics.tsx web/src/settings/topicsText.ts web/src/settings/topicsText.test.ts web/src/settings/settings.module.css web/e2e/settings.spec.ts` with the subject `feat(settings): topics tab with search, kind chips and a find dialog`.

---

### Task 8: The People and Hive tabs

Spec §3.5, §3.6, §3.7.

**Files:** Modify `web/src/settings/PeopleTab.tsx`, `web/src/settings/HiveTab.tsx`, `web/src/settings/Settings.tsx` (focus targets for invite only), `web/src/settings/text.ts`, `web/src/settings/text.test.ts`, `web/src/settings/settings.module.css`, `web/e2e/settings.spec.ts`.

**Interfaces:**

- Consumes: `PanelDialog`, `RowMenu`, and today's invite and delete texts.
- Produces in `text.ts`:
  - `INVITE_TITLE = "Invite someone"`
  - `INVITED = "Invited"`
  - `SEND_AGAIN = "Send again"`
  - `REVOKE_INVITATION = "Revoke invitation"`
  - `invitationLine(i: Invitation, now: number): string[]`, which returns `[email, "Invited " + shortDate(createdAt), "Expires " + shortDate(expiresAt)]`
  - `DELETE_HIVE_ITEM = "Delete hive…"`
  - `KEEP_HIVE = "Keep the hive"`

**Behaviour:**

- **People.**
  - **The heading row:** the label "People" with its count, today's members note, and for an owner `INVITE_TITLE` (`.primary`, `data-open="invite"`).
  - **The invite form.** When `open?.kind === "invite"`, today's `InviteForm` renders inside `<PanelDialog label={INVITE_TITLE} busy={busy} onClose={onCancel}>`, with a heading at its top. The submit button reads "Invite".
  - Today's `InviteNotice` shows under the heading row, outside the dialog.
  - **One `<ul aria-label="People">`:**
    - member rows as today, with the `you` mark rendered as "You";
    - then, for an owner, invitation rows: name, the `INVITED` mark, a `.meta` line from `invitationLine`, and `<RowMenu label={`Actions for ${i.name}`} items={[{ key: "resend", text: SEND_AGAIN, onPick: onResend }, { key: "revoke", text: REVOKE_INVITATION, danger: true, onPick: onRevoke }]} />`.
    - Today's unsent and failed lines stay in the row.
  - The separate Invitations section and its heading go away. `INVITATIONS_NOTE` becomes the `title` of the Invited mark.
- **Hive.**
  - `DELETE_TITLE`, then `deletionCounts(deletion)` or `DELETE_UNCOUNTED`.
  - Then a `.danger` box (1 px border in the danger token, radius 8 px) with `DELETE_HIVE_ITEM`. That button opens `<PanelDialog label={DELETE_TITLE} busy={busy} onClose={close}>` holding today's typed-name form (`DELETE_FIELD`, `deleteHint`, `DELETE_HELP`, the refusal line), with `KEEP_HIVE` and `DELETE_HIVE` (`.confirm`, disabled until the name matches, as today).
  - **While `closing`:** the box shows `DELETED_ON` <date>, `CLOSING_HELP` and `CANCEL_DELETION` instead, as today.

- [ ] **Step 1: Write the failing unit test** for `invitationLine`, with a fixture invitation, the fixed `now`, and the exact strings from `shortDate`. Run it, implement it, run again.
- [ ] **Step 2: Update the browser tests.**
  - The Invite tests open the People tab and then the dialog `getByRole("dialog", { name: "Invite someone" })`. Today's validation checks stay.
  - The invitation tests find the row in the People list by its "Invited" mark, and Send again and Revoke go through ⋯.
  - "a member who is not the owner sees the members, no invite form and no invitations" stays, on the People tab.
  - The Delete hive tests open the Hive tab, then "Delete hive…", then the dialog. "does nothing until the hive's name is typed exactly" and the refusal, cancel and closing tests stay, pointed at the dialog.
  - The 1100×560 and 390 px tests open the tab first.
- [ ] **Step 3: Implement it. Run the spec and the gates.** Expected: PASS.
- [ ] **Step 4: Commit** `web/src/settings/PeopleTab.tsx web/src/settings/HiveTab.tsx web/src/settings/Settings.tsx web/src/settings/text.ts web/src/settings/text.test.ts web/src/settings/settings.module.css web/e2e/settings.spec.ts` with the subject `feat(settings): people in one list and the hive's delete in a dialog`.

---

### Task 9: The document and the whole run

Spec §8.

**Files:** Modify `docs/ui-concept.md`.

- [ ] **Step 1: Rewrite the Inbox and Settings sections** of `docs/ui-concept.md`:
  - the Inbox's list and detail, the one decision, the opening lines (own note only) and the narrow fold;
  - Settings' tabs and `?tab=`, the dialogs, the ⋯ menus, the folded agents and People as one list;
  - that a member has no Topics and no Hive tab.

  Replace the old text; do not append beside it.

- [ ] **Step 2: Run the whole repository's gates** from the worktree root: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then `cd web && npx playwright test --project=chromium`. Expected: all PASS.
- [ ] **Step 3: Take screenshots** of `/dev/inbox`, `/dev/settings` (each tab) and `/dev/settings?member=1` at 1500×900 and 1100×700, into the scratchpad, for the final review.
- [ ] **Step 4: Commit** `docs/ui-concept.md` with the subject `docs(ui): inbox list and detail, settings tabs`.

---

## Performance and data budget

| Moment                                  | Server round trips                                                                                                                                     | Bounded / indexed                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Inbox first paint                       | Unchanged: `loadInbox` (≤ 100 links, ≤ 100 held)                                                                                                       | Unchanged                                               |
| Selecting an Inbox item (first time)    | 1: `noteOpening(id)` = `notes.select("body").eq("id", id).limit(1)`                                                                                    | Primary key `notes.id`; at most 280 characters returned |
| Selecting an item again; ↑/↓ back; fold | 0 (cache per id)                                                                                                                                       | —                                                       |
| Answering (accept, decline, release)    | Today's write + `router.refresh()`                                                                                                                     | Unchanged                                               |
| Settings first paint                    | Unchanged: `loadSettings` + `loadInboxCount`                                                                                                           | Unchanged                                               |
| Switching tabs                          | 0 (`replaceState`; all panels already rendered)                                                                                                        | —                                                       |
| Topic search, kind chips                | 0 (client filter over loaded `topics`)                                                                                                                 | —                                                       |
| Opening any dialog or ⋯ menu            | 0                                                                                                                                                      | —                                                       |
| Settings writes                         | Today's (create/revoke agent, delete workspace, find/save/delete topics, invite, resend, revoke invitation, request/cancel deletion) + today's refresh | Unchanged                                               |

Does an interaction change server data? Only the answers and the Settings writes do. Each is a write followed by today's targeted refresh. Selection, tabs, search, chips and folds are client state.

## Execution DAG

**Dependencies** (from each task's Interfaces):

- Task 1: none.
- Task 2: Task 1 (`noteOpening`, `linkLine`, the sentences).
- Task 3: Task 2 (`InboxList.onSelect(id, open)`, `InboxDetail.onBack`).
- Task 4: none.
- Task 5: Task 4 (`AgentsTab`, `RowMenu`).
- Task 6: Task 4 (`WorkspacesTab`, `RowMenu`).
- Task 7: Task 4 (the tablist, `RowMenu`).
- Task 8: Task 4 (`PeopleTab`, `HiveTab`, `RowMenu`).
- Task 9: Tasks 3, 5, 6, 7 and 8.

**Parallel batches:**

| Wave | Tasks           | Why together                                                                                                           |
| ---- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | Task 1 ∥ Task 4 | Inbox files vs Settings files: no shared file                                                                          |
| 2    | Task 2 ∥ Task 5 | Inbox vs Settings, no shared file                                                                                      |
| 3    | Task 3 ∥ Task 6 | Same                                                                                                                   |
| 4    | Task 7          | Settings; shares `settings.module.css` and `settings.spec.ts` with 5, 6 and 8, so it runs after them on the one branch |
| 5    | Task 8          | Same                                                                                                                   |
| 6    | Task 9          | Needs all                                                                                                              |

Tasks 5–8 are independent in logic: each owns its own tab file. They all append to `settings.module.css` and `web/e2e/settings.spec.ts`, though, so running them at once on separate branches would mean merge conflicts in those two files. They run one after another in the Settings track. The Inbox track (1 → 2 → 3) and the Settings track (4 → 5 → 6 → 7 → 8) touch no shared file, so the two tracks run side by side.

Under subagent-driven development in this one worktree, implementers are dispatched one at a time. The waves then give the order Task 1, 4, 2, 5, 3, 6, 7, 8, 9, alternating tracks so each task's review runs while the other track's next task is briefed.

**Critical path:** Task 4 → 5 → 6 → 7 → 8 → 9 (six tasks). The Inbox track (three tasks) finishes well inside it.
