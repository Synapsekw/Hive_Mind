# Topics, part 1: find and attach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hive's owner finds topics (customers, vendors, subjects) in their own notes and saves them; every member's own notes are then attached to those topics by rule, after an import and from a button in the vault.

**Architecture:** Three pure modules decide what a topic is and which notes match it. One migration adds two topic kinds, bounds on topics and a `detached_at` column. Two paged server steps (scan a workspace for candidates; attach 40 notes) run under the person's own session, so row-level security decides every row. The browser loops over the steps, exactly as "Connect wiki links" does.

**Tech Stack:** Supabase Postgres (RLS, plpgsql triggers), Next.js server actions, React, Vitest, node:test + PGlite, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-topics-design.md`. This plan covers its units 1 to 4. Units 5 (a note's topics in the vault, detach and add) and 6 (the map's "Group by Topic") are **part 2**, written once `task/map-chrome` has merged, because unit 6 adds an entry to the control that task replaces.

## Global Constraints

- Work in the worktree `.claude/worktrees/topics` on branch `task/topics`. Never `git checkout` or `git stash` in the main checkout.
- Stage by path (`git add <paths>`); never `git add -A`, `git add .` or `git commit -a`. Commits are authored as `Danijel Jovanovic <info@synapse-solutions.ai>` (already pinned in the worktree).
- The migration is minted only with `scripts/new-migration.sh topics`. Never hand-write a version stamp; never edit a shipped migration.
- Sharing is decided in the database. No permission logic in `mcp/` or in server actions: they validate arguments, then let row-level security answer.
- Text read from notes is data. It is compared with topic names; nothing else is done with it. No note path, title or text is logged or returned from the attach step except the cursor.
- A topic name is 1 to 80 characters, trimmed. A topic has at most 20 aliases of at most 80 characters. A hive has at most 2,000 topics. A note keeps at most 5 topics.
- Kinds, in this order everywhere: `client`, `project`, `vendor`, `product`, `person`, `subject`.
- Confidence values: 1.0 (the note proposes the topic), 0.9 (folder or tag), 0.7 (title), 0.5 (text).
- Every colour in UI code comes from a token (the `no-literals` tests enforce it). Every sentence shown lives in a text file, not in a component.
- Gates before closure: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## File Structure

| File                                                              | Responsibility                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `web/src/topics/types.ts` (new)                                   | Kinds, limits, and every shape shared by the tasks     |
| `web/src/topics/normal.ts` (new)                                  | One form of a name for comparing                       |
| `web/src/topics/candidates.ts` (new)                              | What a note proposes; the candidate list of many notes |
| `web/src/topics/match.ts` (new)                                   | Which topics a note is attached to                     |
| `supabase/migrations/<stamp>_topics.sql` (new)                    | Kinds, bounds, `detached_at`, the update policy        |
| `tests/sharing-rules.test.mjs`                                    | Tests of the above                                     |
| `web/src/app/vault/attach.ts` (new)                               | One attach step over 40 notes                          |
| `web/src/app/vault/connect.ts`                                    | Exports `paged`, `counting` for reuse                  |
| `web/src/app/settings/topics.ts` (new)                            | Scan step, save topics, delete a topic                 |
| `web/src/settings/Topics.tsx`, `topicsText.ts` (new)              | The owner's Topics section                             |
| `web/src/vault/attachRun.ts`, `attachText.ts`, `Attach.tsx` (new) | The loop, its sentences, its panel                     |
| `web/src/vault/Import.tsx`, `Vault.tsx`                           | The third import stage; the button                     |

## Execution DAG

- **Dependencies:** Task 3 depends on Tasks 1 and 2. Task 5 depends on Tasks 1 and 2. Task 4 depends on Task 3. Task 6 depends on all.
- **Parallel batches:**
  - Batch A: Task 1 (pure rules) and Task 2 (database). No shared files.
  - Batch B: Task 3 (attach step, `web/src/app/vault/`) and Task 5 (owner's topics, `web/src/settings/`, `web/src/app/settings/`). No shared files.
  - Batch C: Task 4 (attach in the browser).
  - Batch D: Task 6 (closure).
- **Critical path:** Task 1 → Task 3 → Task 4 → Task 6.
- All tasks commit to the one `task/topics` branch. Tasks in one batch touch disjoint files, so parallel subagents work in the same worktree and each stages only its own paths.

---

### Task 1: The rules (pure)

**Files:**

- Create: `web/src/topics/types.ts`, `web/src/topics/normal.ts`, `web/src/topics/candidates.ts`, `web/src/topics/match.ts`
- Test: `web/src/topics/normal.test.ts`, `web/src/topics/candidates.test.ts`, `web/src/topics/match.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: everything in `types.ts` below; `normal(text: string): string`; `headOf(path: string, title: string, frontmatter: unknown): NoteHead`; `proposalOf(head: NoteHead): Proposal | null`; `candidates(heads: NoteHead[]): Candidate[]`; `prepare(topics: Topic[]): Ready[]`; `topicsFor(note: { path: string; title: string; body: string; frontmatter: unknown }, ready: Ready[]): Hit[]`.

- [ ] **Step 1: Write the shared types**

`web/src/topics/types.ts`:

```ts
// Shapes shared by everything about topics. Types and constants only: safe to import anywhere.
export const KINDS = [
  "client",
  "project",
  "vendor",
  "product",
  "person",
  "subject",
] as const;
export type Kind = (typeof KINDS)[number];

export const MAX_NAME = 80;
export const MAX_ALIASES = 20;
export const MAX_HEAD_TAGS = 50;
export const MAX_TOPICS_PER_NOTE = 5;
/** The most candidates one save request carries. */
export const SAVE_CHUNK = 200;

/** A topic of the hive, as the database holds it. */
export type Topic = { id: string; kind: Kind; name: string; aliases: string[] };
/** What the rules read of a note to find topics: never its text. */
export type NoteHead = {
  path: string;
  title: string;
  type: string | null;
  aliases: string[];
  tags: string[];
};
export type Proposal = { kind: Kind; name: string; aliases: string[] };
/** A proposed topic and how many notes proposed it. */
export type Candidate = Proposal & { notes: number };
export type Hit = { id: string; confidence: number };

/** One attach step. `none`: notes of this step left with no topic. `topics`: the hive's topics. */
export type AttachResult =
  | {
      ok: true;
      next: string | null;
      total: number;
      scanned: number;
      attached: number;
      already: number;
      none: number;
      failed: number;
      topics: number;
    }
  | { ok: false };

/** One scan step over a workspace of the owner's. */
export type ScanResult =
  { ok: true; heads: NoteHead[]; next: string | null } | { ok: false };
export type TopicsSaved = { ok: true; saved: number } | { ok: false };
/** A topic as Settings lists it; `notes` is null when the count could not be read. */
export type TopicRow = {
  id: string;
  kind: Kind;
  name: string;
  notes: number | null;
};
```

- [ ] **Step 2: Write the failing tests for `normal`**

`web/src/topics/normal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normal } from "./normal";

describe("normal", () => {
  it("ignores case, accents and the space, dash and underscore between words", () => {
    expect(normal("Zain DragonFly")).toBe("zain dragonfly");
    expect(normal("zain-dragonfly")).toBe("zain dragonfly");
    expect(normal("  ZAIN_dragonfly ")).toBe("zain dragonfly");
    expect(normal("Café Zürich")).toBe("cafe zurich");
  });

  it("keeps & and + so a short company name stays itself", () => {
    expect(normal("e&")).toBe("e&");
    expect(normal("C++ notes")).toBe("c++ notes");
  });

  it("turns punctuation into one space and trims", () => {
    expect(normal("Zain: proposal (v2).")).toBe("zain proposal v2");
    expect(normal("#vendor")).toBe("vendor");
    expect(normal("...")).toBe("");
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `cd web && npx vitest run src/topics/normal.test.ts`
Expected: FAIL, cannot find `./normal`.

- [ ] **Step 4: Implement `normal`**

`web/src/topics/normal.ts`:

```ts
// One form of a name for comparing: lower case, no accents, and every run of anything that is
// not a letter, a digit, & or + as one space. "Zain DragonFly", "zain-dragonfly" and
// "ZAIN_dragonfly" are the same name.
export function normal(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&+]+/gu, " ")
    .trim();
}
```

Run: `cd web && npx vitest run src/topics/normal.test.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing tests for candidates**

`web/src/topics/candidates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { candidates, headOf, proposalOf } from "./candidates";
import type { NoteHead } from "./types";

const head = (path: string, over: Partial<NoteHead> = {}): NoteHead => ({
  path,
  title: path,
  type: null,
  aliases: [],
  tags: [],
  ...over,
});

describe("headOf", () => {
  it("reads type, aliases and tags from the fields, and nothing else", () => {
    expect(
      headOf("a/Zain.md", "Zain Group", {
        type: "client-entity",
        aliases: ["ZainTech", 7, "  Zain KSA "],
        tags: ["kuwait", null, "#vendor"],
        secret: "x",
      }),
    ).toEqual({
      path: "a/Zain.md",
      title: "Zain Group",
      type: "client-entity",
      aliases: ["ZainTech", "Zain KSA"],
      tags: ["kuwait", "#vendor"],
    });
  });

  it("gives empty lists for fields that are missing or the wrong shape", () => {
    for (const f of [
      null,
      undefined,
      "x",
      [],
      { type: 3, aliases: "a", tags: {} },
    ])
      expect(headOf("a.md", "A", f)).toEqual(head("a.md", { title: "A" }));
  });

  it("drops an empty text and one over 80 characters, and keeps at most 20 aliases and 50 tags", () => {
    const h = headOf("a.md", "A", {
      aliases: [
        "",
        "x".repeat(81),
        ...Array.from({ length: 30 }, (_, i) => `al${i}`),
      ],
      tags: Array.from({ length: 60 }, (_, i) => `t${i}`),
    });
    expect(h.aliases).toHaveLength(20);
    expect(h.aliases[0]).toBe("al0");
    expect(h.tags).toHaveLength(50);
  });
});

describe("proposalOf", () => {
  it.each([
    ["client", "client"],
    ["client-entity", "client"],
    ["partner-entity", "client"],
    ["project", "project"],
    ["internal-project", "project"],
    ["person", "person"],
    ["product", "product"],
    ["vendor", "vendor"],
    ["concept", "subject"],
    ["cluster-topic", "subject"],
    ["category", "subject"],
    [" Vendor ", "vendor"],
  ])("a note of type %s proposes a %s named after its file", (type, kind) => {
    expect(proposalOf(head("Knowledge/x/Terra Drone.md", { type }))).toEqual({
      kind,
      name: "Terra Drone",
      aliases: ["Knowledge/x/Terra Drone.md"],
    });
  });

  it("takes the folder's name for an index file, and the title and aliases as aliases", () => {
    for (const file of ["_Index.md", "index.md", "README.md"])
      expect(
        proposalOf(
          head(`Employers/Zain/${file}`, {
            type: "client-entity",
            title: "Zain Group",
            aliases: ["ZainTech", "zain group", "ZAIN"],
          }),
        ),
      ).toEqual({
        kind: "client",
        name: "Zain",
        aliases: ["Zain Group", "ZainTech"],
      });
  });

  it("proposes a folder with an _Index note and no type: a client under Employers, else a subject", () => {
    expect(
      proposalOf(head("Employers/Orbit/_Index.md", { title: "Orbit" })),
    ).toEqual({
      kind: "client",
      name: "Orbit",
      aliases: [],
    });
    expect(
      proposalOf(head("clients/Acme/_index.md", { title: "Acme" }))?.kind,
    ).toBe("client");
    expect(
      proposalOf(head("Decisions/_Index.md", { title: "Decisions" }))?.kind,
    ).toBe("subject");
    // Only _Index does this; a README with no type proposes nothing.
    expect(proposalOf(head("outputs/decks/README.md"))).toBeNull();
  });

  it("proposes nothing for other types, templates, short names, long names and a root index", () => {
    expect(proposalOf(head("Sessions/a.md", { type: "session" }))).toBeNull();
    expect(proposalOf(head("a.md"))).toBeNull();
    expect(
      proposalOf(head("Templates/vendor.md", { type: "vendor" })),
    ).toBeNull();
    expect(
      proposalOf(head("x/templates/y/Acme.md", { type: "vendor" })),
    ).toBeNull();
    expect(proposalOf(head("v/AB.md", { type: "vendor" }))).toBeNull();
    expect(
      proposalOf(head(`v/${"x".repeat(81)}.md`, { type: "vendor" })),
    ).toBeNull();
    expect(proposalOf(head("_Index.md", { type: "vendor" }))).toBeNull();
    expect(
      proposalOf(head("v/toString.md", { type: "constructor" })),
    ).toBeNull();
  });
});

describe("candidates", () => {
  it("merges two notes that propose the same kind and name, ignoring case and accents", () => {
    const out = candidates([
      head("a/Zain.md", {
        type: "client",
        title: "Zain",
        aliases: ["ZainTech"],
      }),
      head("b/zain.md", { type: "client-entity", title: "Zain Group" }),
      head("c/Zain.md", { type: "vendor", title: "Zain" }),
    ]);
    expect(out).toEqual([
      {
        kind: "client",
        name: "Zain",
        aliases: ["ZainTech", "Zain Group"],
        notes: 2,
      },
      { kind: "vendor", name: "Zain", aliases: [], notes: 1 },
    ]);
  });

  it("proposes a tag on five or more notes as a subject, unless a candidate already has the name", () => {
    const tagged = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) =>
        head(`s/${tag}-${i}.md`, { tags: [tag] }),
      );
    const out = candidates([
      head("v/Terra Drone.md", { type: "vendor", title: "Terra Drone" }),
      ...tagged(5, "terra-drone"),
      ...tagged(5, "#flare-stack"),
      ...tagged(4, "rare"),
      ...tagged(6, "ab"),
    ]);
    expect(out).toEqual([
      { kind: "vendor", name: "Terra Drone", aliases: [], notes: 1 },
      { kind: "subject", name: "flare-stack", aliases: [], notes: 5 },
    ]);
  });

  it("counts a tag once per note and ignores the tags of templates", () => {
    const out = candidates([
      ...Array.from({ length: 4 }, (_, i) =>
        head(`s/${i}.md`, { tags: ["ops", "Ops"] }),
      ),
      head("Templates/t.md", { tags: ["ops"] }),
    ]);
    expect(out).toEqual([]);
  });

  it("orders by kind, then by name", () => {
    const out = candidates([
      head("x/Beta.md", { type: "concept", title: "Beta" }),
      head("x/Zed.md", { type: "client", title: "Zed" }),
      head("x/Alpha.md", { type: "client", title: "Alpha" }),
      head("x/Mid.md", { type: "vendor", title: "Mid" }),
    ]);
    expect(out.map((c) => `${c.kind}:${c.name}`)).toEqual([
      "client:Alpha",
      "client:Zed",
      "vendor:Mid",
      "subject:Beta",
    ]);
  });
});
```

Note on the first `proposalOf` table: the fixture's title defaults to the path, which differs from the name, so it comes back as an alias. That is the rule working ("the title when it differs").

- [ ] **Step 6: Run and see them fail**

Run: `cd web && npx vitest run src/topics/candidates.test.ts`
Expected: FAIL, cannot find `./candidates`.

- [ ] **Step 7: Implement candidates**

`web/src/topics/candidates.ts`:

```ts
// What a note proposes as a topic, and the candidate list of many notes. Pure: it reads a
// note's path, title and three of its fields, never its text.
import { normal } from "./normal";
import {
  KINDS,
  MAX_ALIASES,
  MAX_HEAD_TAGS,
  MAX_NAME,
  type Candidate,
  type Kind,
  type NoteHead,
  type Proposal,
} from "./types";

/** A tag must be on this many notes to be proposed as a subject. */
export const TAG_NOTES = 5;
/** A name shorter than this, once normalised, is no topic and matches nothing. */
export const MIN_NAME = 3;

const TYPE_KIND: Record<string, Kind> = {
  client: "client",
  "client-entity": "client",
  "partner-entity": "client",
  project: "project",
  "internal-project": "project",
  person: "person",
  product: "product",
  vendor: "vendor",
  concept: "subject",
  "cluster-topic": "subject",
  category: "subject",
};
const INDEX = /^(_index|index|readme)$/i;
const FOLDER_INDEX = /^_index$/i;
const CLIENT_FOLDERS = new Set(["employers", "clients", "customers"]);

function texts(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length >= 1 && x.length <= MAX_NAME)
    .slice(0, max);
}

/** What the rules read of a note. */
export function headOf(
  path: string,
  title: string,
  frontmatter: unknown,
): NoteHead {
  const f =
    typeof frontmatter === "object" &&
    frontmatter !== null &&
    !Array.isArray(frontmatter)
      ? (frontmatter as Record<string, unknown>)
      : {};
  return {
    path,
    title,
    type: typeof f.type === "string" ? f.type : null,
    aliases: texts(f.aliases, MAX_ALIASES),
    tags: texts(f.tags, MAX_HEAD_TAGS),
  };
}

const inTemplates = (parts: string[]) =>
  parts.some((p) => normal(p) === "templates");

/** The topic this note says it is, or null. */
export function proposalOf(h: NoteHead): Proposal | null {
  const parts = h.path.split("/");
  if (inTemplates(parts)) return null;
  const file = parts[parts.length - 1]!.replace(/\.md$/i, "");
  const folder = parts.length >= 2 ? parts[parts.length - 2]! : null;
  const type = h.type === null ? "" : h.type.trim().toLowerCase();
  const typed = Object.hasOwn(TYPE_KIND, type) ? TYPE_KIND[type]! : null;

  let kind: Kind;
  let name: string;
  if (typed !== null) {
    kind = typed;
    if (INDEX.test(file)) {
      if (folder === null) return null;
      name = folder;
    } else name = file;
  } else if (FOLDER_INDEX.test(file) && folder !== null) {
    const above = parts.length >= 3 ? normal(parts[parts.length - 3]!) : "";
    kind = CLIENT_FOLDERS.has(above) ? "client" : "subject";
    name = folder;
  } else return null;

  name = name.trim();
  const key = normal(name);
  if (name.length > MAX_NAME || key.length < MIN_NAME) return null;

  const seen = new Set([key]);
  const aliases: string[] = [];
  for (const a of [h.title.trim(), ...h.aliases]) {
    const k = normal(a);
    if (a.length > MAX_NAME || k.length < MIN_NAME || seen.has(k)) continue;
    seen.add(k);
    aliases.push(a);
    if (aliases.length >= MAX_ALIASES) break;
  }
  return { kind, name, aliases };
}

/** Every topic the notes propose, merged, with the tags used on five or more notes. */
export function candidates(heads: NoteHead[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const tags = new Map<string, { text: string; notes: number }>();
  for (const h of heads) {
    const p = proposalOf(h);
    if (p) {
      const key = `${p.kind}|${normal(p.name)}`;
      const old = byKey.get(key);
      if (!old) byKey.set(key, { ...p, aliases: [...p.aliases], notes: 1 });
      else {
        old.notes += 1;
        const seen = new Set([normal(old.name), ...old.aliases.map(normal)]);
        for (const a of p.aliases) {
          if (old.aliases.length >= MAX_ALIASES || seen.has(normal(a)))
            continue;
          seen.add(normal(a));
          old.aliases.push(a);
        }
      }
    }
    if (inTemplates(h.path.split("/"))) continue;
    const own = new Map<string, string>();
    for (const t of h.tags) {
      const text = t.replace(/^#+/, "").trim();
      const k = normal(text);
      if (k.length >= MIN_NAME && !own.has(k)) own.set(k, text);
    }
    for (const [k, text] of own) {
      const old = tags.get(k);
      if (old) old.notes += 1;
      else tags.set(k, { text, notes: 1 });
    }
  }

  const known = new Set<string>();
  for (const c of byKey.values()) {
    known.add(normal(c.name));
    for (const a of c.aliases) known.add(normal(a));
  }
  for (const [k, t] of tags) {
    if (t.notes < TAG_NOTES || known.has(k)) continue;
    byKey.set(`subject|${k}`, {
      kind: "subject",
      name: t.text,
      aliases: [],
      notes: t.notes,
    });
  }

  return [...byKey.values()].sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}
```

Run: `cd web && npx vitest run src/topics/candidates.test.ts` — Expected: PASS.

- [ ] **Step 8: Write the failing tests for matching**

`web/src/topics/match.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import { prepare, prose, topicsFor } from "./match";
import type { Kind, Topic } from "./types";

const topic = (
  id: string,
  kind: Kind,
  name: string,
  aliases: string[] = [],
): Topic => ({
  id,
  kind,
  name,
  aliases,
});
const note = (
  path: string,
  over: { title?: string; body?: string; frontmatter?: unknown } = {},
) => ({
  path,
  title: over.title ?? "Untitled",
  body: over.body ?? "",
  frontmatter: over.frontmatter ?? {},
});

const ZAIN = topic("z", "client", "Zain", ["ZainTech"]);
const TERRA = topic("t", "vendor", "Terra Drone");
const ready = prepare([ZAIN, TERRA]);

describe("prose", () => {
  it("drops fenced code blocks and inline code", () => {
    expect(prose("a\n```\nZain\n```\nb `Zain` c\n~~~\nZain\n~~~\nd")).toBe(
      "a\nb   c\nd",
    );
  });

  it("treats a fence that never closes as code to the end", () => {
    expect(prose("a\n```\nZain\nmore")).toBe("a");
  });
});

describe("topicsFor", () => {
  it("gives 1 to the note that proposes the topic itself", () => {
    expect(
      topicsFor(
        note("Employers/Zain/_Index.md", {
          frontmatter: { type: "client-entity" },
        }),
        ready,
      ),
    ).toEqual([{ id: "z", confidence: 1 }]);
  });

  it("gives 0.9 for a folder in the path, by name or alias, and not for the file's own name", () => {
    expect(topicsFor(note("sources/zain/vendors/x.md"), ready)).toEqual([
      { id: "z", confidence: 0.9 },
    ]);
    expect(topicsFor(note("outputs/ZainTech/deck.md"), ready)).toEqual([
      { id: "z", confidence: 0.9 },
    ]);
    expect(topicsFor(note("notes/zain.md"), ready)).toEqual([]);
  });

  it("gives 0.9 for a tag, with dashes read as spaces", () => {
    expect(
      topicsFor(
        note("a.md", { frontmatter: { tags: ["terra-drone", "kuwait"] } }),
        ready,
      ),
    ).toEqual([{ id: "t", confidence: 0.9 }]);
  });

  it("gives 0.7 for whole words in the title", () => {
    expect(
      topicsFor(note("a.md", { title: "Zain: proposal v2" }), ready),
    ).toEqual([{ id: "z", confidence: 0.7 }]);
    expect(topicsFor(note("a.md", { title: "Zainab's notes" }), ready)).toEqual(
      [],
    );
  });

  it("gives 0.5 for whole words in the text, outside code, for names of four characters or more", () => {
    expect(
      topicsFor(note("a.md", { body: "Met Terra Drone today." }), ready),
    ).toEqual([{ id: "t", confidence: 0.5 }]);
    expect(
      topicsFor(note("a.md", { body: "```\nTerra Drone\n```" }), ready),
    ).toEqual([]);
    const short = prepare([
      topic("e", "client", "e&"),
      topic("o", "client", "Oxy"),
    ]);
    expect(topicsFor(note("a.md", { body: "e& and Oxy" }), short)).toEqual([]);
    expect(topicsFor(note("a.md", { title: "Oxy deck" }), short)).toEqual([
      { id: "o", confidence: 0.7 },
    ]);
  });

  it("keeps the strongest signal of a topic, once", () => {
    expect(
      topicsFor(
        note("sources/zain/x.md", { title: "Zain", body: "Zain Zain" }),
        ready,
      ),
    ).toEqual([{ id: "z", confidence: 0.9 }]);
  });

  it("keeps five topics: strongest first, then by kind, then by name", () => {
    const many = prepare([
      topic("s1", "subject", "Alpha"),
      topic("v1", "vendor", "Bravo"),
      topic("c2", "client", "Delta"),
      topic("c1", "client", "Charlie"),
      topic("p1", "person", "Echo"),
      topic("s2", "subject", "Foxtrot"),
      topic("x", "client", "Golf"),
    ]);
    const hits = topicsFor(
      note("Golf/a.md", { body: "Alpha Bravo Charlie Delta Echo Foxtrot" }),
      many,
    );
    expect(hits.map((h) => h.id)).toEqual(["x", "c1", "c2", "v1", "p1"]);
    expect(hits[0]!.confidence).toBe(0.9);
  });

  it("never matches a topic whose name is under three characters", () => {
    expect(
      topicsFor(
        note("ab/x.md", { title: "ab" }),
        prepare([topic("a", "client", "AB")]),
      ),
    ).toEqual([]);
  });
});
````

- [ ] **Step 9: Run and see them fail**

Run: `cd web && npx vitest run src/topics/match.test.ts`
Expected: FAIL, cannot find `./match`.

- [ ] **Step 10: Implement matching**

`web/src/topics/match.ts`:

```ts
// Which topics a note is attached to. Pure. A note's text is compared with topic names and
// nothing else is done with it.
import { headOf, MIN_NAME, proposalOf } from "./candidates";
import { normal } from "./normal";
import {
  KINDS,
  MAX_TOPICS_PER_NOTE,
  type Hit,
  type Kind,
  type Topic,
} from "./types";

/** A name must be this long, once normalised, to be looked for in a note's text. */
const MIN_IN_TEXT = 4;

/** A topic ready for comparing: its own name's key, and the keys of its name and aliases. */
export type Ready = {
  id: string;
  kind: Kind;
  name: string;
  own: string;
  keys: string[];
};

export function prepare(topics: Topic[]): Ready[] {
  return topics.map((t) => {
    const own = normal(t.name);
    const keys = [...new Set([own, ...t.aliases.map(normal)])].filter(
      (k) => k.length >= MIN_NAME,
    );
    return { id: t.id, kind: t.kind, name: t.name, own, keys };
  });
}

/** A note's text without its fenced code blocks and inline code. */
export function prose(body: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length)
        fence = null;
      continue;
    }
    if (m) {
      fence = m[1]!;
      continue;
    }
    out.push(line.replace(/`[^`\n]*`/g, " "));
  }
  return out.join("\n");
}

/** Up to five topics for one note, strongest first. */
export function topicsFor(
  note: { path: string; title: string; body: string; frontmatter: unknown },
  ready: Ready[],
): Hit[] {
  const head = headOf(note.path, note.title, note.frontmatter);
  const own = proposalOf(head);
  const ownKey = own ? `${own.kind}|${normal(own.name)}` : null;
  const folders = new Set(note.path.split("/").slice(0, -1).map(normal));
  const tags = new Set(head.tags.map(normal));
  const title = ` ${normal(note.title)} `;
  const text = ` ${normal(prose(note.body))} `;

  const found: { t: Ready; confidence: number }[] = [];
  for (const t of ready) {
    if (t.keys.length === 0) continue;
    let confidence = 0;
    if (ownKey === `${t.kind}|${t.own}`) confidence = 1;
    else if (t.keys.some((k) => folders.has(k) || tags.has(k)))
      confidence = 0.9;
    else if (t.keys.some((k) => title.includes(` ${k} `))) confidence = 0.7;
    else if (
      t.keys.some((k) => k.length >= MIN_IN_TEXT && text.includes(` ${k} `))
    )
      confidence = 0.5;
    if (confidence > 0) found.push({ t, confidence });
  }
  found.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      KINDS.indexOf(a.t.kind) - KINDS.indexOf(b.t.kind) ||
      (a.t.name < b.t.name ? -1 : a.t.name > b.t.name ? 1 : 0),
  );
  return found
    .slice(0, MAX_TOPICS_PER_NOTE)
    .map(({ t, confidence }) => ({ id: t.id, confidence }));
}
```

- [ ] **Step 11: Run all three, format, typecheck**

Run: `cd web && npx vitest run src/topics && npx prettier --write src/topics && npx tsc --noEmit`
Expected: all tests PASS, no type errors. If prettier reflows a test file, run the tests once more.

- [ ] **Step 12: Commit**

```bash
git add web/src/topics
git commit -m "feat(topics): the rules that find topics in notes and match notes to them"
```

---

### Task 2: The database

**Files:**

- Create: `supabase/migrations/<stamp>_topics.sql` (minted in Step 1)
- Modify: `tests/sharing-rules.test.mjs` (append at the end)

**Interfaces:**

- Consumes: nothing.
- Produces: `entity_type` values `vendor` and `subject`; trigger refusals `a topic needs a name`, `that topic name is too long`, `that topic alias is too long`, `a topic has at most 20 aliases`, `this hive already has 2000 topics`; column `note_entities.detached_at timestamptz`; policy `note_entities_update` (the note's owner, as a person; only `detached_at` may be updated).

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh topics`
Expected: prints the new file's path, `supabase/migrations/<stamp>_topics.sql`. Use that exact file below.

- [ ] **Step 2: Write the failing tests**

Append to `tests/sharing-rules.test.mjs`:

```js
// ---------------------------------------------------------------- topics
// <stamp>_topics.sql. A topic is a row of public.entities; a note is attached
// to it by a row of public.note_entities.

const TP_POLICY = /row-level security/;
const addTopic = (who, hiveId, kind, name, aliases = []) =>
  as(
    who,
    `insert into public.entities (hive_id, type, canonical_name, aliases)
     values ($1, $2, $3, $4) returning id, canonical_name, aliases`,
    [hiveId, kind, name, aliases],
  ).then((r) => r[0]);
const tpNote = (name, path) =>
  as(
    person(name),
    `insert into public.notes (hive_id, member_id, workspace_id, path, title, body)
     values ($1, $2, $3, $4, $4, 'text') returning id`,
    [hive, members[name], ws[name], path],
  ).then((r) => r[0].id);
const attachTopic = (who, note, topic, confidence = 0.9) =>
  as(
    who,
    `insert into public.note_entities (note_id, entity_id, confidence)
     values ($1, $2, $3) returning note_id`,
    [note, topic, confidence],
  );
const detachTopic = (who, note, topic, at = "2026-11-24T12:00:00Z") =>
  as(
    who,
    `update public.note_entities set detached_at = $3
      where note_id = $1 and entity_id = $2 returning note_id`,
    [note, topic, at],
  );
const pairsOf = (who, note) =>
  as(
    who,
    `select entity_id, detached_at is not null as detached
       from public.note_entities where note_id = $1`,
    [note],
  );
// Refused outright or answered with no row, by the grants and the policies.
const nothingDone = async (run) => {
  const out = await run.catch((e) => e);
  assert.ok(
    Array.isArray(out)
      ? out.length === 0
      : /row-level security|permission denied/.test(String(out)),
    String(out),
  );
};

test("only the hive's owner, as a person, makes a topic; a vendor and a subject are kinds", async () => {
  const vendor = await addTopic(
    person("dani"),
    hive,
    "vendor",
    "tp Terra Drone",
  );
  const subject = await addTopic(
    person("dani"),
    hive,
    "subject",
    "tp Flare inspection",
  );
  assert.ok(vendor.id && subject.id);

  await assert.rejects(
    addTopic(person("ahmed"), hive, "vendor", "tp By Ahmed"),
    TP_POLICY,
  );
  await assert.rejects(
    addTopic(await agentFor("dani"), hive, "vendor", "tp By an agent"),
    TP_POLICY,
  );
  await assert.rejects(
    addTopic(passOf(person("dani")), hive, "vendor", "tp By an app"),
    TP_POLICY,
  );

  // Every member of the hive reads the list; nobody outside it does.
  const seen = async (who) =>
    (
      await as(who, `select id from public.entities where id = any($1)`, [
        [vendor.id, subject.id],
      ])
    ).length;
  assert.equal(await seen(person("ahmed")), 2);
  assert.equal(await seen(person("outsider")), 0);
});

test("a topic's name and aliases are trimmed and bounded", async () => {
  const dani = person("dani");
  for (const name of ["", "   ", null])
    await assert.rejects(
      addTopic(dani, hive, "client", name),
      /a topic needs a name/,
    );
  await assert.rejects(
    addTopic(dani, hive, "client", "x".repeat(81)),
    /that topic name is too long/,
  );
  const made = await addTopic(dani, hive, "client", "  tp Zain \t", [
    " ZainTech ",
    "",
    "ZainTech",
    "Zain KSA",
  ]);
  assert.equal(made.canonical_name, "tp Zain");
  assert.deepEqual(made.aliases, ["ZainTech", "Zain KSA"]);

  await assert.rejects(
    addTopic(dani, hive, "client", "tp Long alias", ["y".repeat(81)]),
    /that topic alias is too long/,
  );
  await assert.rejects(
    addTopic(
      dani,
      hive,
      "client",
      "tp Many aliases",
      Array.from({ length: 21 }, (_, i) => `alias ${i}`),
    ),
    /a topic has at most 20 aliases/,
  );
  // The same name of the same kind, once trimmed, is the same topic.
  await assert.rejects(
    addTopic(dani, hive, "client", " tp Zain "),
    /unique|duplicate/,
  );
});

test("a hive has at most 2000 topics, and nobody outside learns how many it has", async () => {
  const who = await hivePerson();
  const full = await startHive(who, `Topics cap ${Date.now()}`);
  await asDbOwner(
    null,
    `insert into public.entities (hive_id, type, canonical_name)
     select $1, 'subject', 'cap ' || g from generate_series(1, 2000) g`,
    [full],
  );
  await assert.rejects(
    addTopic(who, full, "subject", "One too many"),
    /this hive already has 2000 topics/,
  );
  // The trigger binds the database's owner as well.
  await assert.rejects(
    asDbOwner(
      null,
      `insert into public.entities (hive_id, type, canonical_name) values ($1, 'subject', 'Also too many')`,
      [full],
    ),
    /this hive already has 2000 topics/,
  );
  // Somebody who does not own the hive gets the policy's answer, not the count.
  const stranger = await addTopic(
    person("ahmed"),
    full,
    "subject",
    "Probe",
  ).catch((e) => e);
  assert.match(String(stranger), TP_POLICY);
  assert.doesNotMatch(String(stranger), /2000/);
});

test("a person attaches their own notes; a colleague reads a note's topics only with the note", async () => {
  const topic = await addTopic(
    person("dani"),
    hive,
    "client",
    "tp Attach client",
  );
  const note = await tpNote("ahmed", "tp/attach.md");

  await assert.rejects(attachTopic(person("dani"), note, topic.id), TP_POLICY);
  assert.equal((await attachTopic(person("ahmed"), note, topic.id)).length, 1);
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: false },
  ]);

  // The note is private: Sara reads neither it nor what it is attached to.
  assert.deepEqual(await pairsOf(person("sara"), note), []);
  // Shared with the hive's group, the way the sharing tests above this one do it. If this
  // statement is refused, copy the share from "every sharing change leaves one audit row".
  await as(
    person("ahmed"),
    `update public.notes set visibility = 'group' where id = $1`,
    [note],
  );
  assert.deepEqual(await pairsOf(person("sara"), note), [
    { entity_id: topic.id, detached: false },
  ]);
});

test("only the note's owner, as a person, detaches and re-attaches; nothing else of the pair changes", async () => {
  const topic = await addTopic(
    person("dani"),
    hive,
    "client",
    "tp Detach client",
  );
  const note = await tpNote("ahmed", "tp/detach.md");
  await attachTopic(person("ahmed"), note, topic.id);

  await nothingDone(detachTopic(person("dani"), note, topic.id));
  await nothingDone(detachTopic(person("sara"), note, topic.id));
  await nothingDone(detachTopic(await agentFor("ahmed"), note, topic.id));
  await nothingDone(detachTopic(passOf(person("ahmed")), note, topic.id));
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: false },
  ]);

  assert.equal((await detachTopic(person("ahmed"), note, topic.id)).length, 1);
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: true },
  ]);
  // A detached pair is still a pair: a second insert cannot bring it back.
  await assert.rejects(
    attachTopic(person("ahmed"), note, topic.id),
    /unique|duplicate/,
  );
  // Only detached_at may be written.
  await assert.rejects(
    as(
      person("ahmed"),
      `update public.note_entities set confidence = 0.1 where note_id = $1 and entity_id = $2`,
      [note, topic.id],
    ),
    /permission denied/,
  );
  // Clearing it attaches the note again.
  assert.equal(
    (await detachTopic(person("ahmed"), note, topic.id, null)).length,
    1,
  );
  assert.deepEqual(await pairsOf(person("ahmed"), note), [
    { entity_id: topic.id, detached: false },
  ]);
});

test("a note and its topic are in one hive, and a hive that is being deleted takes neither", async () => {
  const other = (
    await db.query(
      `select h.id from public.hives h join public.members m on m.hive_id = h.id
        where m.user_id = $1 and h.name = 'Other hive'`,
      [users.outsider],
    )
  ).rows[0].id;
  const foreign = await addTopic(
    person("outsider"),
    other,
    "client",
    "tp Foreign",
  );
  const note = await tpNote("dani", "tp/one-hive.md");
  await assert.rejects(attachTopic(person("dani"), note, foreign.id));

  const who = await hivePerson();
  const name = `Topics frozen ${Date.now()}`;
  const closing = await startHive(who, name);
  const kept = await addTopic(who, closing, "client", "Before closing");
  await as(who, `select public.request_hive_deletion($1, $2)`, [closing, name]);
  await assert.rejects(
    addTopic(who, closing, "client", "After closing"),
    FROZEN,
  );
  await assert.rejects(
    as(who, `delete from public.entities where id = $1 returning id`, [
      kept.id,
    ]),
    FROZEN,
  );
});
```

- [ ] **Step 3: Run and see them fail**

Run: `node --test --test-name-pattern="topic" tests/sharing-rules.test.mjs 2>&1 | grep -E "^✖|^✔|^ℹ (pass|fail)"`
Expected: the six new tests FAIL (invalid enum value `vendor`, no column `detached_at`).

- [ ] **Step 4: Write the migration**

Replace the minted file's body, keeping its first three header lines:

```sql
-- What this migration does:
--   Topics. A topic is a row of public.entities (shown as "topic" in the app);
--   a note is attached to a topic by a row of public.note_entities. Both
--   tables and their policies exist since the first migration and were empty.
--   The app is about to fill them, so this adds what they need.
--
--   - entity_type gains 'vendor' and 'subject'. Neither is used in this file.
--   - topic_rules(), one trigger function, attached to public.entities as
--     zzzz_topic_rules, before insert and before an update of the name or the
--     aliases, for each row. It binds every writer alike.
--       The name is trimmed of white space at the ends and stored that way;
--       it is 1 to 80 characters. Refusals: 'a topic needs a name',
--       'that topic name is too long'.
--       Each alias is trimmed; an empty one and a repeated one are dropped;
--       one over 80 characters is refused with 'that topic alias is too
--       long'; more than 20 with 'a topic has at most 20 aliases'.
--       A hive has at most 2,000 topics: one more is refused with
--       'this hive already has 2000 topics'. The count is made under a lock
--       for the hive, held until the transaction ends. A caller that comes
--       through the API (the session's role is anon or authenticated) and
--       does not own the hive is not counted for: entities_insert refuses
--       that row anyway, and the answer then says nothing about the hive.
--     It runs after zz_hive_frozen and zzz_one_hive, by its name, so a hive
--     that is being deleted still answers 'this hive is being deleted'.
--   - note_entities gains detached_at: null while the note is attached. A row
--     that is detached stays, so the pair cannot be attached again by an
--     insert: the note's owner said no, and the next run respects it.
--   - note_entities_update: the note's owner, signed in as a person (never an
--     agent; an app pass is refused by note_entities_no_app as everywhere),
--     may update a row, and the column grant lets only detached_at be
--     written. Insert, delete and select are unchanged.
--
--   Nobody reads anything they could not read before: a topic's name is the
--   hive's (entities_select), and a note's topics follow the note
--   (note_entities_select). The count reads entities by hive_id, the leading
--   column of the unique (hive_id, type, canonical_name).

alter type public.entity_type add value if not exists 'vendor';
alter type public.entity_type add value if not exists 'subject';

create function public.topic_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_space constant text := E' \t\n\r\f\x0B';
  v_name text := btrim(coalesce(new.canonical_name, ''), v_space);
  v_aliases text[] := '{}';
  v_alias text;
begin
  if v_name = '' then
    raise exception 'a topic needs a name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'that topic name is too long';
  end if;
  new.canonical_name := v_name;

  foreach v_alias in array coalesce(new.aliases, '{}'::text[]) loop
    v_alias := btrim(coalesce(v_alias, ''), v_space);
    if v_alias = '' or v_alias = any (v_aliases) then
      continue;
    end if;
    if char_length(v_alias) > 80 then
      raise exception 'that topic alias is too long';
    end if;
    v_aliases := v_aliases || v_alias;
  end loop;
  if cardinality(v_aliases) > 20 then
    raise exception 'a topic has at most 20 aliases';
  end if;
  new.aliases := v_aliases;

  if tg_op = 'INSERT' then
    if coalesce(pg_catalog.current_setting('role', true), '') in ('anon', 'authenticated')
       and not public.is_hive_owner(new.hive_id) then
      return new;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('topic_cap:' || new.hive_id::text, 0));
    if (select count(*) from public.entities e where e.hive_id = new.hive_id) >= 2000 then
      raise exception 'this hive already has 2000 topics';
    end if;
  end if;
  return new;
end
$$;

create trigger zzzz_topic_rules before insert or update of canonical_name, aliases
  on public.entities for each row execute function public.topic_rules();

-- The database's own: a trigger function is never called by hand.
revoke all on function public.topic_rules() from public, anon, authenticated;

alter table public.note_entities add column detached_at timestamptz;

create policy note_entities_update on public.note_entities for update to authenticated
  using (public.jwt_agent_id() is null
         and exists (select 1 from public.notes n
                      where n.id = note_id
                        and n.member_id in (select public.my_member_ids())))
  with check (public.jwt_agent_id() is null
              and exists (select 1 from public.notes n
                           where n.id = note_id
                             and n.member_id in (select public.my_member_ids())));

revoke update on public.note_entities from authenticated;
grant update (detached_at) on public.note_entities to authenticated;
```

- [ ] **Step 5: Run the new tests, then the whole file**

Run: `node --test tests/sharing-rules.test.mjs 2>&1 | grep -E "^✖|^ℹ (tests|pass|fail)"`
Expected: `fail 0`. If an older test fails because it lists every trigger or every column of `entities` or `note_entities` (the freeze tests do), read its message and add the new trigger or column to that test's expected list; do not change the migration to suit it.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write tests/sharing-rules.test.mjs
git add supabase/migrations/*_topics.sql tests/sharing-rules.test.mjs
git commit -m "feat(db): vendor and subject topics, bounds on topics, and detaching a note from one"
```

---

### Task 3: The attach step (server)

**Files:**

- Create: `web/src/app/vault/attach.ts`
- Modify: `web/src/app/vault/connect.ts` (export two helpers), `web/src/app/vault/actions.ts` (one action)
- Test: `web/src/app/vault/attach.test.ts`

**Interfaces:**

- Consumes: `prepare`, `topicsFor` (`web/src/topics/match.ts`); `KINDS`, `MAX_TOPICS_PER_NOTE`, `AttachResult`, `Kind`, `Topic` (`web/src/topics/types.ts`); `failed`, `ownWorkspace`, `rows`, `userId`, `Db`, `Res` (`./import`); `isUuid` (`./validate`).
- Produces: `attachBatchIn(db: Db, workspaceId: unknown, after: unknown): Promise<AttachResult>`; server action `attachTopics(workspaceId: string, after: string | null): Promise<AttachResult>`.

- [ ] **Step 1: Export the paging helpers from the connect step**

In `web/src/app/vault/connect.ts`, change `async function paged(` to `export async function paged(` and `const counting = (` to `export const counting = (`. Nothing else in that file changes.

Run: `cd web && npx vitest run src/app/vault/connect.test.ts` — Expected: PASS, as before.

- [ ] **Step 2: Write the failing tests**

`web/src/app/vault/attach.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachBatchIn } from "./attach";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const UID = "00000000-0000-4000-8000-0000000000aa";
const W1 = "00000000-0000-4000-8000-000000000b01";
const ZAIN = "00000000-0000-4000-8000-0000000000e1";
const TERRA = "00000000-0000-4000-8000-0000000000e2";

type Err = { message: string; code?: string };
type Res = { data: unknown; error: Err | null; count?: unknown };
type Row = Record<string, unknown>;
type Call = { table: string; ops: [string, unknown[]][] };

const nid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const op = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];
const note = (n: number, path: string, over: Row = {}): Row => ({
  id: nid(n),
  workspace_id: W1,
  member_id: ME,
  path,
  title: "Untitled",
  body: "",
  frontmatter: {},
  ...over,
});
const TOPICS: Row[] = [
  {
    id: ZAIN,
    hive_id: HIVE,
    type: "client",
    canonical_name: "Zain",
    aliases: ["ZainTech"],
  },
  {
    id: TERRA,
    hive_id: HIVE,
    type: "vendor",
    canonical_name: "Terra Drone",
    aliases: [],
  },
];

/** A small database in memory, speaking the part of the client the step uses. */
function fake(
  opts: {
    user?: { id: string } | null;
    workspaces?: Row[];
    entities?: Row[];
    notes?: Row[];
    pairs?: Row[];
    fail?: (c: Call) => Res | undefined;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    workspaces: opts.workspaces ?? [{ id: W1, hive_id: HIVE, member_id: ME }],
    members: [{ id: ME, hive_id: HIVE, user_id: UID }],
    entities: opts.entities ?? TOPICS,
    notes: opts.notes ?? [],
    note_entities: opts.pairs ?? [],
  };
  const calls: Call[] = [];
  const run = (c: Call): Res => {
    const said = opts.fail?.(c);
    if (said) return said;
    const table = tables[c.table]!;
    const inserted = op(c, "insert")?.[0] as Row[] | undefined;
    if (inserted) {
      for (const r of inserted)
        if (
          table.some(
            (p) => p.note_id === r.note_id && p.entity_id === r.entity_id,
          )
        )
          return {
            data: null,
            error: { message: "duplicate key", code: "23505" },
          };
      table.push(...inserted.map((r) => ({ detached_at: null, ...r })));
      return { data: null, error: null };
    }
    let hit = table.filter((r) =>
      c.ops.every(([m, a]) => {
        if (m === "eq") return r[a[0] as string] === a[1];
        if (m === "gt") return String(r[a[0] as string]) > String(a[1]);
        if (m === "in") return (a[1] as unknown[]).includes(r[a[0] as string]);
        return true;
      }),
    );
    const by = c.ops
      .filter(([m]) => m === "order")
      .map(([, a]) => a[0] as string);
    if (by.length > 0)
      hit = [...hit].sort((x, y) => {
        for (const k of by) {
          if (String(x[k]) < String(y[k])) return -1;
          if (String(x[k]) > String(y[k])) return 1;
        }
        return 0;
      });
    const asked = op(c, "select")?.[1] as
      { count?: string; head?: boolean } | undefined;
    const count = asked?.count === "exact" ? hit.length : undefined;
    if (asked?.head) return { data: null, error: null, count };
    const range = op(c, "range") as [number, number] | undefined;
    if (range) hit = hit.slice(range[0], range[1] + 1);
    const limit = op(c, "limit")?.[0] as number | undefined;
    if (limit !== undefined) hit = hit.slice(0, limit);
    return { data: hit, error: null, count };
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "insert",
      "eq",
      "gt",
      "in",
      "order",
      "range",
      "limit",
    ])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
      new Promise<Res>((resolve) => resolve(run(call))).then(ok, no);
    return chain;
  });
  const user = opts.user === undefined ? { id: UID } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, auth } as never, calls, tables, from, auth };
}

const pairs = (t: { tables: Record<string, Row[]> }) =>
  t.tables
    .note_entities!.map((p) => `${p.note_id}>${p.entity_id}@${p.confidence}`)
    .sort();

afterEach(() => vi.restoreAllMocks());

describe("attachBatchIn", () => {
  it.each([
    ["a workspace id that is a word", "nope", null],
    ["a workspace id with a filter appended", `${W1},x`, null],
    ["a cursor that is a number", W1, 7],
    ["an empty cursor", W1, ""],
    ["a cursor over 4000 characters", W1, "x".repeat(4001)],
    ["a cursor with a NUL", W1, "a\u0000b"],
  ])("refuses %s before any query", async (_name, ws, after) => {
    const t = fake();
    expect(await attachBatchIn(t.db, ws, after)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(t.auth.getUser).not.toHaveBeenCalled();
  });

  it("refuses without a session and for a workspace that is not the person's own", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await attachBatchIn(fake({ user: null }).db, W1, null)).toEqual({
      ok: false,
    });
    const other = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: nid(99) }],
    });
    expect(await attachBatchIn(other.db, W1, null)).toEqual({ ok: false });
    expect(other.tables.note_entities).toEqual([]);
  });

  it("with no topics in the hive, reads no note and says so", async () => {
    const t = fake({ entities: [], notes: [note(1, "a.md")] });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({
      ok: true,
      next: null,
      total: 0,
      scanned: 0,
      attached: 0,
      already: 0,
      none: 0,
      failed: 0,
      topics: 0,
    });
    expect(t.calls.some((c) => c.table === "notes")).toBe(false);
  });

  it("attaches each note to its topics with the rule's confidence, and counts", async () => {
    const t = fake({
      notes: [
        note(1, "sources/zain/a.md"),
        note(2, "b.md", {
          title: "Terra Drone brochure",
          body: "for ZainTech",
        }),
        note(3, "c.md", { body: "nothing here" }),
      ],
    });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({
      ok: true,
      next: null,
      total: 3,
      scanned: 3,
      attached: 3,
      already: 0,
      none: 1,
      failed: 0,
      topics: 2,
    });
    expect(pairs(t)).toEqual(
      [
        `${nid(1)}>${ZAIN}@0.9`,
        `${nid(2)}>${TERRA}@0.7`,
        `${nid(2)}>${ZAIN}@0.5`,
      ].sort(),
    );
  });

  it("leaves a pair that is there, counts it, and never brings back a detached one", async () => {
    const t = fake({
      notes: [note(1, "sources/zain/a.md", { title: "Terra Drone" })],
      pairs: [
        {
          note_id: nid(1),
          entity_id: ZAIN,
          confidence: 0.9,
          detached_at: null,
        },
        {
          note_id: nid(1),
          entity_id: TERRA,
          confidence: 0.7,
          detached_at: "2026-11-24T12:00:00Z",
        },
      ],
    });
    const out = await attachBatchIn(t.db, W1, null);
    expect(out).toMatchObject({ ok: true, attached: 0, already: 1, none: 0 });
    expect(t.tables.note_entities).toHaveLength(2);
    expect(t.calls.some((c) => op(c, "insert"))).toBe(false);
  });

  it("counts a note whose only topic was detached as having none", async () => {
    const t = fake({
      notes: [note(1, "sources/zain/a.md")],
      pairs: [
        {
          note_id: nid(1),
          entity_id: ZAIN,
          confidence: 0.9,
          detached_at: "2026-11-24T12:00:00Z",
        },
      ],
    });
    expect(await attachBatchIn(t.db, W1, null)).toMatchObject({
      attached: 0,
      already: 0,
      none: 1,
    });
  });

  it("reads 40 notes a step in path order and hands back the last path as the cursor", async () => {
    const notes = Array.from({ length: 45 }, (_, i) =>
      note(i + 1, `zain/${String(i).padStart(3, "0")}.md`),
    );
    const t = fake({ notes });
    const first = await attachBatchIn(t.db, W1, null);
    expect(first).toMatchObject({
      ok: true,
      scanned: 40,
      total: 45,
      attached: 40,
      next: "zain/039.md",
    });
    const second = await attachBatchIn(t.db, W1, "zain/039.md");
    expect(second).toMatchObject({
      ok: true,
      scanned: 5,
      attached: 5,
      next: null,
    });
    expect(t.tables.note_entities).toHaveLength(45);
  });

  it("when a chunk is refused, saves the pairs one by one and counts the ones that fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let inserts = 0;
    const t = fake({
      notes: [note(1, "zain/a.md"), note(2, "zain/b.md")],
      fail: (c) => {
        if (c.table !== "note_entities" || !op(c, "insert")) return undefined;
        inserts += 1;
        // The chunk, then the first of the two single inserts.
        return inserts <= 2
          ? { data: null, error: { message: "boom", code: "XX000" } }
          : undefined;
      },
    });
    expect(await attachBatchIn(t.db, W1, null)).toMatchObject({
      attached: 1,
      failed: 1,
    });
  });

  it("refuses the step when the hive is being deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fake({
      notes: [note(1, "zain/a.md")],
      fail: (c) =>
        c.table === "note_entities" && op(c, "insert")
          ? {
              data: null,
              error: { message: "this hive is being deleted", code: "P0001" },
            }
          : undefined,
    });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({ ok: false });
  });

  it("logs no path, title or text when a read fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fake({
      notes: [
        note(1, "secret/path.md", {
          title: "Secret title",
          body: "Secret body",
        }),
      ],
      fail: (c) =>
        c.table === "notes" && !op(c, "select")?.[1]
          ? {
              data: null,
              error: { message: "boom secret/path.md", code: "XX000" },
            }
          : undefined,
    });
    expect(await attachBatchIn(t.db, W1, null)).toEqual({ ok: false });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/secret|Secret/);
  });
});
```

- [ ] **Step 3: Run and see them fail**

Run: `cd web && npx vitest run src/app/vault/attach.test.ts`
Expected: FAIL, cannot find `./attach`.

- [ ] **Step 4: Implement the step**

`web/src/app/vault/attach.ts`:

```ts
// One step of attaching a workspace's notes to the hive's topics, given a client signed in as
// the person. The step is a public endpoint, so both arguments are taken as hostile and checked
// before any query; the hive and the member come from the workspace's own row (the import's
// check, shared), never from the browser. Whether a note may be attached is the database's
// answer: `note_entities_insert` lets a person attach their own note, and the pair's primary key
// refuses one that is already there, attached or detached. Nothing here updates or deletes.
//
// A note's text is compared with topic names and nothing else is done with it. Only an error's
// code is logged, never its message, and never a note's path, title or text. The answer is
// numbers and the next cursor, which is a path of the person's own.
import { prepare, topicsFor } from "../../topics/match";
import {
  KINDS,
  MAX_TOPICS_PER_NOTE,
  type AttachResult,
  type Kind,
  type Topic,
} from "../../topics/types";
import { counting, MAX_CURSOR_CHARS, paged, STEP_NOTES } from "./connect";
import {
  failed,
  ownWorkspace,
  rows,
  userId,
  type Db,
  type Res,
} from "./import";
import { isUuid } from "./validate";

/** The most pairs in one insert. */
const CHUNK = 200;
const UNIQUE_VIOLATION = "23505";
/** What `zz_hive_frozen` says: no insert of this run will go in, so the run stops. */
const SAYS_FROZEN = "this hive is being deleted";

const REFUSED: AttachResult = { ok: false };
const isKind = (v: unknown): v is Kind =>
  (KINDS as readonly unknown[]).includes(v);
const says = (res: Res, words: string): boolean =>
  String(res.error?.message ?? "").includes(words);

export async function attachBatchIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<AttachResult> {
  if (!isUuid(workspaceId)) return REFUSED;
  if (
    after !== null &&
    (typeof after !== "string" ||
      after.length < 1 ||
      after.length > MAX_CURSOR_CHARS ||
      after.includes("\u0000"))
  )
    return REFUSED;
  const uid = await userId(db);
  if (!uid) return REFUSED;
  const wsId = workspaceId.toLowerCase();
  const own = await ownWorkspace(db, wsId, uid);
  if (own === null) return REFUSED;
  const { hiveId, memberId } = own;

  // The hive's topics: at most 2,000, by the database's own cap.
  const listed = await paged(
    "attach topics query",
    "too many topics",
    (from, to, counted) =>
      db
        .from("entities")
        .select("id, type, canonical_name, aliases", counting(counted))
        .eq("hive_id", hiveId)
        .order("id")
        .range(from, to),
  );
  if (listed === null) return REFUSED;
  const topics: Topic[] = listed.flatMap((r): Topic[] =>
    isUuid(r.id) && isKind(r.type) && typeof r.canonical_name === "string"
      ? [
          {
            id: r.id.toLowerCase(),
            kind: r.type,
            name: r.canonical_name,
            aliases: Array.isArray(r.aliases)
              ? r.aliases.filter((a): a is string => typeof a === "string")
              : [],
          },
        ]
      : [],
  );
  const counts = { attached: 0, already: 0, none: 0, failed: 0 };
  if (topics.length === 0)
    return { ok: true, next: null, total: 0, scanned: 0, ...counts, topics: 0 };

  const sized = (await db
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", wsId)
    .eq("member_id", memberId)) as Res & { count?: unknown };
  if (failed("attach count query", sized, true)) return REFUSED;
  const total =
    typeof sized.count === "number" && sized.count >= 0 ? sized.count : 0;

  // This step's notes.
  const all = db
    .from("notes")
    .select("id, path, title, body, frontmatter")
    .eq("workspace_id", wsId)
    .eq("member_id", memberId);
  const read = (await (after === null ? all : all.gt("path", after))
    .order("path")
    .limit(STEP_NOTES)) as Res;
  if (failed("attach notes query", read, true) || !Array.isArray(read.data))
    return REFUSED;
  const notes: { id: string; path: string; row: Record<string, unknown> }[] =
    [];
  for (const row of rows(read))
    if (isUuid(row.id) && typeof row.path === "string")
      notes.push({ id: row.id.toLowerCase(), path: row.path, row });
  if (notes.length !== read.data.length) {
    console.error("attach notes answer has an unexpected shape");
    return REFUSED;
  }
  const answer = (): AttachResult => ({
    ok: true,
    next: notes.length >= STEP_NOTES ? notes[notes.length - 1]!.path : null,
    total,
    scanned: notes.length,
    ...counts,
    topics: topics.length,
  });
  if (notes.length === 0) return answer();

  // The pairs these notes already have, attached or detached. The ids were checked as uuids.
  const ids = notes.map((n) => n.id);
  const had = await paged(
    "attach pairs query",
    "too many pairs",
    (from, to, counted) =>
      db
        .from("note_entities")
        .select("note_id, entity_id, detached_at", counting(counted))
        .in("note_id", ids)
        .order("note_id")
        .order("entity_id")
        .range(from, to),
  );
  if (had === null) return REFUSED;
  const seen = new Map<string, Map<string, boolean>>();
  for (const p of had) {
    if (typeof p.note_id !== "string" || typeof p.entity_id !== "string")
      continue;
    const of = seen.get(p.note_id.toLowerCase()) ?? new Map<string, boolean>();
    of.set(
      p.entity_id.toLowerCase(),
      p.detached_at === null || p.detached_at === undefined,
    );
    seen.set(p.note_id.toLowerCase(), of);
  }

  const ready = prepare(topics);
  const missing: { note_id: string; entity_id: string; confidence: number }[] =
    [];
  for (const note of notes) {
    const of = seen.get(note.id) ?? new Map<string, boolean>();
    const attached = [...of.values()].filter(Boolean).length;
    let room = MAX_TOPICS_PER_NOTE - attached;
    let added = 0;
    const hits = topicsFor(
      {
        path: note.path,
        title: typeof note.row.title === "string" ? note.row.title : "",
        body: typeof note.row.body === "string" ? note.row.body : "",
        frontmatter: note.row.frontmatter,
      },
      ready,
    );
    for (const hit of hits) {
      const there = of.get(hit.id);
      if (there === true) counts.already += 1;
      if (there !== undefined || room <= 0) continue;
      missing.push({
        note_id: note.id,
        entity_id: hit.id,
        confidence: hit.confidence,
      });
      room -= 1;
      added += 1;
    }
    if (attached + added === 0) counts.none += 1;
  }

  for (let at = 0; at < missing.length; at += CHUNK) {
    const chunk = missing.slice(at, at + CHUNK);
    const res = (await db.from("note_entities").insert(chunk)) as Res;
    if (!failed("attach pairs insert", res, true)) {
      counts.attached += chunk.length;
      continue;
    }
    if (says(res, SAYS_FROZEN)) return REFUSED;
    // Find the pairs the database refused; the others still go in.
    for (const pair of chunk) {
      const one = (await db.from("note_entities").insert([pair])) as Res;
      if (!one.error) counts.attached += 1;
      else if (one.error.code === UNIQUE_VIOLATION) counts.already += 1;
      else {
        failed("attach pair insert", one, true);
        if (says(one, SAYS_FROZEN)) return REFUSED;
        counts.failed += 1;
      }
    }
  }
  return answer();
}
```

Two exports this needs from `connect.ts` already exist there as exported constants: `STEP_NOTES` and `MAX_CURSOR_CHARS`. Step 1 exported `paged` and `counting`.

- [ ] **Step 5: Run the tests**

Run: `cd web && npx vitest run src/app/vault/attach.test.ts src/app/vault/connect.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the server action**

In `web/src/app/vault/actions.ts`, add to the imports:

```ts
import type { AttachResult } from "../../topics/types";
import { attachBatchIn } from "./attach";
```

and append:

```ts
/**
 * One step of attaching a workspace's notes to the hive's topics: the 40 notes after the
 * cursor. The arguments are checked in `attach.ts`; the hive and the member come from the
 * workspace's row.
 */
export async function attachTopics(
  workspaceId: string,
  after: string | null,
): Promise<AttachResult> {
  return withSession<AttachResult>({ ok: false }, (db) =>
    attachBatchIn(db, workspaceId, after),
  );
}
```

If `web/src/app/vault/actions.test.ts` exists and lists the file's exports, add `"attachTopics"` to that list in its sorted place.

- [ ] **Step 7: Typecheck, format, commit**

```bash
cd web && npx prettier --write src/app/vault && npx tsc --noEmit && npx vitest run src/app/vault && cd ..
git add web/src/app/vault/attach.ts web/src/app/vault/attach.test.ts web/src/app/vault/connect.ts web/src/app/vault/actions.ts
git commit -m "feat(vault): a server step that attaches 40 of a person's notes to the hive's topics"
```

(Also `git add web/src/app/vault/actions.test.ts` if Step 6 changed it.)

---

### Task 4: Attaching in the browser

**Files:**

- Create: `web/src/vault/attachRun.ts`, `web/src/vault/attachText.ts`, `web/src/vault/Attach.tsx`
- Modify: `web/src/import/types.ts`, `web/src/vault/Import.tsx`, `web/src/vault/Vault.tsx`, `web/src/app/vault/page.tsx`, `web/src/app/dev/vault/DevVault.tsx`
- Test: `web/src/vault/attachRun.test.ts`, `web/src/vault/attachText.test.ts`, `web/e2e/vault.spec.ts`

**Interfaces:**

- Consumes: `AttachResult` (`web/src/topics/types.ts`); server action `attachTopics(workspaceId, after)` (Task 3).
- Produces: `ImportActions.attach(workspaceId: string, after: string | null): Promise<AttachResult>`; `runAttach(attach, workspaceId, on): Promise<{ tally: AttachTally; end: AttachEnd }>`; `<Attach workspace attach onClose onBusy />`.

- [ ] **Step 1: Add `attach` to the import's actions**

In `web/src/import/types.ts`, add at the top `import type { AttachResult } from "../topics/types";` and inside `ImportActions`, after `connect`:

```ts
  /** One step of attaching the workspace's notes to the hive's topics, from the cursor `after`. */
  attach(workspaceId: string, after: string | null): Promise<AttachResult>;
```

- [ ] **Step 2: Write the failing tests for the loop and the sentences**

`web/src/vault/attachRun.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { AttachResult } from "../topics/types";
import { runAttach } from "./attachRun";

const step = (
  over: Partial<Extract<AttachResult, { ok: true }>> = {},
): AttachResult => ({
  ok: true,
  next: null,
  total: 90,
  scanned: 40,
  attached: 30,
  already: 5,
  none: 5,
  failed: 0,
  topics: 12,
  ...over,
});
const on = () => ({ progress: vi.fn(), stop: vi.fn(() => false) });

describe("runAttach", () => {
  it("walks the cursor to the end and adds the counts up", async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce(step({ next: "b.md" }))
      .mockResolvedValueOnce(
        step({ next: null, scanned: 10, attached: 4, already: 1, none: 5 }),
      );
    const o = on();
    expect(await runAttach(attach, "w", o)).toEqual({
      tally: { attached: 34, already: 6, none: 10, failed: 0, topics: 12 },
      end: "finished",
    });
    expect(attach.mock.calls).toEqual([
      ["w", null],
      ["w", "b.md"],
    ]);
    expect(o.progress.mock.calls).toEqual([
      [40, 90],
      [50, 90],
    ]);
  });

  it("ends at once, finished, when the hive has no topics", async () => {
    const attach = vi.fn().mockResolvedValue(
      step({
        topics: 0,
        scanned: 0,
        total: 0,
        attached: 0,
        already: 0,
        none: 0,
      }),
    );
    expect(await runAttach(attach, "w", on())).toEqual({
      tally: { attached: 0, already: 0, none: 0, failed: 0, topics: 0 },
      end: "finished",
    });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("tries a refused step again and gives up after three in a row", async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce(step());
    expect((await runAttach(attach, "w", on())).end).toBe("finished");
    const never = vi.fn().mockResolvedValue({ ok: false });
    expect((await runAttach(never, "w", on())).end).toBe("halted");
    expect(never).toHaveBeenCalledTimes(3);
  });

  it("stops between steps when asked, and halts on a cursor that does not move", async () => {
    const attach = vi.fn().mockResolvedValue(step({ next: "b.md" }));
    const o = on();
    o.stop.mockReturnValue(true);
    expect((await runAttach(attach, "w", o)).end).toBe("stopped");
    expect(attach).toHaveBeenCalledTimes(1);
    const stuck = vi.fn().mockResolvedValue(step({ next: "b.md" }));
    expect((await runAttach(stuck, "w", on())).end).toBe("halted");
  });

  it("takes an answer that is not a step as a refusal", async () => {
    const bad = vi.fn().mockResolvedValue({ ok: true, next: 3, total: "x" });
    expect((await runAttach(bad, "w", on())).end).toBe("halted");
  });
});
```

`web/src/vault/attachText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as a from "./attachText";

describe("the sentences of attaching topics", () => {
  it("counts in the order shown, with the fourth line only when something failed", () => {
    expect(
      a.attachCounts({
        attached: 1234,
        already: 5,
        none: 7,
        failed: 0,
        topics: 3,
      }),
    ).toEqual([
      { label: "Attached to a topic", value: "1,234" },
      { label: "Already attached", value: "5" },
      { label: "Notes with no topic", value: "7" },
    ]);
    expect(
      a.attachCounts({
        attached: 0,
        already: 0,
        none: 0,
        failed: 2,
        topics: 3,
      })[3],
    ).toEqual({ label: "Could not be saved", value: "2" });
  });

  it("says progress in notes read", () => {
    expect(a.attachProgress(40, 90)).toBe("40 of 90 notes read");
    expect(a.attachProgress(1, 1)).toBe("1 of 1 note read");
  });

  it("says where topics come from when the hive has none", () => {
    expect(a.NO_TOPICS).toContain("Settings");
  });
});
```

- [ ] **Step 3: Run and see them fail**

Run: `cd web && npx vitest run src/vault/attachRun.test.ts src/vault/attachText.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the loop and the sentences**

`web/src/vault/attachRun.ts`:

```ts
// The loop a browser runs over the steps that attach a workspace's notes to the hive's topics.
// Each step is one request; the server reads the notes and the database decides what may be
// attached. Nothing here reads a note.
import type { ImportActions } from "../import/types";
import type { AttachResult } from "../topics/types";

export type AttachTally = {
  attached: number;
  already: number;
  none: number;
  failed: number;
  /** The hive's topics, as the last step counted them; 0 means there was nothing to attach to. */
  topics: number;
};
export type AttachEnd = "finished" | "stopped" | "halted";

/** Steps refused one after another before the run gives up. */
export const GIVE_UP_AFTER = 3;

type Step = Extract<AttachResult, { ok: true }>;

const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The step as answered, or null when it was refused or is not a step at all. */
function answered(r: unknown): Step | null {
  if (typeof r !== "object" || r === null) return null;
  const a = r as Partial<Step>;
  if (a.ok !== true) return null;
  if (a.next !== null && typeof a.next !== "string") return null;
  return count(a.total) &&
    count(a.scanned) &&
    count(a.attached) &&
    count(a.already) &&
    count(a.none) &&
    count(a.failed) &&
    count(a.topics)
    ? (a as Step)
    : null;
}

export async function runAttach(
  attach: ImportActions["attach"],
  workspaceId: string,
  on: { progress(done: number, total: number): void; stop(): boolean },
): Promise<{ tally: AttachTally; end: AttachEnd }> {
  const tally: AttachTally = {
    attached: 0,
    already: 0,
    none: 0,
    failed: 0,
    topics: 0,
  };
  let after: string | null = null;
  let done = 0;
  let streak = 0;
  for (;;) {
    let step: Step | null;
    try {
      step = answered(await attach(workspaceId, after));
    } catch {
      step = null;
    }
    if (!step) {
      streak += 1;
      if (streak >= GIVE_UP_AFTER) return { tally, end: "halted" };
      if (on.stop()) return { tally, end: "stopped" };
      continue;
    }
    streak = 0;
    tally.attached += step.attached;
    tally.already += step.already;
    tally.none += step.none;
    tally.failed += step.failed;
    tally.topics = step.topics;
    // No topics: the server read no note, and there is nothing to walk.
    if (step.topics === 0) return { tally, end: "finished" };
    done += step.scanned;
    on.progress(done, step.total);
    if (step.next === null || step.scanned === 0)
      return { tally, end: "finished" };
    if (step.next === after) return { tally, end: "halted" };
    if (on.stop()) return { tally, end: "stopped" };
    after = step.next;
  }
}
```

`web/src/vault/attachText.ts`:

```ts
// Every sentence of attaching topics: the panel behind the vault's button, and the stage a
// folder import ends with. Copy is fixed; the numbers come from what the server answered.
import type { AttachTally } from "./attachRun";
import { num } from "./importText";

export const ATTACH = "Attach topics";
export const ATTACH_INTRO =
  "Puts each of your notes in this workspace under the hive's topics it belongs to, by its folder, tags, title and text. Only your own notes are attached. A topic you removed from a note stays removed.";
export const START = "Attach";
export const ATTACHING = "Attaching topics";
export const ATTACHED = "Topics attached";
export const ATTACH_STOPPED = "Attaching stopped";
export const ATTACH_HALTED =
  "Three steps in a row could not be saved, so attaching stopped. What was attached stays. Attach again to finish the rest.";
export const NO_TOPICS =
  "This hive has no topics yet. Its owner finds them in Settings, under Topics.";
export const AFTER_IMPORT_UNFINISHED =
  "Not every note was attached to its topics. Open the workspace and press Attach topics to finish.";

/** "120 of 480 notes read" */
export const attachProgress = (done: number, total: number) =>
  `${num(done)} of ${num(total)} ${total === 1 ? "note" : "notes"} read`;

/** The counts of a run, in the order they are shown; the fourth only when something failed. */
export function attachCounts(
  t: AttachTally,
): { label: string; value: string }[] {
  const counts = [
    { label: "Attached to a topic", value: num(t.attached) },
    { label: "Already attached", value: num(t.already) },
    { label: "Notes with no topic", value: num(t.none) },
  ];
  if (t.failed > 0)
    counts.push({ label: "Could not be saved", value: num(t.failed) });
  return counts;
}
```

Run the two test files — Expected: PASS.

- [ ] **Step 5: The panel**

Create `web/src/vault/Attach.tsx` as a copy of `web/src/vault/Connect.tsx` with exactly these changes, and no others:

1. The header comment becomes: `// The panel behind "Attach topics": one sentence and a Start button, the progress, then the counts. Each step is one request; the server reads the person's own notes and the database decides what may be attached. Nothing here reads a note or sets sharing.`
2. Imports: replace the `connectRun` and `connectText` lines with

   ```ts
   import { runAttach, type AttachEnd, type AttachTally } from "./attachRun";
   import * as c from "./attachText";
   ```

3. In `Stage`, `tally: ConnectTally; end: ConnectEnd` becomes `tally: AttachTally; end: AttachEnd`.
4. The component is `export function Attach({ workspace, attach, onClose, onBusy }` with prop type `attach: ImportActions["attach"];` in place of `connect`.
5. `runConnect(connect, workspace.id, …)` becomes `runAttach(attach, workspace.id, …)`.
6. The title lines become:

   ```ts
   let title = c.ATTACH;
   if (stage.kind === "running") title = c.ATTACHING;
   if (stage.kind === "done")
     title = stage.end === "finished" ? c.ATTACHED : c.ATTACH_STOPPED;
   ```

7. The section's `id` is `"vault-attach"`; the Close button's label is `` `${t.CLOSE}: ${c.ATTACH}` ``.
8. In the ready stage: `{c.ATTACH_INTRO}` and `{c.START}`. In the running stage: `aria-label={c.ATTACHING}` and `c.attachProgress(stage.done, stage.total)`.
9. The done stage's body becomes:

   ```tsx
   {
     stage.end === "halted" && (
       <p role="alert" className={s.refused}>
         {c.ATTACH_HALTED}
       </p>
     );
   }
   {
     stage.tally.topics === 0 && stage.end === "finished" ? (
       <p className={s.sentence}>{c.NO_TOPICS}</p>
     ) : (
       <p className={s.facts}>
         {c.attachCounts(stage.tally).map((n) => (
           <span key={n.label}>
             {n.label} <strong>{n.value}</strong>
           </span>
         ))}
       </p>
     );
   }
   ```

   followed by the unchanged Close button block.

- [ ] **Step 6: The button in the vault**

In `web/src/vault/Vault.tsx`:

1. Imports, beside the Connect ones:

   ```ts
   import { Attach } from "./Attach";
   import { ATTACH } from "./attachText";
   ```

2. `useState<"import" | "connect" | null>(null)` becomes `useState<"import" | "connect" | "attach" | null>(null)`. Update the comment above it to "the import, connecting wiki links, attaching topics, or none; never two."
3. After `const connectOpener = useRef<HTMLButtonElement>(null);` add `const attachOpener = useRef<HTMLButtonElement>(null);`. After `const connecting = …;` add `const attaching = panel === "attach" && connectIn !== null;` (the panel keeps the workspace it was opened on in the same `connectIn` state).
4. After `closeConnect` add:

   ```ts
   function closeAttach() {
     setPanel(null);
     (attachOpener.current ?? importOpener.current)?.focus();
   }
   ```

5. `if (panel === "connect" && !panelBusy) setPanel(null);` becomes `if ((panel === "connect" || panel === "attach") && !panelBusy) setPanel(null);`.
6. Directly after the Connect button's closing `)}` inside `<div className={s.openers}>`, add:

   ```tsx
   {
     ownWorkspace && (
       <button
         ref={attachOpener}
         type="button"
         className={s.secondary}
         aria-expanded={attaching}
         aria-controls={attaching ? "vault-attach" : undefined}
         aria-disabled={panelBusy || undefined}
         onClick={() => {
           if (panelBusy) return;
           if (attaching) closeAttach();
           else {
             setConnectIn(ownWorkspace);
             setPanel("attach");
           }
         }}
       >
         {ATTACH}
       </button>
     );
   }
   ```

7. After the `<Connect … />` block add:

   ```tsx
   {
     importer && attaching && connectIn && (
       <Attach
         workspace={connectIn}
         attach={importer.attach}
         onClose={closeAttach}
         onBusy={setPanelBusy}
       />
     );
   }
   ```

- [ ] **Step 7: The import's third stage**

In `web/src/vault/Import.tsx`:

1. Imports, beside the connect ones:

   ```ts
   import { runAttach, type AttachEnd, type AttachTally } from "./attachRun";
   import * as a from "./attachText";
   ```

2. In `Stage`, after the `connecting` member add:

   ```ts
   // The workspace's topics, after its wiki links.
   | {
       kind: "attaching";
       done: number;
       total: number | null;
       stopping: boolean;
     }
   ```

   and in the `done` member, after `links`, add:

   ```ts
   /** How attaching the topics went; null when the import did not get that far. */
   topics: { tally: AttachTally; end: AttachEnd } | null;
   ```

3. `const running = stage.kind === "running" || stage.kind === "connecting";` becomes `const running = stage.kind === "running" || stage.kind === "connecting" || stage.kind === "attaching";`.
4. Directly after the `if (…) { … links = await runConnect(…); }` block and before `onBusy(false);`, add:

   ```ts
   // The wiki links are connected: attach the workspace's notes to the hive's topics.
   let topics: { tally: AttachTally; end: AttachEnd } | null = null;
   if (links?.end === "finished" && !stop.current && alive.current) {
     setStage({
       kind: "attaching",
       done: 0,
       total: null,
       stopping: stop.current,
     });
     topics = await runAttach(actions.attach, workspace.id, {
       progress: (done, total) =>
         setStage({ kind: "attaching", done, total, stopping: stop.current }),
       stop: () => stop.current || !alive.current,
     });
   }
   ```

   and add `topics,` after `links,` in the final `setStage({ kind: "done", … })`.

5. After `if (stage.kind === "connecting") title = c.CONNECTING;` add `if (stage.kind === "attaching") title = a.ATTACHING;`.
6. `{(stage.kind === "running" || stage.kind === "connecting") && (` becomes `{(stage.kind === "running" || stage.kind === "connecting" || stage.kind === "attaching") && (`, and the status paragraph's expression becomes:

   ```tsx
   {
     stage.kind === "running"
       ? t.progress(stage.done, stage.total)
       : stage.total === null
         ? ""
         : stage.kind === "connecting"
           ? c.connectProgress(stage.done, stage.total)
           : a.attachProgress(stage.done, stage.total);
   }
   ```

7. In the done stage, directly after the `{stage.links && stage.links.end !== "finished" && (…)}` paragraph, add:

   ```tsx
   {
     stage.topics && stage.topics.tally.topics > 0 && (
       <p className={s.facts}>
         {a.attachCounts(stage.topics.tally).map((n) => (
           <span key={n.label}>
             {n.label} <strong>{n.value}</strong>
           </span>
         ))}
       </p>
     );
   }
   {
     stage.topics &&
       stage.topics.tally.topics === 0 &&
       stage.topics.end === "finished" && (
         <p className={s.sentence}>{a.NO_TOPICS}</p>
       );
   }
   {
     stage.topics && stage.topics.end !== "finished" && (
       <p className={s.sentence}>{a.AFTER_IMPORT_UNFINISHED}</p>
     );
   }
   ```

- [ ] **Step 8: Wire the real page and the dev stand-in**

In `web/src/app/vault/page.tsx`: add `attachTopics,` to the import from `"./actions"` and `attach: attachTopics,` after `connect: connectWikiLinks,`.

In `web/src/app/dev/vault/DevVault.tsx`: add `import type { AttachResult } from "../../../topics/types";`, add `failattach: string | null;` and `notopics: boolean;` to the import flags type beside `failconnect`, read both from the query in `web/src/app/dev/vault/page.tsx` exactly as `failconnect` is read (`notopics` is true when the query has `notopics=1`), add `const attachNo = useRef(0);` beside `connectNo`, and after the `connect` stand-in add:

```ts
attach: async (workspaceId, after): Promise<AttachResult> => {
  record("attach", [workspaceId, after]);
  attachNo.current += 1;
  const no = attachNo.current;
  if (slow) await wait(SLOW_BATCH);
  if (importFlags.failattach === "all" || importFlags.failattach === String(no))
    return { ok: false };
  const empty = { attached: 0, already: 0, none: 0, failed: 0 };
  if (importFlags.notopics)
    return { ok: true, next: null, total: 0, scanned: 0, ...empty, topics: 0 };
  // The cursor is how many notes were read before this step.
  const from = after === null ? 0 : Number(after);
  if (!Number.isInteger(from) || from < 0) return { ok: false };
  const scanned = Math.max(0, Math.min(CONNECT_STEP, CONNECT_NOTES - from));
  return {
    ok: true,
    next: scanned === CONNECT_STEP ? String(from + scanned) : null,
    total: CONNECT_NOTES,
    scanned,
    attached: scanned > 0 ? 9 : 0,
    already: scanned > 0 ? 3 : 0,
    none: scanned > 0 ? 4 : 0,
    failed: 0,
    topics: 12,
  };
},
```

- [ ] **Step 9: Browser tests**

In `web/e2e/vault.spec.ts` add `import * as A from "../src/vault/attachText";` beside the `C` import, and append:

```ts
// ---- Attach topics ----

const attachButton = (page: Page) =>
  page.getByRole("button", { name: A.ATTACH, exact: true });
const attachCalls = async (page: Page) =>
  ((await calls(page)) as { name: string; args: unknown[] }[])
    .filter((c) => c.name === "attach")
    .map((c) => c.args);

test("after connecting the wiki links the import attaches topics and counts them", async ({
  page,
}) => {
  await open(page);
  await pick(page, folder("Field notes", { "a.md": "[[b]]", "b.md": "B" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText("Links made 21", { exact: true })).toBeVisible();
  await expect(
    done.getByText("Attached to a topic 27", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Already attached 9", { exact: true }),
  ).toBeVisible();
  await expect(
    done.getByText("Notes with no topic 12", { exact: true }),
  ).toBeVisible();
  await expect(done.getByText(A.AFTER_IMPORT_UNFINISHED)).toHaveCount(0);
  expect(await attachCalls(page)).toEqual([
    ["imported-1", null],
    ["imported-1", "40"],
    ["imported-1", "80"],
  ]);
  const names = ((await calls(page)) as { name: string }[]).map((c) => c.name);
  expect(names.indexOf("attach")).toBeGreaterThan(names.lastIndexOf("connect"));
});

test("an import into a hive with no topics says where topics come from", async ({
  page,
}) => {
  await open(page, "?notopics=1");
  await pick(page, folder("Field notes", { "a.md": "A" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText(A.NO_TOPICS)).toBeVisible();
  await expect(done.getByText(/Attached to a topic/)).toHaveCount(0);
  expect(await attachCalls(page)).toEqual([["imported-1", null]]);
});

test("an import whose topics could not be attached says where to finish", async ({
  page,
}) => {
  await open(page, "?failattach=all");
  await pick(page, folder("Field notes", { "a.md": "A" }));
  await importPanel(page)
    .getByRole("button", { name: T.START, exact: true })
    .click();
  const done = panelNamed(page, T.FINISHED);
  await expect(done.getByText(A.AFTER_IMPORT_UNFINISHED)).toBeVisible();
  expect(await attachCalls(page)).toHaveLength(3);
});

test("Attach topics on one's own workspace: one sentence, Start, progress, then the counts", async ({
  page,
}) => {
  await open(page);
  await expect(attachButton(page)).toHaveAttribute("aria-expanded", "false");
  await attachButton(page).click();
  const panel = panelNamed(page, A.ATTACH);
  await expect(panel.getByRole("heading", { name: A.ATTACH })).toBeFocused();
  await expect(panel.getByText(A.ATTACH_INTRO)).toBeVisible();
  expect(await nameless(page, "vault-attach")).toEqual([]);
  await panel.getByRole("button", { name: A.START, exact: true }).click();
  const done = panelNamed(page, A.ATTACHED);
  await expect(done.getByRole("heading", { name: A.ATTACHED })).toBeFocused();
  await expect(
    done.getByText("Attached to a topic 27", { exact: true }),
  ).toBeVisible();
  await done.getByRole("button", { name: "Close", exact: true }).click();
  await expect(attachButton(page)).toBeFocused();
  // Not on "Shared with me".
  await page.getByRole("link", { name: "Shared with me" }).click();
  await expect(attachButton(page)).toHaveCount(0);
});
```

`open`, `pick`, `folder`, `importPanel`, `panelNamed`, `calls`, `nameless` and `T` are the helpers the connect tests in this file already use. If the "Shared with me" tab is reached differently in the neighbouring connect test ("Connect wiki links is offered on one's own workspace, not on Shared with me"), copy that test's way of opening it.

Run: `cd web && lsof -nP -iTCP:3100 -sTCP:LISTEN` first. If another session's dev server holds port 3100, wait for it to stop: Playwright reuses whatever answers on that port, and it would be serving another branch's code. Then:

Run: `cd web && npx playwright test e2e/vault.spec.ts --project=chromium`
Expected: every test PASS, including the older connect tests. An older import test that counts the recorded calls may now see `attach` calls too; extend its expected list with them rather than removing the attach stage.

- [ ] **Step 10: Unit tests, typecheck, format, commit**

```bash
cd web && npx prettier --write src/vault src/import src/app/vault src/app/dev/vault e2e/vault.spec.ts && npx tsc --noEmit && npx vitest run && cd ..
git add web/src/vault/attachRun.ts web/src/vault/attachRun.test.ts web/src/vault/attachText.ts web/src/vault/attachText.test.ts web/src/vault/Attach.tsx web/src/vault/Import.tsx web/src/vault/Vault.tsx web/src/import/types.ts web/src/app/vault/page.tsx web/src/app/dev/vault/DevVault.tsx web/src/app/dev/vault/page.tsx web/e2e/vault.spec.ts
git commit -m "feat(vault): Attach topics, from a button and as the import's third stage"
```

---

### Task 5: The owner's topics in Settings

**Files:**

- Create: `web/src/app/settings/topics.ts`, `web/src/settings/Topics.tsx`, `web/src/settings/topicsText.ts`
- Modify: `web/src/settings/types.ts`, `web/src/app/settings/load-settings.ts`, `web/src/app/settings/actions.ts`, `web/src/app/settings/page.tsx`, `web/src/settings/Settings.tsx`, `web/src/settings/fixture.ts`, `web/src/app/dev/settings/DevSettings.tsx`
- Test: `web/src/app/settings/topics.test.ts`, `web/src/settings/topicsText.test.ts`, `web/src/app/settings/load-settings.test.ts`, `web/e2e/settings.spec.ts`

**Interfaces:**

- Consumes: `candidates`, `headOf` (`web/src/topics/candidates.ts`); `normal`; `KINDS`, `SAVE_CHUNK`, `MAX_NAME`, `MAX_ALIASES`, `Candidate`, `Kind`, `NoteHead`, `Proposal`, `ScanResult`, `TopicRow`, `TopicsSaved` (`web/src/topics/types.ts`); `ownWorkspace`, `rows`, `userId` (`web/src/app/vault/import.ts`); `isUuid`.
- Produces: `scanTopicsIn(db, workspaceId, after): Promise<ScanResult>`; `saveTopicsIn(db, hiveId, picks): Promise<TopicsSaved>`; `deleteTopicIn(db, id): Promise<Result>`; `SettingsData.topics: TopicRow[]`; `SettingsActions.scanTopics / saveTopics / deleteTopic`.

- [ ] **Step 1: Write the failing server tests**

`web/src/app/settings/topics.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteTopicIn,
  saveTopicsIn,
  scanTopicsIn,
  SCAN_NOTES,
} from "./topics";

const HIVE = "00000000-0000-4000-8000-000000000a01";
const ME = "00000000-0000-4000-8000-000000000001";
const UID = "00000000-0000-4000-8000-0000000000aa";
const W1 = "00000000-0000-4000-8000-000000000b01";
const T1 = "00000000-0000-4000-8000-0000000000e1";

type Res = { data: unknown; error: { message: string; code?: string } | null };
type Row = Record<string, unknown>;
type Call = { table: string; ops: [string, unknown[]][] };
const op = (c: Call, name: string) => c.ops.find(([m]) => m === name)?.[1];

function fake(
  opts: {
    user?: { id: string } | null;
    workspaces?: Row[];
    notes?: Row[];
    answer?: (c: Call) => Res | undefined;
  } = {},
) {
  const tables: Record<string, Row[]> = {
    workspaces: opts.workspaces ?? [{ id: W1, hive_id: HIVE, member_id: ME }],
    members: [{ id: ME, hive_id: HIVE, user_id: UID }],
    notes: opts.notes ?? [],
    entities: [],
  };
  const calls: Call[] = [];
  const run = (c: Call): Res => {
    const said = opts.answer?.(c);
    if (said) return said;
    let hit = (tables[c.table] ?? []).filter((r) =>
      c.ops.every(([m, a]) => {
        if (m === "eq") return r[a[0] as string] === a[1];
        if (m === "gt") return String(r[a[0] as string]) > String(a[1]);
        return true;
      }),
    );
    const by = op(c, "order")?.[0] as string | undefined;
    if (by)
      hit = [...hit].sort((x, y) => (String(x[by]) < String(y[by]) ? -1 : 1));
    const limit = op(c, "limit")?.[0] as number | undefined;
    if (limit !== undefined) hit = hit.slice(0, limit);
    return { data: hit, error: null };
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "select",
      "upsert",
      "delete",
      "eq",
      "gt",
      "order",
      "limit",
    ])
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    chain.then = (ok: (r: Res) => unknown, no: (e: unknown) => unknown) =>
      new Promise<Res>((resolve) => resolve(run(call))).then(ok, no);
    return chain;
  });
  const user = opts.user === undefined ? { id: UID } : opts.user;
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
  };
  return { db: { from, auth } as never, calls, from, auth };
}

afterEach(() => vi.restoreAllMocks());

describe("scanTopicsIn", () => {
  it("refuses a malformed workspace id or cursor before any query", async () => {
    for (const [ws, after] of [
      ["nope", null],
      [W1, 7],
      [W1, ""],
      [W1, "x".repeat(4001)],
    ] as const) {
      const t = fake();
      expect(await scanTopicsIn(t.db, ws, after)).toEqual({ ok: false });
      expect(t.from).not.toHaveBeenCalled();
    }
  });

  it("refuses without a session and for somebody else's workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await scanTopicsIn(fake({ user: null }).db, W1, null)).toEqual({
      ok: false,
    });
    const other = fake({
      workspaces: [{ id: W1, hive_id: HIVE, member_id: "someone" }],
    });
    expect(await scanTopicsIn(other.db, W1, null)).toEqual({ ok: false });
  });

  it("answers each note's head, never its text, and asks for no text", async () => {
    const t = fake({
      notes: [
        {
          id: "n1",
          workspace_id: W1,
          member_id: ME,
          path: "Employers/Zain/_Index.md",
          title: "Zain Group",
          body: "SECRET",
          frontmatter: {
            type: "client-entity",
            aliases: ["ZainTech"],
            tags: ["kuwait"],
            x: 1,
          },
        },
      ],
    });
    const out = await scanTopicsIn(t.db, W1, null);
    expect(out).toEqual({
      ok: true,
      next: null,
      heads: [
        {
          path: "Employers/Zain/_Index.md",
          title: "Zain Group",
          type: "client-entity",
          aliases: ["ZainTech"],
          tags: ["kuwait"],
        },
      ],
    });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    const read = t.calls.find((c) => c.table === "notes")!;
    expect(op(read, "select")).toEqual(["path, title, frontmatter"]);
  });

  it("reads a page in path order and hands back the last path as the cursor", async () => {
    const notes = Array.from({ length: SCAN_NOTES + 1 }, (_, i) => ({
      id: `n${i}`,
      workspace_id: W1,
      member_id: ME,
      path: `p/${String(i).padStart(4, "0")}.md`,
      title: "t",
      frontmatter: {},
    }));
    const t = fake({ notes });
    const first = await scanTopicsIn(t.db, W1, null);
    if (!first.ok) throw new Error("expected ok");
    expect(first.heads).toHaveLength(SCAN_NOTES);
    expect(first.next).toBe(`p/${String(SCAN_NOTES - 1).padStart(4, "0")}.md`);
    const second = await scanTopicsIn(t.db, W1, first.next);
    expect(second).toMatchObject({ ok: true, next: null });
  });
});

describe("saveTopicsIn", () => {
  const pick = (over: Row = {}) => ({
    kind: "client",
    name: "Zain",
    aliases: ["ZainTech"],
    ...over,
  });

  it.each([
    ["a hive id that is a word", "nope", [pick()]],
    ["picks that are not a list", HIVE, { 0: pick() }],
    ["no picks", HIVE, []],
    [
      "over 200 picks",
      HIVE,
      Array.from({ length: 201 }, (_, i) => pick({ name: `n${i}` })),
    ],
    ["an unknown kind", HIVE, [pick({ kind: "enemy" })]],
    ["an empty name", HIVE, [pick({ name: "  " })]],
    ["a name over 80 characters", HIVE, [pick({ name: "x".repeat(81) })]],
    ["aliases that are not texts", HIVE, [pick({ aliases: [1] })]],
    [
      "over 20 aliases",
      HIVE,
      [pick({ aliases: Array.from({ length: 21 }, (_, i) => `a${i}`) })],
    ],
    ["a pick with a class", HIVE, [new Date()]],
  ])("refuses %s before any query", async (_name, hive, picks) => {
    const t = fake();
    expect(await saveTopicsIn(t.db, hive, picks)).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("inserts known keys only, skips topics that are already there, and counts the new ones", async () => {
    const t = fake({
      answer: (c) =>
        c.table === "entities"
          ? { data: [{ id: T1 }], error: null }
          : undefined,
    });
    const out = await saveTopicsIn(t.db, HIVE.toUpperCase(), [
      { ...pick(), hive_id: "evil", id: "evil" },
      pick({ kind: "vendor", name: " Terra Drone ", aliases: [] }),
    ]);
    expect(out).toEqual({ ok: true, saved: 1 });
    const write = t.calls.find((c) => c.table === "entities")!;
    expect(op(write, "upsert")).toEqual([
      [
        {
          hive_id: HIVE,
          type: "client",
          canonical_name: "Zain",
          aliases: ["ZainTech"],
        },
        {
          hive_id: HIVE,
          type: "vendor",
          canonical_name: "Terra Drone",
          aliases: [],
        },
      ],
      { onConflict: "hive_id,type,canonical_name", ignoreDuplicates: true },
    ]);
    expect(op(write, "select")).toEqual(["id"]);
  });

  it("answers not ok when the database refuses, logging code and message only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fake({
      answer: (c) =>
        c.table === "entities"
          ? {
              data: null,
              error: {
                message: "new row violates row-level security",
                code: "42501",
              },
            }
          : undefined,
    });
    expect(await saveTopicsIn(t.db, HIVE, [pick()])).toEqual({ ok: false });
    expect(error).toHaveBeenCalledWith(
      "topics save failed",
      "42501",
      "new row violates row-level security",
    );
  });
});

describe("deleteTopicIn", () => {
  it("refuses an id that is not a uuid, and a caller with no session", async () => {
    const t = fake();
    expect(await deleteTopicIn(t.db, "nope")).toEqual({ ok: false });
    expect(t.from).not.toHaveBeenCalled();
    expect(await deleteTopicIn(fake({ user: null }).db, T1)).toEqual({
      ok: false,
    });
  });

  it("deletes that one topic, and answers not ok when no row went", async () => {
    const gone = fake({
      answer: (c) =>
        c.table === "entities"
          ? { data: [{ id: T1 }], error: null }
          : undefined,
    });
    expect(await deleteTopicIn(gone.db, T1)).toEqual({ ok: true });
    const call = gone.calls.find((c) => c.table === "entities")!;
    expect(call.ops.map(([m]) => m)).toEqual(["delete", "eq", "select"]);
    expect(op(call, "eq")).toEqual(["id", T1]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const none = fake({
      answer: (c) =>
        c.table === "entities" ? { data: [], error: null } : undefined,
    });
    expect(await deleteTopicIn(none.db, T1)).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd web && npx vitest run src/app/settings/topics.test.ts`
Expected: FAIL, cannot find `./topics`.

- [ ] **Step 3: Implement the server steps**

`web/src/app/settings/topics.ts`:

```ts
// What the owner's topic actions do, given a client signed in as the person. Each is a public
// endpoint: its arguments are taken as hostile and checked before any query, and the database
// decides. Only the hive's owner may make or delete a topic (`entities_insert`,
// `entities_delete`); a scan reads the caller's own notes in one of their own workspaces.
//
// A scan answers each note's path, title and three of its fields (type, aliases, tags), to the
// note's own owner, and never its text. Only an error's code and message are logged.
import { headOf } from "../../topics/candidates";
import {
  KINDS,
  MAX_ALIASES,
  MAX_NAME,
  SAVE_CHUNK,
  type Kind,
  type NoteHead,
  type ScanResult,
  type TopicsSaved,
} from "../../topics/types";
import type { Result } from "../../settings/types";
import { MAX_CURSOR_CHARS } from "../vault/connect";
import {
  failed,
  ownWorkspace,
  rows,
  userId,
  type Db,
  type Res,
} from "../vault/import";
import { isUuid } from "../vault/validate";

/** The notes one scan step reads. */
export const SCAN_NOTES = 500;

/** Fits every answer here: each of them has `{ ok: false }` as its refusal. */
const NO = { ok: false } as const;
const isKind = (v: unknown): v is Kind =>
  (KINDS as readonly unknown[]).includes(v);
const plain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export async function scanTopicsIn(
  db: Db,
  workspaceId: unknown,
  after: unknown,
): Promise<ScanResult> {
  if (!isUuid(workspaceId)) return NO;
  if (
    after !== null &&
    (typeof after !== "string" ||
      after.length < 1 ||
      after.length > MAX_CURSOR_CHARS ||
      after.includes("\u0000"))
  )
    return NO;
  const uid = await userId(db);
  if (!uid) return NO;
  const wsId = workspaceId.toLowerCase();
  const own = await ownWorkspace(db, wsId, uid);
  if (own === null) return NO;

  const all = db
    .from("notes")
    .select("path, title, frontmatter")
    .eq("workspace_id", wsId)
    .eq("member_id", own.memberId);
  const read = (await (after === null ? all : all.gt("path", after))
    .order("path")
    .limit(SCAN_NOTES)) as Res;
  if (failed("topics scan query", read, true) || !Array.isArray(read.data))
    return NO;
  const heads: NoteHead[] = [];
  for (const r of rows(read))
    if (typeof r.path === "string")
      heads.push(
        headOf(
          r.path,
          typeof r.title === "string" ? r.title : "",
          r.frontmatter,
        ),
      );
  if (heads.length !== read.data.length) {
    console.error("topics scan answer has an unexpected shape");
    return NO;
  }
  return {
    ok: true,
    heads,
    next: heads.length >= SCAN_NOTES ? heads[heads.length - 1]!.path : null,
  };
}

type Clean = {
  hive_id: string;
  type: Kind;
  canonical_name: string;
  aliases: string[];
};

/** The picks rebuilt from known keys only, or null when anything about them is malformed. */
function cleanPicks(hiveId: string, raw: unknown): Clean[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > SAVE_CHUNK)
    return null;
  const out: Clean[] = [];
  for (const item of raw as unknown[]) {
    if (!plain(item)) return null;
    const { kind, name, aliases } = item;
    if (!isKind(kind) || typeof name !== "string") return null;
    const canonical = name.trim();
    if (canonical.length < 1 || canonical.length > MAX_NAME) return null;
    if (!Array.isArray(aliases) || aliases.length > MAX_ALIASES) return null;
    const cleaned: string[] = [];
    for (const a of aliases as unknown[]) {
      if (typeof a !== "string" || a.length > MAX_NAME) return null;
      cleaned.push(a);
    }
    out.push({
      hive_id: hiveId,
      type: kind,
      canonical_name: canonical,
      aliases: cleaned,
    });
  }
  return out;
}

/** Saves up to 200 picked candidates as topics of the hive; one that is there already is skipped. */
export async function saveTopicsIn(
  db: Db,
  hiveId: unknown,
  raw: unknown,
): Promise<TopicsSaved> {
  if (!isUuid(hiveId)) return NO;
  const picks = cleanPicks(hiveId.toLowerCase(), raw);
  if (picks === null) return NO;
  if (!(await userId(db))) return NO;
  const res = (await db
    .from("entities")
    .upsert(picks, {
      onConflict: "hive_id,type,canonical_name",
      ignoreDuplicates: true,
    })
    .select("id")) as Res;
  if (res.error) {
    console.error("topics save failed", res.error.code, res.error.message);
    return NO;
  }
  return { ok: true, saved: Array.isArray(res.data) ? res.data.length : 0 };
}

export async function deleteTopicIn(db: Db, id: unknown): Promise<Result> {
  if (!isUuid(id)) return NO;
  if (!(await userId(db))) return NO;
  const wanted = id.toLowerCase();
  const res = (await db
    .from("entities")
    .delete()
    .eq("id", wanted)
    .select("id")) as Res;
  if (res.error) {
    console.error("topic delete failed", res.error.code, res.error.message);
    return NO;
  }
  if (!Array.isArray(res.data) || res.data.length !== 1) {
    console.error("topic delete removed no row");
    return NO;
  }
  return { ok: true };
}
```

`Db` in `../vault/import` is `Pick<SupabaseClient, "from" | "auth">`, which is what these need.

Run: `cd web && npx vitest run src/app/settings/topics.test.ts` — Expected: PASS.

- [ ] **Step 4: Types, loader, actions**

In `web/src/settings/types.ts`:

```ts
import type {
  NoteHead,
  Proposal,
  ScanResult,
  TopicRow,
  TopicsSaved,
} from "../topics/types";
```

add `topics: TopicRow[];` to `SettingsData` with the comment `/** The hive's topics, for its owner; empty for everyone else. */`, and to `SettingsActions`:

```ts
  /** One page of the heads of the person's own notes in a workspace of theirs. */
  scanTopics(workspaceId: string, after: string | null): Promise<ScanResult>;
  /** Saves up to 200 picked candidates as topics of this hive. */
  saveTopics(picks: Proposal[]): Promise<TopicsSaved>;
  deleteTopic(id: string): Promise<Result>;
```

Re-export for the component: `export type { NoteHead, Proposal, ScanResult, TopicRow, TopicsSaved };`.

In `web/src/app/settings/load-settings.ts`, add the parser:

```ts
function toTopic(v: unknown): TopicRow | null {
  if (!row(v)) return null;
  const { id, type, canonical_name, note_entities } = v;
  if (!str(id) || !str(canonical_name)) return null;
  if (!(KINDS as readonly unknown[]).includes(type)) return null;
  return {
    id,
    kind: type as Kind,
    name: canonical_name,
    notes: countOf(note_entities),
  };
}
```

(import `KINDS`, `type Kind`, `type TopicRow` from `"../../topics/types"`; `countOf` is already in this file.) Add a sixth read to the `Promise.all`, for the owner only:

```ts
      hive.role === "owner"
        ? db
            .from("entities")
            // The hive's topics (at most 2,000 by the database's cap), each with the number
            // of notes attached to it that the owner can read.
            .select("id, type, canonical_name, note_entities(count)")
            .eq("hive_id", hive.id)
            .is("note_entities.detached_at", null)
            .order("type", { ascending: true })
            .order("canonical_name", { ascending: true })
            .limit(MAX_TOPICS)
        : { data: [], error: null },
```

with `const MAX_TOPICS = 2000;` beside the other caps, the tuple type extended by one `Res`, `failed("topics query", topicsRes)` added to `bad`, `const topics = all(topicsRes.data, toTopic);` beside the others and included in the shape check, and `topics,` in the returned `data`.

In `web/src/app/settings/load-settings.test.ts`: add `"topics"` handling to the stub the way `"invitations"` is handled (its table name is `entities`; if the stub's chain lacks `is`, add it to the chain's method list), add `topics: []` or the mapped rows to each expected `data`, and add:

```ts
it("reads the hive's topics for the owner with their note counts, and none for a member", async () => {
  const t = stub({
    entities: ok([
      {
        id: "t1",
        type: "client",
        canonical_name: "Zain",
        note_entities: [{ count: 12 }],
      },
      { id: "t2", type: "weird", canonical_name: "Dropped", note_entities: [] },
    ]),
  });
  const out = await loadSettings(t.db, NOW);
  // A row whose kind is unknown makes the whole answer unreadable, as for the other lists.
  expect(out.state).toBe("error");
  const good = stub({
    entities: ok([
      {
        id: "t1",
        type: "client",
        canonical_name: "Zain",
        note_entities: [{ count: 12 }],
      },
    ]),
  });
  const loaded = await loadSettings(good.db, NOW);
  if (loaded.state !== "ok") throw new Error("expected ok");
  expect(loaded.data.topics).toEqual([
    { id: "t1", kind: "client", name: "Zain", notes: 12 },
  ]);
});
```

Name the stub option to match how that file names its per-table answers (it uses the table's name for `members`, `workspaces`, `agents`, `invitations`).

In `web/src/app/settings/actions.ts` add:

```ts
import type { Proposal, ScanResult, TopicsSaved } from "../../topics/types";
import { deleteTopicIn, saveTopicsIn, scanTopicsIn } from "./topics";

export async function scanTopics(
  workspaceId: string,
  after: string | null,
): Promise<ScanResult> {
  return withSession<ScanResult>((db) => scanTopicsIn(db, workspaceId, after), {
    ok: false,
  });
}

/** `hiveId` is the hive the settings page was showing; the page binds it. */
export async function saveTopics(
  hiveId: string,
  picks: Proposal[],
): Promise<TopicsSaved> {
  return withSession<TopicsSaved>((db) => saveTopicsIn(db, hiveId, picks), {
    ok: false,
  });
}

export async function deleteTopic(id: string): Promise<Result> {
  return withSession<Result>((db) => deleteTopicIn(db, id), { ok: false });
}
```

In `web/src/app/settings/page.tsx` import the three and add to `actions`: `scanTopics, saveTopics: saveTopics.bind(null, result.hiveId), deleteTopic,`.

- [ ] **Step 5: The sentences, test first**

`web/src/settings/topicsText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as t from "./topicsText";

describe("the sentences of the Topics section", () => {
  it("names each kind in the plural", () => {
    expect(t.KIND_NAMES).toEqual({
      client: "Customers",
      project: "Projects",
      vendor: "Vendors",
      product: "Products",
      person: "People",
      subject: "Subjects",
    });
  });

  it("says how many notes a topic and a candidate have", () => {
    expect(t.topicNotes(0)).toBe("No notes yet");
    expect(t.topicNotes(1)).toBe("1 note");
    expect(t.topicNotes(12)).toBe("12 notes");
    expect(t.topicNotes(null)).toBeNull();
    expect(t.candidateNotes("subject", 7)).toBe("tag on 7 notes");
    expect(t.candidateNotes("client", 1)).toBeNull();
  });

  it("says what a save did", () => {
    expect(t.saved(0)).toBe("Those topics were already there.");
    expect(t.saved(1)).toBe("1 topic saved.");
    expect(t.saved(40)).toBe("40 topics saved.");
  });

  it("asks before deleting, and says what goes with the topic", () => {
    expect(t.deleteQuestion("Zain")).toBe("Delete the topic Zain?");
    expect(t.DELETE_ASIDE).toBe(
      "Notes stay. They are no longer under this topic.",
    );
  });
});
```

`web/src/settings/topicsText.ts`:

```ts
// Every sentence of the owner's Topics section in Settings.
import type { Kind } from "../topics/types";

export const TITLE = "Topics";
export const NOTE =
  "Customers, vendors, subjects: what notes are about. Every member's notes are attached to these by their folder, tags, title and text.";
export const FIND = "Find topics in my notes";
export const FINDING = "Reading your notes";
export const FOUND = "Topics found in your notes";
export const FOUND_NOTE =
  "From notes that say what they are, folders with an index note, and tags on five or more notes. Tick the ones this hive should have.";
export const NOTHING_NEW =
  "Nothing new found. Every topic your notes name is already here.";
export const SCAN_FAILED = "Your notes could not be read. Try again.";
export const SAVE = "Save topics";
export const CANCEL = "Cancel";
export const SAVE_FAILED = "The topics could not be saved. Try again.";
export const NEXT = "Now open the vault and press Attach topics.";
export const EMPTY_TITLE = "No topics yet.";
export const EMPTY_TEXT =
  "Find them in your notes, and every note in the hive can be put under a customer or subject.";
export const DELETE = "Delete";
export const KEEP = "Keep";
export const DELETE_ASIDE = "Notes stay. They are no longer under this topic.";
export const FAILED = "That didn't work. Try again.";

export const KIND_NAMES: Record<Kind, string> = {
  client: "Customers",
  project: "Projects",
  vendor: "Vendors",
  product: "Products",
  person: "People",
  subject: "Subjects",
};

const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function topicNotes(n: number | null): string | null {
  if (n === null) return null;
  return n === 0 ? "No notes yet" : many(n, "note");
}

/** Beside a candidate that came from a tag: how widely the tag is used. */
export function candidateNotes(kind: Kind, notes: number): string | null {
  return kind === "subject" && notes >= 5
    ? `tag on ${many(notes, "note")}`
    : null;
}

export function saved(n: number): string {
  return n === 0
    ? "Those topics were already there."
    : `${many(n, "topic")} saved.`;
}

export const deleteQuestion = (name: string) => `Delete the topic ${name}?`;
export const deleted = (name: string) => `${name} deleted.`;
export const pickLabel = (kindName: string, name: string) =>
  `${kindName}: ${name}`;
```

Note on `candidateNotes`: a subject proposed by one concept note has `notes` 1 and shows nothing; one proposed by a tag has `notes` 5 or more.

Run: `cd web && npx vitest run src/settings/topicsText.test.ts` — Expected: PASS.

- [ ] **Step 6: The section**

`web/src/settings/Topics.tsx`:

```tsx
"use client";

// The owner's Topics section. "Find topics in my notes" reads the heads of the owner's own
// notes a page at a time, works out the candidates in the browser, and shows the ones the hive
// does not have yet, ticked by kind; Save sends the ticked ones. Below, the hive's topics by
// kind, each with Delete, asked once. The database decides whether the person may; this only
// asks. Nothing here reads a note's text.
import { useEffect, useRef, useState } from "react";
import { candidates } from "../topics/candidates";
import { normal } from "../topics/normal";
import {
  KINDS,
  SAVE_CHUNK,
  type Candidate,
  type Kind,
  type NoteHead,
} from "../topics/types";
import * as t from "./topicsText";
import type { SettingsActions, TopicRow, Workspace } from "./types";
import s from "./settings.module.css";

/** Scan steps refused one after another before the reading gives up. */
const GIVE_UP_AFTER = 3;

type Stage =
  | { kind: "idle" }
  | { kind: "finding"; read: number }
  | {
      kind: "picking";
      found: Candidate[];
      ticked: ReadonlySet<number>;
      saving: boolean;
    };

const keyOf = (kind: Kind, name: string) => `${kind}|${normal(name)}`;

export function Topics({
  topics,
  workspaces,
  actions,
  closing,
  onSay,
  onChanged,
}: {
  topics: TopicRow[];
  /** The owner's own workspaces: where their notes are read from. */
  workspaces: Workspace[];
  actions: Pick<SettingsActions, "scanTopics" | "saveTopics" | "deleteTopic">;
  /** The hive is being deleted: nothing can be saved, so nothing is offered. */
  closing: boolean;
  onSay: (text: string) => void;
  /** Topics were saved or deleted: the page is read again. */
  onChanged: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const running = useRef(false);
  const alive = useRef(true);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The candidates replace the button: the focus goes to their heading.
  const picking = stage.kind === "picking";
  useEffect(() => {
    if (picking) heading.current?.focus();
  }, [picking]);

  const shown = topics.filter((x) => !gone.has(x.id));

  function say(text: string, failed = false) {
    setProblem(failed ? text : null);
    onSay(text);
  }

  async function find() {
    if (running.current) return;
    running.current = true;
    say("");
    setStage({ kind: "finding", read: 0 });
    const heads: NoteHead[] = [];
    let ok = true;
    reading: for (const w of workspaces) {
      let after: string | null = null;
      let streak = 0;
      for (;;) {
        let step: Awaited<ReturnType<typeof actions.scanTopics>>;
        try {
          step = await actions.scanTopics(w.id, after);
        } catch {
          step = { ok: false };
        }
        if (!alive.current) return;
        if (!step.ok || !Array.isArray(step.heads)) {
          streak += 1;
          if (streak >= GIVE_UP_AFTER) {
            ok = false;
            break reading;
          }
          continue;
        }
        streak = 0;
        heads.push(...step.heads);
        setStage({ kind: "finding", read: heads.length });
        if (
          step.next === null ||
          step.next === after ||
          step.heads.length === 0
        )
          break;
        after = step.next;
      }
    }
    running.current = false;
    if (!ok) {
      setStage({ kind: "idle" });
      return say(t.SCAN_FAILED, true);
    }
    const have = new Set(shown.map((x) => keyOf(x.kind, x.name)));
    const found = candidates(heads).filter(
      (c) => !have.has(keyOf(c.kind, c.name)),
    );
    if (found.length === 0) {
      setStage({ kind: "idle" });
      return say(t.NOTHING_NEW);
    }
    const ticked = new Set<number>();
    found.forEach((c, i) => {
      if (c.kind !== "subject") ticked.add(i);
    });
    setStage({ kind: "picking", found, ticked, saving: false });
  }

  async function save() {
    if (stage.kind !== "picking" || running.current || stage.ticked.size === 0)
      return;
    running.current = true;
    say("");
    setStage({ ...stage, saving: true });
    const picks = stage.found
      .filter((_, i) => stage.ticked.has(i))
      .map(({ kind, name, aliases }) => ({ kind, name, aliases }));
    let total = 0;
    let ok = true;
    for (let at = 0; at < picks.length && ok; at += SAVE_CHUNK) {
      let answer: Awaited<ReturnType<typeof actions.saveTopics>>;
      try {
        answer = await actions.saveTopics(picks.slice(at, at + SAVE_CHUNK));
      } catch {
        answer = { ok: false };
      }
      if (answer.ok) total += answer.saved;
      else ok = false;
    }
    running.current = false;
    if (!ok) {
      setStage({ ...stage, saving: false });
      // What went in before the refusal stays: the list is read again either way.
      if (total > 0) onChanged();
      return say(t.SAVE_FAILED, true);
    }
    setStage({ kind: "idle" });
    say(`${t.saved(total)} ${t.NEXT}`);
    onChanged();
    opener.current?.focus();
  }

  async function remove(topic: TopicRow) {
    if (running.current) return;
    running.current = true;
    setBusy(topic.id);
    say("");
    let ok = false;
    try {
      ok = (await actions.deleteTopic(topic.id)).ok;
    } catch {
      ok = false;
    }
    running.current = false;
    setBusy(null);
    setAsking(null);
    if (!ok) return say(t.FAILED, true);
    setGone((set) => new Set(set).add(topic.id));
    say(t.deleted(topic.name));
    onChanged();
  }

  return (
    <section aria-labelledby="settings-topics" className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-topics">{t.TITLE}</span>
            <span className={s.count}>{shown.length}</span>
          </h2>
          <p className={s.note}>{t.NOTE}</p>
        </div>
        {stage.kind !== "picking" && !closing && (
          <button
            ref={opener}
            type="button"
            className={s.primary}
            aria-disabled={stage.kind === "finding" || undefined}
            onClick={() => void find()}
          >
            {t.FIND}
          </button>
        )}
      </div>

      {stage.kind === "finding" && (
        <p role="status" className={s.note}>
          {t.FINDING}: {stage.read}
        </p>
      )}
      {problem && stage.kind !== "picking" && (
        <p className={s.refused}>{problem}</p>
      )}

      {stage.kind === "picking" && (
        <form
          aria-labelledby="settings-topics-found"
          className={s.form}
          aria-busy={stage.saving || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3
            ref={heading}
            id="settings-topics-found"
            tabIndex={-1}
            className={s.fieldLabel}
          >
            {t.FOUND}
          </h3>
          <p className={s.hint}>{t.FOUND_NOTE}</p>
          {KINDS.map((kind) => {
            const of = stage.found
              .map((c, i) => ({ c, i }))
              .filter(({ c }) => c.kind === kind);
            if (of.length === 0) return null;
            return (
              <fieldset key={kind} className={s.field}>
                <legend className={s.fieldLabel}>
                  {t.KIND_NAMES[kind]}{" "}
                  <span className={s.count}>{of.length}</span>
                </legend>
                <ul role="list" className={s.rows}>
                  {of.map(({ c, i }) => {
                    const extra = t.candidateNotes(c.kind, c.notes);
                    return (
                      <li key={i} className={s.item}>
                        <label className={s.text}>
                          <input
                            type="checkbox"
                            checked={stage.ticked.has(i)}
                            disabled={stage.saving}
                            aria-label={t.pickLabel(t.KIND_NAMES[kind], c.name)}
                            onChange={(e) => {
                              const ticked = new Set(stage.ticked);
                              if (e.currentTarget.checked) ticked.add(i);
                              else ticked.delete(i);
                              setStage({ ...stage, ticked });
                            }}
                          />{" "}
                          <span className={s.name}>{c.name}</span>
                          {extra && <span className={s.mark}>{extra}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
          <div className={s.formFoot}>
            <button
              type="submit"
              className={s.primary}
              aria-disabled={
                stage.saving || stage.ticked.size === 0 || undefined
              }
            >
              {t.SAVE}
            </button>
            <button
              type="button"
              className={s.secondary}
              aria-disabled={stage.saving || undefined}
              onClick={() => {
                if (stage.saving) return;
                setStage({ kind: "idle" });
                setProblem(null);
              }}
            >
              {t.CANCEL}
            </button>
            {problem && <p className={s.refused}>{problem}</p>}
          </div>
        </form>
      )}

      {shown.length === 0 && stage.kind === "idle" ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>{t.EMPTY_TITLE}</p>
          <p className={s.emptyText}>{t.EMPTY_TEXT}</p>
        </div>
      ) : (
        KINDS.map((kind) => {
          const of = shown.filter((x) => x.kind === kind);
          if (of.length === 0) return null;
          return (
            <ul
              key={kind}
              role="list"
              aria-label={t.KIND_NAMES[kind]}
              className={s.rows}
            >
              {of.map((topic) => {
                const notes = t.topicNotes(topic.notes);
                const isAsking = asking === topic.id;
                const off = busy === topic.id || undefined;
                return (
                  <li key={topic.id} className={s.item} aria-busy={off}>
                    <div className={s.text}>
                      <p className={s.what}>
                        <span className={s.name}>{topic.name}</span>
                      </p>
                      <p className={s.meta}>
                        <span>{t.KIND_NAMES[kind]}</span>
                        {notes && <span>{notes}</span>}
                      </p>
                    </div>
                    {!closing && (
                      <div className={s.side}>
                        <div
                          role="group"
                          aria-label={`${t.DELETE} ${topic.name}`}
                          className={s.actions}
                        >
                          {isAsking ? (
                            <>
                              <p className={s.ask}>
                                {t.deleteQuestion(topic.name)}
                              </p>
                              <button
                                type="button"
                                className={s.confirm}
                                aria-disabled={off}
                                onClick={() => void remove(topic)}
                              >
                                {t.DELETE}
                              </button>
                              <button
                                type="button"
                                className={s.secondary}
                                aria-disabled={off}
                                onClick={() => setAsking(null)}
                              >
                                {t.KEEP}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className={s.secondary}
                              aria-label={`${t.DELETE} ${topic.name}`}
                              onClick={() => setAsking(topic.id)}
                            >
                              {t.DELETE}
                            </button>
                          )}
                        </div>
                        {isAsking && (
                          <p className={s.aside}>{t.DELETE_ASIDE}</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })
      )}
    </section>
  );
}
```

Every class used (`section`, `sectionHead`, `headText`, `label`, `count`, `note`, `primary`, `secondary`, `confirm`, `refused`, `form`, `field`, `fieldLabel`, `hint`, `formFoot`, `rows`, `item`, `text`, `what`, `name`, `mark`, `meta`, `side`, `actions`, `ask`, `aside`, `empty`, `emptyTitle`, `emptyText`) is already in `settings.module.css`. Add no new CSS and no colour.

In `web/src/settings/Settings.tsx`: `import { Topics } from "./Topics";` and, directly after the `<Workspaces … />` element, add:

```tsx
{
  data.isOwner && (
    <Topics
      topics={data.topics}
      workspaces={data.workspaces}
      actions={actions}
      closing={closing !== null}
      onSay={setSaid}
      onChanged={() => router.refresh()}
    />
  );
}
```

- [ ] **Step 7: Fixture and dev stand-in**

In `web/src/settings/fixture.ts` add to the returned data `topics: opts.member ? [] : TOPICS.map((x) => ({ ...x })),` with:

```ts
const TOPICS: TopicRow[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    kind: "client",
    name: "Zain",
    notes: 198,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    kind: "vendor",
    name: "Terra Drone",
    notes: 0,
  },
];

/** The heads the dev page's scan answers: one new customer, one known, a tag on five notes. */
export function fixtureHeads(): NoteHead[] {
  const tagged = Array.from({ length: 5 }, (_, i) => ({
    path: `Sessions/s${i}.md`,
    title: `Session ${i}`,
    type: "session",
    aliases: [],
    tags: ["flare-stack"],
  }));
  return [
    {
      path: "Employers/Orbit/_Index.md",
      title: "Orbit",
      type: "client-entity",
      aliases: [],
      tags: [],
    },
    {
      path: "Employers/Zain/_Index.md",
      title: "Zain",
      type: "client-entity",
      aliases: [],
      tags: [],
    },
    ...tagged,
  ];
}
```

(import `NoteHead`, `TopicRow` from `"../topics/types"`.) Update `fixture.test.ts` if it lists the keys of the fixture's data.

In `web/src/app/dev/settings/DevSettings.tsx` add to `actions`:

```ts
scanTopics: async (workspaceId, after) => {
  record("scanTopics", [workspaceId, after]);
  await wait();
  if (fail) return { ok: false };
  // Everything on the first workspace's first page; the others hold nothing.
  const first = data.workspaces[0]?.id === workspaceId && after === null;
  return { ok: true, heads: first ? fixtureHeads() : [], next: null };
},
saveTopics: async (picks) => {
  record("saveTopics", [picks]);
  await wait();
  if (fail) return { ok: false };
  setData((d) => ({
    ...d,
    topics: [
      ...d.topics,
      ...picks.map((p, i) => ({
        id: `00000000-0000-4000-8000-0000000b${String(100 + d.topics.length + i)}`,
        kind: p.kind,
        name: p.name,
        notes: 0,
      })),
    ],
  }));
  return { ok: true, saved: picks.length };
},
deleteTopic: async (id) => {
  record("deleteTopic", [id]);
  await wait();
  if (fail) return { ok: false };
  setData((d) => ({ ...d, topics: d.topics.filter((x) => x.id !== id) }));
  return { ok: true };
},
```

- [ ] **Step 8: Browser tests**

Append to `web/e2e/settings.spec.ts`:

```ts
// ---- Topics ----

const topics = (page: Page) => section(page, "Topics");
const findTopics = (page: Page) =>
  topics(page).getByRole("button", { name: "Find topics in my notes" });

test("Topics: the owner finds candidates, new ones only, with subjects unticked; Save adds the ticked ones", async ({
  page,
}) => {
  await open(page);
  await expect(topics(page)).toContainText("Zain");
  await expect(topics(page)).toContainText("198 notes");
  await expect(topics(page)).toContainText("No notes yet");

  await findTopics(page).click();
  const found = topics(page).getByRole("form", {
    name: "Topics found in your notes",
  });
  await expect(
    found.getByRole("heading", { name: "Topics found in your notes" }),
  ).toBeFocused();
  // Zain is there already: only Orbit and the tag are offered.
  const orbit = found.getByRole("checkbox", { name: "Customers: Orbit" });
  const flare = found.getByRole("checkbox", { name: "Subjects: flare-stack" });
  await expect(orbit).toBeChecked();
  await expect(flare).not.toBeChecked();
  await expect(found.getByRole("checkbox", { name: /Zain/ })).toHaveCount(0);
  await expect(found).toContainText("tag on 5 notes");

  await found.getByRole("button", { name: "Save topics" }).click();
  await expect(found).toHaveCount(0);
  await expect(live(page)).toHaveText(
    "1 topic saved. Now open the vault and press Attach topics.",
  );
  await expect(
    topics(page).getByRole("list", { name: "Customers" }),
  ).toContainText("Orbit");
  const saves = (await calls(page)).filter((c) => c.name === "saveTopics");
  expect(saves).toEqual([
    {
      name: "saveTopics",
      args: [[{ kind: "client", name: "Orbit", aliases: [] }]],
    },
  ]);
  // Both of the owner's workspaces were read, from the start.
  expect(
    (await calls(page))
      .filter((c) => c.name === "scanTopics")
      .map((c) => c.args),
  ).toEqual([
    [MAIN.id, null],
    [DRA.id, null],
  ]);
});

test("Topics: Delete asks first and says the notes stay; a failed read or save says so", async ({
  page,
}) => {
  await open(page);
  const row = topics(page)
    .getByRole("listitem")
    .filter({ hasText: "Terra Drone" });
  await row.getByRole("button", { name: "Delete Terra Drone" }).click();
  await expect(row).toContainText("Delete the topic Terra Drone?");
  await expect(row).toContainText(
    "Notes stay. They are no longer under this topic.",
  );
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(live(page)).toHaveText("Terra Drone deleted.");

  await open(page, "?fail=1");
  await findTopics(page).click();
  await expect(topics(page)).toContainText(
    "Your notes could not be read. Try again.",
  );
});

test("Topics: a member who is not the owner has no such section", async ({
  page,
}) => {
  await open(page, "?member=1");
  await expect(topics(page)).toHaveCount(0);
});
```

Two older tests in this file walk the card by Tab and assert the page does not scroll at 1100 x 560 ("the keyboard reaches every control…", and the one with the invite form open). The new section adds controls between the workspaces' Delete buttons and "Invite a member": extend the Tab walk with `Find topics in my notes`, then `Delete Zain`, then `Delete Terra Drone`. The no-scroll assertions measure the page, not the card's inner scroller, and should still hold; if one fails, read the measurement before changing anything.

Check the port first (`lsof -nP -iTCP:3100 -sTCP:LISTEN`; another session's server on it would serve another branch), then:

Run: `cd web && npx playwright test e2e/settings.spec.ts --project=chromium`
Expected: every test PASS.

- [ ] **Step 9: Unit tests, typecheck, format, commit**

```bash
cd web && npx prettier --write src/settings src/app/settings src/app/dev/settings e2e/settings.spec.ts && npx tsc --noEmit && npx vitest run && cd ..
git add web/src/app/settings/topics.ts web/src/app/settings/topics.test.ts web/src/app/settings/actions.ts web/src/app/settings/page.tsx web/src/app/settings/load-settings.ts web/src/app/settings/load-settings.test.ts web/src/settings/Topics.tsx web/src/settings/topicsText.ts web/src/settings/topicsText.test.ts web/src/settings/Settings.tsx web/src/settings/types.ts web/src/settings/fixture.ts web/src/app/dev/settings/DevSettings.tsx web/e2e/settings.spec.ts
git commit -m "feat(settings): the owner finds topics in their notes, saves them and deletes them"
```

(Also `git add web/src/settings/fixture.test.ts` if it changed.)

---

### Task 6: Closure

**Files:**

- Modify: `docs/ui-concept.md`

**Interfaces:**

- Consumes: everything above.
- Produces: the merged feature on `develop`.

- [ ] **Step 1: Document the two screens**

In `docs/ui-concept.md`, in the Settings paragraph, after the Workspaces sentences, add:

```markdown
The owner also has **Topics**: the hive's customers, projects, vendors, products, people and
subjects, by kind, each with the number of notes under it and **Delete** (asked once; the
notes stay). **Find topics in my notes** reads the owner's own notes, never their text, and
lists the topics they name that the hive does not have yet, ticked by kind with subjects
unticked; **Save topics** adds the ticked ones.
```

and in the vault's section, where "Connect wiki links" is described, add:

```markdown
Beside it, **Attach topics** puts each of the person's notes in that workspace under the
hive's topics it belongs to (by folder, tag, title, then text; at most five), and shows three
counts: attached, already attached, notes with no topic. A folder import runs it by itself as
its last stage. In a hive with no topics it says where topics come from.
```

Run: `npx prettier --write docs/ui-concept.md`

- [ ] **Step 2: The four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. Paste the last lines of each into the report.

- [ ] **Step 3: Commit and finish**

```bash
git add docs/ui-concept.md
git commit -m "docs(ui): the Topics section and Attach topics"
scripts/finish-task.sh
```

Expected: "rebased onto develop, gated, merged, pushed, worktree removed, branch deleted". If the rebase conflicts, resolve `git rebase develop` and run it again.

- [ ] **Step 4: The hosted database (Danijel runs this)**

An agent's `supabase db push` is blocked by the permission check. Ask Danijel to run, from the main checkout: `supabase db push`. Expected: it lists only `<stamp>_topics.sql` and applies it.

- [ ] **Step 5: Live check on Synapse, by hand, and report the numbers**

1. Settings → Topics → Find topics in my notes → Save topics.
2. Vault → Main → Attach topics → Start.
3. Report the three counts shown, and run this through the `supabase-dev` MCP to compare with the spec's bar (at least 450 of the 692 notes that had no link now have a topic):

```sql
select count(*) filter (where has_topic) as with_topic, count(*) as unlinked
from (
  select exists (select 1 from note_entities ne
                  where ne.note_id = n.id and ne.detached_at is null) as has_topic
  from notes n
  join workspaces w on w.id = n.workspace_id
  join hives h on h.id = n.hive_id
  where h.name = 'Synapse' and w.name = 'Main'
    and not exists (select 1 from links l where l.from_note = n.id or l.to_note = n.id)
) x;
```

- [ ] **Step 6: Hand over**

Give Danijel a numbered "How to test this" (steps 1 to 3 above with the expected results), and say plainly that part 2 (a note's topics in the vault with remove and add; "Group by Topic" on the map) is not built yet and waits for `task/map-chrome`.
